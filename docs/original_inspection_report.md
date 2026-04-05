# Original zip inspection report

## Classification

This uploaded project was **not OpenCode itself**. It was a **small wrapper/orchestrator project around the OpenCode SDK**.

## Facts from the uploaded zip

- The root project contained `package.json`, `opencode.json`, `run-session.sh`, `trading-loop.mjs`, `AGENTS.md`, `journal.md`, and a vendored `node_modules/@opencode-ai/sdk` tree.
- `package.json` declared a dependency on `@opencode-ai/sdk` rather than containing OpenCode source code.
- `trading-loop.mjs` imported `createOpencode` from `@opencode-ai/sdk` and started a loop externally.
- `opencode.json` configured permissions and model selection for an OpenCode-driven session.
- The project had no planner, no evaluator, no leaderboard, no backlog, no durable evidence index, and no robust workspace state model.
- The project workspace was effectively empty beyond a journal placeholder.

## Why this proves wrapper status

A real OpenCode repository would include the OpenCode application source tree. The uploaded zip instead contained a tiny custom project that **calls into** the published SDK package and relies on OpenCode behavior externally.

## Full file manifest

See `docs/original_zip_manifest.json`.
