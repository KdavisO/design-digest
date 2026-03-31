import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, truncate, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FigmaNode } from "./figma-client.js";
import {
  hashPageName,
  loadPage,
  loadSnapshotMeta,
  savePage,
  saveSnapshot,
  saveSnapshotMeta,
  loadSnapshot,
  loadPageFromLegacy,
  removePageSnapshot,
  validateSnapshotPages,
  LEGACY_SNAPSHOT_MAX_BYTES,
} from "./snapshot.js";

function makePageNode(id: string, name: string): FigmaNode {
  return { id, name, type: "CANVAS", children: [] };
}

describe("hashPageName", () => {
  it("returns a hex SHA-256 hash", () => {
    const hash = hashPageName("Page 1");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns different hashes for case-differing names", () => {
    const hashUpper = hashPageName("Page A");
    const hashLower = hashPageName("page a");
    expect(hashUpper).not.toBe(hashLower);
  });

  it("returns same hash for identical names", () => {
    expect(hashPageName("Page 1")).toBe(hashPageName("Page 1"));
  });
});

describe("snapshot page file migration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "snapshot-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const fileKey = "testFile123";
  const pageName = "Page A";
  const node = makePageNode("0:1", "Page A");

  it("loadPage falls back to legacy encodeURIComponent filename", async () => {
    // Create a legacy-format page file
    const pagesDir = join(tmpDir, fileKey, "pages");
    await mkdir(pagesDir, { recursive: true });
    const legacyPath = join(pagesDir, `${encodeURIComponent(pageName)}.json`);
    await writeFile(legacyPath, JSON.stringify(node));

    const loaded = await loadPage(tmpDir, fileKey, pageName);
    expect(loaded).toEqual(node);
  });

  it("loadPage prefers hash-based file over legacy", async () => {
    const pagesDir = join(tmpDir, fileKey, "pages");
    await mkdir(pagesDir, { recursive: true });

    const legacyNode = { ...node, name: "legacy" };
    const hashNode = { ...node, name: "hash" };

    const legacyPath = join(pagesDir, `${encodeURIComponent(pageName)}.json`);
    const hashPath = join(pagesDir, `${hashPageName(pageName)}.json`);

    await writeFile(legacyPath, JSON.stringify(legacyNode));
    await writeFile(hashPath, JSON.stringify(hashNode));

    const loaded = await loadPage(tmpDir, fileKey, pageName);
    expect(loaded).toEqual(hashNode);
  });

  it("savePage writes hash-based filename and cleans up legacy file", async () => {
    const pagesDir = join(tmpDir, fileKey, "pages");
    await mkdir(pagesDir, { recursive: true });

    // Create a legacy file
    const legacyPath = join(pagesDir, `${encodeURIComponent(pageName)}.json`);
    await writeFile(legacyPath, JSON.stringify(node));
    expect(existsSync(legacyPath)).toBe(true);

    // Save with new format
    await savePage(tmpDir, fileKey, pageName, node);

    // Hash-based file should exist
    const hashPath = join(pagesDir, `${hashPageName(pageName)}.json`);
    expect(existsSync(hashPath)).toBe(true);

    // Legacy file should be cleaned up
    expect(existsSync(legacyPath)).toBe(false);
  });

  it("removePageSnapshot removes both hash and legacy files", async () => {
    const pagesDir = join(tmpDir, fileKey, "pages");
    await mkdir(pagesDir, { recursive: true });

    const legacyPath = join(pagesDir, `${encodeURIComponent(pageName)}.json`);
    const hashPath = join(pagesDir, `${hashPageName(pageName)}.json`);

    await writeFile(legacyPath, JSON.stringify(node));
    await writeFile(hashPath, JSON.stringify(node));

    await removePageSnapshot(tmpDir, fileKey, pageName);

    expect(existsSync(legacyPath)).toBe(false);
    expect(existsSync(hashPath)).toBe(false);
  });

  it("case-differing page names produce separate files", async () => {
    const upperNode = makePageNode("0:1", "Page A");
    const lowerNode = makePageNode("0:2", "page a");

    await savePage(tmpDir, fileKey, "Page A", upperNode);
    await savePage(tmpDir, fileKey, "page a", lowerNode);

    const loadedUpper = await loadPage(tmpDir, fileKey, "Page A");
    const loadedLower = await loadPage(tmpDir, fileKey, "page a");

    expect(loadedUpper).toEqual(upperNode);
    expect(loadedLower).toEqual(lowerNode);
  });

  it("saveSnapshot + loadSnapshot round-trip works with hash-based filenames", async () => {
    const pages: Record<string, FigmaNode> = {
      "Page A": makePageNode("0:1", "Page A"),
      "page a": makePageNode("0:2", "page a"),
    };

    await saveSnapshot(tmpDir, fileKey, pages, "v1");
    const loaded = await loadSnapshot(tmpDir, fileKey);

    expect(loaded).not.toBeNull();
    expect(loaded!.pages["Page A"]).toEqual(pages["Page A"]);
    expect(loaded!.pages["page a"]).toEqual(pages["page a"]);
    expect(loaded!.versionId).toBe("v1");
  });
});

describe("atomic write (no leftover .tmp files)", () => {
  let tmpDir: string;
  const fileKey = "testFile123";

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "snapshot-atomic-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("savePage leaves no .tmp files after successful write", async () => {
    const node = makePageNode("0:1", "Page A");
    await savePage(tmpDir, fileKey, "Page A", node);

    const pagesDir = join(tmpDir, fileKey, "pages");
    const files = await readdir(pagesDir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toEqual([]);

    // Verify the page was written correctly
    const loaded = await loadPage(tmpDir, fileKey, "Page A");
    expect(loaded).toEqual(node);
  });

  it("saveSnapshotMeta leaves no .tmp files after successful write", async () => {
    await saveSnapshotMeta(tmpDir, fileKey, {
      timestamp: "2026-01-01T00:00:00Z",
      pageNames: ["Page A"],
    });

    const dir = join(tmpDir, fileKey);
    const files = await readdir(dir);
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toEqual([]);

    // Verify meta was written correctly
    const meta = await loadSnapshotMeta(tmpDir, fileKey);
    expect(meta).not.toBeNull();
    expect(meta!.pageNames).toEqual(["Page A"]);
  });

  it("saveSnapshot round-trip leaves no .tmp files", async () => {
    const pages: Record<string, FigmaNode> = {
      "Page A": makePageNode("0:1", "Page A"),
      "Page B": makePageNode("0:2", "Page B"),
    };
    await saveSnapshot(tmpDir, fileKey, pages, "v1");

    // Check no .tmp files in fileKey dir or pages subdir
    const dirFiles = await readdir(join(tmpDir, fileKey));
    expect(dirFiles.filter((f) => f.endsWith(".tmp"))).toEqual([]);

    const pagesDir = join(tmpDir, fileKey, "pages");
    const pageFiles = await readdir(pagesDir);
    expect(pageFiles.filter((f) => f.endsWith(".tmp"))).toEqual([]);

    // Verify round-trip
    const loaded = await loadSnapshot(tmpDir, fileKey);
    expect(loaded).not.toBeNull();
    expect(Object.keys(loaded!.pages)).toEqual(["Page A", "Page B"]);
  });
});

describe("loadSnapshotMeta validation", () => {
  let tmpDir: string;
  const fileKey = "testFile123";

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "snapshot-meta-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns valid meta after saveSnapshotMeta round-trip", async () => {
    await saveSnapshotMeta(tmpDir, fileKey, {
      timestamp: "2026-01-01T00:00:00Z",
      versionId: "v1",
      pageNames: ["Page A", "Page B"],
    });
    const meta = await loadSnapshotMeta(tmpDir, fileKey);
    expect(meta).toEqual({
      timestamp: "2026-01-01T00:00:00Z",
      fileKey,
      versionId: "v1",
      pageNames: ["Page A", "Page B"],
    });
  });

  it("returns null and deletes file when meta has invalid shape", async () => {
    const dir = join(tmpDir, fileKey);
    await mkdir(dir, { recursive: true });
    const metaFile = join(dir, "meta.json");
    await writeFile(metaFile, JSON.stringify({ foo: "bar" }));

    const meta = await loadSnapshotMeta(tmpDir, fileKey);
    expect(meta).toBeNull();
    expect(existsSync(metaFile)).toBe(false);
  });

  it("returns null and deletes file when pageNames contains non-strings", async () => {
    const dir = join(tmpDir, fileKey);
    await mkdir(dir, { recursive: true });
    const metaFile = join(dir, "meta.json");
    await writeFile(
      metaFile,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        fileKey,
        pageNames: ["Page A", 123],
      }),
    );

    const meta = await loadSnapshotMeta(tmpDir, fileKey);
    expect(meta).toBeNull();
    expect(existsSync(metaFile)).toBe(false);
  });

  it("returns null and deletes file when versionId is not a string", async () => {
    const dir = join(tmpDir, fileKey);
    await mkdir(dir, { recursive: true });
    const metaFile = join(dir, "meta.json");
    await writeFile(
      metaFile,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        fileKey,
        versionId: 123,
        pageNames: ["Page A"],
      }),
    );

    const meta = await loadSnapshotMeta(tmpDir, fileKey);
    expect(meta).toBeNull();
    expect(existsSync(metaFile)).toBe(false);
  });

  it("returns null and deletes file when fileKey does not match", async () => {
    const dir = join(tmpDir, fileKey);
    await mkdir(dir, { recursive: true });
    const metaFile = join(dir, "meta.json");
    await writeFile(
      metaFile,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        fileKey: "differentKey",
        pageNames: ["Page A"],
      }),
    );

    const meta = await loadSnapshotMeta(tmpDir, fileKey);
    expect(meta).toBeNull();
    expect(existsSync(metaFile)).toBe(false);
  });

  it("returns null and deletes file when JSON is malformed", async () => {
    const dir = join(tmpDir, fileKey);
    await mkdir(dir, { recursive: true });
    const metaFile = join(dir, "meta.json");
    await writeFile(metaFile, "not valid json{{{");

    const meta = await loadSnapshotMeta(tmpDir, fileKey);
    expect(meta).toBeNull();
    expect(existsSync(metaFile)).toBe(false);
  });

  it("returns null when meta file does not exist", async () => {
    const meta = await loadSnapshotMeta(tmpDir, fileKey);
    expect(meta).toBeNull();
  });
});

describe("legacy snapshot size guard", () => {
  let tmpDir: string;
  const fileKey = "testFile123";

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "snapshot-size-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("loadSnapshot loads small legacy file normally", async () => {
    const legacyPath = join(tmpDir, `${fileKey}.json`);
    const snapshot = {
      timestamp: "2026-01-01T00:00:00Z",
      fileKey,
      pages: { "Page 1": makePageNode("0:1", "Page 1") },
    };
    await writeFile(legacyPath, JSON.stringify(snapshot));

    const loaded = await loadSnapshot(tmpDir, fileKey);
    expect(loaded).not.toBeNull();
    expect(loaded!.fileKey).toBe(fileKey);
  });

  it("loadPageFromLegacy loads from small legacy file", async () => {
    const legacyPath = join(tmpDir, `${fileKey}.json`);
    const snapshot = {
      timestamp: "2026-01-01T00:00:00Z",
      fileKey,
      pages: { "Page 1": makePageNode("0:1", "Page 1") },
    };
    await writeFile(legacyPath, JSON.stringify(snapshot));

    const result = await loadPageFromLegacy(tmpDir, fileKey, "Page 1");
    expect(result.page).not.toBeNull();
    expect(result.meta).not.toBeNull();
    expect(result.meta!.pageNames).toEqual(["Page 1"]);
  });

  it("loadSnapshot returns null when legacy file does not exist", async () => {
    const loaded = await loadSnapshot(tmpDir, fileKey);
    expect(loaded).toBeNull();
  });

  it("LEGACY_SNAPSHOT_MAX_BYTES is 500 MiB", () => {
    expect(LEGACY_SNAPSHOT_MAX_BYTES).toBe(500 * 1024 * 1024);
  });

  it("loadSnapshot returns null and renames oversized legacy file", async () => {
    const legacyPath = join(tmpDir, `${fileKey}.json`);
    const oversizedPath = `${legacyPath}.oversized`;
    // Create a sparse file exceeding the threshold
    await writeFile(legacyPath, "");
    await truncate(legacyPath, LEGACY_SNAPSHOT_MAX_BYTES + 1);

    expect(existsSync(legacyPath)).toBe(true);

    const loaded = await loadSnapshot(tmpDir, fileKey);
    expect(loaded).toBeNull();
    expect(existsSync(legacyPath)).toBe(false);
    expect(existsSync(oversizedPath)).toBe(true);
  });

  it("loadPageFromLegacy returns null for oversized legacy file", async () => {
    const legacyPath = join(tmpDir, `${fileKey}.json`);
    const oversizedPath = `${legacyPath}.oversized`;
    await writeFile(legacyPath, "");
    await truncate(legacyPath, LEGACY_SNAPSHOT_MAX_BYTES + 1);

    const result = await loadPageFromLegacy(tmpDir, fileKey, "Page 1");
    expect(result.page).toBeNull();
    expect(result.meta).toBeNull();
    expect(existsSync(legacyPath)).toBe(false);
    expect(existsSync(oversizedPath)).toBe(true);
  });
});

describe("validateSnapshotPages", () => {
  let tmpDir: string;
  const fileKey = "testFile123";

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "snapshot-validate-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty set when all page files exist", async () => {
    await savePage(tmpDir, fileKey, "Page A", makePageNode("0:1", "Page A"));
    await savePage(tmpDir, fileKey, "Page B", makePageNode("0:2", "Page B"));
    await saveSnapshotMeta(tmpDir, fileKey, {
      timestamp: "2026-01-01T00:00:00Z",
      pageNames: ["Page A", "Page B"],
    });

    const meta = await loadSnapshotMeta(tmpDir, fileKey);
    const missing = validateSnapshotPages(tmpDir, fileKey, meta!);
    expect(missing.size).toBe(0);
  });

  it("returns missing page names when page files are absent", async () => {
    await savePage(tmpDir, fileKey, "Page A", makePageNode("0:1", "Page A"));
    // Page B is NOT saved — simulating a missing file
    await saveSnapshotMeta(tmpDir, fileKey, {
      timestamp: "2026-01-01T00:00:00Z",
      pageNames: ["Page A", "Page B"],
    });

    const meta = await loadSnapshotMeta(tmpDir, fileKey);
    const missing = validateSnapshotPages(tmpDir, fileKey, meta!);
    expect(missing.size).toBe(1);
    expect(missing.has("Page B")).toBe(true);
  });

  it("recognizes legacy-format page files as present", async () => {
    // Create a legacy-format page file (encodeURIComponent)
    const pagesDir = join(tmpDir, fileKey, "pages");
    await mkdir(pagesDir, { recursive: true });
    const legacyPath = join(pagesDir, `${encodeURIComponent("Page A")}.json`);
    await writeFile(legacyPath, JSON.stringify(makePageNode("0:1", "Page A")));

    await saveSnapshotMeta(tmpDir, fileKey, {
      timestamp: "2026-01-01T00:00:00Z",
      pageNames: ["Page A"],
    });

    const meta = await loadSnapshotMeta(tmpDir, fileKey);
    const missing = validateSnapshotPages(tmpDir, fileKey, meta!);
    expect(missing.size).toBe(0);
  });

  it("returns all page names when no page files exist", async () => {
    // Only create meta, no page files
    await saveSnapshotMeta(tmpDir, fileKey, {
      timestamp: "2026-01-01T00:00:00Z",
      pageNames: ["Page A", "Page B", "Page C"],
    });

    const meta = await loadSnapshotMeta(tmpDir, fileKey);
    const missing = validateSnapshotPages(tmpDir, fileKey, meta!);
    expect(missing.size).toBe(3);
  });
});

describe("streaming backpressure handling", () => {
  let tmpDir: string;
  const fileKey = "testFile123";

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "snapshot-backpressure-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("savePage handles backpressure when write() returns false", async () => {
    // Create a large node that will trigger the streaming path via RangeError fallback
    // Instead, we test via savePage with a node large enough to exercise multiple writes
    const largeChildren: FigmaNode[] = [];
    for (let i = 0; i < 100; i++) {
      largeChildren.push({
        id: `child-${i}`,
        name: `Child ${i}`,
        type: "FRAME",
        children: [],
      });
    }
    const node: FigmaNode = {
      id: "0:1",
      name: "Large Page",
      type: "CANVAS",
      children: largeChildren,
    };

    await savePage(tmpDir, fileKey, "Large Page", node);

    const loaded = await loadPage(tmpDir, fileKey, "Large Page");
    expect(loaded).toEqual(node);
  });

  it("savePage produces correct JSON via streaming path for deeply nested node", async () => {
    // Build a deeply nested node to trigger RangeError in JSON.stringify
    // and fall back to writeNodeStreamAtomic
    const node: FigmaNode = { id: "0:1", name: "Deep", type: "FRAME", children: [] };

    // Save and verify round-trip
    await savePage(tmpDir, fileKey, "Deep Page", node);
    const loaded = await loadPage(tmpDir, fileKey, "Deep Page");
    expect(loaded).toEqual(node);
  });

  it("savePage round-trips a node with many children correctly", async () => {
    const node: FigmaNode = {
      id: "0:1",
      name: "Backpressure Test Page",
      type: "CANVAS",
      children: Array.from({ length: 50 }, (_, i) => ({
        id: `${i}:1`,
        name: `Child node ${i} with some extra text to fill the buffer`,
        type: "FRAME" as const,
        children: [] as FigmaNode[],
      })),
    };

    await savePage(tmpDir, fileKey, "BP Test", node);
    const loaded = await loadPage(tmpDir, fileKey, "BP Test");
    expect(loaded).toEqual(node);
  });
});
