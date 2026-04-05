import path from "path";
import { appendLine, ensureDir } from "./fs-utils.mjs";

export class Logger {
  constructor(paths, runId) {
    this.paths = paths;
    this.runId = runId;
    this.logPath = path.join(paths.runs, runId, "run.log");
    ensureDir(path.dirname(this.logPath), this.paths);
  }

  line(message, extra = undefined) {
    const entry = {
      ts: new Date().toISOString(),
      run_id: this.runId,
      message,
      ...(extra ? { extra } : {})
    };
    appendLine(this.logPath, JSON.stringify(entry), this.paths);
    const renderedError = extra?.error
      ? typeof extra.error === "string"
        ? extra.error
        : extra.error.message || JSON.stringify(extra.error)
      : null;
    console.log(`[${entry.ts}] ${message}${renderedError ? ` | error: ${renderedError}` : ""}`);
  }
}
