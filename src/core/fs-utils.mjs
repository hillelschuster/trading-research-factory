import fs from "fs";
import path from "path";

function normalizeWriteScope(scopeLike) {
  if (!scopeLike) return null;
  return scopeLike.writeScope ?? scopeLike;
}

export function assertContainedPath(targetPath, scopeLike) {
  const scope = normalizeWriteScope(scopeLike);
  if (!scope?.rootDir) {
    return path.resolve(targetPath);
  }

  const rootDir = path.resolve(scope.rootDir);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(rootDir, resolvedTarget);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing write outside canonical root: ${resolvedTarget}`);
  }

  if (!relative || relative === ".") {
    return resolvedTarget;
  }

  const segments = relative.split(path.sep).filter(Boolean);
  const topLevel = segments[0];
  if (segments.length === 1 && scope.allowedRootFiles instanceof Set && scope.allowedRootFiles.has(topLevel)) {
    return resolvedTarget;
  }
  if (scope.allowedTopLevelDirs instanceof Set && scope.allowedTopLevelDirs.has(topLevel)) {
    return resolvedTarget;
  }

  throw new Error(`Refusing undeclared top-level write target: ${relative}`);
}

export function ensureDir(dirPath, scopeLike) {
  const safePath = assertContainedPath(dirPath, scopeLike);
  fs.mkdirSync(safePath, { recursive: true });
}

export function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(filePath, data, scopeLike) {
  const safePath = assertContainedPath(filePath, scopeLike);
  ensureDir(path.dirname(safePath), scopeLike);
  const tmp = `${safePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, safePath);
}

export function writeTextAtomic(filePath, text, scopeLike) {
  const safePath = assertContainedPath(filePath, scopeLike);
  ensureDir(path.dirname(safePath), scopeLike);
  const tmp = `${safePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, safePath);
}

export function appendLine(filePath, line, scopeLike) {
  const safePath = assertContainedPath(filePath, scopeLike);
  ensureDir(path.dirname(safePath), scopeLike);
  fs.writeFileSync(safePath, line.endsWith("\n") ? line : line + "\n", { flag: "a" });
}

export function listFilesRecursive(rootDir) {
  const out = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  }
  if (fs.existsSync(rootDir)) walk(rootDir);
  return out.sort();
}
