#!/usr/bin/env python3
"""
Validate WFA YAML configuration files against the smoke-test compatible schema.

Exit codes:
  0 - valid
  2 - invalid (schema mismatch)
  3 - error (file not found / parse error)

Usage:
  python scripts/validate_wfa_config.py --config config/walk_forward_SMOKE.yaml
"""
import sys, argparse, yaml
from pathlib import Path

REQUIRED_TOP = ["walk_forward", "data", "strategy"]
REQUIRED_WF_KEYS = [
    "training_months",
    "testing_months",
    "step_months",
    "n_parameter_trials",
    "output_directory",
]
REQUIRED_STRATEGY_KEYS = ["profile_key"]
REQUIRED_DATA_KEYS = ["source_file"]


def validate(cfg: dict) -> tuple[bool, list[str]]:
    errs: list[str] = []
    # Top-level sections
    for k in REQUIRED_TOP:
        if k not in cfg:
            errs.append(f"Missing top-level section: {k}")
    if errs:
        return False, errs

    wf = cfg.get("walk_forward", {})
    for k in REQUIRED_WF_KEYS:
        if k not in wf:
            errs.append(f"walk_forward missing: {k}")

    strat = cfg.get("strategy", {})
    for k in REQUIRED_STRATEGY_KEYS:
        if k not in strat:
            errs.append(f"strategy missing: {k}")

    data = cfg.get("data", {})
    for k in REQUIRED_DATA_KEYS:
        if k not in data:
            errs.append(f"data missing: {k}")

    # Type sanity (best-effort)
    def is_int_like(v):
        return isinstance(v, int) or (isinstance(v, float) and v.is_integer())

    for k in ["training_months", "testing_months", "step_months", "n_parameter_trials"]:
        if k in wf and not is_int_like(wf[k]):
            errs.append(f"walk_forward.{k} must be integer-like")
    if "output_directory" in wf and not isinstance(wf["output_directory"], str):
        errs.append("walk_forward.output_directory must be string")

    if "profile_key" in strat and not isinstance(strat["profile_key"], str):
        errs.append("strategy.profile_key must be string")

    if "source_file" in data and not isinstance(data["source_file"], str):
        errs.append("data.source_file must be string")

    return (len(errs) == 0), errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    args = ap.parse_args()

    p = Path(args.config)
    if not p.exists():
        print(f"ERROR: file not found: {p}", file=sys.stderr)
        sys.exit(3)

    try:
        cfg = yaml.safe_load(p.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"ERROR: parse failed: {e}", file=sys.stderr)
        sys.exit(3)

    ok, errs = validate(cfg or {})
    if ok:
        print("VALID: configuration matches smoke-test schema")
        sys.exit(0)
    else:
        print("INVALID:")
        for e in errs:
            print(f" - {e}")
        sys.exit(2)


if __name__ == "__main__":
    main()

