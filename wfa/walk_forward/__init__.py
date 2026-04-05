# Walk-Forward Analysis Package
"""
Walk-Forward Analysis framework for systematic backtesting and optimization.

This package provides tools for:
- Time window generation and management
- Parameter optimization using advanced algorithms
- Results aggregation and analysis
- Performance optimization for large-scale testing
"""

__version__ = "1.0.0"
__author__ = "Prop Firm Trading Bot"

# Import main classes for convenience
from .window_manager import WindowManager, WindowConfig, TimeWindow, DateRange

try:
    from .parameter_generator import ParameterGridGenerator, generate_parameter_combinations
    _PARAMETER_GENERATOR_AVAILABLE = True
except ImportError:
    _PARAMETER_GENERATOR_AVAILABLE = False
    ParameterGridGenerator = None
    generate_parameter_combinations = None

try:
    from .walk_forward_runner import WalkForwardRunner, WalkForwardConfig, WindowResult, WalkForwardResults
    _WALK_FORWARD_RUNNER_AVAILABLE = True
except ImportError:
    _WALK_FORWARD_RUNNER_AVAILABLE = False
    WalkForwardRunner = None
    WalkForwardConfig = None
    WindowResult = None
    WalkForwardResults = None

# Epic 10: Task 10.2.1 - Async WFA Orchestrator Engine
try:
    from .async_wfa_orchestrator import (
        AsyncWFAOrchestrator,
        WFAConfiguration,
        WFAExecutionResult,
        WFAWindowResult,
        WFAStatus,
        create_wfa_orchestrator,
        run_wfa_analysis
    )
    from .parameter_optimizer import (
        ParameterOptimizer,
        OptimizationConfiguration,
        OptimizationResult,
        OptimizationObjective
    )
    _ASYNC_WFA_AVAILABLE = True
except ImportError:
    _ASYNC_WFA_AVAILABLE = False
    AsyncWFAOrchestrator = None
    WFAConfiguration = None
    WFAExecutionResult = None
    WFAWindowResult = None
    WFAStatus = None
    create_wfa_orchestrator = None
    run_wfa_analysis = None
    ParameterOptimizer = None
    OptimizationConfiguration = None
    OptimizationResult = None
    OptimizationObjective = None

__all__ = [
    'WindowManager',
    'WindowConfig',
    'TimeWindow',
    'DateRange',
]

if _PARAMETER_GENERATOR_AVAILABLE:
    __all__.extend(['ParameterGridGenerator', 'generate_parameter_combinations'])

if _WALK_FORWARD_RUNNER_AVAILABLE:
    __all__.extend(['WalkForwardRunner', 'WalkForwardConfig', 'WindowResult', 'WalkForwardResults'])

if _ASYNC_WFA_AVAILABLE:
    __all__.extend([
        'AsyncWFAOrchestrator',
        'WFAConfiguration',
        'WFAExecutionResult',
        'WFAWindowResult',
        'WFAStatus',
        'create_wfa_orchestrator',
        'run_wfa_analysis',
        'ParameterOptimizer',
        'OptimizationConfiguration',
        'OptimizationResult',
        'OptimizationObjective'
    ])
