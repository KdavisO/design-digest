import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
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
  removePageSnapshot,
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
