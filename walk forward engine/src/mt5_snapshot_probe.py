import hashlib
import json
import os
import platform
import sys
from datetime import datetime, timezone


TIMEFRAMES = {
    "M1": "TIMEFRAME_M1",
    "M2": "TIMEFRAME_M2",
    "M3": "TIMEFRAME_M3",
    "M4": "TIMEFRAME_M4",
    "M5": "TIMEFRAME_M5",
    "M6": "TIMEFRAME_M6",
    "M10": "TIMEFRAME_M10",
    "M12": "TIMEFRAME_M12",
    "M15": "TIMEFRAME_M15",
    "M20": "TIMEFRAME_M20",
    "M30": "TIMEFRAME_M30",
    "H1": "TIMEFRAME_H1",
    "H2": "TIMEFRAME_H2",
    "H3": "TIMEFRAME_H3",
    "H4": "TIMEFRAME_H4",
    "H6": "TIMEFRAME_H6",
    "H8": "TIMEFRAME_H8",
    "H12": "TIMEFRAME_H12",
    "D1": "TIMEFRAME_D1",
    "W1": "TIMEFRAME_W1",
    "MN1": "TIMEFRAME_MN1",
}


def emit(payload, exit_code):
    sys.stdout.write(json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n")
    raise SystemExit(exit_code)


def blocked(reason, error_code, **extra):
    emit({
        "schema_version": "mt5_snapshot_probe_v1",
        "status": "blocked",
        "blocked_reason": reason,
        "diagnostics": {
            "error_code": error_code,
            "message": reason,
            "python_version": platform.python_version(),
            "platform": platform.platform(),
            **extra,
        },
        "observations": {},
    }, 2)


def clean_dict(value, allowed_keys):
    if value is None:
        return {}
    source = value._asdict() if hasattr(value, "_asdict") else dict(value)
    return {key: source.get(key) for key in allowed_keys if key in source}


def rates_identity(rates):
    rows = []
    for row in rates.tolist():
        rows.append({
            "time": int(row[0]),
            "open": float(row[1]),
            "high": float(row[2]),
            "low": float(row[3]),
            "close": float(row[4]),
            "tick_volume": int(row[5]),
            "spread": int(row[6]),
            "real_volume": int(row[7]),
        })
    body = json.dumps(rows, sort_keys=True, separators=(",", ":"))
    first_time = rows[0]["time"] if rows else None
    last_time = rows[-1]["time"] if rows else None
    return {
        "rows": len(rows),
        "first_bar_utc": datetime.fromtimestamp(first_time, timezone.utc).isoformat() if first_time else None,
        "last_bar_utc": datetime.fromtimestamp(last_time, timezone.utc).isoformat() if last_time else None,
        "bars_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
    }


def account_login_hash_or_id(account):
    login = account.get("login") if account else None
    if login is None:
        return None
    return hashlib.sha256(str(login).encode("utf-8")).hexdigest()


def asset_class_hints(symbol_spec):
    haystack = " ".join(str(symbol_spec.get(key) or "") for key in [
        "name", "path", "description", "currency_base", "currency_profit", "currency_margin"
    ]).lower()
    currency_base = str(symbol_spec.get("currency_base") or "").upper()
    currency_profit = str(symbol_spec.get("currency_profit") or "").upper()

    keyword_groups = {
        "crypto_like": ["crypto", "btc", "eth", "xrp", "ltc", "ada", "sol", "doge", "usdt", "usdc"],
        "metal_like": ["xau", "xag", "gold", "silver", "metal"],
        "energy_like": ["oil", "brent", "wti", "ngas", "natural gas"],
        "index_like": ["index", "indices", "nas", "spx", "us30", "dow", "dax", "ger40", "uk100"],
        "stock_like": ["stock", "stocks", "share", "shares", "equity", "equities"],
    }
    matches_by_guess = {
        guess: [keyword for keyword in keywords if keyword in haystack]
        for guess, keywords in keyword_groups.items()
    }
    matches_by_guess = {guess: matches for guess, matches in matches_by_guess.items() if matches}

    common_fx_codes = {
        "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNH", "HKD", "SGD", "NOK", "SEK", "DKK",
        "MXN", "ZAR", "TRY", "PLN", "CZK", "HUF"
    }
    fx_like = currency_base in common_fx_codes and currency_profit in common_fx_codes
    if fx_like:
        matches_by_guess["fx_like"] = [currency_base, currency_profit]

    priority = ["crypto_like", "metal_like", "energy_like", "index_like", "stock_like", "fx_like"]
    asset_class_guess = next((guess for guess in priority if guess in matches_by_guess), "unknown")
    return {
        "asset_class_guess": asset_class_guess,
        "is_crypto_like": asset_class_guess == "crypto_like",
        "basis": "heuristic_terminal_metadata_keyword_match",
        "matched_hints": matches_by_guess,
        "classification_is_tradability_proof": False,
    }


def symbol_spec_from(symbol_info):
    spec = clean_dict(symbol_info, [
        "name", "path", "description", "currency_base", "currency_profit", "currency_margin", "digits", "point",
        "trade_mode", "trade_calc_mode", "trade_contract_size", "trade_tick_size", "trade_tick_value",
        "trade_tick_value_profit", "trade_tick_value_loss", "volume_min", "volume_max", "volume_step", "volume_limit",
        "spread", "spread_float", "swap_mode", "swap_long", "swap_short", "margin_initial", "margin_maintenance",
        "margin_hedged", "session_deals", "session_buy_orders", "session_sell_orders", "session_turnover",
        "session_interest", "session_buy_orders_volume", "session_sell_orders_volume", "visible", "select", "custom",
    ])
    if "trade_tick_size" in spec and "tick_size" not in spec:
        spec["tick_size"] = spec.get("trade_tick_size")
    if "trade_tick_value" in spec and "tick_value" not in spec:
        spec["tick_value"] = spec.get("trade_tick_value")
    spec["asset_class_hints"] = asset_class_hints(spec)
    spec["history_availability"] = {
        "status": "not_probed_first_slice",
        "blocked_reason": "Phase 8A initial universe slice enumerates symbols/specs only; per-symbol history probing is deferred.",
    }
    return spec


def emit_universe_snapshot(request, terminal, account, symbol_infos, mt5_package_version=None):
    universe_filter = request.get("universe_filter") or {}
    symbols = [symbol_spec_from(symbol_info) for symbol_info in symbol_infos]
    symbol_count_by_asset_class_guess = {}
    for symbol in symbols:
        guess = symbol.get("asset_class_hints", {}).get("asset_class_guess") or "unknown"
        symbol_count_by_asset_class_guess[guess] = symbol_count_by_asset_class_guess.get(guess, 0) + 1
    crypto_like = symbol_count_by_asset_class_guess.get("crypto_like", 0)
    universe = {
        "terminal_path": request.get("terminal_path") or None,
        "terminal_build": terminal.get("build"),
        "account_login_hash_or_id": account_login_hash_or_id(account),
        "server": account.get("server"),
        "company": terminal.get("company"),
        "symbol_count_total": len(symbols),
        "symbol_count_crypto_like": crypto_like,
        "symbol_count_by_asset_class_guess": symbol_count_by_asset_class_guess,
        "universe_scope": {
            "scope": request.get("universe_scope"),
            "filter_used": bool(universe_filter.get("filter_used")),
            "filter_pattern": universe_filter.get("filter_pattern"),
            "filter_description": universe_filter.get("filter_description") or "no filter used",
        },
        "symbols": symbols,
        "unavailable_fields": [{
            "field": "per_symbol_history_availability",
            "reason": "deferred_first_slice",
        }],
    }
    emit({
        "schema_version": "mt5_snapshot_probe_v1",
        "status": "succeeded",
        "blocked_reason": None,
        "diagnostics": {
            "error_code": None,
            "message": None,
            "python_version": platform.python_version(),
            "platform": platform.platform(),
            "mt5_package_version": mt5_package_version,
            "password_env_provided": bool(os.environ.get("TRF_MT5_PASSWORD") or None),
        },
        "observations": {
            "terminal": terminal,
            "account": account,
            "universe": universe,
        },
    }, 0)


def main():
    try:
        request = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as exc:
        blocked(f"Invalid JSON request: {exc}", "invalid_request_json")

    symbol = request.get("symbol")
    timeframe = request.get("timeframe")
    bars = request.get("bars") or 256
    snapshot_mode = request.get("snapshot_mode") or "symbol"
    terminal_path = request.get("terminal_path")
    login = request.get("login")
    server = request.get("server")
    password = os.environ.get("TRF_MT5_PASSWORD") or None

    if snapshot_mode == "universe":
        if not request.get("universe_scope"):
            blocked("MT5 tradable universe request missing explicit universe_scope.", "missing_universe_scope")
        fixture_symbols = request.get("fixture_symbols")
        if fixture_symbols is not None:
            terminal = request.get("fixture_terminal") or {"name": "fixture", "company": "fixture", "build": 0, "connected": True}
            account = request.get("fixture_account") or {"login": None, "server": "fixture", "currency": "USD"}
            emit_universe_snapshot(request, terminal, account, fixture_symbols, mt5_package_version="fixture")
    else:
        if not symbol:
            blocked("MT5 snapshot request missing explicit symbol.", "missing_symbol")
        if not timeframe:
            blocked("MT5 snapshot request missing explicit timeframe.", "missing_timeframe")
        if timeframe not in TIMEFRAMES:
            blocked(f"Unsupported MT5 timeframe: {timeframe}.", "unsupported_timeframe", requested_timeframe=timeframe)
        if not isinstance(bars, int) or bars < 1:
            blocked("MT5 snapshot request bars must be a positive integer.", "invalid_bars")

    try:
        import MetaTrader5 as mt5
    except Exception as exc:
        blocked(f"MetaTrader5 import failed: {type(exc).__name__}: {exc}", "metatrader5_import_failed")

    initialize_kwargs = {}
    if terminal_path and terminal_path != "provided_not_persisted":
        initialize_kwargs["path"] = terminal_path
    if login is not None:
        try:
            initialize_kwargs["login"] = int(login)
        except (TypeError, ValueError):
            blocked("MT5 snapshot request login must be an integer when provided.", "invalid_login")
    if server:
        initialize_kwargs["server"] = str(server)
    if password:
        initialize_kwargs["password"] = password

    if not mt5.initialize(**initialize_kwargs):
        code, message = mt5.last_error()
        auth_attempts = [{
            "method": "initialize_with_env_password" if password else "initialize",
            "mt5_error_code": code,
            "mt5_error_message": message,
        }]
        if password and login is not None:
            fallback_kwargs = {key: value for key, value in initialize_kwargs.items() if key not in ("login", "password", "server")}
            if mt5.initialize(**fallback_kwargs):
                login_kwargs = {"password": password}
                if server:
                    login_kwargs["server"] = str(server)
                if not mt5.login(int(login), **login_kwargs):
                    login_code, login_message = mt5.last_error()
                    auth_attempts.append({
                        "method": "initialize_then_login_with_env_password",
                        "mt5_error_code": login_code,
                        "mt5_error_message": login_message,
                    })
                    mt5.shutdown()
                    blocked(
                        f"MetaTrader5 login failed after env-password initialize fallback: {login_code} {login_message}",
                        "mt5_login_failed",
                        mt5_error_code=login_code,
                        mt5_error_message=login_message,
                        auth_attempts=auth_attempts,
                        password_env_provided=True,
                    )
                auth_attempts.append({
                    "method": "initialize_then_login_with_env_password",
                    "mt5_error_code": None,
                    "mt5_error_message": None,
                })
            else:
                fallback_code, fallback_message = mt5.last_error()
                auth_attempts.append({
                    "method": "initialize_without_credentials_fallback",
                    "mt5_error_code": fallback_code,
                    "mt5_error_message": fallback_message,
                })
                blocked(
                    f"MetaTrader5 initialize failed with env-password auth and fallback initialize failed: {code} {message}; fallback {fallback_code} {fallback_message}",
                    "mt5_initialize_failed",
                    mt5_error_code=code,
                    mt5_error_message=message,
                    auth_attempts=auth_attempts,
                    password_env_provided=True,
                )
        else:
            blocked(
                f"MetaTrader5 initialize failed: {code} {message}",
                "mt5_initialize_failed",
                mt5_error_code=code,
                mt5_error_message=message,
                auth_attempts=auth_attempts,
                password_env_provided=bool(password),
            )

    try:
        terminal = clean_dict(mt5.terminal_info(), [
            "name", "company", "build", "connected", "dlls_allowed", "trade_allowed", "community_account", "language", "maxbars"
        ])
        account = clean_dict(mt5.account_info(), [
            "login", "server", "currency", "leverage", "trade_mode", "margin_mode", "trade_allowed", "trade_expert"
        ])
        if not terminal:
            blocked("MetaTrader5 terminal_info returned no identity.", "missing_terminal_info")
        if not account:
            blocked("MetaTrader5 account_info returned no identity.", "missing_account_info")

        if snapshot_mode == "universe":
            universe_filter = request.get("universe_filter") or {}
            group = universe_filter.get("filter_pattern") if universe_filter.get("filter_used") else None
            symbols = mt5.symbols_get(group=group) if group else mt5.symbols_get()
            if symbols is None or len(symbols) == 0:
                code, message = mt5.last_error()
                blocked(f"MetaTrader5 symbols_get returned no symbols: {code} {message}", "symbols_get_empty", mt5_error_code=code, mt5_error_message=message)
            emit_universe_snapshot(
                request,
                terminal,
                account,
                symbols,
                mt5_package_version=mt5.__version__ if hasattr(mt5, "__version__") else None,
            )

        symbol_info = mt5.symbol_info(symbol)
        if symbol_info is None:
            selected = mt5.symbol_select(symbol, True)
            symbol_info = mt5.symbol_info(symbol) if selected else None
        if symbol_info is None:
            code, message = mt5.last_error()
            blocked(f"MetaTrader5 symbol_info unavailable for explicit symbol {symbol}: {code} {message}", "symbol_info_unavailable", mt5_error_code=code, mt5_error_message=message)

        symbol_spec = clean_dict(symbol_info, [
            "name", "path", "description", "currency_base", "currency_profit", "currency_margin", "digits", "point", "trade_mode", "trade_contract_size", "trade_tick_size", "trade_tick_value", "volume_min", "volume_max", "volume_step", "spread", "spread_float", "swap_mode", "swap_long", "swap_short", "margin_initial", "margin_maintenance", "session_deals", "session_buy_orders", "session_sell_orders"
        ])
        symbol_spec.pop("path", None)

        timeframe_constant = getattr(mt5, TIMEFRAMES[timeframe])
        rates = mt5.copy_rates_from_pos(symbol, timeframe_constant, 0, bars)
        if rates is None or len(rates) == 0:
            code, message = mt5.last_error()
            blocked(f"MetaTrader5 rates unavailable for {symbol} {timeframe}: {code} {message}", "rates_unavailable", mt5_error_code=code, mt5_error_message=message)

        rate_identity = rates_identity(rates)
        observations = {
            "terminal": terminal,
            "account": account,
            "symbol": symbol_spec,
            "data_identity": {
                "provider": "MetaTrader5 terminal",
                "source_type": "mt5_terminal_rates",
                "symbol": symbol,
                "timeframe": timeframe,
                "quote_basis": "broker_terminal_bid_ohlc",
                "server": account.get("server"),
                "timezone_basis": "mt5_epoch_seconds_interpreted_as_utc_for_identity_only",
                "requested_bars": bars,
                "returned_bars": rate_identity["rows"],
                "coverage_start_utc": rate_identity["first_bar_utc"],
                "coverage_end_utc": rate_identity["last_bar_utc"],
                "bars_sha256": rate_identity["bars_sha256"],
            },
        }
        emit({
            "schema_version": "mt5_snapshot_probe_v1",
            "status": "succeeded",
            "blocked_reason": None,
            "diagnostics": {
                "error_code": None,
                "message": None,
                "python_version": platform.python_version(),
                "platform": platform.platform(),
                "mt5_package_version": mt5.__version__ if hasattr(mt5, "__version__") else None,
                "password_env_provided": bool(password),
            },
            "observations": observations,
        }, 0)
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
