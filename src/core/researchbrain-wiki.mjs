import fs from "fs";
import path from "path";
import crypto from "crypto";

// ResearchBrain Obsidian wiki module.
// Audit/hunch layer — NOT the LLM's cognitive engine.
// Zero deps. Raw fs + crypto. Atomic writes (temp+rename) for 9P/NTFS safety.

const DEFAULT_VAULT_PATH = "/mnt/c/Users/הלל/Documents/research-wiki/";
const ALLOWED_DIRS = ["concepts", "sources", "hypotheses", "hunches", "_raw"];

function getVaultPath() {
  return process.env.RESEARCH_WIKI_VAULT_PATH || DEFAULT_VAULT_PATH;
}

function writeAtomic(filePath, content) {
  const tmp = filePath + ".tmp." + crypto.randomBytes(4).toString("hex");
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function now() {
  return new Date().toISOString();
}

function generateFrontmatter({ type, tags, summary, runId }) {
  const safeTags = (tags || []).join(", ");
  const safeSummary = (summary || "").replace(/"/g, '\\"');
  return `---\ntype: ${type}\ntags: [${safeTags}]\nsummary: "${safeSummary}"\nrun_id: "${runId || ""}"\nupdated: ${today()}\n---\n\n`;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const fm = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    let val = m[2];
    if (val.startsWith("[") && val.endsWith("]")) {
      val = val.slice(1, -1).split(",").map(s => s.trim()).filter(Boolean);
    } else if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\"/g, '"');
    }
    fm[m[1]] = val;
  }
  return { frontmatter: fm, body: match[2] };
}

function updateIndex(pagePath, type, summary, tags) {
  const vault = getVaultPath();
  const indexPath = path.join(vault, "_index.md");
  const safeSummary = (summary || "").replace(/"/g, '\\"');
  const entry = `- ${type} | ${pagePath} | "${safeSummary}" | [${(tags || []).join(", ")}]`;

  let lines = [];
  if (fs.existsSync(indexPath)) {
    lines = fs.readFileSync(indexPath, "utf8").split("\n").filter(l => l.startsWith("- "));
  }
  lines = lines.filter(l => !l.includes(`| ${pagePath} |`));
  lines.push(entry);
  lines.sort();
  writeAtomic(indexPath, "# Wiki Index\n\n" + lines.join("\n") + "\n");
}

function appendLog(message) {
  const vault = getVaultPath();
  const logPath = path.join(vault, "_log.md");
  fs.appendFileSync(logPath, `${now()} ${message}\n`, "utf8");
}

function writeWikiPage({ path: pagePath, type, content, tags, summary, runId }) {
  const vault = getVaultPath();
  const dir = pagePath.split("/")[0];
  if (!ALLOWED_DIRS.includes(dir)) {
    throw new Error(`Invalid wiki path: ${pagePath}. Must start with: ${ALLOWED_DIRS.join(", ")}`);
  }
  if (!content || !content.trim()) {
    throw new Error("Wiki page content must not be empty");
  }

  const fullPath = path.join(vault, pagePath);
  ensureDir(path.dirname(fullPath));

  let finalContent;
  if (fs.existsSync(fullPath)) {
    const existing = fs.readFileSync(fullPath, "utf8");
    const { frontmatter } = parseFrontmatter(existing);
    const fm = generateFrontmatter({
      type: frontmatter.type || type,
      tags: frontmatter.tags || tags,
      summary: frontmatter.summary || summary,
      runId: frontmatter.run_id || runId
    });
    finalContent = fm + "\n## Update " + today() + "\n\n" + content;
  } else {
    finalContent = generateFrontmatter({ type, tags, summary, runId }) + content;
  }

  writeAtomic(fullPath, finalContent);
  updateIndex(pagePath, type, summary, tags);
  appendLog(`wrote ${pagePath}: ${summary || ""}`);
  return { path: pagePath, written: true };
}

function searchWiki({ query = "", type, limit = 10, includeBodies = false }) {
  const vault = getVaultPath();
  const indexPath = path.join(vault, "_index.md");
  if (!fs.existsSync(indexPath)) return { results: [], total: 0 };

  const lines = fs.readFileSync(indexPath, "utf8").split("\n").filter(l => l.startsWith("- "));
  let results = [];
  for (const line of lines) {
    const parts = line.slice(2).split(" | ");
    if (parts.length < 4) continue;
    const [entryType, entryPath, entrySummary, entryTags] = parts;
    results.push({
      type: entryType.trim(),
      path: entryPath.trim(),
      summary: entrySummary.trim().replace(/^"|"$/g, ""),
      tags: entryTags.trim().replace(/^\[|\]$/g, "").split(",").map(s => s.trim()).filter(Boolean)
    });
  }

  if (type) results = results.filter(r => r.type === type);
  if (query) {
    const q = query.toLowerCase();
    results = results.filter(r =>
      r.path.toLowerCase().includes(q) ||
      r.summary.toLowerCase().includes(q) ||
      r.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  const total = results.length;
  results = results.slice(0, Math.min(limit, 50));

  if (includeBodies) {
    results = results.map(r => {
      const fullPath = path.join(vault, r.path);
      let body = null;
      if (fs.existsSync(fullPath)) body = fs.readFileSync(fullPath, "utf8");
      return { ...r, content: body };
    });
  }

  return { results, total };
}

function ensureVault() {
  const vault = getVaultPath();
  for (const dir of ALLOWED_DIRS) ensureDir(path.join(vault, dir));
  const agentsPath = path.join(vault, "AGENTS.md");
  if (!fs.existsSync(agentsPath)) {
    const schema = [
      "# ResearchBrain Wiki Schema",
      "",
      "You maintain a Karpathy-style LLM wiki in this vault.",
      "",
      "## Directory structure",
      "- concepts/ — trading concepts, instruments, brokers, people (unified)",
      "- sources/ — one summary per ingested source",
      "- hypotheses/ — one page per hypothesis packet",
      "- hunches/ — free-form thoughts, timestamped",
      "- _raw/ — staging for rough captures",
      "- _index.md — master catalog (update on every write)",
      "- _log.md — append-only changelog",
      "",
      "## Write rules",
      "1. Every page MUST have YAML frontmatter with type, tags, summary, updated",
      '2. Use [[wikilinks]] for ALL cross-references',
      '3. When updating a page, READ existing first, then append with "## Update YYYY-MM-DD"',
      "4. If new info contradicts a page, flag with > [!contradiction]",
      "5. Append to _log.md on every write",
      "6. Update _index.md when adding a new page",
      "7. Hunches are okay with only one source",
      "8. Extract 3-5 key concepts per source, not 50",
      ""
    ].join("\n");
    writeAtomic(agentsPath, schema);
  }
}

function writeSourcePage({ runId, sourceCapture }) {
  const slug = (sourceCapture.url || "unknown").replace(/[^a-z0-9]+/gi, "-").slice(0, 60).toLowerCase();
  const pagePath = `sources/${today()}-${slug}.md`;
  return writeWikiPage({
    path: pagePath,
    type: "source",
    content: `Source: ${sourceCapture.url || ""}\n\n${sourceCapture.content || sourceCapture.title || ""}`,
    tags: sourceCapture.tags || [],
    summary: sourceCapture.title || sourceCapture.url || "source",
    runId
  });
}

function writeHypothesisPage({ runId, hypothesis }) {
  const slug = (hypothesis.mechanism || hypothesis.id || "hypothesis").replace(/[^a-z0-9]+/gi, "-").slice(0, 60).toLowerCase();
  const pagePath = `hypotheses/${slug}.md`;
  return writeWikiPage({
    path: pagePath,
    type: "hypothesis",
    content: `## Mechanism\n${hypothesis.mechanism || ""}\n\n## Prediction\n${hypothesis.falsifiable_prediction || ""}\n\n## Sources\n${(hypothesis.cited_source_ids || []).join(", ")}`,
    tags: hypothesis.tags || [],
    summary: hypothesis.mechanism || hypothesis.id || "hypothesis",
    runId
  });
}

export {
  writeWikiPage,
  searchWiki,
  ensureVault,
  writeSourcePage,
  writeHypothesisPage,
  getVaultPath
};
