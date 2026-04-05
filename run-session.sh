#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec node src/cli.mjs run --mode "${RESEARCH_FACTORY_MODE:-simulate}" --cycles "${RESEARCH_FACTORY_CYCLES:-5}" --interval-ms "${RESEARCH_FACTORY_INTERVAL_MS:-5000}" --max-retries "${RESEARCH_FACTORY_MAX_RETRIES:-3}" --no-open-browser
