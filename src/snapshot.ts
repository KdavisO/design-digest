import { readFile, writeFile, mkdir, rm, stat, rename } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { FigmaNode } from "./figma-client.js";

/** Maximum legacy snapshot file size in bytes (500 MiB). Files exceeding this are renamed aside to prevent OOM. */
export const LEGACY_SNAPSHOT_MAX_BYTES = 500 * 1024 * 1024;

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

/**
 * Check if a legacy snapshot file exceeds the size threshold.
 * If it does, rename it aside (`.oversized`) and warn.
 * Returns true if the file is safe to read, false if skipped.
 */
async function checkLegacyFileSize(path: string): Promise<boolean> {
  try {
    const st = await stat(path);
    if (st.size > LEGACY_SNAPSHOT_MAX_BYTES) {
      const mib = (st.size / (1024 * 1024)).toFixed(1);
      const limitMib = (LEGACY_SNAPSHOT_MAX_BYTES / (1024 * 1024)).toFixed(0);
      const asideBase = `${path}.oversized`;
      let aside = asideBase;
      if (existsSync(aside)) {
        aside = `${asideBase}.${Date.now()}`;
      }
      console.warn(
        `  Legacy snapshot ${path} is ${mib} MiB (limit: ${limitMib} MiB). Renaming to ${aside} to prevent OOM.`,
      );
      try {
        await rename(path, aside);
      } catch (renameErr) {
        console.warn(`  Failed to rename oversized legacy snapshot ${path}:`, renameErr);
      }
      return false;
    }
    return true;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error?.code === "ENOENT") {
      return false;
    }
    console.warn(`  Failed to check legacy snapshot file size for ${path}:`, error);
    return false;
  }
}

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

  if (!(await checkLegacyFileSize(legacyPath))) return null;

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

function isValidSnapshotMeta(data: unknown): data is SnapshotMeta {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.timestamp === "string" &&
    typeof obj.fileKey === "string" &&
    Array.isArray(obj.pageNames) &&
    obj.pageNames.every((p: unknown) => typeof p === "string") &&
    (!("versionId" in obj) ||
      obj.versionId === undefined ||
      typeof obj.versionId === "string")
  );
}

/**
 * Validate that all page files listed in a SnapshotMeta actually exist on disk.
 * Returns the set of page names whose files are missing.
 */
export function validateSnapshotPages(
  dir: string,
  fileKey: string,
  meta: SnapshotMeta,
): Set<string> {
  const missing = new Set<string>();
  for (const pageName of meta.pageNames) {
    const path = pageFilePath(dir, fileKey, pageName);
    if (existsSync(path)) continue;
    // Check legacy path as well
    const legacy = legacyPageFilePath(dir, fileKey, pageName);
    if (!existsSync(legacy)) {
      missing.add(pageName);
    }
  }
  return missing;
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
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSnapshotMeta(parsed)) {
      console.warn(`  Invalid snapshot meta shape at ${path}, removing corrupt file`);
      await rm(path, { force: true }).catch(() => {});
      return null;
    }
    if (parsed.fileKey !== fileKey) {
      console.warn(`  Snapshot meta fileKey mismatch at ${path} (expected ${fileKey}, got ${parsed.fileKey}), removing`);
      await rm(path, { force: true }).catch(() => {});
      return null;
    }
    return parsed;
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
  if (!(await checkLegacyFileSize(legacyPath))) return { page: null, meta: null };
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
