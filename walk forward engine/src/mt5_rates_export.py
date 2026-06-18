import csv
import hashlib
import json
import os
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path


TIMEFRAMES = {
    "M1": "TIMEFRAME_M1",
    "M5": "TIMEFRAME_M5",
    "M15": "TIMEFRAME_M15",
    "M30": "TIMEFRAME_M30",
    "H1": "TIMEFRAME_H1",
    "H4": "TIMEFRAME_H4",
    "D1": "TIMEFRAME_D1",
}


def emit(payload, exit_code):
    sys.stdout.write(json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n")
    raise SystemExit(exit_code)


def blocked(reason, error_code, **extra):
    emit({
        "schema_version": "mt5_rates_export_v1",
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


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_dict(value, allowed_keys):
    if value is None:
        return {}
    source = value._asdict() if hasattr(value, "_asdict") else dict(value)
    return {key: source.get(key) for key in allowed_keys if key in source}


def main():
    try:
        request = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError as exc:
        blocked(f"Invalid JSON request: {exc}", "invalid_request_json")

    symbol = request.get("symbol")
    timeframe = request.get("timeframe")
    bars = request.get("bars") or 100000
    output = request.get("output")
    terminal_path = request.get("terminal_path")
    login = request.get("login")
    server = request.get("server")
    password = os.environ.get("TRF_MT5_PASSWORD") or None

    if not symbol:
        blocked("MT5 rates export request missing explicit symbol.", "missing_symbol")
    if timeframe not in TIMEFRAMES:
        blocked(f"Unsupported MT5 timeframe: {timeframe}.", "unsupported_timeframe", requested_timeframe=timeframe)
    if not isinstance(bars, int) or bars < 1:
        blocked("MT5 rates export request bars must be a positive integer.", "invalid_bars")
    if not output:
        blocked("MT5 rates export request missing output path.", "missing_output")

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
            blocked("MT5 rates export request login must be an integer when provided.", "invalid_login")
    if server:
        initialize_kwargs["server"] = str(server)
    if password:
        initialize_kwargs["password"] = password

    if not mt5.initialize(**initialize_kwargs):
        code, message = mt5.last_error()
        blocked(
            f"MetaTrader5 initialize failed: {code} {message}",
            "mt5_initialize_failed",
            mt5_error_code=code,
            mt5_error_message=message,
            password_env_provided=bool(password),
        )

    try:
        terminal = clean_dict(mt5.terminal_info(), ["name", "company", "build", "connected", "maxbars"])
        account = clean_dict(mt5.account_info(), ["login", "server", "currency", "leverage", "margin_mode"])
        if not mt5.symbol_select(symbol, True):
            code, message = mt5.last_error()
            blocked(f"MetaTrader5 symbol_select failed for {symbol}: {code} {message}", "symbol_select_failed", mt5_error_code=code, mt5_error_message=message)

        timeframe_constant = getattr(mt5, TIMEFRAMES[timeframe])
        rates = mt5.copy_rates_from_pos(symbol, timeframe_constant, 0, bars)
        if rates is None or len(rates) == 0:
            code, message = mt5.last_error()
            blocked(f"MetaTrader5 rates unavailable for {symbol} {timeframe}: {code} {message}", "rates_unavailable", mt5_error_code=code, mt5_error_message=message)

        rows = []
        for row in rates.tolist():
            rows.append({
                "timestamp": datetime.fromtimestamp(int(row[0]), timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": int(row[5]),
                "spread": int(row[6]),
                "real_volume": int(row[7]),
            })
        rows.sort(key=lambda item: item["timestamp"])

        output_path = Path(output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=["timestamp", "open", "high", "low", "close", "volume", "spread", "real_volume"])
            writer.writeheader()
            writer.writerows(rows)

        emit({
            "schema_version": "mt5_rates_export_v1",
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
            "observations": {
                "terminal": terminal,
                "account": account,
                "data_identity": {
                    "provider": "MetaTrader5 terminal",
                    "source_type": "mt5_terminal_rates_export",
                    "quote_basis": "broker_terminal_bid_ohlc",
                    "timezone_basis": "mt5_epoch_seconds_interpreted_as_utc_for_identity_only",
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "requested_bars": bars,
                    "returned_bars": len(rows),
                    "coverage_start_utc": rows[0]["timestamp"],
                    "coverage_end_utc": rows[-1]["timestamp"],
                    "output": str(output_path),
                    "csv_sha256": sha256_file(output_path),
                },
            },
        }, 0)
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
