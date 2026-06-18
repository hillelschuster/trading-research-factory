#!/usr/bin/env node
import { migrateRuntimeLedger } from "../src/core/runtime-ledger.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const rootDir = valueAfter(args, "--root") ?? process.cwd();
const dbPath = valueAfter(args, "--db-path");

try {
  const result = migrateRuntimeLedger({ rootDir, dbPath });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
}
