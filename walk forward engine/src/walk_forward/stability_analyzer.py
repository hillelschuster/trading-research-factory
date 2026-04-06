"""
Parameter Stability Analysis Framework.

This module provides comprehensive parameter stability assessment including
variance across folds, sensitivity to hyperparameter changes, and robustness
validation for multi-objective optimization in WFA.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Tuple, Any, Callable

import numpy as np
import pandas as pd

from .multi_objective_optimizer import StabilityMetric
from .parameter_tracker import ParameterShelfLifeTracker


class StabilityTest(Enum):
    """Types of stability tests."""
    PARAMETER_VARIANCE_TEST = "parameter_variance_test"
    PERFORMANCE_CONSISTENCY_TEST = "performance_consistency_test"
    HYPERPARAMETER_SENSITIVITY_TEST = "hyperparameter_sensitivity_test"
    FOLD_ROBUSTNESS_TEST = "fold_robustness_test"
    REGIME_STABILITY_TEST = "regime_stability_test"


class StabilityLevel(Enum):
    """Parameter stability levels."""
    HIGHLY_STABLE = "highly_stable"
    STABLE = "stable"
    MODERATELY_STABLE = "moderately_stable"
    UNSTABLE = "unstable"
    HIGHLY_UNSTABLE = "highly_unstable"


@dataclass
class StabilityTestConfig:
    """Configuration for stability tests."""
    test_type: StabilityTest
    enabled: bool = True
    threshold: float = 0.1
    weight: float = 1.0
    parameters: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.parameters is None:
            self.parameters = {}


@dataclass
class StabilityTestResult:
    """Result from a stability test."""
    test_type: StabilityTest
    stability_score: float
    stability_level: StabilityLevel
    details: Dict[str, Any]
    passed: bool
    created_at: datetime


@dataclass
class ParameterStabilityReport:
    """Comprehensive parameter stability report."""
    parameter_set: Dict[str, Any]
    overall_stability_score: float
    overall_stability_level: StabilityLevel
    test_results: List[StabilityTestResult]
    recommendations: List[str]
    fold_analysis: Dict[str, Any]
    sensitivity_analysis: Dict[str, Any]
    created_at: datetime


class StabilityAnalyzer:
    """
    Parameter stability analysis framework.
    
    Provides comprehensive stability assessment for parameter sets including
    variance analysis, sensitivity testing, and robustness validation.
    """
    
    def __init__(self, 
                 test_configs: Optional[List[StabilityTestConfig]] = None,
                 parameter_tracker: Optional[ParameterShelfLifeTracker] = None,
                 logger: Optional[logging.Logger] = None):
        """
        Initialize stability analyzer.
        
        Args:
            test_configs: List of stability test configurations
            parameter_tracker: Parameter tracker for historical analysis
            logger: Logger instance
        """
        self.test_configs = test_configs or self._create_default_test_configs()
        self.parameter_tracker = parameter_tracker
        self.logger = logger or logging.getLogger(__name__)
        
        # Analysis history
        self.stability_reports: List[ParameterStabilityReport] = []
        self.fold_data: Dict[int, Dict[str, Any]] = {}
        self.parameter_history: List[Dict[str, Any]] = []
        self.performance_history: List[Dict[str, float]] = []
        
        self.logger.info("StabilityAnalyzer initialized with {} test configurations".format(len(self.test_configs)))
    
    def _create_default_test_configs(self) -> List[StabilityTestConfig]:
        """Create default stability test configurations."""
        return [
            StabilityTestConfig(
                test_type=StabilityTest.PARAMETER_VARIANCE_TEST,
                threshold=0.15,  # 15% variance threshold
                weight=1.0
            ),
            StabilityTestConfig(
                test_type=StabilityTest.PERFORMANCE_CONSISTENCY_TEST,
                threshold=0.2,   # 20% performance variation threshold
                weight=1.0
            ),
            StabilityTestConfig(
                test_type=StabilityTest.HYPERPARAMETER_SENSITIVITY_TEST,
                threshold=0.1,   # 10% sensitivity threshold
                weight=0.8
            ),
            StabilityTestConfig(
                test_type=StabilityTest.FOLD_ROBUSTNESS_TEST,
                threshold=0.3,   # 30% fold variation threshold
                weight=1.2
            ),
            StabilityTestConfig(
                test_type=StabilityTest.REGIME_STABILITY_TEST,
                threshold=0.25,  # 25% regime variation threshold
                weight=0.9
            )
        ]
    
    def analyze_parameter_stability(self, 
                                  parameter_set: Dict[str, Any],
                                  fold_results: Dict[int, List[Dict[str, Any]]],
                                  performance_data: Optional[List[Dict[str, float]]] = None) -> ParameterStabilityReport:
        """
        Perform comprehensive parameter stability analysis.
        
        Args:
            parameter_set: Parameter set to analyze
            fold_results: Results from multiple folds
            performance_data: Historical performance data
            
        Returns:
            Comprehensive stability report
        """
        self.logger.info("Starting parameter stability analysis")
        
        # Store data for analysis
        self.fold_data.update(fold_results)
        if performance_data:
            self.performance_history.extend(performance_data)
        
        # Run stability tests
        test_results = []
        for config in self.test_configs:
            if config.enabled:
                result = self._run_stability_test(config, parameter_set, fold_results, performance_data)
                test_results.append(result)
        
        # Calculate overall stability
        overall_score, overall_level = self._calculate_overall_stability(test_results)
        
        # Generate recommendations
        recommendations = self._generate_stability_recommendations(test_results, overall_level)
        
        # Perform detailed analyses
        fold_analysis = self._perform_fold_analysis(fold_results)
        sensitivity_analysis = self._perform_sensitivity_analysis(parameter_set, fold_results)
        
        # Create report
        report = ParameterStabilityReport(
            parameter_set=parameter_set.copy(),
            overall_stability_score=overall_score,
            overall_stability_level=overall_level,
            test_results=test_results,
            recommendations=recommendations,
            fold_analysis=fold_analysis,
            sensitivity_analysis=sensitivity_analysis,
            created_at=datetime.now()
        )
        
        self.stability_reports.append(report)
        self.logger.info(f"Stability analysis completed: {overall_level.value} ({overall_score:.3f})")
        
        return report
    
    def _run_stability_test(self, 
                          config: StabilityTestConfig,
                          parameter_set: Dict[str, Any],
                          fold_results: Dict[int, List[Dict[str, Any]]],
                          performance_data: Optional[List[Dict[str, float]]]) -> StabilityTestResult:
        """Run a specific stability test."""
        try:
            if config.test_type == StabilityTest.PARAMETER_VARIANCE_TEST:
                return self._parameter_variance_test(config, parameter_set, fold_results)
            
            elif config.test_type == StabilityTest.PERFORMANCE_CONSISTENCY_TEST:
                return self._performance_consistency_test(config, fold_results, performance_data)
            
            elif config.test_type == StabilityTest.HYPERPARAMETER_SENSITIVITY_TEST:
                return self._hyperparameter_sensitivity_test(config, parameter_set, fold_results)
            
            elif config.test_type == StabilityTest.FOLD_ROBUSTNESS_TEST:
                return self._fold_robustness_test(config, fold_results)
            
            elif config.test_type == StabilityTest.REGIME_STABILITY_TEST:
                return self._regime_stability_test(config, fold_results)
            
            else:
                raise ValueError(f"Unknown stability test: {config.test_type}")
                
        except Exception as e:
            self.logger.error(f"Error running stability test {config.test_type}: {e}")
            return StabilityTestResult(
                test_type=config.test_type,
                stability_score=0.0,
                stability_level=StabilityLevel.HIGHLY_UNSTABLE,
                details={"error": str(e)},
                passed=False,
                created_at=datetime.now()
            )
    
    def _parameter_variance_test(self, 
                               config: StabilityTestConfig,
                               parameter_set: Dict[str, Any],
                               fold_results: Dict[int, List[Dict[str, Any]]]) -> StabilityTestResult:
        """Test parameter variance across folds."""
        parameter_variances = {}
        
        for param_name in parameter_set.keys():
            param_values = []
            
            # Collect parameter values across folds
            for fold_id, results in fold_results.items():
                for result in results:
                    if 'parameters' in result and param_name in result['parameters']:
                        param_values.append(float(result['parameters'][param_name]))
            
            if len(param_values) > 1:
                param_variance = np.var(param_values)
                param_mean = np.mean(param_values)
                
                # Normalize variance by mean (coefficient of variation)
                if param_mean != 0:
                    normalized_variance = np.sqrt(param_variance) / abs(param_mean)
                else:
                    normalized_variance = np.sqrt(param_variance)
                
                parameter_variances[param_name] = normalized_variance
        
        # Calculate overall variance score
        if parameter_variances:
            avg_variance = np.mean(list(parameter_variances.values()))
            stability_score = max(0.0, 1.0 - (avg_variance / config.threshold))
        else:
            stability_score = 1.0
        
        # Determine stability level
        stability_level = self._score_to_stability_level(stability_score)
        
        return StabilityTestResult(
            test_type=config.test_type,
            stability_score=stability_score,
            stability_level=stability_level,
            details={
                "parameter_variances": parameter_variances,
                "average_variance": avg_variance if parameter_variances else 0.0,
                "threshold": config.threshold
            },
            passed=stability_score >= 0.6,
            created_at=datetime.now()
        )
    
    def _performance_consistency_test(self, 
                                    config: StabilityTestConfig,
                                    fold_results: Dict[int, List[Dict[str, Any]]],
                                    performance_data: Optional[List[Dict[str, float]]]) -> StabilityTestResult:
        """Test performance consistency across folds."""
        performance_scores = []
        
        # Collect performance scores from fold results
        for fold_id, results in fold_results.items():
            for result in results:
                if 'composite_score' in result:
                    performance_scores.append(result['composite_score'])
                elif 'objective_scores' in result:
                    # Use primary objective score
                    obj_scores = result['objective_scores']
                    if obj_scores:
                        performance_scores.append(list(obj_scores.values())[0])
        
        # Add historical performance data
        if performance_data:
            for perf_data in performance_data:
                if 'score' in perf_data:
                    performance_scores.append(perf_data['score'])
        
        if len(performance_scores) > 1:
            perf_std = np.std(performance_scores)
            perf_mean = np.mean(performance_scores)
            
            # Calculate coefficient of variation
            if perf_mean != 0:
                cv = perf_std / abs(perf_mean)
            else:
                cv = perf_std
            
            stability_score = max(0.0, 1.0 - (cv / config.threshold))
        else:
            stability_score = 1.0
            cv = 0.0
        
        stability_level = self._score_to_stability_level(stability_score)
        
        return StabilityTestResult(
            test_type=config.test_type,
            stability_score=stability_score,
            stability_level=stability_level,
            details={
                "performance_scores": performance_scores,
                "coefficient_of_variation": cv,
                "mean_performance": np.mean(performance_scores) if performance_scores else 0.0,
                "std_performance": np.std(performance_scores) if performance_scores else 0.0,
                "threshold": config.threshold
            },
            passed=stability_score >= 0.6,
            created_at=datetime.now()
        )
    
    def _hyperparameter_sensitivity_test(self, 
                                       config: StabilityTestConfig,
                                       parameter_set: Dict[str, Any],
                                       fold_results: Dict[int, List[Dict[str, Any]]]) -> StabilityTestResult:
        """Test sensitivity to hyperparameter changes."""
        # Simplified sensitivity analysis
        # In a full implementation, this would test small parameter perturbations
        
        sensitivity_scores = {}
        
        for param_name in parameter_set.keys():
            # Collect parameter values and corresponding performance
            param_performance_pairs = []
            
            for fold_id, results in fold_results.items():
                for result in results:
                    if ('parameters' in result and param_name in result['parameters'] and 
                        'composite_score' in result):
                        param_val = float(result['parameters'][param_name])
                        performance = result['composite_score']
                        param_performance_pairs.append((param_val, performance))
            
            if len(param_performance_pairs) > 2:
                # Calculate correlation between parameter value and performance
                param_vals = [pair[0] for pair in param_performance_pairs]
                performances = [pair[1] for pair in param_performance_pairs]
                
                if len(set(param_vals)) > 1:  # Check for variance in parameter values
                    correlation = np.corrcoef(param_vals, performances)[0, 1]
                    if not np.isnan(correlation):
                        # High correlation indicates high sensitivity
                        sensitivity = abs(correlation)
                        sensitivity_scores[param_name] = 1.0 - sensitivity
                    else:
                        sensitivity_scores[param_name] = 0.5
                else:
                    sensitivity_scores[param_name] = 1.0  # No variance = no sensitivity
        
        # Calculate overall sensitivity score
        if sensitivity_scores:
            avg_sensitivity = np.mean(list(sensitivity_scores.values()))
        else:
            avg_sensitivity = 0.5  # Default moderate sensitivity
        
        stability_level = self._score_to_stability_level(avg_sensitivity)
        
        return StabilityTestResult(
            test_type=config.test_type,
            stability_score=avg_sensitivity,
            stability_level=stability_level,
            details={
                "parameter_sensitivities": sensitivity_scores,
                "average_sensitivity": avg_sensitivity,
                "threshold": config.threshold
            },
            passed=avg_sensitivity >= 0.6,
            created_at=datetime.now()
        )
    
    def _fold_robustness_test(self, 
                            config: StabilityTestConfig,
                            fold_results: Dict[int, List[Dict[str, Any]]]) -> StabilityTestResult:
        """Test robustness across different folds."""
        fold_performances = {}
        
        # Calculate average performance per fold
        for fold_id, results in fold_results.items():
            fold_scores = []
            for result in results:
                if 'composite_score' in result:
                    fold_scores.append(result['composite_score'])
            
            if fold_scores:
                fold_performances[fold_id] = np.mean(fold_scores)
        
        if len(fold_performances) > 1:
            fold_scores = list(fold_performances.values())
            fold_std = np.std(fold_scores)
            fold_mean = np.mean(fold_scores)
            
            # Calculate coefficient of variation across folds
            if fold_mean != 0:
                cv = fold_std / abs(fold_mean)
            else:
                cv = fold_std
            
            stability_score = max(0.0, 1.0 - (cv / config.threshold))
        else:
            stability_score = 1.0
            cv = 0.0
        
        stability_level = self._score_to_stability_level(stability_score)
        
        return StabilityTestResult(
            test_type=config.test_type,
            stability_score=stability_score,
            stability_level=stability_level,
            details={
                "fold_performances": fold_performances,
                "coefficient_of_variation": cv,
                "mean_fold_performance": np.mean(list(fold_performances.values())) if fold_performances else 0.0,
                "threshold": config.threshold
            },
            passed=stability_score >= 0.6,
            created_at=datetime.now()
        )
    
    def _regime_stability_test(self, 
                             config: StabilityTestConfig,
                             fold_results: Dict[int, List[Dict[str, Any]]]) -> StabilityTestResult:
        """Test stability across different market regimes."""
        # Simplified regime stability test
        # In practice, this would analyze performance across identified market regimes
        
        # For now, use fold-based analysis as proxy for regime changes
        regime_performances = []
        
        for fold_id, results in fold_results.items():
            fold_scores = []
            for result in results:
                if 'composite_score' in result:
                    fold_scores.append(result['composite_score'])
            
            if fold_scores:
                regime_performances.append(np.mean(fold_scores))
        
        if len(regime_performances) > 1:
            regime_std = np.std(regime_performances)
            regime_mean = np.mean(regime_performances)
            
            if regime_mean != 0:
                cv = regime_std / abs(regime_mean)
            else:
                cv = regime_std
            
            stability_score = max(0.0, 1.0 - (cv / config.threshold))
        else:
            stability_score = 0.7  # Default moderate stability
            cv = 0.0
        
        stability_level = self._score_to_stability_level(stability_score)
        
        return StabilityTestResult(
            test_type=config.test_type,
            stability_score=stability_score,
            stability_level=stability_level,
            details={
                "regime_performances": regime_performances,
                "coefficient_of_variation": cv,
                "mean_regime_performance": np.mean(regime_performances) if regime_performances else 0.0,
                "threshold": config.threshold
            },
            passed=stability_score >= 0.6,
            created_at=datetime.now()
        )
    
    def _score_to_stability_level(self, score: float) -> StabilityLevel:
        """Convert stability score to stability level."""
        if score >= 0.9:
            return StabilityLevel.HIGHLY_STABLE
        elif score >= 0.7:
            return StabilityLevel.STABLE
        elif score >= 0.5:
            return StabilityLevel.MODERATELY_STABLE
        elif score >= 0.3:
            return StabilityLevel.UNSTABLE
        else:
            return StabilityLevel.HIGHLY_UNSTABLE
    
    def _calculate_overall_stability(self, test_results: List[StabilityTestResult]) -> Tuple[float, StabilityLevel]:
        """Calculate overall stability score and level."""
        if not test_results:
            return 0.0, StabilityLevel.HIGHLY_UNSTABLE
        
        # Weight test results by their configuration weights
        weighted_scores = []
        total_weight = 0.0
        
        for result in test_results:
            # Find corresponding config for weight
            config_weight = 1.0
            for config in self.test_configs:
                if config.test_type == result.test_type:
                    config_weight = config.weight
                    break
            
            weighted_scores.append(result.stability_score * config_weight)
            total_weight += config_weight
        
        # Calculate weighted average
        if total_weight > 0:
            overall_score = sum(weighted_scores) / total_weight
        else:
            overall_score = np.mean([r.stability_score for r in test_results])
        
        overall_level = self._score_to_stability_level(overall_score)
        
        return overall_score, overall_level
    
    def _generate_stability_recommendations(self, 
                                          test_results: List[StabilityTestResult],
                                          overall_level: StabilityLevel) -> List[str]:
        """Generate recommendations based on stability analysis."""
        recommendations = []
        
        if overall_level == StabilityLevel.HIGHLY_UNSTABLE:
            recommendations.append("Parameters are highly unstable - consider complete re-optimization")
            recommendations.append("Implement stricter parameter constraints")
            recommendations.append("Increase regularization in optimization process")
        
        elif overall_level == StabilityLevel.UNSTABLE:
            recommendations.append("Parameters show instability - review optimization methodology")
            recommendations.append("Consider reducing parameter search space")
            recommendations.append("Implement stability penalties in objective function")
        
        elif overall_level == StabilityLevel.MODERATELY_STABLE:
            recommendations.append("Parameters are moderately stable - monitor closely")
            recommendations.append("Consider minor parameter adjustments")
        
        elif overall_level == StabilityLevel.STABLE:
            recommendations.append("Parameters are stable - suitable for production use")
            recommendations.append("Continue monitoring for performance degradation")
        
        else:  # HIGHLY_STABLE
            recommendations.append("Parameters are highly stable - excellent for production")
            recommendations.append("Consider this parameter set as baseline for future optimization")
        
        # Add specific recommendations based on failed tests
        for result in test_results:
            if not result.passed:
                if result.test_type == StabilityTest.PARAMETER_VARIANCE_TEST:
                    recommendations.append("High parameter variance detected - implement tighter constraints")
                elif result.test_type == StabilityTest.PERFORMANCE_CONSISTENCY_TEST:
                    recommendations.append("Performance inconsistency detected - review data quality")
                elif result.test_type == StabilityTest.HYPERPARAMETER_SENSITIVITY_TEST:
                    recommendations.append("High sensitivity to hyperparameters - use robust optimization")
                elif result.test_type == StabilityTest.FOLD_ROBUSTNESS_TEST:
                    recommendations.append("Poor fold robustness - increase cross-validation folds")
                elif result.test_type == StabilityTest.REGIME_STABILITY_TEST:
                    recommendations.append("Poor regime stability - consider regime-specific parameters")
        
        return recommendations
    
    def _perform_fold_analysis(self, fold_results: Dict[int, List[Dict[str, Any]]]) -> Dict[str, Any]:
        """Perform detailed fold analysis."""
        fold_stats = {}
        
        for fold_id, results in fold_results.items():
            if results:
                scores = [r.get('composite_score', 0.0) for r in results]
                fold_stats[f"fold_{fold_id}"] = {
                    "mean_score": np.mean(scores),
                    "std_score": np.std(scores),
                    "min_score": np.min(scores),
                    "max_score": np.max(scores),
                    "num_trials": len(scores)
                }
        
        return {
            "fold_statistics": fold_stats,
            "total_folds": len(fold_results),
            "total_trials": sum(len(results) for results in fold_results.values())
        }
    
    def _perform_sensitivity_analysis(self, 
                                    parameter_set: Dict[str, Any],
                                    fold_results: Dict[int, List[Dict[str, Any]]]) -> Dict[str, Any]:
        """Perform detailed sensitivity analysis."""
        sensitivity_data = {}
        
        for param_name in parameter_set.keys():
            param_values = []
            performances = []
            
            for fold_id, results in fold_results.items():
                for result in results:
                    if ('parameters' in result and param_name in result['parameters'] and 
                        'composite_score' in result):
                        param_values.append(float(result['parameters'][param_name]))
                        performances.append(result['composite_score'])
            
            if len(param_values) > 2:
                sensitivity_data[param_name] = {
                    "correlation_with_performance": np.corrcoef(param_values, performances)[0, 1] if len(set(param_values)) > 1 else 0.0,
                    "parameter_range": [np.min(param_values), np.max(param_values)],
                    "parameter_std": np.std(param_values),
                    "performance_range": [np.min(performances), np.max(performances)]
                }
        
        return sensitivity_data
    
    def get_stability_summary(self) -> Dict[str, Any]:
        """Get summary of stability analysis results."""
        if not self.stability_reports:
            return {"status": "no_stability_analysis_completed"}
        
        latest_report = self.stability_reports[-1]
        
        return {
            "total_analyses": len(self.stability_reports),
            "latest_stability_level": latest_report.overall_stability_level.value,
            "latest_stability_score": latest_report.overall_stability_score,
            "test_results_summary": {
                result.test_type.value: {
                    "score": result.stability_score,
                    "level": result.stability_level.value,
                    "passed": result.passed
                }
                for result in latest_report.test_results
            },
            "recommendations": latest_report.recommendations
        }
