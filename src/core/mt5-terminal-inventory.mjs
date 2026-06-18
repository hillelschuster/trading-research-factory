import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./fs-utils.mjs";
import { buildPaths } from "./paths.mjs";

export const MT5_TERMINAL_INVENTORY_REQUEST_SCHEMA_VERSION = "phase8a_mt5_terminal_inventory_request_v1";
export const MT5_TERMINAL_INVENTORY_SCHEMA_VERSION = "phase8a_mt5_terminal_inventory_v1";

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function hasText(value, minLength = 1) {
  return typeof value === "string" && value.trim().length >= minLength;
}

function sha256File(fullPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
}

function repoRelative(rootDir, fullPath) {
  return path.relative(rootDir, fullPath).replace(/\\/g, "/");
}

function resolveRepoRelativePath(rootDir, repoRelativePath, label = "path") {
  if (!hasText(repoRelativePath) || path.isAbsolute(repoRelativePath)) {
    throw new Error(`MT5 terminal inventory ${label} must be a repo-relative path.`);
  }
  const root = path.resolve(rootDir);
  const fullPath = path.resolve(root, repoRelativePath);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`MT5 terminal inventory ${label} escapes repository root: ${repoRelativePath}`);
  }
  return fullPath;
}

function readJsonRepoRelative(rootDir, repoRelativePath, label) {
  const fullPath = resolveRepoRelativePath(rootDir, repoRelativePath, label);
  if (!fs.existsSync(fullPath)) throw new Error(`MT5 terminal inventory ${label} is missing on disk: ${repoRelativePath}`);
  return { fullPath, value: JSON.parse(fs.readFileSync(fullPath, "utf8")) };
}

function artifactRecord(rootDir, fullPath, artifactType) {
  const stat = fs.statSync(fullPath);
  return {
    artifact_type: artifactType,
    path: repoRelative(rootDir, fullPath),
    sha256: sha256File(fullPath),
    size_bytes: stat.size,
    modified_at: stat.mtime.toISOString()
  };
}

function sanitizePathPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "mt5-terminal-inventory";
}

function defaultInventoryId(observedAt) {
  return `FTMO-MULTI-ASSET-TERMINAL-INVENTORY-${observedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function terminalPathGroup(symbol) {
  const value = String(symbol?.path ?? "").trim();
  if (!value) return "(missing)";
  return value.split("\\")[0] || "(missing)";
}

function terminalAssetClass(symbol) {
  const group = terminalPathGroup(symbol);
  if (group === "Forex" || group === "Exotics") return "fx";
  if (group.startsWith("Crypto")) return "crypto_cfd";
  if (group === "Metals CFD") return "metal_cfd";
  if (group.startsWith("Equities")) return "stock_cfd";
  if (group === "Agriculture") return "agriculture_cfd";
  if (group === "Commodities") return "energy_commodity_cfd";
  if (group.startsWith("Cash")) {
    const name = String(symbol?.name ?? "").toUpperCase();
    const description = String(symbol?.description ?? "").toUpperCase();
    if (name.includes("OIL") || name.includes("GAS") || description.includes("OIL") || description.includes("GAS")) return "energy_commodity_cfd";
    return "index_cfd";
  }
  return "other";
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function selectedSymbolFields(symbol) {
  const terminal_path_group = terminalPathGroup(symbol);
  const terminal_asset_class = terminalAssetClass(symbol);
  return {
    name: symbol.name,
    path: symbol.path ?? null,
    terminal_path_group,
    terminal_asset_class,
    description: symbol.description ?? null,
    currency_base: symbol.currency_base ?? null,
    currency_profit: symbol.currency_profit ?? null,
    currency_margin: symbol.currency_margin ?? null,
    digits: symbol.digits ?? null,
    point: symbol.point ?? null,
    trade_mode: symbol.trade_mode ?? null,
    trade_calc_mode: symbol.trade_calc_mode ?? null,
    trade_contract_size: symbol.trade_contract_size ?? null,
    volume_min: symbol.volume_min ?? null,
    volume_max: symbol.volume_max ?? null,
    volume_step: symbol.volume_step ?? null,
    tick_size: symbol.tick_size ?? symbol.trade_tick_size ?? null,
    tick_value: symbol.tick_value ?? symbol.trade_tick_value ?? null,
    spread: symbol.spread ?? null,
    spread_float: symbol.spread_float ?? null,
    swap_mode: symbol.swap_mode ?? null,
    swap_long: symbol.swap_long ?? null,
    swap_short: symbol.swap_short ?? null,
    margin_initial: symbol.margin_initial ?? null,
    margin_maintenance: symbol.margin_maintenance ?? null,
    margin_hedged: symbol.margin_hedged ?? null,
    visible: symbol.visible ?? null,
    select: symbol.select ?? null,
    asset_class_hints: symbol.asset_class_hints ?? null,
    history_availability: symbol.history_availability ?? null
  };
}

function priorityCandidates(symbols) {
  const preferred = [
    { priority_class: "fx", mt5_symbol: "EURUSD", timeframe: "H1", bars: 5000 },
    { priority_class: "index", mt5_symbol: "US100.cash", timeframe: "H1", bars: 5000 },
    { priority_class: "metal", mt5_symbol: "XAUUSD", timeframe: "H1", bars: 5000 },
    { priority_class: "commodity_energy", mt5_symbol: "USOIL.cash", timeframe: "H1", bars: 5000 },
    { priority_class: "stock", mt5_symbol: "AAPL", timeframe: "H1", bars: 5000 },
    { priority_class: "crypto", mt5_symbol: "BTCUSD", timeframe: "H1", bars: 5000 }
  ];
  const byName = new Map(symbols.map((symbol) => [symbol.name, symbol]));
  return preferred
    .filter((item) => byName.has(item.mt5_symbol))
    .map((item) => ({
      ...item,
      selection_basis: "deterministic_cross_asset_representative_from_terminal_path_groups",
      terminal_symbol_spec: selectedSymbolFields(byName.get(item.mt5_symbol))
    }));
}

function validateUniverseSnapshot(universeSnapshot) {
  if (!universeSnapshot || typeof universeSnapshot !== "object" || Array.isArray(universeSnapshot)) {
    throw new Error("MT5 terminal inventory universe snapshot is invalid.");
  }
  if (universeSnapshot.schema_version !== "mt5_tradable_universe_snapshot_v1") {
    throw new Error("MT5 terminal inventory universe snapshot must use mt5_tradable_universe_snapshot_v1.");
  }
  if (universeSnapshot.evidence_kind !== "mt5_tradable_universe_snapshot") {
    throw new Error("MT5 terminal inventory universe snapshot evidence_kind must be mt5_tradable_universe_snapshot.");
  }
  if (universeSnapshot.status === "blocked" || hasText(universeSnapshot.blocked_reason)) {
    throw new Error(`MT5 terminal inventory universe snapshot is blocked: ${universeSnapshot.blocked_reason || "status is blocked"}`);
  }
  if (!Array.isArray(universeSnapshot.symbols) || universeSnapshot.symbols.length === 0) {
    throw new Error("MT5 terminal inventory universe snapshot must include non-empty symbols[].");
  }
}

export function validateMt5TerminalInventoryRequest(request, { rootDir = process.cwd() } = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("MT5 terminal inventory request must be an object.");
  if (request.schema_version !== MT5_TERMINAL_INVENTORY_REQUEST_SCHEMA_VERSION) {
    throw new Error(`MT5 terminal inventory request schema_version must be ${MT5_TERMINAL_INVENTORY_REQUEST_SCHEMA_VERSION}.`);
  }
  if (!hasText(request.universe_snapshot_path)) throw new Error("MT5 terminal inventory request requires universe_snapshot_path.");
  resolveRepoRelativePath(rootDir, request.universe_snapshot_path, "universe_snapshot_path");
  if (request.output_dir !== undefined && request.output_dir !== null) resolveRepoRelativePath(rootDir, request.output_dir, "output_dir");
  return true;
}

export function validateMt5TerminalInventory(inventory) {
  const errors = [];
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) throw new Error("MT5 terminal inventory is missing or invalid.");
  if (inventory.schema_version !== MT5_TERMINAL_INVENTORY_SCHEMA_VERSION) errors.push(`schema_version must be ${MT5_TERMINAL_INVENTORY_SCHEMA_VERSION}`);
  if (inventory.evidence_kind !== "phase8a_mt5_terminal_inventory") errors.push("evidence_kind must be phase8a_mt5_terminal_inventory");
  if (!hasText(inventory.inventory_id, 3)) errors.push("inventory_id is required");
  if (inventory.official_evidence_index_mutated !== false) errors.push("official_evidence_index_mutated must be false");
  if (!inventory.source_universe_snapshot || !hasText(inventory.source_universe_snapshot.path, 3) || !SHA256_PATTERN.test(String(inventory.source_universe_snapshot.sha256 || ""))) {
    errors.push("source_universe_snapshot path and sha256 are required");
  }
  if (!inventory.counts || inventory.counts.total_symbols !== (Array.isArray(inventory.symbols) ? inventory.symbols.length : -1)) {
    errors.push("counts.total_symbols must match symbols length");
  }
  if (!Array.isArray(inventory.symbols) || inventory.symbols.length === 0) errors.push("symbols must be non-empty");
  for (const [index, symbol] of (Array.isArray(inventory.symbols) ? inventory.symbols : []).entries()) {
    if (!hasText(symbol.name)) errors.push(`symbols[${index}].name is required`);
    if (!hasText(symbol.path)) errors.push(`symbols[${index}].path is required`);
    if (!hasText(symbol.terminal_path_group)) errors.push(`symbols[${index}].terminal_path_group is required`);
    if (!hasText(symbol.terminal_asset_class)) errors.push(`symbols[${index}].terminal_asset_class is required`);
  }
  if (!Array.isArray(inventory.priority_history_probe_symbols) || inventory.priority_history_probe_symbols.length === 0) {
    errors.push("priority_history_probe_symbols must be non-empty");
  }
  if (errors.length > 0) throw new Error(`MT5 terminal inventory validation failed: ${errors.join("; ")}`);
  return true;
}

export function writeMt5TerminalInventoryFromRequest({
  rootDir = process.cwd(),
  request,
  observedAt = new Date().toISOString()
} = {}) {
  const paths = buildPaths(rootDir);
  validateMt5TerminalInventoryRequest(request, { rootDir: paths.root });
  const inventoryId = hasText(request.inventory_id, 3) ? request.inventory_id.trim() : defaultInventoryId(observedAt);

  const { fullPath: universeFullPath, value: universeSnapshot } = readJsonRepoRelative(paths.root, request.universe_snapshot_path, "universe_snapshot_path");
  validateUniverseSnapshot(universeSnapshot);
  const symbols = universeSnapshot.symbols.map(selectedSymbolFields).sort((a, b) => a.path.localeCompare(b.path) || a.name.localeCompare(b.name));
  const groups = [...new Set(symbols.map((symbol) => symbol.terminal_path_group))].sort();
  const classes = [...new Set(symbols.map((symbol) => symbol.terminal_asset_class))].sort();
  const priority = priorityCandidates(universeSnapshot.symbols);

  const inventory = {
    schema_version: MT5_TERMINAL_INVENTORY_SCHEMA_VERSION,
    evidence_kind: "phase8a_mt5_terminal_inventory",
    inventory_id: inventoryId,
    observed_at: observedAt,
    authority_layer: "derived_from_mt5_terminal_snapshot",
    official_evidence_index_mutated: false,
    source_universe_snapshot: {
      ...artifactRecord(paths.root, universeFullPath, "mt5_tradable_universe_snapshot"),
      job_id: universeSnapshot.job_id ?? null,
      observed_at: universeSnapshot.observed_at ?? null,
      status: universeSnapshot.status ?? null
    },
    terminal: {
      name: universeSnapshot.observations?.terminal?.name ?? null,
      build: universeSnapshot.terminal_build ?? universeSnapshot.observations?.terminal?.build ?? null,
      company: universeSnapshot.company ?? universeSnapshot.observations?.terminal?.company ?? null,
      server: universeSnapshot.server ?? universeSnapshot.observations?.account?.server ?? null
    },
    counts: {
      total_symbols: symbols.length,
      by_terminal_path_group: countBy(symbols.map((symbol) => symbol.terminal_path_group)),
      by_terminal_asset_class: countBy(symbols.map((symbol) => symbol.terminal_asset_class)),
      by_asset_class_hint: countBy(symbols.map((symbol) => symbol.asset_class_hints?.asset_class_guess ?? "unknown")),
      visible_true: symbols.filter((symbol) => symbol.visible === true).length,
      select_true: symbols.filter((symbol) => symbol.select === true).length
    },
    terminal_path_groups: groups.map((group) => ({
      group,
      count: symbols.filter((symbol) => symbol.terminal_path_group === group).length,
      terminal_asset_classes: [...new Set(symbols.filter((symbol) => symbol.terminal_path_group === group).map((symbol) => symbol.terminal_asset_class))].sort()
    })),
    terminal_asset_classes: classes.map((terminal_asset_class) => ({
      terminal_asset_class,
      count: symbols.filter((symbol) => symbol.terminal_asset_class === terminal_asset_class).length,
      terminal_path_groups: [...new Set(symbols.filter((symbol) => symbol.terminal_asset_class === terminal_asset_class).map((symbol) => symbol.terminal_path_group))].sort()
    })),
    priority_history_probe_symbols: priority,
    symbols
  };
  validateMt5TerminalInventory(inventory);

  const outputDir = request.output_dir
    ? resolveRepoRelativePath(paths.root, request.output_dir, "output_dir")
    : path.join(paths.mt5, "universe-analysis", sanitizePathPart(inventoryId));
  const inventoryPath = path.join(outputDir, "inventory.json");
  writeJsonAtomic(inventoryPath, inventory, paths);

  return {
    status: "ready",
    evidence_kind: "phase8a_mt5_terminal_inventory",
    inventory_id: inventoryId,
    observed_at: observedAt,
    artifacts: {
      inventory: artifactRecord(paths.root, inventoryPath, "phase8a_mt5_terminal_inventory"),
      universe_snapshot: artifactRecord(paths.root, universeFullPath, "mt5_tradable_universe_snapshot")
    },
    counts: inventory.counts,
    priority_history_probe_symbols: inventory.priority_history_probe_symbols,
    inventory
  };
}
