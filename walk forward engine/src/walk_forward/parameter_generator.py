# src/walk_forward/parameter_generator.py

import logging
import optuna
from typing import Dict, List, Any, Union, Optional
from dataclasses import dataclass
from enum import Enum
import numpy as np


class ParameterType(Enum):
    """Enumeration of supported parameter types"""
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    CATEGORICAL = "categorical"


@dataclass
class ParameterSpec:
    """Specification for a single parameter"""
    name: str
    param_type: ParameterType
    range_values: Union[List[Union[int, float]], List[str], List[bool]]
    default: Any
    description: str
    step: Optional[Union[int, float]] = None
    log_scale: bool = False  # For log-uniform distributions


class ParameterValidationError(Exception):
    """Raised when parameter specifications are invalid"""
    pass


class ParameterGridGenerator:
    """
    Advanced parameter grid generator using Optuna for intelligent sampling.
    Supports multiple parameter types and sampling strategies.
    """
    
    def __init__(self, logger: Optional[logging.Logger] = None):
        self.logger = logger or logging.getLogger(self.__class__.__name__)
        self._parameter_specs: Dict[str, ParameterSpec] = {}
    
    def add_parameter_spec(self, spec: ParameterSpec) -> None:
        """
        Add a parameter specification to the generator.
        
        Args:
            spec: ParameterSpec object defining the parameter
            
        Raises:
            ParameterValidationError: If specification is invalid
        """
        try:
            self._validate_parameter_spec(spec)
            self._parameter_specs[spec.name] = spec
            self.logger.debug(f"Added parameter spec: {spec.name} ({spec.param_type.value})")
        except Exception as e:
            raise ParameterValidationError(f"Invalid parameter spec for {spec.name}: {e}")
    
    def load_parameter_specs_from_dict(self, param_dict: Dict[str, Dict[str, Any]]) -> None:
        """
        Load parameter specifications from dictionary format.
        
        Args:
            param_dict: Dictionary containing parameter specifications
            
        Example:
            {
                "rsi_period": {
                    "type": "integer",
                    "range": [10, 30],
                    "step": 2,
                    "default": 14,
                    "description": "RSI calculation period"
                }
            }
        """
        for param_name, param_config in param_dict.items():
            try:
                # Parse parameter type
                param_type = ParameterType(param_config["type"])
                
                # Handle different parameter types
                if param_type in [ParameterType.INTEGER, ParameterType.FLOAT]:
                    if "range" not in param_config or len(param_config["range"]) != 2:
                        raise ValueError("Integer and float parameters require 'range' with [min, max]")
                    range_values = param_config["range"]
                elif param_type == ParameterType.BOOLEAN:
                    range_values = param_config.get("values", [True, False])
                elif param_type == ParameterType.CATEGORICAL:
                    if "values" not in param_config:
                        raise ValueError("Categorical parameters require 'values' list")
                    range_values = param_config["values"]
                else:
                    raise ValueError(f"Unsupported parameter type: {param_type}")
                
                # Create parameter specification
                spec = ParameterSpec(
                    name=param_name,
                    param_type=param_type,
                    range_values=range_values,
                    default=param_config.get("default"),
                    description=param_config.get("description", ""),
                    step=param_config.get("step"),
                    log_scale=param_config.get("log_scale", False)
                )
                
                self.add_parameter_spec(spec)
                
            except Exception as e:
                self.logger.error(f"Failed to load parameter spec for {param_name}: {e}")
                raise ParameterValidationError(f"Invalid parameter configuration for {param_name}: {e}")

    def generate_parameter_combinations(self,
                                      n_trials: int = 100,
                                      sampling_strategy: str = "tpe",
                                      seed: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Generate parameter combinations using Optuna intelligent sampling.

        Args:
            n_trials: Number of parameter combinations to generate
            sampling_strategy: Sampling strategy ("tpe", "random", "cmaes")
            seed: Random seed for reproducibility

        Returns:
            List of parameter dictionaries

        Raises:
            ParameterValidationError: If no parameters are defined or generation fails
        """
        if not self._parameter_specs:
            raise ParameterValidationError("No parameter specifications defined")

        self.logger.info(f"Generating {n_trials} parameter combinations using {sampling_strategy} sampling")

        try:
            # Create Optuna sampler based on strategy
            sampler = self._create_sampler(sampling_strategy, seed)

            # Create study for parameter generation
            study = optuna.create_study(
                direction="maximize",  # Direction doesn't matter for parameter generation
                sampler=sampler
            )

            # Define objective function for parameter suggestion
            def objective(trial: optuna.Trial) -> float:
                """Objective function that suggests parameters and returns dummy value"""
                params = {}

                for spec in self._parameter_specs.values():
                    try:
                        if spec.param_type == ParameterType.INTEGER:
                            params[spec.name] = trial.suggest_int(
                                spec.name,
                                int(spec.range_values[0]),
                                int(spec.range_values[1]),
                                step=spec.step
                            )
                        elif spec.param_type == ParameterType.FLOAT:
                            if spec.log_scale:
                                params[spec.name] = trial.suggest_float(
                                    spec.name,
                                    float(spec.range_values[0]),
                                    float(spec.range_values[1]),
                                    log=True
                                )
                            else:
                                params[spec.name] = trial.suggest_float(
                                    spec.name,
                                    float(spec.range_values[0]),
                                    float(spec.range_values[1]),
                                    step=spec.step
                                )
                        elif spec.param_type == ParameterType.BOOLEAN:
                            params[spec.name] = trial.suggest_categorical(
                                spec.name,
                                spec.range_values
                            )
                        elif spec.param_type == ParameterType.CATEGORICAL:
                            params[spec.name] = trial.suggest_categorical(
                                spec.name,
                                spec.range_values
                            )
                    except Exception as e:
                        self.logger.warning(f"Failed to suggest parameter {spec.name}: {e}")
                        # Use default value if suggestion fails
                        params[spec.name] = spec.default

                return 0.0  # Dummy return value

            # Generate parameter combinations
            study.optimize(objective, n_trials=n_trials, n_jobs=-1, show_progress_bar=False)

            # Extract parameter combinations from trials
            parameter_combinations = []
            for trial in study.trials:
                if trial.state == optuna.trial.TrialState.COMPLETE:
                    parameter_combinations.append(trial.params.copy())

            self.logger.info(f"Successfully generated {len(parameter_combinations)} parameter combinations")

            # Add default parameter combination if not already present
            default_params = self._get_default_parameters()
            if default_params not in parameter_combinations:
                parameter_combinations.insert(0, default_params)
                self.logger.debug("Added default parameter combination")

            return parameter_combinations

        except Exception as e:
            self.logger.error(f"Failed to generate parameter combinations: {e}")
            raise ParameterValidationError(f"Parameter generation failed: {e}")

    def _create_sampler(self, strategy: str, seed: Optional[int]) -> optuna.samplers.BaseSampler:
        """Create Optuna sampler based on strategy"""
        samplers = {
            "tpe": lambda: optuna.samplers.TPESampler(seed=seed, n_startup_trials=10),
            "random": lambda: optuna.samplers.RandomSampler(seed=seed),
            "cmaes": lambda: optuna.samplers.CmaEsSampler(seed=seed),
        }

        if strategy not in samplers:
            self.logger.warning(f"Unknown sampling strategy: {strategy}. Using TPE.")
            strategy = "tpe"

        return samplers[strategy]()

    def _validate_parameter_spec(self, spec: ParameterSpec) -> None:
        """Validate a parameter specification"""
        if not spec.name:
            raise ValueError("Parameter name cannot be empty")

        if spec.param_type in [ParameterType.INTEGER, ParameterType.FLOAT]:
            if len(spec.range_values) != 2:
                raise ValueError("Integer and float parameters require exactly 2 range values [min, max]")
            if spec.range_values[0] > spec.range_values[1]:
                raise ValueError("Parameter range minimum must be less than maximum")

            # Validate step size
            if spec.step is not None:
                if spec.step <= 0:
                    raise ValueError("Step size must be positive")
                if spec.param_type == ParameterType.INTEGER and not isinstance(spec.step, int):
                    raise ValueError("Integer parameter step must be an integer")

        elif spec.param_type in [ParameterType.BOOLEAN, ParameterType.CATEGORICAL]:
            if not spec.range_values:
                raise ValueError("Boolean and categorical parameters require non-empty values list")

        # Validate default value
        if spec.default is not None:
            if spec.param_type in [ParameterType.INTEGER, ParameterType.FLOAT]:
                if not (spec.range_values[0] <= spec.default <= spec.range_values[1]):
                    raise ValueError("Default value must be within parameter range")
            elif spec.param_type in [ParameterType.BOOLEAN, ParameterType.CATEGORICAL]:
                if spec.default not in spec.range_values:
                    raise ValueError("Default value must be in parameter values list")

    def _get_default_parameters(self) -> Dict[str, Any]:
        """Get default parameter values"""
        defaults = {}
        for spec in self._parameter_specs.values():
            if spec.default is not None:
                defaults[spec.name] = spec.default
            else:
                # Generate reasonable default if none specified
                if spec.param_type == ParameterType.INTEGER:
                    defaults[spec.name] = int(np.mean(spec.range_values))
                elif spec.param_type == ParameterType.FLOAT:
                    defaults[spec.name] = float(np.mean(spec.range_values))
                elif spec.param_type in [ParameterType.BOOLEAN, ParameterType.CATEGORICAL]:
                    defaults[spec.name] = spec.range_values[0]

        return defaults

    def suggest_trial_parameters(self, trial: optuna.Trial) -> Dict[str, Any]:
        """
        Suggests a set of parameters for a single Optuna trial.

        Args:
            trial: Optuna trial object

        Returns:
            Dictionary of suggested parameters for this trial
        """
        params = {}
        for spec in self._parameter_specs.values():
            if spec.param_type == ParameterType.INTEGER:
                params[spec.name] = trial.suggest_int(
                    spec.name,
                    int(spec.range_values[0]),
                    int(spec.range_values[1]),
                    step=spec.step
                )
            elif spec.param_type == ParameterType.FLOAT:
                params[spec.name] = trial.suggest_float(
                    spec.name,
                    float(spec.range_values[0]),
                    float(spec.range_values[1]),
                    step=spec.step,
                    log=spec.log_scale
                )
            elif spec.param_type == ParameterType.BOOLEAN or spec.param_type == ParameterType.CATEGORICAL:
                params[spec.name] = trial.suggest_categorical(spec.name, spec.range_values)
        return params

    def get_parameter_info(self) -> Dict[str, Dict[str, Any]]:
        """Get information about all defined parameters"""
        info = {}
        for name, spec in self._parameter_specs.items():
            info[name] = {
                "type": spec.param_type.value,
                "range_values": spec.range_values,
                "default": spec.default,
                "description": spec.description,
                "step": spec.step,
                "log_scale": spec.log_scale
            }
        return info


# Predefined parameter specifications for MeanReversionRSI strategy
MEANREVERSION_RSI_PARAMETERS = {
    # Core RSI Parameters
    "rsi_period": {
        "type": "integer",
        "range": [10, 30],
        "step": 2,
        "default": 14,
        "description": "RSI calculation period"
    },
    "rsi_oversold": {
        "type": "float",
        "range": [20.0, 35.0],
        "step": 5.0,
        "default": 30.0,
        "description": "RSI oversold threshold"
    },
    "rsi_overbought": {
        "type": "float",
        "range": [65.0, 80.0],
        "step": 5.0,
        "default": 70.0,
        "description": "RSI overbought threshold"
    },

    # Bollinger Band Parameters
    "bollinger_period": {
        "type": "integer",
        "range": [15, 50],
        "step": 5,
        "default": 20,
        "description": "Bollinger Band period"
    },
    "bollinger_std_dev": {
        "type": "float",
        "range": [1.0, 3.0],
        "step": 0.25,
        "default": 2.0,
        "description": "Bollinger Band standard deviation"
    },

    # Risk Management Parameters
    "stop_loss_atr_period": {
        "type": "integer",
        "range": [5, 20],
        "step": 5,
        "default": 10,
        "description": "ATR period for stop loss calculation"
    },
    "stop_loss_atr_multiplier": {
        "type": "float",
        "range": [1.0, 3.0],
        "step": 0.2,
        "default": 1.8,
        "description": "ATR multiplier for stop loss distance"
    },
    "take_profit_atr_period": {
        "type": "integer",
        "range": [5, 20],
        "step": 5,
        "default": 10,
        "description": "ATR period for take profit calculation"
    },
    "take_profit_atr_multiplier": {
        "type": "float",
        "range": [1.5, 4.0],
        "step": 0.25,
        "default": 2.5,
        "description": "ATR multiplier for take profit distance"
    },

    # Position Management
    "max_position_age_bars": {
        "type": "integer",
        "range": [24, 96],
        "step": 12,
        "default": 48,
        "description": "Maximum position age in bars"
    },

    # Trend Filter Parameters
    "trend_filter_ma_period": {
        "type": "integer",
        "range": [100, 300],
        "step": 50,
        "default": 200,
        "description": "Moving average period for trend filter"
    },

    # Filter Controls
    "use_trend_filter": {
        "type": "boolean",
        "values": [True, False],
        "default": False,
        "description": "Enable/disable trend filter"
    },
    "use_bollinger_filter": {
        "type": "boolean",
        "values": [True, False],
        "default": False,
        "description": "Enable/disable Bollinger Band filter"
    }
}


def generate_parameter_combinations(param_spec: Dict[str, Dict[str, Any]],
                                  n_trials: int = 100,
                                  sampling_strategy: str = "tpe",
                                  seed: Optional[int] = None,
                                  logger: Optional[logging.Logger] = None) -> List[Dict[str, Any]]:
    """
    Convenience function to generate parameter combinations from specification dictionary.

    Args:
        param_spec: Parameter specification dictionary
        n_trials: Number of combinations to generate
        sampling_strategy: Optuna sampling strategy
        seed: Random seed for reproducibility
        logger: Logger instance

    Returns:
        List of parameter combination dictionaries

    Example:
        combinations = generate_parameter_combinations(
            MEANREVERSION_RSI_PARAMETERS,
            n_trials=50,
            seed=42
        )
    """
    generator = ParameterGridGenerator(logger)
    generator.load_parameter_specs_from_dict(param_spec)
    return generator.generate_parameter_combinations(n_trials, sampling_strategy, seed)


if __name__ == "__main__":
    # Example usage and testing
    logging.basicConfig(level=logging.INFO)

    # Test parameter generation
    try:
        combinations = generate_parameter_combinations(
            MEANREVERSION_RSI_PARAMETERS,
            n_trials=10,
            seed=42
        )

        print(f"Generated {len(combinations)} parameter combinations:")
        for i, combo in enumerate(combinations[:3]):  # Show first 3
            print(f"Combination {i+1}: {combo}")

    except Exception as e:
        print(f"Error: {e}")
