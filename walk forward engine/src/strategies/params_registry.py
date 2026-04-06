"""
Strategy Parameters Registry for validation at config load time.

This module provides centralized validation of strategy parameters using
Pydantic models. It catches configuration errors at startup instead of
at WFA runtime.

Usage:
    from src.strategies.params_registry import validate_strategy_params
    
    validated = validate_strategy_params(
        "LondonBreakout_PriceAction",
        {"buffer_pips": 5.0, ...}
    )
"""

from typing import Dict, Type, Any, Optional
from pydantic import BaseModel, ValidationError
import logging


def get_registry() -> Dict[str, Type[BaseModel]]:
    """
    Lazy-load registry to avoid circular imports.
    
    Returns mapping of strategy_definition_key -> Pydantic param model.
    """
    from src.strategies.london_breakout import LondonBreakoutParams
    
    return {
        "LondonBreakout_PriceAction": LondonBreakoutParams,
        "LondonBreakout_ORB": LondonBreakoutParams,  # New ORB-aligned key
        # Add more as they're converted:
        # "TrendFollowing_SMA_Cross": GoldTrendFollowingParams,
    }



def validate_strategy_params(
    definition_key: str, 
    raw_params: Dict[str, Any],
    logger: Optional[logging.Logger] = None
) -> Optional[BaseModel]:
    """
    Validate raw parameters against registered Pydantic model.
    
    Args:
        definition_key: Strategy definition key from config
        raw_params: Raw parameter dict from JSON config
        logger: Optional logger for debug output
        
    Returns:
        Validated Pydantic model, or None if strategy not in registry
        
    Raises:
        ValidationError: If params fail Pydantic validation
    """
    registry = get_registry()
    
    if definition_key not in registry:
        # Not registered = no validation (backward compatible)
        if logger:
            logger.debug(f"No Pydantic model for '{definition_key}', skipping validation")
        return None
    
    model_class = registry[definition_key]
    return model_class(**raw_params)
