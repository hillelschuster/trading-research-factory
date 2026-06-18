# MT5 Python Auth Snapshot Handoff - 2026-05-03

## Scope

This document summarizes the resolved MT5/FTMO Python connection blocker for the deterministic `mt5_snapshot` worker.

The work was intentionally limited to:

- Python MT5 terminal authentication
- deterministic `mt5_snapshot` evidence generation
- Phase 2 spec status update based on real artifacts

The work did not touch candidates, registry, curator, hygiene, native MQL5 strategy work, tester lifecycle Phase 4, or broad architecture.

## Blocker

Previous real MT5 snapshot attempts blocked at:

`factory/mt5/environment/JOB-MT5-SNAPSHOT-REAL-20260503-EURUSD-M15-R7/`

Failure:

```text
MetaTrader5 initialize failed: -6 Terminal: Authorization failed
```

The worker/probe already supported WSL-to-Windows Python path conversion, pinned `MetaTrader5==5.0.45`, explicit terminal path, explicit login, explicit server, and non-persisted terminal path. The missing piece was password support.

## Fix

Implemented minimal env-only password authentication.

Changed files:

- `src/workers/mt5-snapshot-worker.mjs`
- `walk forward engine/src/mt5_snapshot_probe.py`
- `tests/verification.test.mjs`
- `factory/mt5-ftmo-strategy-factory-spec.md`

Key behavior:

- password is read only from `TRF_MT5_PASSWORD`
- password is never accepted as a CLI argument
- password is not written to artifacts, logs, request files, stdout, stderr, or spec text
- persisted request metadata records only:

```json
{
  "password_env_var": "TRF_MT5_PASSWORD",
  "password_env_provided": true
}
```

Probe behavior:

- passes `password` into `mt5.initialize(path, login=..., password=..., server=...)`
- includes a fallback path using `mt5.initialize(path=...)` followed by `mt5.login(login, password=..., server=...)` if credentialed initialize fails
- records only redacted auth diagnostics such as method names and MT5 error codes/messages

Regression test added:

- `tests/verification.test.mjs` test name: `mt5 snapshot worker records only redacted password env metadata`

## Successful Real Snapshot

Job:

`JOB-MT5-SNAPSHOT-REAL-20260503-EURUSD-M15-PW1`

Command shape used:

```bash
TRF_MT5_PASSWORD='<redacted>' node "scripts/run-mt5-snapshot-worker.mjs" \
  --job-id "JOB-MT5-SNAPSHOT-REAL-20260503-EURUSD-M15-PW1" \
  --run-id "RUN-MT5-SNAPSHOT-REAL-20260503-EURUSD-M15-PW1" \
  --experiment-id "EXP-MT5-SNAPSHOT-REAL-20260503-EURUSD-M15-PW1" \
  --symbol "EURUSD" \
  --timeframe "M15" \
  --bars 256 \
  --terminal-path "C:\\Program Files\\FTMO Global Markets MT5 Terminal\\terminal64.exe" \
  --login 1513283634 \
  --server "FTMO-Demo" \
  --python "walk forward engine/.venv/Scripts/python.exe"
```

Real account and terminal identity observed:

- account login: `1513283634`
- server: `FTMO-Demo`
- account currency: `USD`
- leverage: `30`
- terminal: `FTMO Global Markets MT5 Terminal`
- terminal company: `FTMO Global Markets Ltd`
- terminal build: `5833`
- terminal connected: `true`
- terminal trade allowed: `true`
- terminal DLLs allowed: `false`

Symbol/data identity observed:

- symbol: `EURUSD`
- timeframe: `M15`
- requested bars: `256`
- returned bars: `256`
- coverage start UTC: `2026-04-29T08:00:00+00:00`
- coverage end UTC: `2026-05-01T23:45:00+00:00`
- quote basis: `broker_terminal_bid_ohlc`
- source type: `mt5_terminal_rates`
- bars SHA-256: `03c16b1c96b2721a5b6957ea4bdf23e94b07408d99332cddc2b24eabd9e1a2ad`

## Evidence Artifacts

Successful evidence directory:

`factory/mt5/environment/JOB-MT5-SNAPSHOT-REAL-20260503-EURUSD-M15-PW1/`

Required artifacts exist:

- `factory/mt5/environment/JOB-MT5-SNAPSHOT-REAL-20260503-EURUSD-M15-PW1/snapshot.json`
- `factory/mt5/environment/JOB-MT5-SNAPSHOT-REAL-20260503-EURUSD-M15-PW1/worker-result.json`
- `factory/mt5/environment/JOB-MT5-SNAPSHOT-REAL-20260503-EURUSD-M15-PW1/execution-result.json`

Additional artifacts:

- `factory/mt5/environment/JOB-MT5-SNAPSHOT-REAL-20260503-EURUSD-M15-PW1/request.json`
- `factory/mt5/environment/JOB-MT5-SNAPSHOT-REAL-20260503-EURUSD-M15-PW1/probe.stdout.txt`
- `factory/mt5/environment/JOB-MT5-SNAPSHOT-REAL-20260503-EURUSD-M15-PW1/probe.stderr.txt`

Execution result:

- status: `executed`
- evidence kind: `mt5_snapshot`
- authority layer: `mt5_terminal`
- blocked reason: `null`
- snapshot SHA-256: `5ae8ba84e47e12d15a7838e8b1b7886166b555dee5222cf7912860468eb110df`

## Validation

Focused validation command:

```bash
rtk npm run test:verification
```

Result after code/spec changes:

```text
tests 29
pass 29
fail 0
duration_ms 952.979401
```

## Spec Update

Updated `factory/mt5-ftmo-strategy-factory-spec.md` Phase 2 only.

Main changes:

- recorded that the MT5 Python connection blocker is solved
- recorded env-only password auth through `TRF_MT5_PASSWORD`
- recorded successful FTMO demo snapshot evidence path
- changed terminal/account/symbol/data identity capture tasks to `[x]`
- kept fixture-choice exit criterion `[~]` because this scoped run intentionally did not choose or attach a fixture/candidate
- marked immediate next work item 7 as `[x]` for MT5 environment/data snapshot worker

## Boundaries Still In Force

This success proves Python can connect to the authorized FTMO demo MT5 terminal and produce real `mt5_snapshot` evidence.

It does not prove:

- MT5 Strategy Tester lifecycle execution
- native MQL5 strategy parity
- FTMO rule-ledger survival on live/forward inputs
- candidate promotion readiness
- deployment readiness

Known remaining status after this handoff:

- Phase 2: solved for real MT5 terminal snapshot proof
- Phase 3: protocol smoke already complete
- Phase 4: still lacks real MT5 Strategy Tester lifecycle output
- Phase 5: fixture mechanics only, no real/current ledger input
- Phase 6: blocked until later phases have evidence
