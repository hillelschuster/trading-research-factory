import { readJson, writeJsonAtomic } from "./fs-utils.mjs";

const LEGACY_STATUS_MAP = {
  pending: "ready",
  in_progress: "leased",
  done: "research_complete",
  reviewed: "research_inconclusive",
  failed: "infra_blocked"
};

function normalizeStatus(status, item = {}) {
  if (status === "completed") {
    const verdict = item?.last_verdict ?? item?.verdict;
    if (["passed", "success", "promising", "promising_with_caveats"].includes(verdict)) return "research_complete";
    if (verdict === "blocked") return "research_blocked";
    return "research_inconclusive";
  }
  return LEGACY_STATUS_MAP[status] || status || "ready";
}

function normalizeItem(item) {
  const source = item && typeof item === "object" ? item : {};
  const { run_id, verdict, ...rest } = source;
  const normalizedStatus = normalizeStatus(source?.status, source);
  const normalizedResearchStatus = source?.research_status
    ?? (normalizedStatus.startsWith("research_") ? normalizedStatus : null);
  return {
    ...rest,
    status: normalizedStatus,
    research_status: normalizedResearchStatus,
    cooldown_until: source?.cooldown_until ?? null,
    quarantine_until: source?.quarantine_until ?? null,
    lease_owner: source?.lease_owner ?? null,
    lease_expires_at: source?.lease_expires_at ?? null,
    current_run_id: source?.current_run_id ?? run_id ?? null,
    last_failure_class: source?.last_failure_class ?? (normalizedStatus === "infra_blocked" ? "interruption" : null),
    resume_from_stage: source?.resume_from_stage ?? null,
    last_verdict: source?.last_verdict ?? verdict ?? null
  };
}

function isExpired(timestamp, now = Date.now()) {
  if (!timestamp) return false;
  const value = Date.parse(timestamp);
  return Number.isFinite(value) && value <= now;
}

export class BacklogStore {
  constructor(paths) {
    this.paths = paths;
  }

  read() {
    return readJson(this.paths.backlog, []).map(normalizeItem);
  }

  write(items) {
    writeJsonAtomic(this.paths.backlog, items.map(normalizeItem), this.paths);
  }

  migrate() {
    const rawItems = readJson(this.paths.backlog, []);
    const normalizedItems = rawItems.map(normalizeItem);
    const changed = JSON.stringify(rawItems) !== JSON.stringify(normalizedItems);
    if (changed) {
      this.write(normalizedItems);
    }
    return { changed, items: normalizedItems };
  }

  pickNext({ scoreItem = null, readyStatuses = ["ready"] } = {}) {
    const items = this.read();
    return items
      .filter((item) => readyStatuses.includes(item.status))
      .map((item) => ({
        item,
        score: typeof scoreItem === "function" ? scoreItem(item) : (item.priority ?? 0)
      }))
      .sort((a, b) => b.score - a.score || (b.item.priority ?? 0) - (a.item.priority ?? 0))
      [0]?.item ?? null;
  }

  mark(id, patch) {
    const items = this.read().map((item) => item.id === id ? normalizeItem({ ...item, ...patch }) : item);
    this.write(items);
    return items.find((item) => item.id === id) ?? null;
  }

  append(itemsToAdd) {
    const items = this.read();
    items.push(...itemsToAdd.map((item) => normalizeItem(item)));
    this.write(items);
  }

  lease(id, { leaseOwner, leaseExpiresAt, runId, resumeFromStage = null } = {}) {
    return this.mark(id, {
      status: "leased",
      cooldown_until: null,
      quarantine_until: null,
      lease_owner: leaseOwner ?? null,
      lease_expires_at: leaseExpiresAt ?? null,
      current_run_id: runId ?? null,
      resume_from_stage: resumeFromStage,
      started_at: new Date().toISOString()
    });
  }

  completeResearch(id, { status, lastFailureClass = null, resumeFromStage = null, patch = {} } = {}) {
    return this.mark(id, {
      ...patch,
      status,
      research_status: status,
      cooldown_until: null,
      quarantine_until: null,
      lease_owner: null,
      lease_expires_at: null,
      last_failure_class: lastFailureClass,
      resume_from_stage: resumeFromStage
    });
  }

  markInfraBlocked(id, { runId, failureClass, resumeFromStage, patch = {} } = {}) {
    return this.mark(id, {
      ...patch,
      status: "infra_blocked",
      research_status: patch.research_status ?? this.read().find((item) => item.id === id)?.research_status ?? null,
      cooldown_until: null,
      quarantine_until: null,
      lease_owner: null,
      lease_expires_at: null,
      current_run_id: runId ?? null,
      last_failure_class: failureClass ?? null,
      resume_from_stage: resumeFromStage ?? null
    });
  }

  recoverExpiredLeases(now = new Date()) {
    const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
    const recovered = [];
    const items = this.read().map((item) => {
      if (item.status === "leased" && isExpired(item.lease_expires_at, nowMs)) {
        const next = normalizeItem({
          ...item,
          status: "ready",
          research_status: item.research_status ?? null,
          lease_owner: null,
          lease_expires_at: null,
          last_failure_class: item.last_failure_class ?? "interruption"
        });
        recovered.push(next);
        return next;
      }
      return item;
    });

    if (recovered.length > 0) {
      this.write(items);
    }

    return recovered;
  }

  markInfraCooldown(id, { runId, failureClass, resumeFromStage, cooldownUntil, patch = {} } = {}) {
    return this.mark(id, {
      ...patch,
      status: "infra_cooldown",
      cooldown_until: cooldownUntil ?? null,
      quarantine_until: null,
      lease_owner: null,
      lease_expires_at: null,
      current_run_id: runId ?? null,
      last_failure_class: failureClass ?? null,
      resume_from_stage: resumeFromStage ?? null
    });
  }

  markInfraQuarantined(id, { runId, failureClass, resumeFromStage, quarantineUntil, patch = {} } = {}) {
    return this.mark(id, {
      ...patch,
      status: "infra_quarantined",
      cooldown_until: null,
      quarantine_until: quarantineUntil ?? null,
      lease_owner: null,
      lease_expires_at: null,
      current_run_id: runId ?? null,
      last_failure_class: failureClass ?? null,
      resume_from_stage: resumeFromStage ?? null
    });
  }

  recoverCooldowns(now = new Date()) {
    const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
    const recovered = [];
    const items = this.read().map((item) => {
      if (item.status === "infra_cooldown" && isExpired(item.cooldown_until, nowMs)) {
        const next = normalizeItem({
          ...item,
          status: "infra_blocked",
          cooldown_until: null
        });
        recovered.push(next);
        return next;
      }
      if (item.status === "infra_quarantined" && isExpired(item.quarantine_until, nowMs)) {
        const next = normalizeItem({
          ...item,
          status: "infra_blocked",
          quarantine_until: null
        });
        recovered.push(next);
        return next;
      }
      return item;
    });

    if (recovered.length > 0) {
      this.write(items);
    }

    return recovered;
  }
}
