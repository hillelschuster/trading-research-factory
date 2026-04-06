"""
Walk-Forward Analysis Efficiency Calculator.

This module implements industry-standard WFA efficiency metrics including
Walk Forward Efficiency (WFE), performance consistency tracking, and
comprehensive WFA validation metrics.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import pandas as pd


class WFAQuality(Enum):
    """WFA quality classifications based on efficiency metrics."""
    EXCELLENT = "excellent"      # WFE > 80%
    GOOD = "good"               # WFE 60-80%
    ACCEPTABLE = "acceptable"   # WFE 40-60%
    POOR = "poor"              # WFE 20-40%
    UNRELIABLE = "unreliable"  # WFE < 20%


@dataclass
class WindowPerformance:
    """Performance metrics for a single WFA window."""
    window_id: int
    optimization_return: float
    validation_return: float
    optimization_sharpe: float
    validation_sharpe: float
    optimization_drawdown: float
    validation_drawdown: float
    trade_count: int
    win_rate: float
    profit_factor: float


@dataclass
class WFAEfficiencyMetrics:
    """Comprehensive WFA efficiency metrics."""
    # Core WFA metrics
    walk_forward_efficiency: float  # WFE = avg(validation_return) / avg(optimization_return)
    efficiency_consistency: float   # Consistency of WFE across windows
    
    # Performance metrics
    avg_optimization_return: float
    avg_validation_return: float
    optimization_sharpe: float
    validation_sharpe: float
    
    # Risk metrics
    avg_optimization_drawdown: float
    avg_validation_drawdown: float
    drawdown_consistency: float
    
    # Trade metrics
    avg_trade_count: int
    avg_win_rate: float
    avg_profit_factor: float
    
    # Quality assessment
    wfa_quality: WFAQuality
    quality_score: float  # 0-100 composite score
    
    # Statistical significance
    t_statistic: float
    p_value: float
    confidence_level: float


class WFAEfficiencyCalculator:
    """
    Calculator for Walk-Forward Analysis efficiency metrics.
    
    Implements industry-standard WFA efficiency calculations including
    Walk Forward Efficiency (WFE) and comprehensive performance validation.
    """
    
    def __init__(self, logger: Optional[logging.Logger] = None):
        """
        Initialize WFA efficiency calculator.
        
        Args:
            logger: Logger instance
        """
        self.logger = logger or logging.getLogger(__name__)
        
        # Performance tracking
        self.window_performances: List[WindowPerformance] = []
        self.efficiency_history: List[WFAEfficiencyMetrics] = []
        
        self.logger.info("WFAEfficiencyCalculator initialized")
    
    def add_window_performance(self, 
                             window_id: int,
                             optimization_results: Dict[str, float],
                             validation_results: Dict[str, float]) -> None:
        """
        Add performance results for a WFA window.
        
        Args:
            window_id: Window identifier
            optimization_results: Results from optimization phase
            validation_results: Results from validation phase
        """
        performance = WindowPerformance(
            window_id=window_id,
            optimization_return=optimization_results.get('total_return_pct', 0.0),
            validation_return=validation_results.get('total_return_pct', 0.0),
            optimization_sharpe=optimization_results.get('sharpe_ratio', 0.0),
            validation_sharpe=validation_results.get('sharpe_ratio', 0.0),
            optimization_drawdown=optimization_results.get('max_drawdown_pct', 0.0),
            validation_drawdown=validation_results.get('max_drawdown_pct', 0.0),
            trade_count=validation_results.get('total_trades', 0),
            win_rate=validation_results.get('win_rate', 0.0),
            profit_factor=validation_results.get('profit_factor', 0.0)
        )
        
        self.window_performances.append(performance)
        self.logger.debug(f"Added performance for window {window_id}")
    
    def calculate_wfa_efficiency(self) -> WFAEfficiencyMetrics:
        """
        Calculate comprehensive WFA efficiency metrics.
        
        Returns:
            Complete WFA efficiency analysis
        """
        if not self.window_performances:
            return self._create_empty_metrics()
        
        self.logger.info("Calculating WFA efficiency metrics")
        
        # Extract performance arrays
        opt_returns = [p.optimization_return for p in self.window_performances]
        val_returns = [p.validation_return for p in self.window_performances]
        opt_sharpes = [p.optimization_sharpe for p in self.window_performances]
        val_sharpes = [p.validation_sharpe for p in self.window_performances]
        opt_drawdowns = [p.optimization_drawdown for p in self.window_performances]
        val_drawdowns = [p.validation_drawdown for p in self.window_performances]
        
        # Calculate core WFA metrics
        avg_opt_return = np.mean(opt_returns)
        avg_val_return = np.mean(val_returns)
        
        # Walk Forward Efficiency (WFE)
        if avg_opt_return != 0:
            wfe = avg_val_return / avg_opt_return
        else:
            wfe = 0.0
        
        # Efficiency consistency (1 - coefficient of variation of individual WFEs)
        individual_wfes = []
        for opt_ret, val_ret in zip(opt_returns, val_returns):
            if opt_ret != 0:
                individual_wfes.append(val_ret / opt_ret)
            else:
                individual_wfes.append(0.0)
        
        if individual_wfes and np.mean(individual_wfes) != 0:
            wfe_cv = np.std(individual_wfes) / abs(np.mean(individual_wfes))
            efficiency_consistency = max(0.0, 1.0 - wfe_cv)
        else:
            efficiency_consistency = 0.0
        
        # Performance metrics
        opt_sharpe = np.mean(opt_sharpes)
        val_sharpe = np.mean(val_sharpes)
        
        # Risk metrics
        avg_opt_drawdown = np.mean(opt_drawdowns)
        avg_val_drawdown = np.mean(val_drawdowns)
        
        # Drawdown consistency
        drawdown_ratios = []
        for opt_dd, val_dd in zip(opt_drawdowns, val_drawdowns):
            if opt_dd != 0:
                drawdown_ratios.append(val_dd / opt_dd)
            else:
                drawdown_ratios.append(1.0)
        
        if drawdown_ratios:
            dd_cv = np.std(drawdown_ratios) / max(np.mean(drawdown_ratios), 1e-8)
            drawdown_consistency = max(0.0, 1.0 - dd_cv)
        else:
            drawdown_consistency = 0.0
        
        # Trade metrics
        avg_trade_count = int(np.mean([p.trade_count for p in self.window_performances]))
        avg_win_rate = np.mean([p.win_rate for p in self.window_performances])
        avg_profit_factor = np.mean([p.profit_factor for p in self.window_performances])
        
        # Statistical significance
        t_stat, p_val, conf_level = self._calculate_statistical_significance(val_returns)
        
        # Quality assessment
        wfa_quality, quality_score = self._assess_wfa_quality(
            wfe, efficiency_consistency, val_sharpe, drawdown_consistency
        )
        
        metrics = WFAEfficiencyMetrics(
            walk_forward_efficiency=wfe,
            efficiency_consistency=efficiency_consistency,
            avg_optimization_return=avg_opt_return,
            avg_validation_return=avg_val_return,
            optimization_sharpe=opt_sharpe,
            validation_sharpe=val_sharpe,
            avg_optimization_drawdown=avg_opt_drawdown,
            avg_validation_drawdown=avg_val_drawdown,
            drawdown_consistency=drawdown_consistency,
            avg_trade_count=avg_trade_count,
            avg_win_rate=avg_win_rate,
            avg_profit_factor=avg_profit_factor,
            wfa_quality=wfa_quality,
            quality_score=quality_score,
            t_statistic=t_stat,
            p_value=p_val,
            confidence_level=conf_level
        )
        
        self.efficiency_history.append(metrics)
        
        self.logger.info(f"WFA Efficiency calculated: {wfe:.1%} ({wfa_quality.value})")
        
        return metrics
    
    def _calculate_statistical_significance(self, returns: List[float]) -> Tuple[float, float, float]:
        """Calculate statistical significance of returns."""
        if len(returns) < 2:
            return 0.0, 1.0, 0.0
        
        # One-sample t-test against zero
        mean_return = np.mean(returns)
        std_return = np.std(returns, ddof=1)
        n = len(returns)
        
        if std_return == 0:
            return 0.0, 1.0, 0.0
        
        t_statistic = mean_return / (std_return / np.sqrt(n))
        
        # Approximate p-value calculation (two-tailed)
        # For more accurate results, would use scipy.stats.t
        degrees_freedom = n - 1
        if degrees_freedom > 30:
            # Use normal approximation for large samples
            p_value = 2 * (1 - self._normal_cdf(abs(t_statistic)))
        else:
            # Simplified t-distribution approximation
            p_value = 2 * (1 - self._t_cdf(abs(t_statistic), degrees_freedom))
        
        # Confidence level
        confidence_level = 1 - p_value
        
        return t_statistic, p_value, confidence_level
    
    def _normal_cdf(self, x: float) -> float:
        """Approximate normal CDF."""
        return 0.5 * (1 + np.sign(x) * np.sqrt(1 - np.exp(-2 * x * x / np.pi)))
    
    def _t_cdf(self, x: float, df: int) -> float:
        """Approximate t-distribution CDF."""
        # Simplified approximation - for production use scipy.stats.t
        if df > 30:
            return self._normal_cdf(x)
        elif df <= 2:
            # For very small df, use normal approximation to avoid division by zero
            return self._normal_cdf(x)
        else:
            # Very rough approximation
            return 0.5 + 0.5 * np.tanh(x / np.sqrt(df / (df - 2)))
    
    def _assess_wfa_quality(self, 
                          wfe: float,
                          efficiency_consistency: float,
                          validation_sharpe: float,
                          drawdown_consistency: float) -> Tuple[WFAQuality, float]:
        """Assess overall WFA quality and calculate composite score."""
        # Convert WFE to percentage for classification
        wfe_pct = wfe * 100
        
        # Base quality from WFE
        if wfe_pct >= 80:
            base_quality = WFAQuality.EXCELLENT
            base_score = 90
        elif wfe_pct >= 60:
            base_quality = WFAQuality.GOOD
            base_score = 75
        elif wfe_pct >= 40:
            base_quality = WFAQuality.ACCEPTABLE
            base_score = 60
        elif wfe_pct >= 20:
            base_quality = WFAQuality.POOR
            base_score = 40
        else:
            base_quality = WFAQuality.UNRELIABLE
            base_score = 20
        
        # Adjust score based on other metrics
        consistency_bonus = efficiency_consistency * 10  # Up to 10 points
        sharpe_bonus = min(validation_sharpe * 5, 10)    # Up to 10 points
        drawdown_bonus = drawdown_consistency * 5        # Up to 5 points
        
        quality_score = min(100, base_score + consistency_bonus + sharpe_bonus + drawdown_bonus)
        
        # Adjust quality based on final score
        if quality_score >= 85:
            final_quality = WFAQuality.EXCELLENT
        elif quality_score >= 70:
            final_quality = WFAQuality.GOOD
        elif quality_score >= 55:
            final_quality = WFAQuality.ACCEPTABLE
        elif quality_score >= 35:
            final_quality = WFAQuality.POOR
        else:
            final_quality = WFAQuality.UNRELIABLE
        
        return final_quality, quality_score
    
    def _create_empty_metrics(self) -> WFAEfficiencyMetrics:
        """Create empty metrics for cases with no data."""
        return WFAEfficiencyMetrics(
            walk_forward_efficiency=0.0,
            efficiency_consistency=0.0,
            avg_optimization_return=0.0,
            avg_validation_return=0.0,
            optimization_sharpe=0.0,
            validation_sharpe=0.0,
            avg_optimization_drawdown=0.0,
            avg_validation_drawdown=0.0,
            drawdown_consistency=0.0,
            avg_trade_count=0,
            avg_win_rate=0.0,
            avg_profit_factor=0.0,
            wfa_quality=WFAQuality.UNRELIABLE,
            quality_score=0.0,
            t_statistic=0.0,
            p_value=1.0,
            confidence_level=0.0
        )
    
    def get_efficiency_summary(self) -> Dict[str, Any]:
        """Get summary of WFA efficiency analysis."""
        if not self.efficiency_history:
            return {"status": "no_analysis_available"}
        
        latest_metrics = self.efficiency_history[-1]
        
        return {
            "wfa_efficiency": {
                "value": latest_metrics.walk_forward_efficiency,
                "percentage": f"{latest_metrics.walk_forward_efficiency:.1%}",
                "quality": latest_metrics.wfa_quality.value,
                "quality_score": latest_metrics.quality_score
            },
            "performance": {
                "avg_optimization_return": latest_metrics.avg_optimization_return,
                "avg_validation_return": latest_metrics.avg_validation_return,
                "validation_sharpe": latest_metrics.validation_sharpe,
                "avg_trade_count": latest_metrics.avg_trade_count
            },
            "consistency": {
                "efficiency_consistency": latest_metrics.efficiency_consistency,
                "drawdown_consistency": latest_metrics.drawdown_consistency
            },
            "statistical_significance": {
                "t_statistic": latest_metrics.t_statistic,
                "p_value": latest_metrics.p_value,
                "confidence_level": latest_metrics.confidence_level,
                "significant": latest_metrics.p_value < 0.05
            },
            "recommendation": self._get_recommendation(latest_metrics)
        }
    
    def _get_recommendation(self, metrics: WFAEfficiencyMetrics) -> str:
        """Get recommendation based on WFA efficiency metrics."""
        if metrics.wfa_quality == WFAQuality.EXCELLENT:
            return "Strategy shows excellent WFA efficiency. Proceed with confidence."
        elif metrics.wfa_quality == WFAQuality.GOOD:
            return "Strategy shows good WFA efficiency. Suitable for live trading with monitoring."
        elif metrics.wfa_quality == WFAQuality.ACCEPTABLE:
            return "Strategy shows acceptable WFA efficiency. Consider additional validation."
        elif metrics.wfa_quality == WFAQuality.POOR:
            return "Strategy shows poor WFA efficiency. Significant improvements needed."
        else:
            return "Strategy shows unreliable WFA efficiency. Not recommended for live trading."
    
    def clear_history(self) -> None:
        """Clear performance and efficiency history."""
        self.window_performances.clear()
        self.efficiency_history.clear()
        self.logger.info("WFA efficiency history cleared")
