#!/usr/bin/env python3
"""Minimal WFA runner for ATR breakout strategy - pure Python (no pandas)."""
import csv
import json
import math
import sys
from pathlib import Path
from statistics import mean, pstdev
from itertools import product

def load_csv(path):
    rows = []
    with open(path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({
                'timestamp': row['timestamp'],
                'open': float(row['open']),
                'high': float(row['high']),
                'low': float(row['low']),
                'close': float(row['close']),
                'volume': float(row['volume'])
            })
    return rows

def calculate_atr(data, period):
    """Calculate Average True Range."""
    trs = []
    for i in range(1, len(data)):
        high = data[i]['high']
        low = data[i]['low']
        prev_close = data[i-1]['close']
        
        tr1 = high - low
        tr2 = abs(high - prev_close)
        tr3 = abs(low - prev_close)
        tr = max(tr1, tr2, tr3)
        trs.append(tr)
    
    # Rolling average
    atrs = []
    for i in range(len(trs)):
        if i < period - 1:
            atrs.append(None)
        else:
            avg = sum(trs[i-period+1:i+1]) / period
            atrs.append(avg)
    return atrs

def generate_signal_sma(data, fast_period, slow_period):
    """Generate SMA crossover signals."""
    n = len(data)
    signals = [0] * n
    in_position = False
    
    # Calculate SMAs
    for i in range(slow_period, n):
        fast_sma = sum(data[j]['close'] for j in range(i-fast_period+1, i+1)) / fast_period
        slow_sma = sum(data[j]['close'] for j in range(i-slow_period+1, i+1)) / slow_period
        
        # Previous values
        prev_fast = sum(data[j]['close'] for j in range(i-fast_period, i)) / fast_period
        prev_slow = sum(data[j]['close'] for j in range(i-slow_period, i)) / slow_period
        
        # Crossover detection
        if prev_fast <= prev_slow and fast_sma > slow_sma:
            in_position = True
            signals[i] = 1
        elif prev_fast >= prev_slow and fast_sma < slow_sma:
            in_position = False
            if signals[i-1] == 1:
                pass  # Exit
            signals[i] = 0
        else:
            signals[i] = 1 if in_position else 0
    
    return signals

def generate_signal_bb(data, period, std_dev):
    """Generate Bollinger Bands mean-reversion signals.
    
    Buy when price touches lower band, sell when touches upper band.
    """
    n = len(data)
    signals = [0] * n
    in_position = False
    
    for i in range(period, n):
        # Calculate middle band (SMA)
        sma = sum(data[j]['close'] for j in range(i-period+1, i+1)) / period
        
        # Calculate standard deviation
        variance = sum((data[j]['close'] - sma)**2 for j in range(i-period+1, i+1)) / period
        std = variance ** 0.5
        
        # Calculate bands
        upper_band = sma + (std_dev * std)
        lower_band = sma - (std_dev * std)
        
        current_price = data[i]['close']
        prev_price = data[i-1]['close']
        
        # Entry: price crosses below lower band
        if not in_position and prev_price > lower_band and current_price <= lower_band:
            in_position = True
            signals[i] = 1
        # Exit: price crosses above upper band or touches middle (take profit)
        elif in_position:
            if prev_price < upper_band and current_price >= upper_band:
                in_position = False
            elif prev_price < sma and current_price >= sma:
                # Take profit at middle band
                in_position = False
            else:
                signals[i] = 1
    
    return signals

def generate_signal_spread(data1, data2, period, threshold):
    """Generate cross-asset momentum spread signals.
    
    Long asset1 when it outperforms asset2 by > threshold, 
    exit when spread narrows.
    """
    n = min(len(data1), len(data2))
    signals = [0] * n
    in_position = False
    
    for i in range(period, n):
        # Calculate returns for both assets over period
        ret1 = (data1[i]['close'] - data1[i-period]['close']) / data1[i-period]['close']
        ret2 = (data2[i]['close'] - data2[i-period]['close']) / data2[i-period]['close']
        
        # Spread is relative outperformance
        spread = ret1 - ret2
        
        if not in_position:
            # Enter long asset1 when it outperforms by threshold
            if spread > threshold:
                in_position = True
                signals[i] = 1
        else:
            # Exit when spread mean-reverts (goes below threshold/2)
            if spread < threshold / 2:
                in_position = False
            else:
                signals[i] = 1
    
    return signals

def generate_signal_rsi(data, period, oversold, overbought):
    """Generate RSI momentum signals.
    
    Buy when RSI crosses above oversold, sell when crosses below overbought.
    """
    n = len(data)
    signals = [0] * n
    in_position = False
    
    # Calculate RSI
    rsi_values = []
    for i in range(1, n):
        delta = data[i]['close'] - data[i-1]['close']
        gains = []
        losses = []
        for j in range(max(0, i-period), i):
            d = data[j+1]['close'] - data[j]['close']
            if d > 0:
                gains.append(d)
            else:
                losses.append(abs(d))
        
        avg_gain = sum(gains) / period if gains else 0
        avg_loss = sum(losses) / period if losses else 0
        
        if avg_loss == 0:
            rsi = 100
        else:
            rs = avg_gain / avg_loss
            rsi = 100 - (100 / (1 + rs))
        
        rsi_values.append(rsi)
    
    # Generate signals from RSI
    for i in range(period, n-1):
        prev_rsi = rsi_values[i - period] if i - period >= 0 else 50
        curr_rsi = rsi_values[i - period + 1] if i - period + 1 >= 0 else 50
        
        if not in_position:
            if prev_rsi < oversold and curr_rsi >= oversold:
                in_position = True
                signals[i+1] = 1
        else:
            if prev_rsi > overbought and curr_rsi <= overbought:
                in_position = False
            else:
                signals[i+1] = 1
    
    return signals

def generate_signal_ensemble(data, sma_fast, sma_slow, rsi_period, rsi_oversold, rsi_overbought):
    """Generate ensemble signals combining SMA and RSI.
    
    Buy when SMA is bullish (fast > slow) OR RSI crosses above oversold level.
    This is a more inclusive "OR" logic - either signal confirms entry.
    Sell when SMA bearish AND RSI overbought (both must agree to exit).
    """
    n = len(data)
    signals = [0] * n
    in_position = False
    
    # Pre-calculate RSI values
    rsi_values = []
    for i in range(1, n):
        gains = []
        losses = []
        for j in range(max(0, i-rsi_period), i):
            d = data[j+1]['close'] - data[j]['close']
            if d > 0:
                gains.append(d)
            else:
                losses.append(abs(d))
        
        avg_gain = sum(gains) / rsi_period if gains else 0
        avg_loss = sum(losses) / rsi_period if losses else 0
        
        if avg_loss == 0:
            rsi = 100
        else:
            rs = avg_gain / avg_loss
            rsi = 100 - (100 / (1 + rs))
        
        rsi_values.append(rsi)
    
    # Generate ensemble signals
    prev_in_position = False
    for i in range(sma_slow, n-1):
        # Get SMA values
        fast_val = sum(data[j]['close'] for j in range(i-sma_fast+1, i+1)) / sma_fast
        slow_val = sum(data[j]['close'] for j in range(i-sma_slow+1, i+1)) / sma_slow
        
        # Get RSI value
        rsi = rsi_values[i - 1] if i - 1 >= 0 else 50
        
        # SMA bullish = fast > slow
        sma_bullish = fast_val > slow_val
        rsi_crossed_up = rsi > rsi_oversold and (i > 0 and rsi_values[i-2] <= rsi_oversold) if i >= 2 else False
        rsi_overbought_cross = rsi < rsi_overbought and (i > 0 and rsi_values[i-2] >= rsi_overbought) if i >= 2 else False
        
        # Entry: Either SMA bullish OR RSI crosses up from oversold
        if not in_position:
            if sma_bullish or rsi_crossed_up:
                in_position = True
                signals[i+1] = 1
        else:
            # Exit: SMA turns bearish AND RSI crosses down from overbought
            if (fast_val < slow_val and rsi > rsi_overbought) or rsi_overbought_cross:
                in_position = False
            else:
                signals[i+1] = 1
    
    return signals

def compute_metrics(data, signals):
    """Compute strategy metrics."""
    returns = []
    equity = [1.0]
    
    for i in range(1, len(data)):
        if signals[i-1] == 1:
            ret = (data[i]['close'] - data[i-1]['close']) / data[i-1]['close']
        else:
            ret = 0.0
        returns.append(ret)
        equity.append(equity[-1] * (1 + ret))
    
    # Drawdown
    running_max = [equity[0]]
    for e in equity[1:]:
        running_max.append(max(running_max[-1], e))
    
    drawdowns = []
    for i in range(len(equity)):
        dd = (equity[i] / running_max[i]) - 1 if running_max[i] > 0 else 0
        drawdowns.append(dd)
    
    # Metrics
    total_return = equity[-1] - 1
    
    avg_ret = mean(returns) if returns else 0.0
    std_ret = pstdev(returns) if len(returns) > 1 else 0.0
    sharpe = (avg_ret / std_ret * math.sqrt(252)) if std_ret > 0 else 0.0
    
    max_dd = min(drawdowns) if drawdowns else 0
    
    # Win rate
    nonzero_returns = [r for r in returns if r != 0]
    win_rate = sum(1 for r in nonzero_returns if r > 0) / len(nonzero_returns) if nonzero_returns else 0
    
    # Trade count
    trades = sum(1 for i in range(1, len(signals)) if signals[i-1] == 0 and signals[i] == 1)
    
    return {
        'total_return': total_return,
        'sharpe': sharpe,
        'max_drawdown': max_dd,
        'win_rate': win_rate,
        'trades': trades
    }

def run_wfa(data, param_grid, train_size, test_size):
    """Run walk-forward analysis."""
    windows = []
    
    cursor = 0
    while cursor + train_size + test_size <= len(data):
        train_data = data[cursor:cursor + train_size]
        test_data = data[cursor + train_size:cursor + train_size + test_size]
        
        # Find best params on train
        best_params = None
        best_score = float('-inf')
        
        for params in param_grid:
            signals = generate_signal_atr(train_data, **params)
            metrics = compute_metrics(train_data, signals)
            score = metrics['sharpe'] - abs(metrics['max_drawdown'])
            if score > best_score:
                best_score = score
                best_params = params
        
        # Apply best params to test
        test_signals = generate_signal_atr(test_data, **best_params)
        test_metrics = compute_metrics(test_data, test_signals)
        
        train_metrics = compute_metrics(train_data, generate_signal_atr(train_data, **best_params))
        
        windows.append({
            'train_start': train_data[0]['timestamp'],
            'train_end': train_data[-1]['timestamp'],
            'test_start': test_data[0]['timestamp'],
            'test_end': test_data[-1]['timestamp'],
            'params': best_params,
            'train': train_metrics,
            'test': test_metrics
        })
        
        cursor += test_size
    
    # Aggregate out-of-sample
    if windows:
        oos_returns = []
        for w in windows:
            # Use test metrics
            pass
        oos = {
            'total_return': mean([w['test']['total_return'] for w in windows]),
            'sharpe': mean([w['test']['sharpe'] for w in windows]),
            'max_drawdown': mean([w['test']['max_drawdown'] for w in windows]),
            'win_rate': mean([w['test']['win_rate'] for w in windows]),
            'trades': sum([w['test']['trades'] for w in windows]),
            'windows': len(windows)
        }
    else:
        oos = {'total_return': 0, 'sharpe': 0, 'max_drawdown': 0, 'win_rate': 0, 'trades': 0, 'windows': 0}
    
    return {'windows': windows, 'out_of_sample': oos}

def run_wfa_sma(data, param_grid, train_size, test_size):
    """Run walk-forward analysis with SMA strategy."""
    windows = []
    
    cursor = 0
    while cursor + train_size + test_size <= len(data):
        train_data = data[cursor:cursor + train_size]
        test_data = data[cursor + train_size:cursor + train_size + test_size]
        
        # Find best params on train
        best_params = None
        best_score = float('-inf')
        
        for params in param_grid:
            signals = generate_signal_sma(train_data, params['fast'], params['slow'])
            metrics = compute_metrics(train_data, signals)
            score = metrics['sharpe'] - abs(metrics['max_drawdown'])
            if score > best_score:
                best_score = score
                best_params = params
        
        # Apply best params to test
        test_signals = generate_signal_sma(test_data, best_params['fast'], best_params['slow'])
        test_metrics = compute_metrics(test_data, test_signals)
        
        train_metrics = compute_metrics(train_data, generate_signal_sma(train_data, best_params['fast'], best_params['slow']))
        
        windows.append({
            'train_start': train_data[0]['timestamp'],
            'train_end': train_data[-1]['timestamp'],
            'test_start': test_data[0]['timestamp'],
            'test_end': test_data[-1]['timestamp'],
            'params': best_params,
            'train': train_metrics,
            'test': test_metrics
        })
        
        cursor += test_size
    
    # Aggregate out-of-sample
    if windows:
        oos = {
            'total_return': mean([w['test']['total_return'] for w in windows]),
            'sharpe': mean([w['test']['sharpe'] for w in windows]),
            'max_drawdown': mean([w['test']['max_drawdown'] for w in windows]),
            'win_rate': mean([w['test']['win_rate'] for w in windows]),
            'trades': sum([w['test']['trades'] for w in windows]),
            'windows': len(windows)
        }
    else:
        oos = {'total_return': 0, 'sharpe': 0, 'max_drawdown': 0, 'win_rate': 0, 'trades': 0, 'windows': 0}
    
    return {'windows': windows, 'out_of_sample': oos}

def run_wfa_bb(data, param_grid, train_size, test_size):
    """Run walk-forward analysis with Bollinger Bands strategy."""
    windows = []
    
    cursor = 0
    while cursor + train_size + test_size <= len(data):
        train_data = data[cursor:cursor + train_size]
        test_data = data[cursor + train_size:cursor + train_size + test_size]
        
        # Find best params on train
        best_params = None
        best_score = float('-inf')
        
        for params in param_grid:
            signals = generate_signal_bb(train_data, params['period'], params['std_dev'])
            metrics = compute_metrics(train_data, signals)
            score = metrics['sharpe'] - abs(metrics['max_drawdown'])
            if score > best_score:
                best_score = score
                best_params = params
        
        # Apply best params to test
        test_signals = generate_signal_bb(test_data, best_params['period'], best_params['std_dev'])
        test_metrics = compute_metrics(test_data, test_signals)
        
        train_metrics = compute_metrics(train_data, generate_signal_bb(train_data, best_params['period'], best_params['std_dev']))
        
        windows.append({
            'train_start': train_data[0]['timestamp'],
            'train_end': train_data[-1]['timestamp'],
            'test_start': test_data[0]['timestamp'],
            'test_end': test_data[-1]['timestamp'],
            'params': best_params,
            'train': train_metrics,
            'test': test_metrics
        })
        
        cursor += test_size
    
    # Aggregate out-of-sample
    if windows:
        oos = {
            'total_return': mean([w['test']['total_return'] for w in windows]),
            'sharpe': mean([w['test']['sharpe'] for w in windows]),
            'max_drawdown': mean([w['test']['max_drawdown'] for w in windows]),
            'win_rate': mean([w['test']['win_rate'] for w in windows]),
            'trades': sum([w['test']['trades'] for w in windows]),
            'windows': len(windows)
        }
    else:
        oos = {'total_return': 0, 'sharpe': 0, 'max_drawdown': 0, 'win_rate': 0, 'trades': 0, 'windows': 0}
    
    return {'windows': windows, 'out_of_sample': oos}

def run_wfa_spread(data1, data2, param_grid, train_size, test_size):
    """Run walk-forward analysis with cross-asset spread strategy."""
    n = min(len(data1), len(data2))
    windows = []
    
    cursor = 0
    while cursor + train_size + test_size <= n:
        train_d1 = data1[cursor:cursor + train_size]
        train_d2 = data2[cursor:cursor + train_size]
        test_d1 = data1[cursor + train_size:cursor + train_size + test_size]
        test_d2 = data2[cursor + train_size:cursor + train_size + test_size]
        
        # Find best params on train
        best_params = None
        best_score = float('-inf')
        
        for params in param_grid:
            signals = generate_signal_spread(train_d1, train_d2, params['period'], params['threshold'])
            metrics = compute_metrics(train_d1, signals)  # Use asset1 for metrics
            score = metrics['sharpe'] - abs(metrics['max_drawdown'])
            if score > best_score:
                best_score = score
                best_params = params
        
        # Apply best params to test
        test_signals = generate_signal_spread(test_d1, test_d2, best_params['period'], best_params['threshold'])
        test_metrics = compute_metrics(test_d1, test_signals)
        
        train_metrics = compute_metrics(train_d1, generate_signal_spread(train_d1, train_d2, best_params['period'], best_params['threshold']))
        
        windows.append({
            'train_start': train_d1[0]['timestamp'],
            'train_end': train_d1[-1]['timestamp'],
            'test_start': test_d1[0]['timestamp'],
            'test_end': test_d1[-1]['timestamp'],
            'params': best_params,
            'train': train_metrics,
            'test': test_metrics
        })
        
        cursor += test_size
    
    # Aggregate out-of-sample
    if windows:
        oos = {
            'total_return': mean([w['test']['total_return'] for w in windows]),
            'sharpe': mean([w['test']['sharpe'] for w in windows]),
            'max_drawdown': mean([w['test']['max_drawdown'] for w in windows]),
            'win_rate': mean([w['test']['win_rate'] for w in windows]),
            'trades': sum([w['test']['trades'] for w in windows]),
            'windows': len(windows)
        }
    else:
        oos = {'total_return': 0, 'sharpe': 0, 'max_drawdown': 0, 'win_rate': 0, 'trades': 0, 'windows': 0}
    
    return {'windows': windows, 'out_of_sample': oos}

def run_wfa_rsi(data, param_grid, train_size, test_size):
    """Run walk-forward analysis with RSI strategy."""
    windows = []
    
    cursor = 0
    while cursor + train_size + test_size <= len(data):
        train_data = data[cursor:cursor + train_size]
        test_data = data[cursor + train_size:cursor + train_size + test_size]
        
        # Find best params on train
        best_params = None
        best_score = float('-inf')
        
        for params in param_grid:
            signals = generate_signal_rsi(train_data, params['period'], params['oversold'], params['overbought'])
            metrics = compute_metrics(train_data, signals)
            score = metrics['sharpe'] - abs(metrics['max_drawdown'])
            if score > best_score:
                best_score = score
                best_params = params
        
        # Apply best params to test
        test_signals = generate_signal_rsi(test_data, best_params['period'], best_params['oversold'], best_params['overbought'])
        test_metrics = compute_metrics(test_data, test_signals)
        
        train_metrics = compute_metrics(train_data, generate_signal_rsi(train_data, best_params['period'], best_params['oversold'], best_params['overbought']))
        
        windows.append({
            'train_start': train_data[0]['timestamp'],
            'train_end': train_data[-1]['timestamp'],
            'test_start': test_data[0]['timestamp'],
            'test_end': test_data[-1]['timestamp'],
            'params': best_params,
            'train': train_metrics,
            'test': test_metrics
        })
        
        cursor += test_size
    
    # Aggregate out-of-sample
    if windows:
        oos = {
            'total_return': mean([w['test']['total_return'] for w in windows]),
            'sharpe': mean([w['test']['sharpe'] for w in windows]),
            'max_drawdown': mean([w['test']['max_drawdown'] for w in windows]),
            'win_rate': mean([w['test']['win_rate'] for w in windows]),
            'trades': sum([w['test']['trades'] for w in windows]),
            'windows': len(windows)
        }
    else:
        oos = {'total_return': 0, 'sharpe': 0, 'max_drawdown': 0, 'win_rate': 0, 'trades': 0, 'windows': 0}
    
    return {'windows': windows, 'out_of_sample': oos}

def run_wfa_ensemble(data, param_grid, train_size, test_size):
    """Run walk-forward analysis with ensemble strategy."""
    windows = []
    
    cursor = 0
    while cursor + train_size + test_size <= len(data):
        train_data = data[cursor:cursor + train_size]
        test_data = data[cursor + train_size:cursor + train_size + test_size]
        
        # Find best params on train
        best_params = None
        best_score = float('-inf')
        
        for params in param_grid:
            signals = generate_signal_ensemble(train_data, params['sma_fast'], params['sma_slow'], 
                                            params['rsi_period'], params['rsi_oversold'], params['rsi_overbought'])
            metrics = compute_metrics(train_data, signals)
            score = metrics['sharpe'] - abs(metrics['max_drawdown'])
            if score > best_score:
                best_score = score
                best_params = params
        
        # Apply best params to test
        test_signals = generate_signal_ensemble(test_data, best_params['sma_fast'], best_params['sma_slow'],
                                                best_params['rsi_period'], best_params['rsi_oversold'], best_params['rsi_overbought'])
        test_metrics = compute_metrics(test_data, test_signals)
        
        train_metrics = compute_metrics(train_data, generate_signal_ensemble(train_data, best_params['sma_fast'], best_params['sma_slow'],
                                       best_params['rsi_period'], best_params['rsi_oversold'], best_params['rsi_overbought']))
        
        windows.append({
            'train_start': train_data[0]['timestamp'],
            'train_end': train_data[-1]['timestamp'],
            'test_start': test_data[0]['timestamp'],
            'test_end': test_data[-1]['timestamp'],
            'params': best_params,
            'train': train_metrics,
            'test': test_metrics
        })
        
        cursor += test_size
    
    # Aggregate out-of-sample
    if windows:
        oos = {
            'total_return': mean([w['test']['total_return'] for w in windows]),
            'sharpe': mean([w['test']['sharpe'] for w in windows]),
            'max_drawdown': mean([w['test']['max_drawdown'] for w in windows]),
            'win_rate': mean([w['test']['win_rate'] for w in windows]),
            'trades': sum([w['test']['trades'] for w in windows]),
            'windows': len(windows)
        }
    else:
        oos = {'total_return': 0, 'sharpe': 0, 'max_drawdown': 0, 'win_rate': 0, 'trades': 0, 'windows': 0}
    
    return {'windows': windows, 'out_of_sample': oos}

def generate_signal_macd(data, fast_period, slow_period, signal_period):
    """Generate MACD (Moving Average Convergence Divergence) signals.
    
    Buy when MACD line crosses above signal line.
    Sell when MACD line crosses below signal line.
    Uses simpler approach without complex EMA alignment.
    """
    n = len(data)
    signals = [0] * n
    in_position = False
    
    # Get close prices
    closes = [d['close'] for d in data]
    
    min_period = slow_period + signal_period
    if n < min_period + 1:
        return signals
    
    # Calculate EMA manually with proper index tracking
    def get_ema_at_idx(prices, idx, period):
        """Get EMA value at specific index."""
        if idx < period:
            return None
        # Use SMA for first EMA value
        sma = sum(prices[idx-period+1:idx+1]) / period
        multiplier = 2 / (period + 1)
        ema = sma
        for j in range(idx-period+1, idx):
            ema = (prices[idx] - ema) * multiplier + ema
        return ema
    
    # Calculate MACD and signal values
    macd_values = []  # (data_index, macd_value)
    for i in range(min_period, n):
        fast_ema = get_ema_at_idx(closes, i, fast_period)
        slow_ema = get_ema_at_idx(closes, i, slow_period)
        
        if fast_ema is not None and slow_ema is not None:
            macd_values.append((i, fast_ema - slow_ema))
    
    # Calculate signal line
    if len(macd_values) < signal_period:
        return signals
    
    signal_values = []  # (data_index, signal_value)
    for i in range(signal_period - 1, len(macd_values)):
        macd_prices = [m[1] for m in macd_values[i-signal_period+1:i+1]]
        if len(macd_prices) >= signal_period:
            sma = sum(macd_prices) / signal_period
            multiplier = 2 / (signal_period + 1)
            ema = sma
            for j in range(len(macd_prices) - 1):
                ema = (macd_prices[-1] - ema) * multiplier + ema
            signal_values.append((macd_values[i][0], ema))
    
    # Generate signals from crossovers
    for i in range(1, len(signal_values)):
        curr_idx, curr_signal = signal_values[i]
        prev_idx, prev_signal = signal_values[i-1]
        
        # Get MACD values
        curr_macd = None
        prev_macd = None
        for idx, val in macd_values:
            if idx == curr_idx:
                curr_macd = val
            if idx == prev_idx:
                prev_macd = val
        
        if curr_macd is None or prev_macd is None:
            continue
        
        # Crossover detection
        if not in_position:
            if prev_macd <= prev_signal and curr_macd > curr_signal:
                in_position = True
                signals[curr_idx] = 1
        else:
            if prev_macd >= prev_signal and curr_macd < curr_signal:
                in_position = False
            else:
                signals[curr_idx] = 1
    
    return signals

def run_wfa_macd(data, param_grid, train_size, test_size):
    """Run walk-forward analysis with MACD strategy."""
    windows = []
    
    cursor = 0
    while cursor + train_size + test_size <= len(data):
        train_data = data[cursor:cursor + train_size]
        test_data = data[cursor + train_size:cursor + train_size + test_size]
        
        # Find best params on train
        best_params = None
        best_score = float('-inf')
        
        for params in param_grid:
            signals = generate_signal_macd(train_data, params['fast'], params['slow'], params['signal'])
            metrics = compute_metrics(train_data, signals)
            score = metrics['sharpe'] - abs(metrics['max_drawdown'])
            if score > best_score:
                best_score = score
                best_params = params
        
        # Apply best params to test
        test_signals = generate_signal_macd(test_data, best_params['fast'], best_params['slow'], best_params['signal'])
        test_metrics = compute_metrics(test_data, test_signals)
        
        train_metrics = compute_metrics(train_data, generate_signal_macd(train_data, best_params['fast'], best_params['slow'], best_params['signal']))
        
        windows.append({
            'train_start': train_data[0]['timestamp'],
            'train_end': train_data[-1]['timestamp'],
            'test_start': test_data[0]['timestamp'],
            'test_end': test_data[-1]['timestamp'],
            'params': best_params,
            'train': train_metrics,
            'test': test_metrics
        })
        
        cursor += test_size
    
    # Aggregate out-of-sample
    if windows:
        oos = {
            'total_return': mean([w['test']['total_return'] for w in windows]),
            'sharpe': mean([w['test']['sharpe'] for w in windows]),
            'max_drawdown': mean([w['test']['max_drawdown'] for w in windows]),
            'win_rate': mean([w['test']['win_rate'] for w in windows]),
            'trades': sum([w['test']['trades'] for w in windows]),
            'windows': len(windows)
        }
    else:
        oos = {'total_return': 0, 'sharpe': 0, 'max_drawdown': 0, 'win_rate': 0, 'trades': 0, 'windows': 0}
    
    return {'windows': windows, 'out_of_sample': oos}


def main():
    # Check for optional strategy argument
    strategy = 'sma'
    args = sys.argv[1:]
    if args and args[0] in ['sma', 'bb', 'bollinger', 'spread', 'rsi', 'ensemble', 'macd']:
        strategy = args[0]
        args = args[1:]
     
    if len(args) < 3:
        print("Usage: wfa_minimal.py [sma|bb|rsi|spread|ensemble|macd] <csv_path> [csv_path2] <train_size> <test_size>")
        sys.exit(1)
    
    if strategy == 'spread':
        # Need two CSV files
        if len(args) < 4:
            print("Usage: wfa_minimal.py spread <csv1> <csv2> <train_size> <test_size>")
            sys.exit(1)
        csv1 = args[0]
        csv2 = args[1]
        train_size = int(args[2])
        test_size = int(args[3])
        
        print(f"Loading data from {csv1} and {csv2}...")
        data1 = load_csv(csv1)
        data2 = load_csv(csv2)
        print(f"Loaded {len(data1)} and {len(data2)} rows")
        
        param_grid = [
            {'period': 12, 'threshold': 0.02},
            {'period': 24, 'threshold': 0.02},
            {'period': 24, 'threshold': 0.03},
            {'period': 48, 'threshold': 0.03},
            {'period': 48, 'threshold': 0.05},
        ]
        print(f"Running WFA with Spread, train_size={train_size}, test_size={test_size}...")
        results = run_wfa_spread(data1, data2, param_grid, train_size, test_size)
    else:
        csv_path = args[0]
        train_size = int(args[1])
        test_size = int(args[2])
        
        print(f"Loading data from {csv_path}...")
        data = load_csv(csv_path)
        print(f"Loaded {len(data)} rows")
        
        if strategy == 'rsi':
            param_grid = [
                {'period': 7, 'oversold': 30, 'overbought': 70},
                {'period': 14, 'oversold': 30, 'overbought': 70},
                {'period': 14, 'oversold': 25, 'overbought': 75},
                {'period': 21, 'oversold': 30, 'overbought': 70},
                {'period': 21, 'oversold': 35, 'overbought': 65},
                {'period': 28, 'oversold': 25, 'overbought': 75},
                {'period': 28, 'oversold': 30, 'overbought': 70},
                {'period': 35, 'oversold': 20, 'overbought': 80},
                {'period': 35, 'oversold': 25, 'overbought': 75},
                {'period': 14, 'oversold': 35, 'overbought': 65},
            ]
            print(f"Running WFA with RSI, train_size={train_size}, test_size={test_size}...")
            results = run_wfa_rsi(data, param_grid, train_size, test_size)
        elif strategy == 'ensemble':
            param_grid = [
                {'sma_fast': 5, 'sma_slow': 20, 'rsi_period': 14, 'rsi_oversold': 30, 'rsi_overbought': 70},
                {'sma_fast': 10, 'sma_slow': 20, 'rsi_period': 14, 'rsi_oversold': 30, 'rsi_overbought': 70},
                {'sma_fast': 10, 'sma_slow': 40, 'rsi_period': 14, 'rsi_oversold': 30, 'rsi_overbought': 70},
                {'sma_fast': 5, 'sma_slow': 20, 'rsi_period': 21, 'rsi_oversold': 25, 'rsi_overbought': 75},
                {'sma_fast': 10, 'sma_slow': 20, 'rsi_period': 21, 'rsi_oversold': 35, 'rsi_overbought': 65},
                {'sma_fast': 5, 'sma_slow': 10, 'rsi_period': 14, 'rsi_oversold': 30, 'rsi_overbought': 70},
                {'sma_fast': 5, 'sma_slow': 20, 'rsi_period': 28, 'rsi_oversold': 25, 'rsi_overbought': 75},
            ]
            print(f"Running WFA with Ensemble (SMA+RSI), train_size={train_size}, test_size={test_size}...")
            results = run_wfa_ensemble(data, param_grid, train_size, test_size)
        elif strategy == 'macd':
            param_grid = [
                {'fast': 12, 'slow': 26, 'signal': 9},
                {'fast': 8, 'slow': 17, 'signal': 9},
                {'fast': 5, 'slow': 35, 'signal': 5},
                {'fast': 12, 'slow': 26, 'signal': 12},
                {'fast': 19, 'slow': 39, 'signal': 9},
            ]
            print(f"Running WFA with MACD, train_size={train_size}, test_size={test_size}...")
            results = run_wfa_macd(data, param_grid, train_size, test_size)
        elif strategy in ['bb', 'bollinger']:
            param_grid = [
                {'period': 14, 'std_dev': 1.5},
                {'period': 14, 'std_dev': 2.0},
                {'period': 20, 'std_dev': 1.5},
                {'period': 20, 'std_dev': 2.0},
                {'period': 30, 'std_dev': 2.0},
            ]
            print(f"Running WFA with Bollinger Bands, train_size={train_size}, test_size={test_size}...")
            results = run_wfa_bb(data, param_grid, train_size, test_size)
        else:
            param_grid = [
                {'fast': 5, 'slow': 20},
                {'fast': 10, 'slow': 20},
                {'fast': 10, 'slow': 40},
                {'fast': 20, 'slow': 50},
                {'fast': 5, 'slow': 10},
            ]
            print(f"Running WFA with SMA, train_size={train_size}, test_size={test_size}...")
            results = run_wfa_sma(data, param_grid, train_size, test_size)
    
    print(json.dumps(results, indent=2))
    return results

if __name__ == "__main__":
    main()
