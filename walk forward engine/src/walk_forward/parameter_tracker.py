"""
Parameter Shelf-Life Management and Relevancy Tracking.

This module implements parameter shelf-life management to track how long
optimized parameters remain effective and when they need re-optimization.
"""

import json
import logging
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import pandas as pd


class ParameterStatus(Enum):
    """Parameter status indicators."""
    ACTIVE = "active"
    DEGRADING = "degrading"
    EXPIRED = "expired"
    REQUIRES_REOPTIMIZATION = "requires_reoptimization"


class RelevancyMetric(Enum):
    """Metrics for parameter relevancy assessment."""
    PERFORMANCE_DECAY = "performance_decay"
    MARKET_REGIME_SHIFT = "market_regime_shift"
    VOLATILITY_CHANGE = "volatility_change"
    CORRELATION_BREAKDOWN = "correlation_breakdown"


@dataclass
class ParameterSnapshot:
    """Snapshot of parameters at a specific time."""
    window_id: int
    parameters: Dict[str, Any]
    optimization_score: float
    validation_score: float
    created_at: datetime
    market_conditions: Dict[str, float]  # Volatility, trend, etc.


@dataclass
class ParameterPerformance:
    """Performance tracking for parameter set."""
    window_id: int
    parameters: Dict[str, Any]
    initial_score: float
    current_score: float
    performance_decay: float
    days_active: int
    status: ParameterStatus
    relevancy_scores: Dict[RelevancyMetric, float]
    last_updated: datetime


class ParameterShelfLifeTracker:
    """
    Parameter shelf-life management and relevancy tracking system.
    
    Tracks how long optimized parameters remain effective and provides
    recommendations for when re-optimization is needed.
    """
    
    def __init__(self, 
                 max_parameter_age_days: int = 365,
                 performance_decay_threshold: float = 0.15,
                 artifacts_dir: Optional[str] = None,
                 logger: Optional[logging.Logger] = None):
        """
        Initialize parameter tracker.
        
        Args:
            max_parameter_age_days: Maximum age before parameters expire
            performance_decay_threshold: Threshold for performance decay (15%)
            artifacts_dir: Directory to store tracking artifacts
            logger: Logger instance
        """
        self.max_parameter_age_days = max_parameter_age_days
        self.performance_decay_threshold = performance_decay_threshold
        self.artifacts_dir = Path(artifacts_dir) if artifacts_dir else Path("artifacts/parameter_tracking")
        self.logger = logger or logging.getLogger(__name__)
        
        # Create artifacts directory
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        
        # Parameter tracking
        self.parameter_snapshots: List[ParameterSnapshot] = []
        self.parameter_performance: Dict[int, ParameterPerformance] = {}  # window_id -> performance
        self.market_regime_history: List[Dict[str, float]] = []
        
        # Load existing data
        self._load_tracking_data()
        
        self.logger.info(f"ParameterShelfLifeTracker initialized with {max_parameter_age_days} day shelf-life")
    
    def add_parameter_snapshot(self, 
                             window_id: int,
                             parameters: Dict[str, Any],
                             optimization_score: float,
                             validation_score: float,
                             market_conditions: Optional[Dict[str, float]] = None) -> None:
        """
        Add a parameter snapshot for tracking.
        
        Args:
            window_id: Window identifier
            parameters: Optimized parameters
            optimization_score: Score from optimization phase
            validation_score: Score from validation phase
            market_conditions: Current market conditions (volatility, trend, etc.)
        """
        if market_conditions is None:
            market_conditions = {}
        
        snapshot = ParameterSnapshot(
            window_id=window_id,
            parameters=parameters.copy(),
            optimization_score=optimization_score,
            validation_score=validation_score,
            created_at=datetime.now(),
            market_conditions=market_conditions
        )
        
        self.parameter_snapshots.append(snapshot)
        
        # Initialize performance tracking
        self.parameter_performance[window_id] = ParameterPerformance(
            window_id=window_id,
            parameters=parameters.copy(),
            initial_score=validation_score,
            current_score=validation_score,
            performance_decay=0.0,
            days_active=0,
            status=ParameterStatus.ACTIVE,
            relevancy_scores={metric: 1.0 for metric in RelevancyMetric},
            last_updated=datetime.now()
        )
        
        self.logger.info(f"Added parameter snapshot for window {window_id}")
        self._save_tracking_data()
    
    def update_parameter_performance(self, 
                                   window_id: int,
                                   current_score: float,
                                   market_conditions: Optional[Dict[str, float]] = None) -> None:
        """
        Update performance tracking for parameters.
        
        Args:
            window_id: Window identifier
            current_score: Current performance score
            market_conditions: Current market conditions
        """
        if window_id not in self.parameter_performance:
            self.logger.warning(f"No parameter tracking found for window {window_id}")
            return
        
        performance = self.parameter_performance[window_id]
        
        # Update performance metrics
        performance.current_score = current_score
        performance.performance_decay = (performance.initial_score - current_score) / performance.initial_score
        performance.days_active = (datetime.now() - performance.last_updated).days
        performance.last_updated = datetime.now()
        
        # Update relevancy scores
        if market_conditions:
            self.market_regime_history.append(market_conditions)
            performance.relevancy_scores = self._calculate_relevancy_scores(
                window_id, market_conditions
            )
        
        # Update status
        performance.status = self._determine_parameter_status(performance)
        
        self.logger.debug(f"Updated performance for window {window_id}: decay={performance.performance_decay:.3f}")
        self._save_tracking_data()
    
    def _calculate_relevancy_scores(self, 
                                  window_id: int,
                                  current_market_conditions: Dict[str, float]) -> Dict[RelevancyMetric, float]:
        """Calculate relevancy scores based on market conditions."""
        relevancy_scores = {}
        
        # Get historical market conditions for comparison
        if len(self.market_regime_history) < 2:
            return {metric: 1.0 for metric in RelevancyMetric}
        
        recent_conditions = self.market_regime_history[-10:]  # Last 10 observations
        
        # Performance decay score
        performance = self.parameter_performance[window_id]
        decay_score = max(0.0, 1.0 - abs(performance.performance_decay))
        relevancy_scores[RelevancyMetric.PERFORMANCE_DECAY] = decay_score
        
        # Market regime shift score
        if 'volatility' in current_market_conditions:
            historical_vol = np.mean([cond.get('volatility', 0) for cond in recent_conditions])
            current_vol = current_market_conditions['volatility']
            vol_change = abs(current_vol - historical_vol) / max(historical_vol, 1e-8)
            regime_score = max(0.0, 1.0 - vol_change)
            relevancy_scores[RelevancyMetric.MARKET_REGIME_SHIFT] = regime_score
        else:
            relevancy_scores[RelevancyMetric.MARKET_REGIME_SHIFT] = 1.0
        
        # Volatility change score
        if len(recent_conditions) >= 5:
            vol_values = [cond.get('volatility', 0) for cond in recent_conditions[-5:]]
            vol_stability = 1.0 - np.std(vol_values) / max(np.mean(vol_values), 1e-8)
            relevancy_scores[RelevancyMetric.VOLATILITY_CHANGE] = max(0.0, vol_stability)
        else:
            relevancy_scores[RelevancyMetric.VOLATILITY_CHANGE] = 1.0
        
        # Correlation breakdown score (simplified)
        correlation_score = 0.8  # Placeholder - would need more sophisticated analysis
        relevancy_scores[RelevancyMetric.CORRELATION_BREAKDOWN] = correlation_score
        
        return relevancy_scores
    
    def _determine_parameter_status(self, performance: ParameterPerformance) -> ParameterStatus:
        """Determine parameter status based on performance and age."""
        # Check age
        if performance.days_active > self.max_parameter_age_days:
            return ParameterStatus.EXPIRED
        
        # Check performance decay
        if performance.performance_decay > self.performance_decay_threshold:
            return ParameterStatus.REQUIRES_REOPTIMIZATION
        
        # Check relevancy scores
        avg_relevancy = np.mean(list(performance.relevancy_scores.values()))
        if avg_relevancy < 0.5:
            return ParameterStatus.DEGRADING
        elif avg_relevancy < 0.7:
            return ParameterStatus.DEGRADING
        
        return ParameterStatus.ACTIVE
    
    def get_parameter_recommendations(self) -> Dict[int, Dict[str, Any]]:
        """
        Get recommendations for parameter management.
        
        Returns:
            Dictionary with recommendations for each window
        """
        recommendations = {}
        
        for window_id, performance in self.parameter_performance.items():
            recommendation = {
                'window_id': window_id,
                'status': performance.status.value,
                'days_active': performance.days_active,
                'performance_decay': performance.performance_decay,
                'avg_relevancy': np.mean(list(performance.relevancy_scores.values())),
                'action_required': False,
                'recommended_action': 'continue_monitoring'
            }
            
            if performance.status == ParameterStatus.EXPIRED:
                recommendation['action_required'] = True
                recommendation['recommended_action'] = 'immediate_reoptimization'
                recommendation['reason'] = f'Parameters expired after {performance.days_active} days'
            
            elif performance.status == ParameterStatus.REQUIRES_REOPTIMIZATION:
                recommendation['action_required'] = True
                recommendation['recommended_action'] = 'schedule_reoptimization'
                recommendation['reason'] = f'Performance decay {performance.performance_decay:.1%} exceeds threshold'
            
            elif performance.status == ParameterStatus.DEGRADING:
                recommendation['action_required'] = False
                recommendation['recommended_action'] = 'increased_monitoring'
                recommendation['reason'] = 'Parameters showing signs of degradation'
            
            recommendations[window_id] = recommendation
        
        return recommendations
    
    def get_shelf_life_statistics(self) -> Dict[str, Any]:
        """Get statistics about parameter shelf-life."""
        if not self.parameter_performance:
            return {}
        
        performances = list(self.parameter_performance.values())
        
        # Calculate statistics
        active_count = sum(1 for p in performances if p.status == ParameterStatus.ACTIVE)
        degrading_count = sum(1 for p in performances if p.status == ParameterStatus.DEGRADING)
        expired_count = sum(1 for p in performances if p.status == ParameterStatus.EXPIRED)
        reopt_count = sum(1 for p in performances if p.status == ParameterStatus.REQUIRES_REOPTIMIZATION)
        
        avg_days_active = np.mean([p.days_active for p in performances])
        avg_performance_decay = np.mean([p.performance_decay for p in performances])
        avg_relevancy = np.mean([
            np.mean(list(p.relevancy_scores.values())) for p in performances
        ])
        
        return {
            'total_parameters': len(performances),
            'status_distribution': {
                'active': active_count,
                'degrading': degrading_count,
                'expired': expired_count,
                'requires_reoptimization': reopt_count
            },
            'avg_days_active': avg_days_active,
            'avg_performance_decay': avg_performance_decay,
            'avg_relevancy_score': avg_relevancy,
            'parameters_requiring_action': expired_count + reopt_count
        }
    
    def _save_tracking_data(self) -> None:
        """Save tracking data to disk."""
        try:
            # Save parameter snapshots
            snapshots_file = self.artifacts_dir / "parameter_snapshots.json"
            snapshots_data = [
                {
                    **asdict(snapshot),
                    'created_at': snapshot.created_at.isoformat()
                }
                for snapshot in self.parameter_snapshots
            ]
            
            from src.utils.stable_io import stable_json_dump
            with open(snapshots_file, 'w') as f:
                stable_json_dump(snapshots_data, f, indent=2)

            # Save performance tracking
            performance_file = self.artifacts_dir / "parameter_performance.json"
            performance_data = {}
            
            for window_id, performance in self.parameter_performance.items():
                performance_data[str(window_id)] = {
                    **asdict(performance),
                    'status': performance.status.value,
                    'relevancy_scores': {
                        metric.value: score 
                        for metric, score in performance.relevancy_scores.items()
                    },
                    'last_updated': performance.last_updated.isoformat()
                }
            
            from src.utils.stable_io import stable_json_dump
            with open(performance_file, 'w') as f:
                stable_json_dump(performance_data, f, indent=2)

        except Exception as e:
            self.logger.error(f"Failed to save tracking data: {e}")
    
    def _load_tracking_data(self) -> None:
        """Load existing tracking data from disk."""
        try:
            # Load parameter snapshots
            snapshots_file = self.artifacts_dir / "parameter_snapshots.json"
            if snapshots_file.exists():
                with open(snapshots_file, 'r') as f:
                    snapshots_data = json.load(f)
                
                for snapshot_data in snapshots_data:
                    snapshot_data['created_at'] = datetime.fromisoformat(snapshot_data['created_at'])
                    self.parameter_snapshots.append(ParameterSnapshot(**snapshot_data))
            
            # Load performance tracking
            performance_file = self.artifacts_dir / "parameter_performance.json"
            if performance_file.exists():
                with open(performance_file, 'r') as f:
                    performance_data = json.load(f)
                
                for window_id_str, perf_data in performance_data.items():
                    window_id = int(window_id_str)
                    perf_data['status'] = ParameterStatus(perf_data['status'])
                    perf_data['relevancy_scores'] = {
                        RelevancyMetric(metric): score
                        for metric, score in perf_data['relevancy_scores'].items()
                    }
                    perf_data['last_updated'] = datetime.fromisoformat(perf_data['last_updated'])
                    
                    self.parameter_performance[window_id] = ParameterPerformance(**perf_data)
            
            self.logger.info(f"Loaded {len(self.parameter_snapshots)} parameter snapshots")
            
        except Exception as e:
            self.logger.warning(f"Failed to load existing tracking data: {e}")
    
    def cleanup_old_data(self, days_to_keep: int = 730) -> None:
        """Clean up old tracking data."""
        cutoff_date = datetime.now() - timedelta(days=days_to_keep)
        
        # Remove old snapshots
        self.parameter_snapshots = [
            snapshot for snapshot in self.parameter_snapshots
            if snapshot.created_at > cutoff_date
        ]
        
        # Remove old performance data
        old_windows = [
            window_id for window_id, performance in self.parameter_performance.items()
            if performance.last_updated < cutoff_date
        ]
        
        for window_id in old_windows:
            del self.parameter_performance[window_id]
        
        self.logger.info(f"Cleaned up data older than {days_to_keep} days")
        self._save_tracking_data()
