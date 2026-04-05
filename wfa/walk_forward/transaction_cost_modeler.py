"""
Transaction Cost Modeling Framework for Walk-Forward Analysis.

This module implements comprehensive transaction cost and slippage models with
asset-specific parameters, dynamic spread modeling, and realistic commission
structures for accurate P&L calculation in trading system validation.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, time
from enum import Enum
from typing import Dict, List, Optional, Tuple, Any, Union

import numpy as np
import pandas as pd

# InstrumentDetails Protocol for per-symbol cost overrides
# Defined locally to avoid external config dependency
from typing import Protocol, runtime_checkable

@runtime_checkable
class InstrumentDetails(Protocol):
    """Protocol for instrument details used in cost modeling.
    
    Any object with these attributes can be used as InstrumentDetails.
    This allows flexibility in how instrument config is provided.
    """
    platform_symbol: str
    pip_value_in_account_currency_per_lot: float
    contract_size: float
    min_volume_lots: float
    max_volume_lots: float


class AssetClass(Enum):
    """Supported asset classes for cost modeling."""
    FOREX = "forex"
    CRYPTO = "crypto"
    EQUITIES = "equities"
    COMMODITIES = "commodities"
    FUTURES = "futures"



class MarketSession(Enum):
    """Market session types for time-of-day adjustments."""
    ASIAN = "asian"
    EUROPEAN = "european"
    AMERICAN = "american"
    OVERLAP_ASIAN_EUROPEAN = "overlap_asian_european"
    OVERLAP_EUROPEAN_AMERICAN = "overlap_european_american"
    OFF_HOURS = "off_hours"


class VolatilityRegime(Enum):
    """Volatility regimes for spread adjustments."""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    EXTREME = "extreme"


@dataclass
class AssetCostParameters:
    """Cost parameters for specific asset class."""
    asset_class: AssetClass
    base_spread_bps: float  # Base bid-ask spread in basis points
    slippage_bps: float  # Market impact slippage in basis points
    commission_rate: float  # Commission as percentage of notional
    commission_minimum: float  # Minimum commission per trade
    financing_rate_annual: float  # Annual financing/swap rate

    # Dynamic adjustments
    volatility_multipliers: Dict[VolatilityRegime, float]
    session_multipliers: Dict[MarketSession, float]

    # Liquidity parameters
    average_daily_volume: float  # For market impact calculation
    market_impact_coefficient: float  # Coefficient for square-root impact model


@dataclass
class SymbolCostOverrides:
    """Per-symbol cost parameter overrides from InstrumentDetails."""
    symbol: str
    pip_value_per_lot: Optional[float] = None  # From InstrumentDetails
    contract_size: Optional[float] = None  # From InstrumentDetails
    min_lot_size: Optional[float] = None  # From InstrumentDetails
    max_lot_size: Optional[float] = None  # From InstrumentDetails

    # Optional symbol-specific cost overrides
    base_spread_bps_override: Optional[float] = None
    commission_rate_override: Optional[float] = None
    financing_rate_override: Optional[float] = None

    # Liquidity overrides
    average_daily_volume_override: Optional[float] = None


@dataclass
class TradeExecution:
    """Trade execution details for cost calculation."""
    timestamp: datetime
    asset_symbol: str
    asset_class: AssetClass
    side: str  # 'buy' or 'sell'
    quantity: float
    price: float
    notional_value: float
    market_session: MarketSession
    volatility_regime: VolatilityRegime


@dataclass
class TransactionCosts:
    """Comprehensive transaction cost breakdown."""
    spread_cost: float
    slippage_cost: float
    commission_cost: float
    financing_cost: float
    total_cost: float
    cost_bps: float  # Total cost in basis points
    execution_details: TradeExecution


class TransactionCostModeler:
    """
    Comprehensive transaction cost modeling framework.
    
    Implements realistic cost models for different asset classes with
    dynamic spread adjustments, market impact modeling, and stress testing.
    """
    
    def __init__(self,
                 logger: Optional[logging.Logger] = None,
                 instrument_details: Optional[Dict[str, InstrumentDetails]] = None):
        """
        Initialize transaction cost modeler.

        Args:
            logger: Logger instance
            instrument_details: Dictionary of symbol -> InstrumentDetails for per-symbol overrides
        """
        self.logger = logger or logging.getLogger(__name__)

        # Asset-specific cost parameters
        self.asset_parameters = self._initialize_asset_parameters()

        # Symbol-specific cost overrides from InstrumentDetails
        self.symbol_overrides: Dict[str, SymbolCostOverrides] = {}
        if instrument_details and INSTRUMENT_DETAILS_AVAILABLE:
            self._initialize_symbol_overrides(instrument_details)

        # Cost calculation history
        self.cost_history: List[TransactionCosts] = []
        self.stress_test_results: Dict[str, Any] = {}

        self.logger.info("TransactionCostModeler initialized with {} asset classes and {} symbol overrides".format(
            len(self.asset_parameters), len(self.symbol_overrides)
        ))
    
    def _initialize_asset_parameters(self) -> Dict[AssetClass, AssetCostParameters]:
        """Initialize realistic cost parameters for each asset class."""
        parameters = {}
        
        # Forex parameters (major pairs like EURUSD)
        parameters[AssetClass.FOREX] = AssetCostParameters(
            asset_class=AssetClass.FOREX,
            base_spread_bps=0.5,  # 0.5 bps for major pairs
            slippage_bps=0.3,     # Market impact slippage
            commission_rate=0.0,  # No commission for retail forex
            commission_minimum=0.0,
            financing_rate_annual=0.02,  # 2% annual swap rate
            volatility_multipliers={
                VolatilityRegime.LOW: 0.8,
                VolatilityRegime.NORMAL: 1.0,
                VolatilityRegime.HIGH: 1.5,
                VolatilityRegime.EXTREME: 2.5
            },
            session_multipliers={
                MarketSession.ASIAN: 1.2,
                MarketSession.EUROPEAN: 0.9,
                MarketSession.AMERICAN: 1.0,
                MarketSession.OVERLAP_ASIAN_EUROPEAN: 0.8,
                MarketSession.OVERLAP_EUROPEAN_AMERICAN: 0.7,
                MarketSession.OFF_HOURS: 1.8
            },
            average_daily_volume=5000000000,  # $5B daily volume
            market_impact_coefficient=0.1
        )
        
        # Crypto parameters (major pairs like BTC/USD)
        parameters[AssetClass.CRYPTO] = AssetCostParameters(
            asset_class=AssetClass.CRYPTO,
            base_spread_bps=2.0,  # Higher spreads for crypto
            slippage_bps=1.5,     # Higher market impact
            commission_rate=0.001,  # 0.1% commission
            commission_minimum=1.0,  # $1 minimum
            financing_rate_annual=0.05,  # 5% annual funding rate
            volatility_multipliers={
                VolatilityRegime.LOW: 0.9,
                VolatilityRegime.NORMAL: 1.0,
                VolatilityRegime.HIGH: 2.0,
                VolatilityRegime.EXTREME: 4.0
            },
            session_multipliers={
                MarketSession.ASIAN: 1.1,
                MarketSession.EUROPEAN: 1.0,
                MarketSession.AMERICAN: 0.9,
                MarketSession.OVERLAP_ASIAN_EUROPEAN: 0.95,
                MarketSession.OVERLAP_EUROPEAN_AMERICAN: 0.85,
                MarketSession.OFF_HOURS: 1.3
            },
            average_daily_volume=2000000000,  # $2B daily volume
            market_impact_coefficient=0.2
        )
        
        # Equities parameters (large cap stocks)
        parameters[AssetClass.EQUITIES] = AssetCostParameters(
            asset_class=AssetClass.EQUITIES,
            base_spread_bps=1.0,  # 1 bps for large cap
            slippage_bps=0.8,     # Market impact
            commission_rate=0.0005,  # 0.05% commission
            commission_minimum=1.0,  # $1 minimum
            financing_rate_annual=0.03,  # 3% annual borrowing rate
            volatility_multipliers={
                VolatilityRegime.LOW: 0.8,
                VolatilityRegime.NORMAL: 1.0,
                VolatilityRegime.HIGH: 1.8,
                VolatilityRegime.EXTREME: 3.0
            },
            session_multipliers={
                MarketSession.ASIAN: 1.5,  # Pre-market
                MarketSession.EUROPEAN: 1.3,  # Pre-market
                MarketSession.AMERICAN: 1.0,  # Regular hours
                MarketSession.OVERLAP_ASIAN_EUROPEAN: 1.4,
                MarketSession.OVERLAP_EUROPEAN_AMERICAN: 1.1,
                MarketSession.OFF_HOURS: 2.0  # After hours
            },
            average_daily_volume=100000000,  # $100M daily volume
            market_impact_coefficient=0.15
        )

        # Commodities parameters (gold, oil, etc.)
        parameters[AssetClass.COMMODITIES] = AssetCostParameters(
            asset_class=AssetClass.COMMODITIES,
            base_spread_bps=1.5,  # 1.5 bps for major commodities
            slippage_bps=1.0,     # Market impact
            commission_rate=0.0002,  # 0.02% commission
            commission_minimum=2.0,  # $2 minimum
            financing_rate_annual=0.025,  # 2.5% annual financing rate
            volatility_multipliers={
                VolatilityRegime.LOW: 0.8,
                VolatilityRegime.NORMAL: 1.0,
                VolatilityRegime.HIGH: 2.0,
                VolatilityRegime.EXTREME: 3.5
            },
            session_multipliers={
                MarketSession.ASIAN: 1.3,
                MarketSession.EUROPEAN: 1.1,
                MarketSession.AMERICAN: 1.0,
                MarketSession.OVERLAP_ASIAN_EUROPEAN: 1.2,
                MarketSession.OVERLAP_EUROPEAN_AMERICAN: 0.9,
                MarketSession.OFF_HOURS: 1.6
            },
            average_daily_volume=500000000,  # $500M daily volume
            market_impact_coefficient=0.18
        )

        return parameters

    def _initialize_symbol_overrides(self, instrument_details: Dict[str, InstrumentDetails]) -> None:
        """Initialize symbol-specific cost overrides from InstrumentDetails."""
        for instrument_key, details in instrument_details.items():
            try:
                # Extract symbol from platform_symbol
                symbol = details.platform_symbol

                # Create symbol cost overrides
                overrides = SymbolCostOverrides(
                    symbol=symbol,
                    pip_value_per_lot=details.pip_value_in_account_currency_per_lot,
                    contract_size=details.contract_size,
                    min_lot_size=details.min_volume_lots,
                    max_lot_size=details.max_volume_lots
                )

                # Store overrides by symbol
                self.symbol_overrides[symbol] = overrides

                self.logger.debug(f"Initialized cost overrides for {symbol}: "
                                f"pip_value={details.pip_value_in_account_currency_per_lot}, "
                                f"contract_size={details.contract_size}")

            except Exception as e:
                self.logger.warning(f"Failed to initialize overrides for {instrument_key}: {e}")

    def add_symbol_override(self, symbol: str, overrides: SymbolCostOverrides) -> None:
        """Add or update symbol-specific cost overrides."""
        self.symbol_overrides[symbol] = overrides
        self.logger.info(f"Added cost overrides for symbol: {symbol}")

    def get_effective_cost_parameters(self,
                                    execution: 'TradeExecution') -> AssetCostParameters:
        """Get effective cost parameters with symbol-specific overrides applied."""
        # Start with base asset class parameters
        base_params = self.asset_parameters[execution.asset_class]

        # Check for symbol-specific overrides
        symbol_override = self.symbol_overrides.get(execution.asset_symbol)
        if not symbol_override:
            return base_params

        # Create modified parameters with overrides
        effective_params = AssetCostParameters(
            asset_class=base_params.asset_class,
            base_spread_bps=symbol_override.base_spread_bps_override or base_params.base_spread_bps,
            slippage_bps=base_params.slippage_bps,  # Keep base slippage for now
            commission_rate=symbol_override.commission_rate_override or base_params.commission_rate,
            commission_minimum=base_params.commission_minimum,
            financing_rate_annual=symbol_override.financing_rate_override or base_params.financing_rate_annual,
            volatility_multipliers=base_params.volatility_multipliers,
            session_multipliers=base_params.session_multipliers,
            average_daily_volume=symbol_override.average_daily_volume_override or base_params.average_daily_volume,
            market_impact_coefficient=base_params.market_impact_coefficient
        )

        return effective_params

    def infer_asset_class_from_symbol(self, symbol: str) -> AssetClass:
        """Infer asset class from symbol name."""
        symbol_upper = symbol.upper()

        # Forex pairs (major, minor, exotic)
        forex_patterns = [
            'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
            'EURJPY', 'GBPJPY', 'EURGBP', 'AUDCAD', 'GBPCHF', 'EURAUD', 'EURCHF',
            'AUDNZD', 'GBPAUD', 'GBPCAD', 'EURNZD', 'AUDCHF', 'NZDCHF'
        ]

        # Crypto patterns
        crypto_patterns = [
            'BTC', 'ETH', 'ADA', 'DOT', 'LINK', 'UNI', 'AAVE', 'SUSHI',
            'USDT', 'USDC', 'BUSD', 'DAI'
        ]

        # Check for exact forex matches
        if symbol_upper in forex_patterns:
            return AssetClass.FOREX

        # Check for crypto patterns
        for crypto in crypto_patterns:
            if crypto in symbol_upper:
                return AssetClass.CRYPTO

        # Check for stock/index patterns
        if any(pattern in symbol_upper for pattern in ['US30', 'SPX', 'NAS', 'DOW', '.cash']):
            return AssetClass.EQUITIES

        # Check for commodities
        if any(pattern in symbol_upper for pattern in ['XAU', 'XAG', 'OIL', 'GOLD', 'SILVER']):
            return AssetClass.COMMODITIES

        # Default to forex for unknown symbols
        self.logger.warning(f"Unknown symbol {symbol}, defaulting to FOREX asset class")
        return AssetClass.FOREX

    def calculate_transaction_costs(self,
                                  execution: TradeExecution,
                                  stress_multiplier: float = 1.0) -> TransactionCosts:
        """
        Calculate comprehensive transaction costs for a trade execution.
        
        Args:
            execution: Trade execution details
            stress_multiplier: Stress testing multiplier for costs
            
        Returns:
            Comprehensive transaction cost breakdown
        """
        if execution.asset_class not in self.asset_parameters:
            raise ValueError(f"Unsupported asset class: {execution.asset_class}")

        # Get effective parameters with symbol-specific overrides
        params = self.get_effective_cost_parameters(execution)
        
        # Calculate base spread cost
        spread_cost = self._calculate_spread_cost(execution, params, stress_multiplier)
        
        # Calculate slippage cost
        slippage_cost = self._calculate_slippage_cost(execution, params, stress_multiplier)
        
        # Calculate commission cost
        commission_cost = self._calculate_commission_cost(execution, params, stress_multiplier)
        
        # Calculate financing cost (for position holding)
        financing_cost = self._calculate_financing_cost(execution, params, stress_multiplier)
        
        # Total cost
        total_cost = spread_cost + slippage_cost + commission_cost + financing_cost
        
        # Cost in basis points
        cost_bps = (total_cost / execution.notional_value) * 10000 if execution.notional_value > 0 else 0
        
        transaction_costs = TransactionCosts(
            spread_cost=spread_cost,
            slippage_cost=slippage_cost,
            commission_cost=commission_cost,
            financing_cost=financing_cost,
            total_cost=total_cost,
            cost_bps=cost_bps,
            execution_details=execution
        )
        
        # Store in history
        self.cost_history.append(transaction_costs)
        
        return transaction_costs
    
    def _calculate_spread_cost(self, 
                             execution: TradeExecution,
                             params: AssetCostParameters,
                             stress_multiplier: float) -> float:
        """Calculate bid-ask spread cost with dynamic adjustments."""
        base_spread_bps = params.base_spread_bps
        
        # Apply volatility adjustment
        volatility_multiplier = params.volatility_multipliers.get(
            execution.volatility_regime, 1.0
        )
        
        # Apply session adjustment
        session_multiplier = params.session_multipliers.get(
            execution.market_session, 1.0
        )
        
        # Calculate adjusted spread
        adjusted_spread_bps = (base_spread_bps * 
                              volatility_multiplier * 
                              session_multiplier * 
                              stress_multiplier)
        
        # Convert to dollar cost
        spread_cost = (adjusted_spread_bps / 10000) * execution.notional_value
        
        return spread_cost
    
    def _calculate_slippage_cost(self, 
                               execution: TradeExecution,
                               params: AssetCostParameters,
                               stress_multiplier: float) -> float:
        """Calculate market impact slippage cost using square-root model."""
        base_slippage_bps = params.slippage_bps
        
        # Market impact based on trade size relative to average volume
        if params.average_daily_volume > 0:
            volume_ratio = execution.notional_value / params.average_daily_volume
            # Square-root market impact model
            impact_multiplier = params.market_impact_coefficient * np.sqrt(volume_ratio)
        else:
            impact_multiplier = 1.0
        
        # Apply volatility adjustment
        volatility_multiplier = params.volatility_multipliers.get(
            execution.volatility_regime, 1.0
        )
        
        # Calculate adjusted slippage
        adjusted_slippage_bps = (base_slippage_bps * 
                               impact_multiplier * 
                               volatility_multiplier * 
                               stress_multiplier)
        
        # Convert to dollar cost
        slippage_cost = (adjusted_slippage_bps / 10000) * execution.notional_value
        
        return slippage_cost
    
    def _calculate_commission_cost(self, 
                                 execution: TradeExecution,
                                 params: AssetCostParameters,
                                 stress_multiplier: float) -> float:
        """Calculate commission cost with minimum fees."""
        # Calculate percentage-based commission
        commission_cost = params.commission_rate * execution.notional_value * stress_multiplier
        
        # Apply minimum commission
        commission_cost = max(commission_cost, params.commission_minimum * stress_multiplier)
        
        return commission_cost
    
    def _calculate_financing_cost(self, 
                                execution: TradeExecution,
                                params: AssetCostParameters,
                                stress_multiplier: float) -> float:
        """Calculate financing/swap cost for position holding."""
        # Simplified: assume 1-day holding period
        daily_financing_rate = params.financing_rate_annual / 365
        
        # Apply to notional value
        financing_cost = (daily_financing_rate * 
                         execution.notional_value * 
                         stress_multiplier)
        
        return financing_cost
    
    def determine_market_session(self, timestamp: datetime) -> MarketSession:
        """Determine market session based on timestamp (UTC)."""
        hour = timestamp.hour
        
        # Simplified session determination (UTC hours)
        if 0 <= hour < 7:  # Asian session
            return MarketSession.ASIAN
        elif 7 <= hour < 8:  # Asian-European overlap
            return MarketSession.OVERLAP_ASIAN_EUROPEAN
        elif 8 <= hour < 13:  # European session
            return MarketSession.EUROPEAN
        elif 13 <= hour < 14:  # European-American overlap
            return MarketSession.OVERLAP_EUROPEAN_AMERICAN
        elif 14 <= hour < 21:  # American session
            return MarketSession.AMERICAN
        else:  # Off hours
            return MarketSession.OFF_HOURS
    
    def determine_volatility_regime(self, 
                                  recent_volatility: float,
                                  historical_volatility: float) -> VolatilityRegime:
        """Determine volatility regime based on recent vs historical volatility."""
        volatility_ratio = recent_volatility / historical_volatility if historical_volatility > 0 else 1.0
        
        if volatility_ratio < 0.7:
            return VolatilityRegime.LOW
        elif volatility_ratio < 1.3:
            return VolatilityRegime.NORMAL
        elif volatility_ratio < 2.0:
            return VolatilityRegime.HIGH
        else:
            return VolatilityRegime.EXTREME
    
    def calculate_portfolio_costs(self, 
                                executions: List[TradeExecution],
                                stress_multiplier: float = 1.0) -> Dict[str, Any]:
        """Calculate costs for a portfolio of trades."""
        total_costs = 0.0
        total_notional = 0.0
        cost_breakdown = {
            'spread_costs': 0.0,
            'slippage_costs': 0.0,
            'commission_costs': 0.0,
            'financing_costs': 0.0
        }
        
        trade_costs = []
        
        for execution in executions:
            costs = self.calculate_transaction_costs(execution, stress_multiplier)
            trade_costs.append(costs)
            
            total_costs += costs.total_cost
            total_notional += execution.notional_value
            
            cost_breakdown['spread_costs'] += costs.spread_cost
            cost_breakdown['slippage_costs'] += costs.slippage_cost
            cost_breakdown['commission_costs'] += costs.commission_cost
            cost_breakdown['financing_costs'] += costs.financing_cost
        
        # Calculate portfolio-level metrics
        portfolio_cost_bps = (total_costs / total_notional * 10000) if total_notional > 0 else 0
        
        return {
            'total_costs': total_costs,
            'total_notional': total_notional,
            'portfolio_cost_bps': portfolio_cost_bps,
            'cost_breakdown': cost_breakdown,
            'trade_costs': trade_costs,
            'num_trades': len(executions),
            'average_cost_per_trade': total_costs / len(executions) if executions else 0
        }
    
    def get_cost_summary(self) -> Dict[str, Any]:
        """Get summary of transaction cost calculations."""
        if not self.cost_history:
            return {"status": "no_costs_calculated"}
        
        total_costs = sum(cost.total_cost for cost in self.cost_history)
        total_notional = sum(cost.execution_details.notional_value for cost in self.cost_history)
        
        # Cost breakdown
        spread_costs = sum(cost.spread_cost for cost in self.cost_history)
        slippage_costs = sum(cost.slippage_cost for cost in self.cost_history)
        commission_costs = sum(cost.commission_cost for cost in self.cost_history)
        financing_costs = sum(cost.financing_cost for cost in self.cost_history)
        
        # Average cost in basis points
        avg_cost_bps = np.mean([cost.cost_bps for cost in self.cost_history])
        
        return {
            'total_calculations': len(self.cost_history),
            'total_costs': total_costs,
            'total_notional': total_notional,
            'average_cost_bps': avg_cost_bps,
            'cost_breakdown': {
                'spread_costs': spread_costs,
                'slippage_costs': slippage_costs,
                'commission_costs': commission_costs,
                'financing_costs': financing_costs
            },
            'cost_breakdown_percentage': {
                'spread_percentage': (spread_costs / total_costs * 100) if total_costs > 0 else 0,
                'slippage_percentage': (slippage_costs / total_costs * 100) if total_costs > 0 else 0,
                'commission_percentage': (commission_costs / total_costs * 100) if total_costs > 0 else 0,
                'financing_percentage': (financing_costs / total_costs * 100) if total_costs > 0 else 0
            }
        }
    
    def clear_history(self) -> None:
        """Clear cost calculation history."""
        self.cost_history.clear()
        self.stress_test_results.clear()
        self.logger.info("Transaction cost calculation history cleared")
