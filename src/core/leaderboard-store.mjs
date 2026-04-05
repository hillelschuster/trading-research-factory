import { readJson, writeJsonAtomic } from "./fs-utils.mjs";

export function normalizeLeaderboardEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && Array.isArray(payload.strategies)) {
    return payload.strategies;
  }
  return [];
}

export function readLeaderboardEntries(paths) {
  return normalizeLeaderboardEntries(readJson(paths.leaderboard, []));
}

export function writeLeaderboardEntries(paths, entries) {
  writeJsonAtomic(paths.leaderboard, Array.isArray(entries) ? entries : [], paths);
}
