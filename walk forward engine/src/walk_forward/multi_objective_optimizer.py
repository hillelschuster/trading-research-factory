"""
Multi-Objective Optimization Framework for Walk-Forward Analysis.

This module implements sophisticated multi-objective optimization functions that include
stability penalties and turnover costs, replacing basic Sharpe ratio optimization
with industry-standard robust parameter selection methods.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Tuple, Any, Callable, Union

import numpy as np
import pandas as pd

from .parameter_tracker import ParameterShelfLifeTracker
from .wfa_efficiency import WFAEfficiencyCalculator
from .transaction_cost_modeler import TransactionCostModeler, TradeExecution, AssetClass
from .cost_stress_tester import CostStressTester, StressScenario


class ObjectiveFunction(Enum):
    """Available objective functions for optimization."""
    SHARPE_RATIO = "sharpe_ratio"
    SHARPE_WITH_TURNOVER_PENALTY = "sharpe_with_turnover_penalty"
    DRAWDOWN_ADJUSTED_CAGR = "drawdown_adjusted_cagr"
    CALMAR_RATIO = "calmar_ratio"
    SORTINO_RATIO = "sortino_ratio"
    RANK_AGGREGATION = "rank_aggregation"
    STABILITY_WEIGHTED_SHARPE = "stability_weighted_sharpe"
    MULTI_OBJECTIVE_COMPOSITE = "multi_objective_composite"
    COST_ADJUSTED_SHARPE = "cost_adjusted_sharpe"
    COST_ADJUSTED_RETURN = "cost_adjusted_return"
    STRESS_TESTED_PERFORMANCE = "stress_tested_performance"


class StabilityMetric(Enum):
    """Stability metrics for parameter assessment."""
    PARAMETER_VARIANCE = "parameter_variance"
    PERFORMANCE_CONSISTENCY = "performance_consistency"
    HYPERPARAMETER_SENSITIVITY = "hyperparameter_sensitivity"
    FOLD_CORRELATION = "fold_correlation"
    REGIME_ROBUSTNESS = "regime_robustness"


@dataclass
class ObjectiveConfig:
    """Configuration for objective function."""
    function: ObjectiveFunction
    weight: float = 1.0
    parameters: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.parameters is None:
            self.parameters = {}


@dataclass
class StabilityConfig:
    """Configuration for stability penalties."""
    enabled: bool = True
    variance_penalty_weight: float = 0.1
    sensitivity_penalty_weight: float = 0.05
    consistency_bonus_weight: float = 0.1
    turnover_penalty_rate: float = 0.001  # Per trade turnover cost
    max_parameter_deviation: float = 0.2  # 20% max deviation threshold


@dataclass
class MultiObjectiveConfig:
    """Configuration for multi-objective optimization."""
    primary_objective: ObjectiveConfig
    secondary_objectives: List[ObjectiveConfig]
    stability_config: StabilityConfig
    aggregation_method: str = "weighted_sum"  # weighted_sum, pareto_front, rank_based
    normalization_method: str = "z_score"  # z_score, min_max, robust
    
    def get_total_weight(self) -> float:
        """Get total weight of all objectives."""
        total = self.primary_objective.weight
        total += sum(obj.weight for obj in self.secondary_objectives)
        return total


@dataclass
class OptimizationResult:
    """Result from multi-objective optimization."""
    parameters: Dict[str, Any]
    objective_scores: Dict[ObjectiveFunction, float]
    stability_scores: Dict[StabilityMetric, float]
    composite_score: float
    penalty_applied: float
    fold_performance: List[float]
    created_at: datetime


class MultiObjectiveOptimizer:
    """
    Multi-objective optimization framework with stability penalties.
    
    Implements sophisticated objective functions that include stability penalties
    and turnover costs for robust parameter selection in WFA.
    """
    
    def __init__(self,
                 config: MultiObjectiveConfig,
                 parameter_tracker: Optional[ParameterShelfLifeTracker] = None,
                 cost_modeler: Optional[TransactionCostModeler] = None,
                 stress_tester: Optional[CostStressTester] = None,
                 logger: Optional[logging.Logger] = None):
        """
        Initialize multi-objective optimizer with cost modeling support.

        Args:
            config: Multi-objective optimization configuration
            parameter_tracker: Parameter tracker for stability analysis
            cost_modeler: Transaction cost modeler for realistic cost calculation
            stress_tester: Cost stress tester for robustness validation
            logger: Logger instance
        """
        self.config = config
        self.parameter_tracker = parameter_tracker
        self.cost_modeler = cost_modeler or TransactionCostModeler()
        self.stress_tester = stress_tester or CostStressTester(self.cost_modeler)
        self.logger = logger or logging.getLogger(__name__)

        # Strategy context for cost modeling
        self.strategy_symbol: Optional[str] = None
        self.strategy_asset_class: Optional[AssetClass] = None

        # Optimization history
        self.optimization_history: List[OptimizationResult] = []
        self.fold_results: Dict[int, List[Dict[str, float]]] = {}

        # Stability tracking
        self.parameter_history: List[Dict[str, Any]] = []
        self.performance_history: List[float] = []

    def set_strategy_context(self, symbol: str) -> None:
        """Set strategy context for accurate cost modeling."""
        self.strategy_symbol = symbol
        self.strategy_asset_class = self.cost_modeler.infer_asset_class_from_symbol(symbol)
        self.logger.info(f"Strategy context set: {symbol} -> {self.strategy_asset_class.value}")

    def get_effective_asset_class(self) -> AssetClass:
        """Get effective asset class for cost calculations."""
        return self.strategy_asset_class or AssetClass.FOREX

    def get_effective_symbol(self) -> str:
        """Get effective symbol for cost calculations."""
        return self.strategy_symbol or "EURUSD"

    # ---- Metric safety helpers ----
    def _safe_metric(self, value: Any, metric: str) -> float:
        """Coerce None/NaN to safe defaults for objective calculations."""
        defaults = {
            'max_drawdown_pct': -0.01,    # small negative to avoid div by zero
            'annual_return_pct': 0.0,
            'total_return_pct': 0.0,
            'sharpe_ratio': 0.0,
            'sortino_ratio': 0.0,
            'total_trades': 0,
        }
        if value is None:
            return defaults.get(metric, 0.0)
        try:
            # Convert to float when appropriate; allow int for total_trades
            if metric == 'total_trades':
                v = int(value)
            else:
                v = float(value)
            if isinstance(v, float) and (np.isnan(v) or np.isinf(v)):
                return defaults.get(metric, 0.0)
            return v
        except Exception:
            return defaults.get(metric, 0.0)

        # Cost modeling data
        self.trade_executions: List[TradeExecution] = []
        self.cost_adjusted_results: Dict[str, Any] = {}

        self.logger.info(f"MultiObjectiveOptimizer initialized with {config.primary_objective.function.value} and cost modeling")

    def evaluate_parameters(self,
                          parameters: Dict[str, Any],
                          backtest_results: Dict[str, float],
                          fold_id: Optional[int] = None,
                          previous_parameters: Optional[Dict[str, Any]] = None) -> float:
        """
        Evaluate parameters using multi-objective optimization with stability penalties.

        Args:
            parameters: Parameter set to evaluate
            backtest_results: Results from backtest execution
            fold_id: Current fold identifier for tracking
            previous_parameters: Previous parameter set for turnover calculation

        Returns:
            Composite optimization score
        """
        # Calculate individual objective scores
        objective_scores = self._calculate_objective_scores(parameters, backtest_results)

        # Calculate stability scores
        stability_scores = self._calculate_stability_scores(parameters, backtest_results, fold_id)
        
        # Apply stability penalties
        penalty = self._calculate_stability_penalty(stability_scores, parameters, previous_parameters)
        
        # Aggregate objectives
        composite_score = self._aggregate_objectives(objective_scores, stability_scores, penalty)
        
        # Store results for tracking
        if fold_id is not None:
            if fold_id not in self.fold_results:
                self.fold_results[fold_id] = []
            
            self.fold_results[fold_id].append({
                'parameters': parameters.copy(),
                'objective_scores': objective_scores.copy(),
                'stability_scores': stability_scores.copy(),
                'composite_score': composite_score,
                'penalty': penalty
            })
        
        # Update history
        self.parameter_history.append(parameters.copy())
        self.performance_history.append(composite_score)

        # Store optimization result
        optimization_result = OptimizationResult(
            parameters=parameters.copy(),
            objective_scores=objective_scores,
            stability_scores=stability_scores,
            composite_score=composite_score,
            penalty_applied=penalty,
            fold_performance=[composite_score],  # Single fold performance
            created_at=datetime.now()
        )
        self.optimization_history.append(optimization_result)

        return composite_score
    
    def _calculate_objective_scores(self, 
                                  parameters: Dict[str, Any],
                                  backtest_results: Dict[str, float]) -> Dict[ObjectiveFunction, float]:
        """Calculate scores for all objective functions."""
        scores = {}
        
        # Primary objective
        scores[self.config.primary_objective.function] = self._calculate_single_objective(
            self.config.primary_objective.function, backtest_results, parameters
        )
        
        # Secondary objectives
        for obj_config in self.config.secondary_objectives:
            scores[obj_config.function] = self._calculate_single_objective(
                obj_config.function, backtest_results, parameters
            )
        
        return scores
    
    def _calculate_single_objective(self,
                                  objective: ObjectiveFunction,
                                  backtest_results: Dict[str, float],
                                  parameters: Dict[str, Any]) -> float:
        """Calculate score for a single objective function."""
        try:
            if objective == ObjectiveFunction.SHARPE_RATIO:
                sharpe = self._safe_metric(backtest_results.get('sharpe_ratio'), 'sharpe_ratio')
                return float(sharpe)

            elif objective == ObjectiveFunction.SHARPE_WITH_TURNOVER_PENALTY:
                sharpe = self._safe_metric(backtest_results.get('sharpe_ratio'), 'sharpe_ratio')
                trade_count = int(self._safe_metric(backtest_results.get('total_trades'), 'total_trades'))
                turnover_penalty = trade_count * self.config.stability_config.turnover_penalty_rate
                return float(sharpe) - float(turnover_penalty)

            elif objective == ObjectiveFunction.DRAWDOWN_ADJUSTED_CAGR:
                total_return = self._safe_metric(backtest_results.get('total_return_pct'), 'total_return_pct')
                max_drawdown = self._safe_metric(backtest_results.get('max_drawdown_pct'), 'max_drawdown_pct')
                # Ensure denominator positive for ratio; use magnitude of drawdown
                denom = abs(float(max_drawdown))
                if denom == 0.0:
                    denom = 0.01
                return float(total_return) / denom

            elif objective == ObjectiveFunction.CALMAR_RATIO:
                annual_return = self._safe_metric(backtest_results.get('annual_return_pct'), 'annual_return_pct')
                max_drawdown = self._safe_metric(backtest_results.get('max_drawdown_pct'), 'max_drawdown_pct')
                denom = abs(float(max_drawdown))
                if denom == 0.0:
                    denom = 0.01
                return float(annual_return) / denom

            elif objective == ObjectiveFunction.SORTINO_RATIO:
                sortino = self._safe_metric(backtest_results.get('sortino_ratio'), 'sortino_ratio')
                if sortino == 0.0:
                    # Fallback to Sharpe if Sortino missing/zero
                    return self._safe_metric(backtest_results.get('sharpe_ratio'), 'sharpe_ratio')
                return float(sortino)

            elif objective == ObjectiveFunction.RANK_AGGREGATION:
                # Rank-based aggregation of multiple metrics
                metrics = ['sharpe_ratio', 'profit_factor', 'win_rate']
                ranks = []
                for metric in metrics:
                    value = self._safe_metric(backtest_results.get(metric), metric)
                    # Simple ranking approximation (would need historical data for true ranking)
                    rank = min(1.0, max(0.0, float(value)))
                    ranks.append(rank)
                return float(np.mean(ranks))

            elif objective == ObjectiveFunction.STABILITY_WEIGHTED_SHARPE:
                sharpe = self._safe_metric(backtest_results.get('sharpe_ratio'), 'sharpe_ratio')
                # Apply stability weighting (calculated separately)
                return float(sharpe)  # Stability weighting applied in aggregation

            elif objective == ObjectiveFunction.COST_ADJUSTED_SHARPE:
                sharpe = self._safe_metric(backtest_results.get('sharpe_ratio'), 'sharpe_ratio')
                # Apply realistic cost adjustment
                cost_adjustment = self._calculate_cost_adjustment(backtest_results, parameters)
                return float(sharpe) - float(cost_adjustment)

            elif objective == ObjectiveFunction.COST_ADJUSTED_RETURN:
                total_return = self._safe_metric(backtest_results.get('total_return_pct'), 'total_return_pct')
                # Apply realistic cost adjustment
                cost_bps = self._calculate_realistic_cost_bps(backtest_results, parameters)
                cost_percentage = float(cost_bps) / 100.0  # Convert bps to percentage
                return float(total_return) - cost_percentage

            elif objective == ObjectiveFunction.STRESS_TESTED_PERFORMANCE:
                # Calculate performance under moderate stress scenario
                stress_performance = self._calculate_stress_tested_performance(backtest_results, parameters)
                return float(stress_performance)

            else:
                self.logger.warning(f"Unknown objective function: {objective}")
                return 0.0

        except Exception as e:
            self.logger.error(f"Error calculating objective {objective}: {e}")
            return 0.0

    def _calculate_stability_scores(self, 
                                  parameters: Dict[str, Any],
                                  backtest_results: Dict[str, float],
                                  fold_id: Optional[int]) -> Dict[StabilityMetric, float]:
        """Calculate stability scores for parameter set."""
        scores = {}
        
        try:
            # Parameter variance across folds
            if len(self.parameter_history) > 1:
                param_variance = self._calculate_parameter_variance(parameters)
                scores[StabilityMetric.PARAMETER_VARIANCE] = 1.0 - min(1.0, param_variance)
            else:
                scores[StabilityMetric.PARAMETER_VARIANCE] = 1.0
            
            # Performance consistency
            if len(self.performance_history) > 1:
                performance_std = np.std(self.performance_history[-10:])  # Last 10 results
                performance_mean = np.mean(self.performance_history[-10:])
                if performance_mean != 0:
                    cv = performance_std / abs(performance_mean)
                    scores[StabilityMetric.PERFORMANCE_CONSISTENCY] = 1.0 - min(1.0, cv)
                else:
                    scores[StabilityMetric.PERFORMANCE_CONSISTENCY] = 0.0
            else:
                scores[StabilityMetric.PERFORMANCE_CONSISTENCY] = 1.0
            
            # Hyperparameter sensitivity (simplified)
            scores[StabilityMetric.HYPERPARAMETER_SENSITIVITY] = 0.8  # Placeholder
            
            # Fold correlation (if multiple folds available)
            if fold_id is not None and len(self.fold_results) > 1:
                fold_correlation = self._calculate_fold_correlation()
                scores[StabilityMetric.FOLD_CORRELATION] = fold_correlation
            else:
                scores[StabilityMetric.FOLD_CORRELATION] = 1.0
            
            # Regime robustness (placeholder)
            scores[StabilityMetric.REGIME_ROBUSTNESS] = 0.7
            
        except Exception as e:
            self.logger.error(f"Error calculating stability scores: {e}")
            # Return default scores
            for metric in StabilityMetric:
                scores[metric] = 0.5
        
        return scores
    
    def _calculate_parameter_variance(self, current_parameters: Dict[str, Any]) -> float:
        """Calculate variance of parameters across optimization history."""
        if len(self.parameter_history) < 2:
            return 0.0
        
        variances = []
        for param_name in current_parameters.keys():
            if param_name in self.parameter_history[-1]:
                # Get recent parameter values
                recent_values = []
                for hist_params in self.parameter_history[-10:]:  # Last 10 parameter sets
                    if param_name in hist_params:
                        recent_values.append(float(hist_params[param_name]))
                
                if len(recent_values) > 1:
                    param_variance = np.var(recent_values)
                    # Normalize by parameter range (simplified)
                    normalized_variance = param_variance / max(1.0, np.mean(recent_values))
                    variances.append(normalized_variance)
        
        return np.mean(variances) if variances else 0.0
    
    def _calculate_fold_correlation(self) -> float:
        """Calculate correlation of performance across folds."""
        if len(self.fold_results) < 2:
            return 1.0
        
        fold_performances = []
        for fold_id, results in self.fold_results.items():
            if results:
                fold_performances.append([r['composite_score'] for r in results])
        
        if len(fold_performances) < 2:
            return 1.0
        
        # Calculate correlation between fold performances (simplified)
        try:
            # Use last performance from each fold
            last_performances = [perf[-1] if perf else 0.0 for perf in fold_performances]
            if len(set(last_performances)) > 1:
                correlation = np.corrcoef(last_performances[:-1], last_performances[1:])[0, 1]
                return max(0.0, correlation) if not np.isnan(correlation) else 0.5
            else:
                return 1.0
        except Exception:
            return 0.5
    
    def _calculate_stability_penalty(self, 
                                   stability_scores: Dict[StabilityMetric, float],
                                   parameters: Dict[str, Any],
                                   previous_parameters: Optional[Dict[str, Any]]) -> float:
        """Calculate stability penalty based on stability scores."""
        if not self.config.stability_config.enabled:
            return 0.0
        
        penalty = 0.0
        
        # Parameter variance penalty
        variance_score = stability_scores.get(StabilityMetric.PARAMETER_VARIANCE, 1.0)
        penalty += (1.0 - variance_score) * self.config.stability_config.variance_penalty_weight
        
        # Performance consistency penalty
        consistency_score = stability_scores.get(StabilityMetric.PERFORMANCE_CONSISTENCY, 1.0)
        penalty += (1.0 - consistency_score) * self.config.stability_config.sensitivity_penalty_weight
        
        # Parameter deviation penalty (if previous parameters available)
        if previous_parameters:
            deviation_penalty = self._calculate_parameter_deviation_penalty(parameters, previous_parameters)
            penalty += deviation_penalty
        
        return penalty

    def _calculate_cost_adjustment(self,
                                 backtest_results: Dict[str, float],
                                 parameters: Dict[str, Any]) -> float:
        """Calculate cost adjustment for Sharpe ratio based on realistic transaction costs."""
        try:
            # Extract trade information from backtest results
            total_trades = int(self._safe_metric(backtest_results.get('total_trades'), 'total_trades'))
            _ = self._safe_metric(backtest_results.get('total_return_pct'), 'total_return_pct')

            if total_trades == 0:
                return 0.0

            # Estimate average trade size and create sample executions
            # This is a simplified approach - in practice, you'd have actual trade data
            avg_trade_size = 10000  # $10k average trade size
            sample_executions = self._create_sample_executions(
                total_trades, avg_trade_size, self.get_effective_asset_class()
            )

            # Calculate portfolio costs
            portfolio_costs = self.cost_modeler.calculate_portfolio_costs(sample_executions)
            cost_bps = float(portfolio_costs.get('portfolio_cost_bps', 0.0))

            # Convert cost impact to Sharpe ratio adjustment (bps -> ratio approx)
            cost_adjustment = cost_bps / 100.0

            return float(cost_adjustment)

        except Exception as e:
            self.logger.warning(f"Error calculating cost adjustment: {e}")
            return 0.0

    def _calculate_realistic_cost_bps(self,
                                    backtest_results: Dict[str, float],
                                    parameters: Dict[str, Any]) -> float:
        """Calculate realistic transaction costs in basis points."""
        try:
            total_trades = int(self._safe_metric(backtest_results.get('total_trades'), 'total_trades'))

            if total_trades == 0:
                return 0.0

            # Create sample executions
            avg_trade_size = 10000
            sample_executions = self._create_sample_executions(
                total_trades, avg_trade_size, self.get_effective_asset_class()
            )

            # Calculate portfolio costs
            portfolio_costs = self.cost_modeler.calculate_portfolio_costs(sample_executions)

            return float(portfolio_costs.get('portfolio_cost_bps', 0.0))

        except Exception as e:
            self.logger.warning(f"Error calculating realistic cost bps: {e}")
            return 0.0

    def _calculate_stress_tested_performance(self,
                                           backtest_results: Dict[str, float],
                                           parameters: Dict[str, Any]) -> float:
        """Calculate performance under moderate stress scenario."""
        try:
            # Use moderate stress scenario (25% cost increase)
            stress_multiplier = 1.25

            total_trades = int(self._safe_metric(backtest_results.get('total_trades'), 'total_trades'))
            sharpe_ratio = float(self._safe_metric(backtest_results.get('sharpe_ratio'), 'sharpe_ratio'))

            if total_trades == 0:
                return sharpe_ratio

            # Create sample executions
            avg_trade_size = 10000
            sample_executions = self._create_sample_executions(
                total_trades, avg_trade_size, self.get_effective_asset_class()
            )

            # Calculate stressed costs
            stressed_costs = self.cost_modeler.calculate_portfolio_costs(
                sample_executions, stress_multiplier
            )

            # Apply cost impact to performance
            additional_cost_bps = stressed_costs['portfolio_cost_bps'] - \
                                self.cost_modeler.calculate_portfolio_costs(sample_executions)['portfolio_cost_bps']

            # Adjust Sharpe ratio for additional costs
            stress_adjusted_sharpe = sharpe_ratio - (additional_cost_bps / 100)

            return stress_adjusted_sharpe

        except Exception as e:
            self.logger.warning(f"Error calculating stress tested performance: {e}")
            return backtest_results.get('sharpe_ratio', 0.0)

    def _create_sample_executions(self,
                                num_trades: int,
                                avg_trade_size: float,
                                asset_class: AssetClass) -> List[TradeExecution]:
        """Create sample trade executions for cost calculation."""
        executions = []

        for i in range(int(num_trades)):
            # Create sample execution with realistic parameters
            execution = TradeExecution(
                timestamp=datetime.now(),
                asset_symbol=self.get_effective_symbol(),
                asset_class=asset_class,
                side="buy" if i % 2 == 0 else "sell",
                quantity=avg_trade_size / 1.1000,  # Approximate quantity
                price=1.1000,  # Sample price
                notional_value=avg_trade_size,
                market_session=self.cost_modeler.determine_market_session(datetime.now()),
                volatility_regime=self.cost_modeler.determine_volatility_regime(0.15, 0.12)
            )
            executions.append(execution)

        return executions

    def run_cost_stress_test(self,
                           strategy_id: str,
                           backtest_results: Dict[str, float],
                           parameters: Dict[str, Any]) -> Dict[str, Any]:
        """Run comprehensive cost stress test on strategy performance."""
        try:
            # Create sample executions
            total_trades = backtest_results.get('total_trades', 0)
            if total_trades == 0:
                return {"status": "no_trades_to_test"}

            avg_trade_size = 10000
            sample_executions = self._create_sample_executions(
                total_trades, avg_trade_size, self.get_effective_asset_class()
            )

            # Define performance calculator
            def performance_calculator(executions: List[TradeExecution], cost_multiplier: float) -> Dict[str, float]:
                # Calculate costs under stress
                portfolio_costs = self.cost_modeler.calculate_portfolio_costs(executions, cost_multiplier)
                cost_bps = portfolio_costs['portfolio_cost_bps']

                # Adjust performance metrics
                original_sharpe = backtest_results.get('sharpe_ratio', 0.0)
                original_return = backtest_results.get('total_return_pct', 0.0)

                # Apply cost impact
                cost_impact_sharpe = cost_bps / 100  # Approximate impact
                cost_impact_return = cost_bps / 100  # Cost in percentage points

                return {
                    'sharpe_ratio': original_sharpe - cost_impact_sharpe,
                    'total_return_pct': original_return - cost_impact_return,
                    'profit_factor': backtest_results.get('profit_factor', 1.0) * (1 - cost_impact_return / 100),
                    'max_drawdown_pct': backtest_results.get('max_drawdown_pct', 0.0)
                }

            # Run stress test
            stress_results = self.stress_tester.run_stress_test(
                strategy_id, backtest_results, sample_executions, performance_calculator
            )

            # Run sensitivity analysis
            sensitivity_analysis = self.stress_tester.run_sensitivity_analysis(
                strategy_id, sample_executions, performance_calculator
            )

            # Generate robustness bands
            robustness_bands = self.stress_tester.generate_robustness_bands(
                strategy_id, backtest_results
            )

            return {
                'stress_test_results': [
                    {
                        'scenario': result.scenario.value,
                        'cost_multiplier': result.cost_multiplier,
                        'passes_test': result.passes_stress_test,
                        'profitability_status': result.profitability_status.value,
                        'performance_degradation': result.performance_degradation
                    }
                    for result in stress_results
                ],
                'sensitivity_analysis': {
                    'break_even_cost_multiplier': sensitivity_analysis.break_even_cost_multiplier,
                    'sensitivity_coefficient': sensitivity_analysis.sensitivity_coefficient,
                    'robustness_score': sensitivity_analysis.robustness_score
                },
                'robustness_bands': {
                    'worst_case_performance': robustness_bands.worst_case_performance,
                    'confidence_bands': robustness_bands.confidence_bands
                }
            }

        except Exception as e:
            self.logger.error(f"Error running cost stress test: {e}")
            return {"status": "error", "message": str(e)}

    def _calculate_parameter_deviation_penalty(self,
                                             current_params: Dict[str, Any],
                                             previous_params: Dict[str, Any]) -> float:
        """Calculate penalty for large parameter deviations."""
        deviations = []
        
        for param_name in current_params.keys():
            if param_name in previous_params:
                current_val = float(current_params[param_name])
                previous_val = float(previous_params[param_name])
                
                if previous_val != 0:
                    relative_deviation = abs(current_val - previous_val) / abs(previous_val)
                    if relative_deviation > self.config.stability_config.max_parameter_deviation:
                        deviations.append(relative_deviation)
        
        if deviations:
            avg_deviation = np.mean(deviations)
            return avg_deviation * self.config.stability_config.variance_penalty_weight
        
        return 0.0
    
    def _aggregate_objectives(self, 
                            objective_scores: Dict[ObjectiveFunction, float],
                            stability_scores: Dict[StabilityMetric, float],
                            penalty: float) -> float:
        """Aggregate multiple objectives into composite score."""
        if self.config.aggregation_method == "weighted_sum":
            return self._weighted_sum_aggregation(objective_scores, stability_scores, penalty)
        elif self.config.aggregation_method == "rank_based":
            return self._rank_based_aggregation(objective_scores, stability_scores, penalty)
        else:
            # Default to weighted sum
            return self._weighted_sum_aggregation(objective_scores, stability_scores, penalty)
    
    def _weighted_sum_aggregation(self, 
                                objective_scores: Dict[ObjectiveFunction, float],
                                stability_scores: Dict[StabilityMetric, float],
                                penalty: float) -> float:
        """Aggregate objectives using weighted sum."""
        total_score = 0.0
        total_weight = 0.0
        
        # Primary objective
        primary_score = objective_scores.get(self.config.primary_objective.function, 0.0)
        total_score += primary_score * self.config.primary_objective.weight
        total_weight += self.config.primary_objective.weight
        
        # Secondary objectives
        for obj_config in self.config.secondary_objectives:
            score = objective_scores.get(obj_config.function, 0.0)
            total_score += score * obj_config.weight
            total_weight += obj_config.weight
        
        # Stability bonus
        if self.config.stability_config.enabled:
            stability_bonus = np.mean(list(stability_scores.values()))
            total_score += stability_bonus * self.config.stability_config.consistency_bonus_weight
            total_weight += self.config.stability_config.consistency_bonus_weight
        
        # Apply penalty
        total_score -= penalty
        
        # Normalize by total weight
        if total_weight > 0:
            return total_score / total_weight
        else:
            return total_score
    
    def _rank_based_aggregation(self, 
                              objective_scores: Dict[ObjectiveFunction, float],
                              stability_scores: Dict[StabilityMetric, float],
                              penalty: float) -> float:
        """Aggregate objectives using rank-based method."""
        # Simplified rank-based aggregation
        all_scores = list(objective_scores.values()) + list(stability_scores.values())
        if all_scores:
            rank_score = np.mean(all_scores) - penalty
            return rank_score
        else:
            return -penalty
    
    def get_optimization_summary(self) -> Dict[str, Any]:
        """Get summary of multi-objective optimization results."""
        if not self.optimization_history:
            return {"status": "no_optimizations_completed"}
        
        latest_result = self.optimization_history[-1]
        
        return {
            "total_optimizations": len(self.optimization_history),
            "latest_parameters": latest_result.parameters,
            "latest_composite_score": latest_result.composite_score,
            "objective_breakdown": latest_result.objective_scores,
            "stability_breakdown": latest_result.stability_scores,
            "penalty_applied": latest_result.penalty_applied,
            "configuration": {
                "primary_objective": self.config.primary_objective.function.value,
                "secondary_objectives": [obj.function.value for obj in self.config.secondary_objectives],
                "stability_enabled": self.config.stability_config.enabled,
                "aggregation_method": self.config.aggregation_method
            }
        }
    
    def clear_history(self) -> None:
        """Clear optimization history."""
        self.optimization_history.clear()
        self.fold_results.clear()
        self.parameter_history.clear()
        self.performance_history.clear()
        self.logger.info("Multi-objective optimization history cleared")
