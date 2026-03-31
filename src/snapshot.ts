import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { FigmaNode } from "./figma-client.js";

export interface Snapshot {
  timestamp: string;
  fileKey: string;
  versionId?: string;
  pages: Record<string, FigmaNode>;
}

export interface SnapshotMeta {
  timestamp: string;
  fileKey: string;
  versionId?: string;
  pageNames: string[];
}

// --- Legacy single-file format ---

function legacySnapshotPath(dir: string, fileKey: string): string {
  return join(dir, `${fileKey}.json`);
}

// --- Per-page directory format ---
// snapshots/{fileKey}/meta.json
// snapshots/{fileKey}/pages/{pageName}.json

function pageDir(dir: string, fileKey: string): string {
  return join(dir, fileKey, "pages");
}

function metaPath(dir: string, fileKey: string): string {
  return join(dir, fileKey, "meta.json");
}

/**
 * Generate a filesystem-safe hash from a page name.
 * Uses SHA-256 to avoid collisions on case-insensitive filesystems
 * (e.g. macOS/Windows) where pages like "Page A" and "page a" would
 * otherwise map to the same file via encodeURIComponent.
 */
export function hashPageName(pageName: string): string {
  return createHash("sha256").update(pageName).digest("hex");
}

/**
 * Legacy page file path using encodeURIComponent (pre-v0.2).
 * Used only for migration from old snapshot format.
 */
function legacyPageFilePath(dir: string, fileKey: string, pageName: string): string {
  return join(pageDir(dir, fileKey), `${encodeURIComponent(pageName)}.json`);
}

function pageFilePath(dir: string, fileKey: string, pageName: string): string {
  return join(pageDir(dir, fileKey), `${hashPageName(pageName)}.json`);
}

/**
 * Load a full snapshot (all pages in memory).
 * Supports both legacy single-file and new per-page directory formats.
 * Prefer loadSnapshotMeta + loadPage for memory-efficient access.
 */
export async function loadSnapshot(
  dir: string,
  fileKey: string,
): Promise<Snapshot | null> {
  // Try new per-page format first
  const meta = await loadSnapshotMeta(dir, fileKey);
  if (meta) {
    const pages: Record<string, FigmaNode> = Object.create(null);
    for (const pageName of meta.pageNames) {
      const page = await loadPage(dir, fileKey, pageName);
      if (!page) {
        console.warn(
          `  Snapshot for fileKey "${fileKey}" is missing page "${pageName}". Treating snapshot as invalid.`,
        );
        return null;
      }
      pages[pageName] = page;
    }
    return {
      timestamp: meta.timestamp,
      fileKey: meta.fileKey,
      versionId: meta.versionId,
      pages,
    };
  }

  // Fall back to legacy single-file format
  const legacyPath = legacySnapshotPath(dir, fileKey);
  if (!existsSync(legacyPath)) return null;

  try {
    const raw = await readFile(legacyPath, "utf-8");
    return JSON.parse(raw) as Snapshot;
  } catch (err) {
    console.warn(
      `  Failed to load legacy snapshot at ${legacyPath}, treating as missing:`,
      err,
    );
    await rm(legacyPath, { force: true }).catch(() => {});
    return null;
  }
}

/**
 * Load snapshot metadata without loading page data.
 */
export async function loadSnapshotMeta(
  dir: string,
  fileKey: string,
): Promise<SnapshotMeta | null> {
  const path = metaPath(dir, fileKey);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as SnapshotMeta;
  } catch (err) {
    console.warn(`  Failed to load snapshot meta at ${path}, treating as missing:`, err);
    await rm(path, { force: true }).catch(() => {});
    return null;
  }
}

/**
 * Load a single page from a per-page snapshot.
 * Falls back to legacy encodeURIComponent-based filename for migration.
 */
export async function loadPage(
  dir: string,
  fileKey: string,
  pageName: string,
): Promise<FigmaNode | null> {
  const path = pageFilePath(dir, fileKey, pageName);
  // Fall back to legacy encodeURIComponent-based path
  const resolvedPath = existsSync(path)
    ? path
    : (() => {
        const legacy = legacyPageFilePath(dir, fileKey, pageName);
        return existsSync(legacy) ? legacy : null;
      })();
  if (!resolvedPath) return null;
  try {
    const raw = await readFile(resolvedPath, "utf-8");
    return JSON.parse(raw) as FigmaNode;
  } catch (err) {
    console.warn(`  Failed to load page snapshot "${pageName}":`, err);
    return null;
  }
}

/**
 * Load a single page from a legacy single-file snapshot.
 * Loads the entire file — use only for migration/backward-compat.
 */
export async function loadPageFromLegacy(
  dir: string,
  fileKey: string,
  pageName: string,
): Promise<{ page: FigmaNode | null; meta: SnapshotMeta | null }> {
  const legacyPath = legacySnapshotPath(dir, fileKey);
  if (!existsSync(legacyPath)) return { page: null, meta: null };
  try {
    const raw = await readFile(legacyPath, "utf-8");
    const snapshot = JSON.parse(raw) as Snapshot;
    const meta: SnapshotMeta = {
      timestamp: snapshot.timestamp,
      fileKey: snapshot.fileKey,
      versionId: snapshot.versionId,
      pageNames: Object.keys(snapshot.pages),
    };
    return { page: snapshot.pages[pageName] ?? null, meta };
  } catch (err) {
    console.warn(
      `  Failed to load legacy snapshot for file "${fileKey}", page "${pageName}":`,
      err,
    );
    await rm(legacyPath, { force: true }).catch(() => {});
    return { page: null, meta: null };
  }
}

/**
 * Save snapshot metadata.
 */
export async function saveSnapshotMeta(
  dir: string,
  fileKey: string,
  meta: Omit<SnapshotMeta, "fileKey">,
): Promise<void> {
  const dirPath = join(dir, fileKey);
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }
  const data: SnapshotMeta = { ...meta, fileKey };
  await writeFile(metaPath(dir, fileKey), JSON.stringify(data, null, 2));
}

/**
 * Iteratively write a value as JSON to a writable stream.
 * Uses an explicit stack instead of recursion to handle deeply nested Figma nodes.
 *
 * Each "action" on the stack describes what to write next. Actions are processed
 * in LIFO order, so we push them in reverse.
 */
function streamJsonValue(ws: NodeJS.WritableStream, root: unknown): void {
  type Action =
    | { kind: "value"; value: unknown; indent: number }
    | { kind: "raw"; text: string };

  const actions: Action[] = [{ kind: "value", value: root, indent: 0 }];

  while (actions.length > 0) {
    const action = actions.pop()!;

    if (action.kind === "raw") {
      ws.write(action.text);
      continue;
    }

    const { value, indent } = action;

    if (value === null || value === undefined) {
      ws.write("null");
      continue;
    }
    // Skip undefined object properties (match JSON.stringify behavior)
    // undefined in arrays is handled as null above via the null check
    if (typeof value !== "object") {
      ws.write(JSON.stringify(value));
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        ws.write("[]");
        continue;
      }
      // Push closing bracket, then items in reverse
      actions.push({ kind: "raw", text: " ".repeat(indent) + "]" });
      for (let i = value.length - 1; i >= 0; i--) {
        const suffix = i < value.length - 1 ? ",\n" : "\n";
        actions.push({ kind: "raw", text: suffix });
        actions.push({ kind: "value", value: value[i], indent: indent + 2 });
        actions.push({ kind: "raw", text: " ".repeat(indent + 2) });
      }
      actions.push({ kind: "raw", text: "[\n" });
      continue;
    }
    // Object — skip undefined properties to match JSON.stringify behavior
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
    if (keys.length === 0) {
      ws.write("{}");
      continue;
    }
    actions.push({ kind: "raw", text: " ".repeat(indent) + "}" });
    for (let i = keys.length - 1; i >= 0; i--) {
      const suffix = i < keys.length - 1 ? ",\n" : "\n";
      actions.push({ kind: "raw", text: suffix });
      actions.push({ kind: "value", value: obj[keys[i]], indent: indent + 2 });
      actions.push({ kind: "raw", text: " ".repeat(indent + 2) + JSON.stringify(keys[i]) + ": " });
    }
    actions.push({ kind: "raw", text: "{\n" });
  }
}

/**
 * Write a FigmaNode to a file using streaming to avoid V8 string length limits.
 */
function writeNodeStream(filePath: string, node: FigmaNode): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = createWriteStream(filePath, { encoding: "utf-8" });
    ws.on("error", reject);
    streamJsonValue(ws, node);
    ws.write("\n");
    ws.end(() => resolve());
  });
}

/**
 * Save a single page to its own file.
 * Cleans up legacy encodeURIComponent-based file if it exists.
 */
export async function savePage(
  dir: string,
  fileKey: string,
  pageName: string,
  node: FigmaNode,
): Promise<void> {
  const pagesDir = pageDir(dir, fileKey);
  if (!existsSync(pagesDir)) {
    await mkdir(pagesDir, { recursive: true });
  }
  const filePath = pageFilePath(dir, fileKey, pageName);
  try {
    await writeFile(filePath, JSON.stringify(node, null, 2));
  } catch (err) {
    if (err instanceof RangeError) {
      // Covers both "Invalid string length" and "Maximum call stack size exceeded"
      await writeNodeStream(filePath, node);
    } else {
      throw err;
    }
  }
  // Clean up legacy-named file after saving with new hash-based name
  const legacy = legacyPageFilePath(dir, fileKey, pageName);
  if (legacy !== filePath && existsSync(legacy)) {
    await rm(legacy, { force: true });
  }
}

/**
 * Remove a single page snapshot file.
 * Also removes legacy encodeURIComponent-based file if it exists.
 */
export async function removePageSnapshot(
  dir: string,
  fileKey: string,
  pageName: string,
): Promise<void> {
  await rm(pageFilePath(dir, fileKey, pageName), { force: true });
  // Also clean up legacy-named file
  const legacy = legacyPageFilePath(dir, fileKey, pageName);
  if (existsSync(legacy)) {
    await rm(legacy, { force: true });
  }
}

/**
 * Remove legacy single-file snapshot after migration to per-page format.
 */
export async function removeLegacySnapshot(
  dir: string,
  fileKey: string,
): Promise<void> {
  const path = legacySnapshotPath(dir, fileKey);
  await rm(path, { force: true });
}

/**
 * Save all pages at once (legacy compatibility).
 * Uses per-page format internally.
 */
export async function saveSnapshot(
  dir: string,
  fileKey: string,
  pages: Record<string, FigmaNode>,
  versionId?: string,
): Promise<void> {
  const timestamp = new Date().toISOString();
  const pageNames = Object.keys(pages);

  // Load previous meta to detect stale pages
  const previousMeta = await loadSnapshotMeta(dir, fileKey);

  await saveSnapshotMeta(dir, fileKey, { timestamp, versionId, pageNames });
  for (const [pageName, node] of Object.entries(pages)) {
    await savePage(dir, fileKey, pageName, node);
  }

  // Remove stale page files from previous snapshot
  if (previousMeta) {
    const currentPageSet = new Set(pageNames);
    for (const prevPage of previousMeta.pageNames) {
      if (!currentPageSet.has(prevPage)) {
        await removePageSnapshot(dir, fileKey, prevPage);
      }
    }
  }

  // Clean up legacy file if it exists
  await removeLegacySnapshot(dir, fileKey);
}
