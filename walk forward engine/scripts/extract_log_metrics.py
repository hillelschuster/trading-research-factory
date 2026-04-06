#!/usr/bin/env python3
"""
Extract WFA metrics from archived log files (Artifact-First Approach).

Strategy:
1. FIRST: Try to extract from structured artifacts (results/*.json, results/*.csv)
2. SECOND: Fall back to log parsing for missing fields and diagnostics
3. ALWAYS: Detect taint conditions (config errors, defaults used)

For each .log file in logs/archive/, creates a corresponding .extracted.json file
with extracted metrics. The user will assess these JSONs before cleanup.
"""

import re
import json
import csv
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List
from glob import glob


# Taint detection patterns - runs with these warnings are INVALID for comparison
TAINT_PATTERNS = [
    (r"using defaults", "config_defaults_used"),
    (r"object has no attribute 'config'", "strategy_config_missing"),
    (r"settings.*not found.*Using defaults", "symbol_settings_missing"),
    (r"Error initializing", "initialization_error"),
    (r"Strategy parameter file not found", "strategy_param_file_missing"),
    (r"Historical data is empty|missing 'timestamp' column", "historical_data_invalid"),
    (r"Halting bar processing due to critical risk rule", "halted_by_risk_rule"),
    (r"Could not fetch initial history", "initial_history_fetch_failed"),
]


def stable_msg_id(level: str, msg: str) -> str:
    """Generate stable hash for message deduplication (not Python's hash())."""
    return hashlib.sha256(f"{level}:{msg}".encode("utf-8", errors="replace")).hexdigest()[:16]


def detect_taint(content: str) -> Dict[str, Any]:
    """
    Detect taint conditions in log content.
    
    Returns:
        Dict with run_tainted (bool) and taint_reasons (list)
    """
    taint_reasons = []
    
    for pattern, reason in TAINT_PATTERNS:
        if re.search(pattern, content, re.IGNORECASE):
            taint_reasons.append(reason)
    
    return {
        "run_tainted": len(taint_reasons) > 0,
        "taint_reasons": taint_reasons
    }


def find_matching_artifacts(log_path: Path) -> Dict[str, Optional[Path]]:
    """
    Find structured artifacts that match this log file.
    
    Searches in common artifact locations:
    - strategies/*/results/
    - results/
    
    Returns dict with paths to matching JSON and CSV files (if found).
    """
    log_name = log_path.stem.lower()
    project_root = log_path.parent.parent.parent
    
    artifacts = {
        "json": None,
        "csv": None,
        "analysis_json": None
    }
    
    # Search patterns
    search_dirs = [
        project_root / "strategies" / "*" / "results" / "*",
        project_root / "results",
        project_root / "results" / "*",
    ]
    
    for search_pattern in search_dirs:
        # Look for JSON files
        for json_file in glob(str(search_pattern / "walk_forward_results_*.json")):
            json_path = Path(json_file)
            # Match by timestamp or name similarity
            if any(part in json_path.stem.lower() for part in log_name.split('_') if len(part) > 3):
                if artifacts["json"] is None:
                    artifacts["json"] = json_path
                    
        # Look for CSV summary files
        for csv_file in glob(str(search_pattern / "walk_forward_summary_*.csv")):
            csv_path = Path(csv_file)
            if any(part in csv_path.stem.lower() for part in log_name.split('_') if len(part) > 3):
                if artifacts["csv"] is None:
                    artifacts["csv"] = csv_path
                    
        # Look for analysis.json (compact artifact)
        for analysis_file in glob(str(search_pattern / "analysis.json")):
            if artifacts["analysis_json"] is None:
                artifacts["analysis_json"] = Path(analysis_file)
    
    return artifacts


def extract_from_artifacts(artifacts: Dict[str, Optional[Path]]) -> Dict[str, Any]:
    """
    Extract metrics from structured artifacts (preferred source).
    
    Returns populated metrics dict or empty dict if no artifacts found.
    """
    metrics = {}
    
    # Try analysis.json first (most compact and complete)
    if artifacts.get("analysis_json") and artifacts["analysis_json"].exists():
        try:
            with open(artifacts["analysis_json"], 'r', encoding='utf-8') as f:
                analysis = json.load(f)
                metrics["from_artifact"] = "analysis.json"
                metrics["summary"] = analysis.get("metrics", {})
                metrics["stability"] = analysis.get("stability", {})
                metrics["provenance"] = analysis.get("provenance", {})
                return metrics
        except Exception as e:
            pass
    
    # Try full results JSON
    if artifacts.get("json") and artifacts["json"].exists():
        try:
            with open(artifacts["json"], 'r', encoding='utf-8') as f:
                results = json.load(f)
                metrics["from_artifact"] = str(artifacts["json"].name)
                
                # Extract window results
                if "window_results" in results:
                    metrics["per_window_results"] = [
                        {
                            "window_id": wr.get("window_id"),
                            "test_start": wr.get("testing_period_start"),
                            "test_end": wr.get("testing_period_end"),
                            "return_pct": wr.get("total_return_pct"),
                            "trades": wr.get("total_trades"),
                            "win_rate": wr.get("win_rate"),
                            "sharpe": wr.get("sharpe_ratio"),
                            "best_params": wr.get("best_parameters", {})
                        }
                        for wr in results["window_results"]
                    ]
                
                # Extract aggregate results
                metrics["aggregate_results"] = {
                    "total_windows": results.get("total_windows"),
                    "successful_windows": results.get("successful_windows"),
                    "aggregate_return_pct": results.get("aggregate_return_pct"),
                    "aggregate_sharpe_ratio": results.get("aggregate_sharpe_ratio"),
                    "aggregate_max_drawdown_pct": results.get("aggregate_max_drawdown_pct"),
                    "total_trades": results.get("aggregate_total_trades"),
                }
                
                return metrics
        except Exception as e:
            pass
    
    # Try CSV summary
    if artifacts.get("csv") and artifacts["csv"].exists():
        try:
            with open(artifacts["csv"], 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                rows = list(reader)
                if rows:
                    metrics["from_artifact"] = str(artifacts["csv"].name)
                    metrics["per_window_results"] = [
                        {
                            "window_id": int(row.get("window_id", 0)),
                            "test_start": row.get("testing_start"),
                            "test_end": row.get("testing_end"),
                            "return_pct": float(row.get("total_return_pct", 0)),
                            "trades": int(row.get("total_trades", 0)),
                            "win_rate": float(row.get("win_rate", 0)),
                            "sharpe": float(row.get("sharpe_ratio", 0)),
                            "best_params": {k.replace("param_", ""): v for k, v in row.items() if k.startswith("param_")}
                        }
                        for row in rows
                    ]
                    return metrics
        except Exception as e:
            pass
    
    return {}


def extract_from_log(log_path: Path, content: str) -> Dict[str, Any]:
    """
    Extract metrics from log file content (fallback for missing artifact data).
    """
    metrics = {
        "from_log": True
    }
    
    lines = content.split('\n')
    
    # Extract run identity from content (not filename)
    run_identity = {}
    
    # Find data range
    for line in lines[:200]:
        match = re.search(r'(\d{4}-\d{2}-\d{2})\s*to\s*(\d{4}-\d{2}-\d{2})', line)
        if match:
            run_identity["data_start"] = match.group(1)
            run_identity["data_end"] = match.group(2)
            break
        
        match = re.search(r'(\d+)\s*rows', line)
        if match:
            run_identity["data_rows"] = int(match.group(1))
    
    # Find strategy profile key
    for line in lines[:100]:
        match = re.search(r'strategy_profile_key["\']?\s*[:=]\s*["\']?([A-Z0-9_]+)', line, re.IGNORECASE)
        if match:
            run_identity["strategy_profile_key"] = match.group(1)
            break
    
    if run_identity:
        metrics["run_identity"] = run_identity
    
    # Extract window results with multiple regex patterns
    window_results = []
    
    # Pattern 1: "Window N completed... Return: X%... Trades: Y"
    pattern1 = re.compile(r'Window\s+(\d+).*?Return[=:]\s*([-\d.]+)%.*?Trades[=:]\s*(\d+)', re.IGNORECASE)
    for match in pattern1.finditer(content):
        window_results.append({
            "window_id": int(match.group(1)),
            "return_pct": float(match.group(2)),
            "trades": int(match.group(3))
        })
    
    # Pattern 2: "Window N/M ... X trades ... Y% return"
    if not window_results:
        pattern2 = re.compile(r'Window\s+(\d+)/\d+.*?(\d+)\s+trades.*?([-\d.]+)%\s*return', re.IGNORECASE)
        for match in pattern2.finditer(content):
            window_results.append({
                "window_id": int(match.group(1)),
                "trades": int(match.group(2)),
                "return_pct": float(match.group(3))
            })
    
    # Sort by window_id for deterministic output
    window_results.sort(key=lambda x: x.get("window_id", 0))
    
    if window_results:
        metrics["per_window_results"] = window_results
    
    # Extract aggregate results
    aggregate = {}
    patterns = {
        "total_windows": r'Total windows[:\s]+(\d+)',
        "successful_windows": r'Successful windows[:\s]+(\d+)',
        "aggregate_return_pct": r'Aggregate return[:\s]+([-\d.]+)%?',
        "aggregate_sharpe_ratio": r'Aggregate Sharpe[:\s]+([-\d.]+)',
        "execution_time_seconds": r'Execution time[:\s]+([\d.]+)s?',
    }
    
    for key, pattern in patterns.items():
        match = re.search(pattern, content, re.IGNORECASE)
        if match:
            value = match.group(1)
            aggregate[key] = float(value) if '.' in value else int(value)
    
    if aggregate:
        metrics["aggregate_results"] = aggregate
    
    # Extract warnings and errors (in encounter order, no dedup)
    diagnostics = []
    seen = set()
    
    for line in lines:
        if '[WARNING]' in line or '[ERROR]' in line:
            # Extract message after the log prefix
            match = re.search(r'\[(WARNING|ERROR)\].*?-\s*(.+)', line)
            if match:
                level = match.group(1)
                msg = match.group(2).strip()[:300]  # Limit length
                
                # Dedupe by stable hash (not Python's hash) but preserve order
                msg_id = stable_msg_id(level, msg)
                if msg_id not in seen:
                    seen.add(msg_id)
                    diagnostics.append({
                        "level": level,
                        "message": msg
                    })
    
    if diagnostics:
        metrics["diagnostics"] = diagnostics[:50]  # Limit to 50
    
    return metrics


def extract_metrics_from_log(log_path: Path) -> Dict[str, Any]:
    """
    Extract all available metrics from a WFA log file using artifact-first approach.
    """
    
    metrics = {
        "source_log": log_path.name,
        "extraction_timestamp": datetime.now().isoformat(),
        "schema_version": "2.0",
        "extraction_method": None,  # Will be set based on what worked
    }
    
    # Step 1: Try to read log content
    content = None
    for encoding in ['utf-8', 'utf-16', 'utf-16-le', 'latin-1']:
        try:
            content = log_path.read_text(encoding=encoding)
            metrics["encoding_used"] = encoding
            break
        except UnicodeDecodeError:
            continue
    
    if content is None:
        metrics["extraction_error"] = "Could not decode file with any known encoding"
        return metrics
    
    # Step 2: Detect taint conditions (ALWAYS do this first)
    taint_info = detect_taint(content)
    metrics["run_tainted"] = taint_info["run_tainted"]
    if taint_info["taint_reasons"]:
        metrics["taint_reasons"] = taint_info["taint_reasons"]
    
    # Step 3: Try artifact-first extraction (SKIP for archived logs - they don't have matching artifacts)
    # Archived logs are legacy salvage; new runs use wfa_history.json directly
    is_archived_log = "archive" in str(log_path.parent).lower()
    
    if not is_archived_log:
        artifacts = find_matching_artifacts(log_path)
        artifact_metrics = extract_from_artifacts(artifacts)
        
        if artifact_metrics:
            metrics["extraction_method"] = "artifact"
            metrics.update(artifact_metrics)
            return metrics
    
    # Fall back to log parsing (default for archived logs)
    metrics["extraction_method"] = "log_parsing"
    log_metrics = extract_from_log(log_path, content)
    metrics.update(log_metrics)
    
    # Step 5: Extract run date from first log line
    lines = content.split('\n')
    for line in lines[:5]:
        date_match = re.search(r'(\d{4}-\d{2}-\d{2})', line)
        if date_match:
            if "run_identity" not in metrics:
                metrics["run_identity"] = {}
            metrics["run_identity"]["run_date"] = date_match.group(1)
            break
    
    # Step 6: Invariant check - did we extract all expected windows?
    expected = metrics.get("aggregate_results", {}).get("total_windows")
    actual = len(metrics.get("per_window_results", []))
    
    if expected is not None and actual != int(expected):
        metrics["extraction_incomplete"] = True
        metrics["extraction_incomplete_reason"] = f"total_windows={expected} != extracted_windows={actual}"
    else:
        metrics["extraction_incomplete"] = False
    
    # Step 7: Add comparable flag (tainted runs should not be compared)
    metrics["comparable"] = not metrics.get("run_tainted", False) and not metrics.get("extraction_incomplete", False)
    
    return metrics


def main():
    """Process all log files in logs/archive/."""
    
    script_dir = Path(__file__).parent
    archive_dir = script_dir.parent / "logs" / "archive"
    
    if not archive_dir.exists():
        print(f"Archive directory not found: {archive_dir}")
        return
    
    log_files = sorted(archive_dir.glob("*.log"))
    print(f"Found {len(log_files)} log files to process")
    
    stats = {"total": 0, "tainted": 0, "from_artifact": 0, "from_log": 0}
    
    for log_path in log_files:
        print(f"\nProcessing: {log_path.name}")
        
        metrics = extract_metrics_from_log(log_path)
        stats["total"] += 1
        
        if metrics.get("run_tainted"):
            stats["tainted"] += 1
            print(f"  ⚠️  TAINTED: {metrics.get('taint_reasons', [])}")
        
        if metrics.get("extraction_method") == "artifact":
            stats["from_artifact"] += 1
            print(f"  📦 From artifact: {metrics.get('from_artifact', 'unknown')}")
        else:
            stats["from_log"] += 1
            print(f"  📄 From log parsing")
        
        window_count = len(metrics.get("per_window_results", []))
        print(f"  Windows: {window_count}")
        
        # Save JSON next to the log file
        json_path = log_path.with_suffix('.extracted.json')
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(metrics, f, indent=2, ensure_ascii=False)
        
        print(f"  -> Saved: {json_path.name}")
    
    print(f"\n{'='*50}")
    print(f"Summary:")
    print(f"  Total processed: {stats['total']}")
    print(f"  Tainted runs: {stats['tainted']}")
    print(f"  From artifacts: {stats['from_artifact']}")
    print(f"  From log parsing: {stats['from_log']}")


if __name__ == "__main__":
    main()
