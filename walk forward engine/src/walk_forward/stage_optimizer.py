"""
Stage-Based Parameter Optimization Framework.

This module implements multi-stage parameter optimization where each stage has
distinct optimization and testing phases, preventing overfitting and ensuring
robust parameter selection across different market conditions.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Tuple, Any, Callable

import numpy as np
import optuna
import pandas as pd

from .wfa_window_manager import WFAWindow, OptimizationPhase
from .data_integrity import DataIntegrityManager
from .multi_objective_optimizer import MultiObjectiveOptimizer, MultiObjectiveConfig, ObjectiveConfig, StabilityConfig, ObjectiveFunction
from .stability_analyzer import StabilityAnalyzer, StabilityTestConfig


class OptimizationStage(Enum):
    """Stages of parameter optimization."""
    INITIAL_SCREENING = "initial_screening"
    REFINEMENT = "refinement"
    VALIDATION = "validation"
    ROBUSTNESS_TEST = "robustness_test"


@dataclass
class StageConfig:
    """Configuration for optimization stage."""
    stage: OptimizationStage
    trials_per_stage: int
    parameter_ranges: Dict[str, Dict[str, Any]]
    fitness_function: str
    validation_split: float = 0.3  # 30% for stage validation
    convergence_threshold: float = 0.05  # 5% improvement threshold


@dataclass
class StageResult:
    """Result from optimization stage."""
    stage: OptimizationStage
    window_id: int
    best_parameters: Dict[str, Any]
    best_score: float
    trials_completed: int
    convergence_achieved: bool
    validation_score: float
    stage_duration_seconds: float
    created_at: datetime


class StageBasedOptimizer:
    """
    Multi-stage parameter optimization framework.
    
    Implements industry-standard stage-based optimization where each stage
    has distinct optimization and testing phases to prevent overfitting.
    """
    
    def __init__(self,
                 data_integrity_manager: DataIntegrityManager,
                 multi_objective_config: Optional[MultiObjectiveConfig] = None,
                 logger: Optional[logging.Logger] = None):
        """
        Initialize stage-based optimizer with multi-objective optimization support.

        Args:
            data_integrity_manager: Data integrity manager for deterministic seeds
            multi_objective_config: Configuration for multi-objective optimization
            logger: Logger instance
        """
        self.data_integrity_manager = data_integrity_manager
        self.logger = logger or logging.getLogger(__name__)

        # Multi-objective optimization
        if multi_objective_config is None:
            multi_objective_config = self._create_default_multi_objective_config()

        self.multi_objective_optimizer = MultiObjectiveOptimizer(
            multi_objective_config, logger=self.logger
        )
        self.stability_analyzer = StabilityAnalyzer(logger=self.logger)

        # Stage tracking
        self.stage_results: Dict[int, List[StageResult]] = {}  # window_id -> stage results
        self.current_stage: Optional[OptimizationStage] = None

        # Default stage configurations
        self.default_stages = self._create_default_stage_configs()

        self.logger.info("StageBasedOptimizer initialized with multi-objective optimization")

    def _create_default_multi_objective_config(self) -> MultiObjectiveConfig:
        """Create default multi-objective optimization configuration."""
        primary_objective = ObjectiveConfig(
            function=ObjectiveFunction.SHARPE_WITH_TURNOVER_PENALTY,
            weight=1.0,
            parameters={"turnover_penalty_rate": 0.001}
        )

        secondary_objectives = [
            ObjectiveConfig(
                function=ObjectiveFunction.DRAWDOWN_ADJUSTED_CAGR,
                weight=0.3
            ),
            ObjectiveConfig(
                function=ObjectiveFunction.STABILITY_WEIGHTED_SHARPE,
                weight=0.2
            )
        ]

        stability_config = StabilityConfig(
            enabled=True,
            variance_penalty_weight=0.1,
            sensitivity_penalty_weight=0.05,
            consistency_bonus_weight=0.1,
            turnover_penalty_rate=0.001,
            max_parameter_deviation=0.2
        )

        return MultiObjectiveConfig(
            primary_objective=primary_objective,
            secondary_objectives=secondary_objectives,
            stability_config=stability_config,
            aggregation_method="weighted_sum",
            normalization_method="z_score"
        )

    def _create_default_stage_configs(self) -> List[StageConfig]:
        """Create default stage configurations."""
        return [
            StageConfig(
                stage=OptimizationStage.INITIAL_SCREENING,
                trials_per_stage=50,
                parameter_ranges={},  # Will be populated from strategy config
                fitness_function="sharpe_ratio",
                validation_split=0.3,
                convergence_threshold=0.1
            ),
            StageConfig(
                stage=OptimizationStage.REFINEMENT,
                trials_per_stage=30,
                parameter_ranges={},  # Narrowed ranges from initial screening
                fitness_function="profit_factor",
                validation_split=0.3,
                convergence_threshold=0.05
            ),
            StageConfig(
                stage=OptimizationStage.VALIDATION,
                trials_per_stage=20,
                parameter_ranges={},  # Final validation with best parameters
                fitness_function="risk_adjusted_return",
                validation_split=0.3,
                convergence_threshold=0.03
            ),
            StageConfig(
                stage=OptimizationStage.ROBUSTNESS_TEST,
                trials_per_stage=15,
                parameter_ranges={},  # Test robustness across parameter neighbors
                fitness_function="consistency_score",
                validation_split=0.3,
                convergence_threshold=0.02
            )
        ]
    
    def optimize_window_staged(self, 
                             window: WFAWindow,
                             parameter_ranges: Dict[str, Dict[str, Any]],
                             evaluation_function: Callable,
                             stage_configs: Optional[List[StageConfig]] = None) -> Dict[str, Any]:
        """
        Perform staged optimization on a WFA window.
        
        Args:
            window: WFA window to optimize
            parameter_ranges: Initial parameter ranges
            evaluation_function: Function to evaluate parameter combinations
            stage_configs: Custom stage configurations (uses defaults if None)
            
        Returns:
            Final optimized parameters
        """
        self.logger.info(f"Starting staged optimization for window {window.window_id}")
        
        if stage_configs is None:
            stage_configs = self.default_stages
        
        # Initialize stage results for this window
        if window.window_id not in self.stage_results:
            self.stage_results[window.window_id] = []
        
        current_parameters = None
        current_ranges = parameter_ranges.copy()
        
        for stage_config in stage_configs:
            self.current_stage = stage_config.stage
            self.logger.info(f"Starting stage: {stage_config.stage.value}")
            
            # Update stage configuration with current ranges
            stage_config.parameter_ranges = current_ranges
            
            # Perform stage optimization
            stage_result = self._optimize_stage(
                window, stage_config, evaluation_function, current_parameters
            )
            
            # Store stage result
            self.stage_results[window.window_id].append(stage_result)
            
            # Update parameters and ranges for next stage
            current_parameters = stage_result.best_parameters
            current_ranges = self._narrow_parameter_ranges(
                current_ranges, stage_result.best_parameters, stage_config.stage
            )
            
            self.logger.info(
                f"Stage {stage_config.stage.value} completed: "
                f"Score={stage_result.best_score:.4f}, "
                f"Validation={stage_result.validation_score:.4f}"
            )
            
            # Early stopping if convergence not achieved in critical stages
            if (stage_config.stage in [OptimizationStage.INITIAL_SCREENING, OptimizationStage.REFINEMENT] 
                and not stage_result.convergence_achieved):
                self.logger.warning(
                    f"Convergence not achieved in {stage_config.stage.value}, "
                    f"but continuing to next stage"
                )
        
        final_parameters = current_parameters or {}
        self.logger.info(f"Staged optimization completed for window {window.window_id}")
        
        return final_parameters
    
    def _optimize_stage(self, 
                       window: WFAWindow,
                       stage_config: StageConfig,
                       evaluation_function: Callable,
                       initial_parameters: Optional[Dict[str, Any]] = None) -> StageResult:
        """Optimize a single stage."""
        start_time = datetime.now()
        
        # Split optimization data for stage validation
        stage_train_data, stage_val_data = self._split_stage_data(
            window.optimization_data, stage_config.validation_split, window.window_id
        )
        
        # Generate deterministic seed for this stage
        stage_seed = self.data_integrity_manager.generate_deterministic_seed(
            window.window_id, int(stage_config.stage.value.encode().hex(), 16) % 1000
        )
        
        best_parameters = None
        best_score = float('-inf')
        validation_score = 0.0
        convergence_achieved = False
        
        # Create Optuna study for this stage
        sampler = optuna.samplers.TPESampler(seed=stage_seed)
        study = optuna.create_study(direction="maximize", sampler=sampler)
        
        def objective(trial):
            # Generate parameters for this trial
            params = {}
            for param_name, param_config in stage_config.parameter_ranges.items():
                if param_config['type'] == 'int':
                    params[param_name] = trial.suggest_int(
                        param_name, param_config['min'], param_config['max']
                    )
                elif param_config['type'] == 'float':
                    params[param_name] = trial.suggest_float(
                        param_name, param_config['min'], param_config['max']
                    )
                elif param_config['type'] == 'categorical':
                    params[param_name] = trial.suggest_categorical(
                        param_name, param_config['choices']
                    )

            # Evaluate parameters on stage training data
            try:
                # Get basic backtest results
                basic_results = evaluation_function(params, stage_train_data)

                # Convert to dictionary format if needed
                if isinstance(basic_results, (int, float)):
                    backtest_results = {'sharpe_ratio': basic_results}
                else:
                    backtest_results = basic_results

                # Use multi-objective optimization for evaluation
                multi_objective_score = self.multi_objective_optimizer.evaluate_parameters(
                    parameters=params,
                    backtest_results=backtest_results,
                    fold_id=window.window_id,
                    previous_parameters=initial_parameters
                )

                return multi_objective_score
            except Exception as e:
                self.logger.warning(f"Trial evaluation failed: {e}")
                return float('-inf')
        
        # Run optimization
        study.optimize(objective, n_trials=stage_config.trials_per_stage, n_jobs=-1, timeout=1800)
        
        if study.best_trial:
            best_parameters = study.best_trial.params
            best_score = study.best_trial.value

            # Validate on stage validation data
            try:
                val_basic = evaluation_function(best_parameters, stage_val_data)
                if isinstance(val_basic, (int, float)):
                    validation_score = float(val_basic)
                else:
                    validation_score = self.multi_objective_optimizer.evaluate_parameters(
                        parameters=best_parameters,
                        backtest_results=val_basic if isinstance(val_basic, dict) else {},
                        fold_id=window.window_id,
                        previous_parameters=None
                    )
            except Exception as e:
                self.logger.warning(f"Stage validation failed: {e}")
                validation_score = 0.0

            # Check convergence
            score_improvement = abs(validation_score - best_score) / max(abs(best_score), 1e-8)
            convergence_achieved = score_improvement <= stage_config.convergence_threshold

        duration = (datetime.now() - start_time).total_seconds()
        
        return StageResult(
            stage=stage_config.stage,
            window_id=window.window_id,
            best_parameters=best_parameters or {},
            best_score=best_score,
            trials_completed=len(study.trials),
            convergence_achieved=convergence_achieved,
            validation_score=validation_score,
            stage_duration_seconds=duration,
            created_at=datetime.now()
        )
    
    def _split_stage_data(self, 
                         optimization_data: pd.DataFrame, 
                         validation_split: float,
                         window_id: int) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """Split optimization data for stage validation."""
        # Use deterministic splitting to ensure reproducibility
        split_point = int(len(optimization_data) * (1 - validation_split))
        
        stage_train_data = optimization_data.iloc[:split_point].copy()
        stage_val_data = optimization_data.iloc[split_point:].copy()
        
        return stage_train_data, stage_val_data
    
    def _narrow_parameter_ranges(self, 
                                current_ranges: Dict[str, Dict[str, Any]],
                                best_parameters: Dict[str, Any],
                                stage: OptimizationStage) -> Dict[str, Dict[str, Any]]:
        """Narrow parameter ranges based on best parameters from current stage."""
        narrowed_ranges = {}
        
        # Narrowing factors by stage
        narrowing_factors = {
            OptimizationStage.INITIAL_SCREENING: 0.5,  # Narrow by 50%
            OptimizationStage.REFINEMENT: 0.3,         # Narrow by 30%
            OptimizationStage.VALIDATION: 0.2,         # Narrow by 20%
            OptimizationStage.ROBUSTNESS_TEST: 0.1     # Narrow by 10%
        }
        
        factor = narrowing_factors.get(stage, 0.3)
        
        for param_name, param_config in current_ranges.items():
            if param_name in best_parameters:
                best_value = best_parameters[param_name]
                
                if param_config['type'] in ['int', 'float']:
                    current_range = param_config['max'] - param_config['min']
                    new_range = current_range * factor
                    
                    new_min = max(param_config['min'], best_value - new_range / 2)
                    new_max = min(param_config['max'], best_value + new_range / 2)
                    
                    narrowed_ranges[param_name] = {
                        'type': param_config['type'],
                        'min': int(new_min) if param_config['type'] == 'int' else new_min,
                        'max': int(new_max) if param_config['type'] == 'int' else new_max
                    }
                else:
                    # Keep categorical parameters unchanged
                    narrowed_ranges[param_name] = param_config.copy()
            else:
                # Keep parameters without best values unchanged
                narrowed_ranges[param_name] = param_config.copy()
        
        return narrowed_ranges

    def get_stability_analysis(self, window_id: int) -> Optional[Dict[str, Any]]:
        """Get stability analysis for a window."""
        if window_id not in self.stage_results:
            return None

        # Get fold results from multi-objective optimizer
        fold_results = self.multi_objective_optimizer.fold_results

        if not fold_results:
            return None

        # Get final parameters from last stage
        stage_results = self.stage_results[window_id]
        if not stage_results:
            return None

        final_parameters = stage_results[-1].best_parameters

        # Perform stability analysis
        stability_report = self.stability_analyzer.analyze_parameter_stability(
            parameter_set=final_parameters,
            fold_results=fold_results
        )

        return {
            "stability_level": stability_report.overall_stability_level.value,
            "stability_score": stability_report.overall_stability_score,
            "test_results": [
                {
                    "test_type": result.test_type.value,
                    "score": result.stability_score,
                    "passed": result.passed
                }
                for result in stability_report.test_results
            ],
            "recommendations": stability_report.recommendations
        }

    def get_stage_results(self, window_id: int) -> List[StageResult]:
        """Get stage results for a window."""
        return self.stage_results.get(window_id, [])
    
    def get_optimization_summary(self, window_id: int) -> Dict[str, Any]:
        """Get optimization summary for a window."""
        stage_results = self.get_stage_results(window_id)

        # Get multi-objective optimization summary
        multi_obj_summary = self.multi_objective_optimizer.get_optimization_summary()

        # Get stability analysis
        stability_analysis = self.get_stability_analysis(window_id)

        if not stage_results:
            return {
                'window_id': window_id,
                'total_stages': 0,
                'total_trials': 0,
                'total_duration_seconds': 0.0,
                'final_parameters': {},
                'convergence_by_stage': {},
                'final_score': 0.0,
                'final_validation_score': 0.0,
                'multi_objective_summary': multi_obj_summary,
                'stability_analysis': stability_analysis
            }

        total_trials = sum(result.trials_completed for result in stage_results)
        total_duration = sum(result.stage_duration_seconds for result in stage_results)
        final_parameters = stage_results[-1].best_parameters if stage_results else {}

        convergence_by_stage = {
            result.stage.value: result.convergence_achieved
            for result in stage_results
        }

        return {
            'window_id': window_id,
            'total_stages': len(stage_results),
            'total_trials': total_trials,
            'total_duration_seconds': total_duration,
            'final_parameters': final_parameters,
            'convergence_by_stage': convergence_by_stage,
            'final_score': stage_results[-1].best_score if stage_results else 0.0,
            'final_validation_score': stage_results[-1].validation_score if stage_results else 0.0,
            'multi_objective_summary': multi_obj_summary,
            'stability_analysis': stability_analysis
        }
