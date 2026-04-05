import fs from "fs";
import path from "path";

export const REPO_SENTINELS = [
  "package.json",
  "opencode.json",
  "src/cli.mjs",
  "AGENTS.md"
];

export const TOOLING_SANDBOX = ".opencode";

export const TOP_LEVEL_WRITE_ALLOWLIST = new Set([
  "factory",
  "workspace",
  "walk forward engine",
  "wfa",
  TOOLING_SANDBOX,
  "src",
  "docs",
  "tests"
]);

export const ROOT_FILE_WRITE_ALLOWLIST = new Set([
  "README.md",
  "package.json",
  "opencode.json",
  "AGENTS.md",
  ".gitignore"
]);

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function looksLikeWindowsDrivePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function isWindowsDriveRoot(value) {
  return /^[A-Za-z]:[\\/]?$/.test(value);
}

function isWindowsUncPath(value) {
  return /^\\\\/.test(value) || /^\/\//.test(value);
}

function toPosixPath(value) {
  return value.replace(/\\/g, "/");
}

function convertWindowsPathToWsl(value) {
  const match = value.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!match) return null;
  const drive = match[1].toLowerCase();
  const rest = toPosixPath(match[2]);
  return rest ? path.posix.join("/mnt", drive, rest) : path.posix.join("/mnt", drive);
}

function isFilesystemRoot(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const normalized = toPosixPath(value);
  if (normalized === "/") return true;
  const parsedPosix = path.posix.parse(normalized);
  if (parsedPosix.root === normalized) return true;
  const parsedWin = path.win32.parse(value);
  return parsedWin.root === value;
}

function statFingerprint(dirPath) {
  const stats = fs.statSync(dirPath);
  return `${stats.dev}:${stats.ino}:${Math.round(stats.mtimeMs)}`;
}

export function resolveCanonicalRoot(inputRoot, { cwd = process.cwd() } = {}) {
  const requested = String(inputRoot ?? "").trim();
  if (!requested) {
    throw new Error("Root path is required.");
  }

  if (requested === "/" || isWindowsDriveRoot(requested) || isWindowsUncPath(requested)) {
    throw new Error(`Refusing filesystem root as repo root: ${requested}`);
  }

  const aliasCandidates = [requested];
  const normalizedInput = looksLikeWindowsDrivePath(requested)
    ? convertWindowsPathToWsl(requested)
    : requested;

  if (!normalizedInput) {
    throw new Error(`Could not normalize root path: ${requested}`);
  }

  if (normalizedInput !== requested) {
    aliasCandidates.push(normalizedInput);
  }

  const absolutePath = path.resolve(cwd, normalizedInput);
  if (isFilesystemRoot(absolutePath)) {
    throw new Error(`Refusing filesystem root as repo root: ${absolutePath}`);
  }
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Root path does not exist: ${absolutePath}`);
  }

  const realPath = fs.realpathSync.native?.(absolutePath) ?? fs.realpathSync(absolutePath);
  const stats = fs.statSync(realPath);
  if (!stats.isDirectory()) {
    throw new Error(`Root path is not a directory: ${realPath}`);
  }

  const sentinelChecks = Object.fromEntries(REPO_SENTINELS.map((sentinel) => [sentinel, fs.existsSync(path.join(realPath, sentinel))]));
  const missingSentinels = Object.entries(sentinelChecks).filter(([, exists]) => !exists).map(([sentinel]) => sentinel);
  if (missingSentinels.length > 0) {
    throw new Error(`Root path is not a valid repo root. Missing sentinels: ${missingSentinels.join(", ")}`);
  }

  return {
    inputPath: requested,
    absolutePath,
    realPath,
    displayPath: realPath,
    aliases: uniqueStrings([...aliasCandidates, absolutePath, realPath]),
    fingerprint: statFingerprint(realPath),
    sentinels: sentinelChecks,
    platformStyle: looksLikeWindowsDrivePath(requested) ? "windows-alias" : path.sep === "\\" ? "windows" : "posix",
    toolingSandbox: path.join(realPath, TOOLING_SANDBOX)
  };
}

export function normalizeRootIdentity(rootRef) {
  if (rootRef && typeof rootRef === "object" && typeof rootRef.realPath === "string") {
    return rootRef;
  }

  if (typeof rootRef === "string" && rootRef.trim()) {
    return {
      inputPath: rootRef,
      absolutePath: rootRef,
      realPath: rootRef,
      displayPath: rootRef,
      aliases: [rootRef],
      fingerprint: null,
      sentinels: {},
      platformStyle: path.sep === "\\" ? "windows" : "posix",
      toolingSandbox: path.join(rootRef, TOOLING_SANDBOX)
    };
  }

  throw new Error("A canonical root identity or root path string is required.");
}

export function isSandboxRelativePath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim()) return false;
  const normalized = toPosixPath(relativePath).replace(/^\.\//, "");
  return normalized === TOOLING_SANDBOX || normalized.startsWith(`${TOOLING_SANDBOX}/`);
}
