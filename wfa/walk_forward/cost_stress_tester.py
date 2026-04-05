"""
Cost Stress Testing Framework for Walk-Forward Analysis.

This module implements comprehensive stress testing of trading strategies under
different transaction cost scenarios, including robustness validation and
cost sensitivity analysis for strategy profitability assessment.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Tuple, Any, Callable

import numpy as np
import pandas as pd

from .transaction_cost_modeler import TransactionCostModeler, TradeExecution, AssetClass


class StressScenario(Enum):
    """Stress testing scenarios."""
    BASELINE = "baseline"
    MODERATE_STRESS = "moderate_stress"  # +25% costs
    HIGH_STRESS = "high_stress"  # +50% costs
    EXTREME_STRESS = "extreme_stress"  # +100% costs
    CRISIS_STRESS = "crisis_stress"  # +200% costs


class ProfitabilityStatus(Enum):
    """Strategy profitability status under stress."""
    HIGHLY_PROFITABLE = "highly_profitable"
    PROFITABLE = "profitable"
    MARGINALLY_PROFITABLE = "marginally_profitable"
    UNPROFITABLE = "unprofitable"
    HIGHLY_UNPROFITABLE = "highly_unprofitable"


@dataclass
class StressTestConfig:
    """Configuration for stress testing."""
    scenarios: List[StressScenario]
    cost_multipliers: Dict[StressScenario, float]
    profitability_thresholds: Dict[str, float]  # Thresholds for classification
    sensitivity_steps: int = 20  # Steps for sensitivity analysis
    max_cost_multiplier: float = 3.0  # Maximum cost multiplier for sensitivity


@dataclass
class StressTestResult:
    """Result from stress testing a strategy."""
    scenario: StressScenario
    cost_multiplier: float
    original_performance: Dict[str, float]
    stress_performance: Dict[str, float]
    performance_degradation: Dict[str, float]
    profitability_status: ProfitabilityStatus
    cost_adjusted_metrics: Dict[str, float]
    passes_stress_test: bool
    created_at: datetime


@dataclass
class SensitivityAnalysis:
    """Cost sensitivity analysis results."""
    cost_multipliers: List[float]
    performance_metrics: Dict[str, List[float]]  # metric_name -> values
    break_even_cost_multiplier: Optional[float]
    sensitivity_coefficient: float  # Performance change per unit cost increase
    robustness_score: float  # 0-1 score based on performance stability


@dataclass
class RobustnessBands:
    """Performance robustness bands under different cost scenarios."""
    baseline_performance: Dict[str, float]
    confidence_bands: Dict[str, Dict[str, float]]  # confidence_level -> {lower, upper}
    worst_case_performance: Dict[str, float]
    best_case_performance: Dict[str, float]
    performance_range: Dict[str, float]


class CostStressTester:
    """
    Comprehensive cost stress testing framework.
    
    Implements stress testing of trading strategies under different transaction
    cost scenarios with robustness validation and sensitivity analysis.
    """
    
    def __init__(self, 
                 cost_modeler: TransactionCostModeler,
                 config: Optional[StressTestConfig] = None,
                 logger: Optional[logging.Logger] = None):
        """
        Initialize cost stress tester.
        
        Args:
            cost_modeler: Transaction cost modeler instance
            config: Stress testing configuration
            logger: Logger instance
        """
        self.cost_modeler = cost_modeler
        self.config = config or self._create_default_config()
        self.logger = logger or logging.getLogger(__name__)
        
        # Stress testing results
        self.stress_results: Dict[str, List[StressTestResult]] = {}
        self.sensitivity_analyses: Dict[str, SensitivityAnalysis] = {}
        self.robustness_bands: Dict[str, RobustnessBands] = {}
        
        self.logger.info("CostStressTester initialized with {} scenarios".format(
            len(self.config.scenarios)
        ))
    
    def _create_default_config(self) -> StressTestConfig:
        """Create default stress testing configuration."""
        scenarios = [
            StressScenario.BASELINE,
            StressScenario.MODERATE_STRESS,
            StressScenario.HIGH_STRESS,
            StressScenario.EXTREME_STRESS
        ]
        
        cost_multipliers = {
            StressScenario.BASELINE: 1.0,
            StressScenario.MODERATE_STRESS: 1.25,
            StressScenario.HIGH_STRESS: 1.5,
            StressScenario.EXTREME_STRESS: 2.0,
            StressScenario.CRISIS_STRESS: 3.0
        }
        
        profitability_thresholds = {
            'sharpe_ratio': 0.5,  # Minimum acceptable Sharpe ratio
            'total_return': 0.05,  # Minimum 5% annual return
            'profit_factor': 1.1,  # Minimum profit factor
            'max_drawdown': -0.15  # Maximum 15% drawdown
        }
        
        return StressTestConfig(
            scenarios=scenarios,
            cost_multipliers=cost_multipliers,
            profitability_thresholds=profitability_thresholds,
            sensitivity_steps=20,
            max_cost_multiplier=3.0
        )
    
    def run_stress_test(self, 
                       strategy_id: str,
                       baseline_performance: Dict[str, float],
                       trade_executions: List[TradeExecution],
                       performance_calculator: Callable[[List[TradeExecution], float], Dict[str, float]]) -> List[StressTestResult]:
        """
        Run comprehensive stress test on a trading strategy.
        
        Args:
            strategy_id: Unique identifier for the strategy
            baseline_performance: Baseline performance metrics
            trade_executions: List of trade executions
            performance_calculator: Function to calculate performance with cost adjustments
            
        Returns:
            List of stress test results for each scenario
        """
        self.logger.info(f"Running stress test for strategy: {strategy_id}")
        
        results = []
        
        for scenario in self.config.scenarios:
            cost_multiplier = self.config.cost_multipliers[scenario]
            
            # Calculate performance under stress scenario
            stress_performance = performance_calculator(trade_executions, cost_multiplier)
            
            # Calculate performance degradation
            performance_degradation = self._calculate_performance_degradation(
                baseline_performance, stress_performance
            )
            
            # Assess profitability status
            profitability_status = self._assess_profitability_status(
                stress_performance, scenario
            )
            
            # Calculate cost-adjusted metrics
            cost_adjusted_metrics = self._calculate_cost_adjusted_metrics(
                trade_executions, cost_multiplier
            )
            
            # Determine if strategy passes stress test
            passes_stress_test = self._evaluate_stress_test_pass(
                stress_performance, profitability_status, scenario
            )
            
            result = StressTestResult(
                scenario=scenario,
                cost_multiplier=cost_multiplier,
                original_performance=baseline_performance.copy(),
                stress_performance=stress_performance.copy(),
                performance_degradation=performance_degradation,
                profitability_status=profitability_status,
                cost_adjusted_metrics=cost_adjusted_metrics,
                passes_stress_test=passes_stress_test,
                created_at=datetime.now()
            )
            
            results.append(result)
        
        # Store results
        self.stress_results[strategy_id] = results
        
        self.logger.info(f"Stress test completed for {strategy_id}: "
                        f"{sum(1 for r in results if r.passes_stress_test)}/{len(results)} scenarios passed")
        
        return results
    
    def run_sensitivity_analysis(self, 
                                strategy_id: str,
                                trade_executions: List[TradeExecution],
                                performance_calculator: Callable[[List[TradeExecution], float], Dict[str, float]]) -> SensitivityAnalysis:
        """
        Run cost sensitivity analysis to determine performance robustness.
        
        Args:
            strategy_id: Unique identifier for the strategy
            trade_executions: List of trade executions
            performance_calculator: Function to calculate performance with cost adjustments
            
        Returns:
            Comprehensive sensitivity analysis results
        """
        self.logger.info(f"Running sensitivity analysis for strategy: {strategy_id}")
        
        # Generate cost multiplier range
        cost_multipliers = np.linspace(1.0, self.config.max_cost_multiplier, self.config.sensitivity_steps)
        
        # Calculate performance for each cost level
        performance_metrics = {}
        
        for multiplier in cost_multipliers:
            performance = performance_calculator(trade_executions, multiplier)
            
            for metric_name, value in performance.items():
                if metric_name not in performance_metrics:
                    performance_metrics[metric_name] = []
                performance_metrics[metric_name].append(value)
        
        # Calculate break-even cost multiplier
        break_even_multiplier = self._calculate_break_even_multiplier(
            cost_multipliers, performance_metrics
        )
        
        # Calculate sensitivity coefficient
        sensitivity_coefficient = self._calculate_sensitivity_coefficient(
            cost_multipliers, performance_metrics
        )
        
        # Calculate robustness score
        robustness_score = self._calculate_robustness_score(
            cost_multipliers, performance_metrics
        )
        
        analysis = SensitivityAnalysis(
            cost_multipliers=cost_multipliers.tolist(),
            performance_metrics=performance_metrics,
            break_even_cost_multiplier=break_even_multiplier,
            sensitivity_coefficient=sensitivity_coefficient,
            robustness_score=robustness_score
        )
        
        # Store analysis
        self.sensitivity_analyses[strategy_id] = analysis
        
        break_even_str = f"{break_even_multiplier:.2f}" if break_even_multiplier is not None else "N/A"
        self.logger.info(f"Sensitivity analysis completed for {strategy_id}: "
                        f"Break-even at {break_even_str}x costs, "
                        f"Robustness score: {robustness_score:.3f}")
        
        return analysis
    
    def generate_robustness_bands(self, 
                                strategy_id: str,
                                baseline_performance: Dict[str, float],
                                confidence_levels: List[float] = [0.68, 0.95, 0.99]) -> RobustnessBands:
        """
        Generate performance robustness bands under different cost scenarios.
        
        Args:
            strategy_id: Unique identifier for the strategy
            baseline_performance: Baseline performance metrics
            confidence_levels: Confidence levels for bands (e.g., 68%, 95%, 99%)
            
        Returns:
            Performance robustness bands
        """
        if strategy_id not in self.sensitivity_analyses:
            raise ValueError(f"No sensitivity analysis found for strategy: {strategy_id}")
        
        analysis = self.sensitivity_analyses[strategy_id]
        
        confidence_bands = {}
        worst_case_performance = {}
        best_case_performance = {}
        performance_range = {}
        
        for metric_name, values in analysis.performance_metrics.items():
            values_array = np.array(values)
            
            # Calculate confidence bands
            confidence_bands[metric_name] = {}
            for confidence_level in confidence_levels:
                lower_percentile = (1 - confidence_level) / 2 * 100
                upper_percentile = (1 + confidence_level) / 2 * 100
                
                lower_bound = np.percentile(values_array, lower_percentile)
                upper_bound = np.percentile(values_array, upper_percentile)
                
                confidence_bands[metric_name][f"{confidence_level:.0%}"] = {
                    'lower': lower_bound,
                    'upper': upper_bound
                }
            
            # Calculate worst and best case
            worst_case_performance[metric_name] = np.min(values_array)
            best_case_performance[metric_name] = np.max(values_array)
            performance_range[metric_name] = np.max(values_array) - np.min(values_array)
        
        bands = RobustnessBands(
            baseline_performance=baseline_performance.copy(),
            confidence_bands=confidence_bands,
            worst_case_performance=worst_case_performance,
            best_case_performance=best_case_performance,
            performance_range=performance_range
        )
        
        # Store bands
        self.robustness_bands[strategy_id] = bands
        
        return bands
    
    def _calculate_performance_degradation(self, 
                                         baseline: Dict[str, float],
                                         stress: Dict[str, float]) -> Dict[str, float]:
        """Calculate performance degradation under stress."""
        degradation = {}
        
        for metric_name in baseline.keys():
            if metric_name in stress:
                baseline_value = baseline[metric_name]
                stress_value = stress[metric_name]
                
                if baseline_value != 0:
                    # Calculate percentage change
                    degradation[metric_name] = (stress_value - baseline_value) / abs(baseline_value)
                else:
                    degradation[metric_name] = 0.0
        
        return degradation
    
    def _assess_profitability_status(self, 
                                   performance: Dict[str, float],
                                   scenario: StressScenario) -> ProfitabilityStatus:
        """Assess profitability status based on performance metrics."""
        # Check key profitability metrics
        sharpe_ratio = performance.get('sharpe_ratio', 0.0)
        total_return = performance.get('total_return_pct', 0.0) / 100  # Convert to decimal
        profit_factor = performance.get('profit_factor', 0.0)
        
        # Count how many thresholds are met
        thresholds_met = 0
        total_thresholds = 0
        
        if 'sharpe_ratio' in self.config.profitability_thresholds:
            total_thresholds += 1
            if sharpe_ratio >= self.config.profitability_thresholds['sharpe_ratio']:
                thresholds_met += 1
        
        if 'total_return' in self.config.profitability_thresholds:
            total_thresholds += 1
            if total_return >= self.config.profitability_thresholds['total_return']:
                thresholds_met += 1
        
        if 'profit_factor' in self.config.profitability_thresholds:
            total_thresholds += 1
            if profit_factor >= self.config.profitability_thresholds['profit_factor']:
                thresholds_met += 1
        
        # Determine status based on threshold compliance
        if total_thresholds == 0:
            return ProfitabilityStatus.PROFITABLE  # Default if no thresholds
        
        threshold_ratio = thresholds_met / total_thresholds
        
        if threshold_ratio >= 0.8:
            return ProfitabilityStatus.HIGHLY_PROFITABLE
        elif threshold_ratio >= 0.6:
            return ProfitabilityStatus.PROFITABLE
        elif threshold_ratio >= 0.4:
            return ProfitabilityStatus.MARGINALLY_PROFITABLE
        elif threshold_ratio >= 0.2:
            return ProfitabilityStatus.UNPROFITABLE
        else:
            return ProfitabilityStatus.HIGHLY_UNPROFITABLE
    
    def _calculate_cost_adjusted_metrics(self, 
                                       trade_executions: List[TradeExecution],
                                       cost_multiplier: float) -> Dict[str, float]:
        """Calculate cost-adjusted performance metrics."""
        # Calculate portfolio costs under stress
        portfolio_costs = self.cost_modeler.calculate_portfolio_costs(
            trade_executions, cost_multiplier
        )
        
        return {
            'total_transaction_costs': portfolio_costs['total_costs'],
            'cost_per_trade': portfolio_costs['average_cost_per_trade'],
            'cost_bps': portfolio_costs['portfolio_cost_bps'],
            'cost_multiplier_applied': cost_multiplier,
            'num_trades': portfolio_costs['num_trades']
        }
    
    def _evaluate_stress_test_pass(self, 
                                 performance: Dict[str, float],
                                 profitability_status: ProfitabilityStatus,
                                 scenario: StressScenario) -> bool:
        """Evaluate if strategy passes stress test for given scenario."""
        # Different passing criteria based on stress scenario
        if scenario == StressScenario.BASELINE:
            return profitability_status in [
                ProfitabilityStatus.HIGHLY_PROFITABLE,
                ProfitabilityStatus.PROFITABLE
            ]
        elif scenario == StressScenario.MODERATE_STRESS:
            return profitability_status in [
                ProfitabilityStatus.HIGHLY_PROFITABLE,
                ProfitabilityStatus.PROFITABLE,
                ProfitabilityStatus.MARGINALLY_PROFITABLE
            ]
        elif scenario == StressScenario.HIGH_STRESS:
            return profitability_status != ProfitabilityStatus.HIGHLY_UNPROFITABLE
        else:  # Extreme or crisis stress
            return profitability_status in [
                ProfitabilityStatus.HIGHLY_PROFITABLE,
                ProfitabilityStatus.PROFITABLE
            ]
    
    def _calculate_break_even_multiplier(self, 
                                       cost_multipliers: np.ndarray,
                                       performance_metrics: Dict[str, List[float]]) -> Optional[float]:
        """Calculate break-even cost multiplier where strategy becomes unprofitable."""
        # Use total return as primary metric for break-even calculation
        if 'total_return_pct' in performance_metrics:
            returns = np.array(performance_metrics['total_return_pct'])
            
            # Find where returns cross zero
            for i, return_value in enumerate(returns):
                if return_value <= 0:
                    if i == 0:
                        return None  # Already unprofitable at baseline
                    else:
                        # Linear interpolation to find exact break-even point
                        prev_return = returns[i-1]
                        prev_multiplier = cost_multipliers[i-1]
                        curr_multiplier = cost_multipliers[i]
                        
                        # Linear interpolation
                        break_even = prev_multiplier + (curr_multiplier - prev_multiplier) * (
                            -prev_return / (return_value - prev_return)
                        )
                        return break_even
        
        return None  # No break-even found within tested range
    
    def _calculate_sensitivity_coefficient(self, 
                                         cost_multipliers: np.ndarray,
                                         performance_metrics: Dict[str, List[float]]) -> float:
        """Calculate sensitivity coefficient (performance change per unit cost increase)."""
        if 'sharpe_ratio' in performance_metrics:
            sharpe_values = np.array(performance_metrics['sharpe_ratio'])
            
            # Calculate linear regression slope
            if len(cost_multipliers) > 1 and len(sharpe_values) > 1:
                slope = np.polyfit(cost_multipliers, sharpe_values, 1)[0]
                return abs(slope)  # Return absolute sensitivity
        
        return 0.0
    
    def _calculate_robustness_score(self, 
                                  cost_multipliers: np.ndarray,
                                  performance_metrics: Dict[str, List[float]]) -> float:
        """Calculate robustness score based on performance stability."""
        if 'sharpe_ratio' in performance_metrics:
            sharpe_values = np.array(performance_metrics['sharpe_ratio'])
            
            if len(sharpe_values) > 1:
                # Calculate coefficient of variation (lower is more robust)
                mean_sharpe = np.mean(sharpe_values)
                std_sharpe = np.std(sharpe_values)
                
                if mean_sharpe > 0:
                    cv = std_sharpe / mean_sharpe
                    # Convert to 0-1 score (higher is more robust)
                    robustness_score = 1.0 / (1.0 + cv)
                    return robustness_score
        
        return 0.5  # Default moderate robustness
    
    def get_stress_test_summary(self, strategy_id: str) -> Dict[str, Any]:
        """Get comprehensive stress test summary for a strategy."""
        if strategy_id not in self.stress_results:
            return {"status": "no_stress_tests_completed"}
        
        results = self.stress_results[strategy_id]
        
        # Calculate summary statistics
        scenarios_passed = sum(1 for result in results if result.passes_stress_test)
        total_scenarios = len(results)
        pass_rate = scenarios_passed / total_scenarios if total_scenarios > 0 else 0
        
        # Get worst-case performance degradation
        worst_degradation = {}
        for result in results:
            for metric, degradation in result.performance_degradation.items():
                if metric not in worst_degradation or degradation < worst_degradation[metric]:
                    worst_degradation[metric] = degradation
        
        return {
            'strategy_id': strategy_id,
            'total_scenarios_tested': total_scenarios,
            'scenarios_passed': scenarios_passed,
            'pass_rate': pass_rate,
            'worst_case_degradation': worst_degradation,
            'stress_test_results': [
                {
                    'scenario': result.scenario.value,
                    'cost_multiplier': result.cost_multiplier,
                    'profitability_status': result.profitability_status.value,
                    'passes_test': result.passes_stress_test
                }
                for result in results
            ]
        }
