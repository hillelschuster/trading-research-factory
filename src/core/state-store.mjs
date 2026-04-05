import { readJson, writeJsonAtomic } from "./fs-utils.mjs";

export class StateStore {
  constructor(paths) {
    this.paths = paths;
  }

  readState() {
    return readJson(this.paths.state, {
      goal: null,
      iteration: 0,
      last_run_id: null,
      run_started_at: null,
      stage_started_at: null,
      exit_reason: null,
      active_session_id: null,
      active_session_url: null,
      active_agent: null,
      active_agent_attempt: null,
      active_agent_status: null,
      last_agent_heartbeat_at: null,
      last_status: "idle",
      last_error: null,
      mode_history: []
    });
  }

  writeState(next) {
    writeJsonAtomic(this.paths.state, next, this.paths);
  }

  update(mutator) {
    const current = this.readState();
    const next = mutator(structuredClone(current));
    this.writeState(next);
    return next;
  }
}
