# Loop Engine Architecture Audit Context

This file records the curated GitHub context for auditing `factory/research/loop-engine-architecture-deep-research-2026-05-06.md`.

Included context:

- Current loop/source files for orchestrator, prompt building, validators, verification, state paths, workers, scripts, tests, and WFA launcher behavior.
- Current factory state/backlog/health/evidence files needed to inspect the report's codebase-reality claims.
- The failed WFA-only canary run `RUN-20260505194725-nlq8sd`, because the report cites planner JSON failure and OpenCode first-header timeouts.
- The rollout gate artifact `factory/verification/rollout-gate-20260505200440396.json`, because the report cites launch-readiness blockage.
- The reassessment brief that framed the deep research question.

Intentionally excluded from this curated push:

- MT5 terminal/tester/FTMO evidence directories and the full MT5/FTMO spec file when they include or reference account identifiers, terminal paths, broker/server names, screenshots, HTML reports, or raw logs.
- Volatile runtime locks, active-session records, owner locks, recovery logs, old failed run attempts, generated verification manifests, and large generated WFA history files.

Boundary for the audit:

- Audit the architectural conclusion and repo evidence for the WFA-only research-loop runtime.
- Do not treat excluded MT5/FTMO artifacts as missing proof for the WFA-loop decision; they were excluded from GitHub context to avoid publishing sensitive platform/account details.
- The first implementation slice now present in the codebase is a deterministic WFA-ready planner bypass. It is narrow by design and does not yet implement the full recommended deterministic WFA execution worker or replaceable research-brain interface.
