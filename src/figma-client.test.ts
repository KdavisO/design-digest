import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sanitizeNode,
  filterWatchTargets,
  extractEditorsSince,
  checkVersionChanged,
  fetchNodesChunked,
} from "./figma-client.js";
import type { FigmaNode, FigmaFile, FigmaVersion } from "./figma-client.js";

describe("sanitizeNode", () => {
  it("removes noise keys", () => {
    const node = {
      id: "1",
      name: "Frame",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      absoluteRenderBounds: { x: 0, y: 0, width: 100, height: 100 },
      pluginData: { foo: "bar" },
      sharedPluginData: { baz: "qux" },
      exportSettings: [{}],
      reactions: [],
      scrollBehavior: "SCROLLS",
      fills: [{ type: "SOLID" }],
    };
    const result = sanitizeNode(node);
    expect(result).not.toHaveProperty("absoluteBoundingBox");
    expect(result).not.toHaveProperty("absoluteRenderBounds");
    expect(result).not.toHaveProperty("pluginData");
    expect(result).not.toHaveProperty("sharedPluginData");
    expect(result).not.toHaveProperty("exportSettings");
    expect(result).not.toHaveProperty("reactions");
    expect(result).not.toHaveProperty("scrollBehavior");
    expect(result).toHaveProperty("fills");
    expect(result).toHaveProperty("name");
  });

  it("recursively sanitizes children", () => {
    const node = {
      id: "1",
      name: "Parent",
      type: "FRAME",
      children: [
        {
          id: "2",
          name: "Child",
          type: "TEXT",
          absoluteBoundingBox: { x: 10, y: 10, width: 50, height: 20 },
          characters: "Hello",
        },
      ],
    };
    const result = sanitizeNode(node) as FigmaNode;
    const child = (result.children as FigmaNode[])[0];
    expect(child).not.toHaveProperty("absoluteBoundingBox");
    expect(child).toHaveProperty("characters", "Hello");
  });

  it("handles arrays", () => {
    const arr = [
      { absoluteBoundingBox: {}, name: "a" },
      { absoluteRenderBounds: {}, name: "b" },
    ];
    const result = sanitizeNode(arr);
    expect(result[0]).not.toHaveProperty("absoluteBoundingBox");
    expect(result[1]).not.toHaveProperty("absoluteRenderBounds");
  });

  it("handles null and primitives", () => {
    expect(sanitizeNode(null)).toBeNull();
    expect(sanitizeNode(42)).toBe(42);
    expect(sanitizeNode("hello")).toBe("hello");
  });
});

describe("filterWatchTargets", () => {
  const file: FigmaFile = {
    name: "Test File",
    lastModified: "2024-01-01",
    version: "1",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [
        { id: "1:0", name: "Home", type: "PAGE" },
        { id: "2:0", name: "Settings", type: "PAGE" },
        { id: "3:0", name: "Archive", type: "PAGE" },
      ],
    },
  };

  it("returns all pages when no filter specified", () => {
    const result = filterWatchTargets(file, []);
    expect(result).toHaveLength(3);
  });

  it("filters to specified pages", () => {
    const result = filterWatchTargets(file, ["Home", "Settings"]);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.name)).toEqual(["Home", "Settings"]);
  });

  it("handles non-matching page names", () => {
    const result = filterWatchTargets(file, ["NonExistent"]);
    expect(result).toHaveLength(0);
  });
});

describe("extractEditorsSince", () => {
  const makeVersion = (
    id: string,
    createdAt: string,
    userId: string,
    handle: string,
  ): FigmaVersion => ({
    id,
    created_at: createdAt,
    label: "",
    description: "",
    user: { id: userId, handle, img_url: `https://img.example.com/${userId}` },
  });

  it("returns editors after the given timestamp", () => {
    const versions: FigmaVersion[] = [
      makeVersion("v3", "2024-01-03T00:00:00Z", "u1", "Alice"),
      makeVersion("v2", "2024-01-02T00:00:00Z", "u2", "Bob"),
      makeVersion("v1", "2024-01-01T00:00:00Z", "u3", "Charlie"),
    ];
    const editors = extractEditorsSince(versions, "2024-01-01T12:00:00Z");
    expect(editors).toHaveLength(2);
    expect(editors.map((e) => e.handle)).toEqual(["Alice", "Bob"]);
  });

  it("deduplicates users", () => {
    const versions: FigmaVersion[] = [
      makeVersion("v3", "2024-01-03T00:00:00Z", "u1", "Alice"),
      makeVersion("v2", "2024-01-02T00:00:00Z", "u1", "Alice"),
    ];
    const editors = extractEditorsSince(versions, "2024-01-01T00:00:00Z");
    expect(editors).toHaveLength(1);
    expect(editors[0].handle).toBe("Alice");
  });

  it("returns empty array when no versions are after the timestamp", () => {
    const versions: FigmaVersion[] = [
      makeVersion("v1", "2024-01-01T00:00:00Z", "u1", "Alice"),
    ];
    const editors = extractEditorsSince(versions, "2024-01-02T00:00:00Z");
    expect(editors).toHaveLength(0);
  });

  it("returns empty array for empty versions list", () => {
    const editors = extractEditorsSince([], "2024-01-01T00:00:00Z");
    expect(editors).toHaveLength(0);
  });
});

describe("checkVersionChanged", () => {
  const makeVersion = (id: string): FigmaVersion => ({
    id,
    created_at: "2024-01-01T00:00:00Z",
    label: "",
    description: "",
    user: { id: "u1", handle: "Alice", img_url: "" },
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns changed=true when no previous version ID", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ versions: [makeVersion("v2")] }),
        { status: 200 },
      ),
    );

    const result = await checkVersionChanged("token", "fileKey", undefined);
    expect(result.changed).toBe(true);
    expect(result.latestVersionId).toBe("v2");
  });

  it("returns changed=false when version matches", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ versions: [makeVersion("v2")] }),
        { status: 200 },
      ),
    );

    const result = await checkVersionChanged("token", "fileKey", "v2");
    expect(result.changed).toBe(false);
  });

  it("returns changed=true when version differs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ versions: [makeVersion("v3")] }),
        { status: 200 },
      ),
    );

    const result = await checkVersionChanged("token", "fileKey", "v2");
    expect(result.changed).toBe(true);
    expect(result.latestVersionId).toBe("v3");
  });

  it("returns changed=true with undefined latestVersionId when versions list is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ versions: [] }),
        { status: 200 },
      ),
    );

    const result = await checkVersionChanged("token", "fileKey", "v1");
    expect(result.changed).toBe(true);
    expect(result.latestVersionId).toBeUndefined();
  });
});

describe("fetchNodesChunked", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockNodesResponse(nodes: Record<string, FigmaNode>) {
    const wrapped: Record<string, { document: FigmaNode }> = {};
    for (const [id, node] of Object.entries(nodes)) {
      wrapped[id] = { document: node };
    }
    return new Response(JSON.stringify({ nodes: wrapped }), { status: 200 });
  }

  it("fetches child nodes in batches", async () => {
    const parent: FigmaNode = {
      id: "1:0",
      name: "Page",
      type: "CANVAS",
      children: [
        { id: "1:1", name: "A", type: "FRAME" },
        { id: "1:2", name: "B", type: "FRAME" },
        { id: "1:3", name: "C", type: "FRAME" },
      ],
    };
    const childA: FigmaNode = { id: "1:1", name: "A", type: "FRAME", fills: [] };
    const childB: FigmaNode = { id: "1:2", name: "B", type: "FRAME", fills: [] };
    const childC: FigmaNode = { id: "1:3", name: "C", type: "FRAME", fills: [] };

    vi.spyOn(globalThis, "fetch")
      // depth=1 fetch for parent
      .mockResolvedValueOnce(mockNodesResponse({ "1:0": parent }))
      // batch 1: A, B (batchSize=2)
      .mockResolvedValueOnce(mockNodesResponse({ "1:1": childA, "1:2": childB }))
      // batch 2: C
      .mockResolvedValueOnce(mockNodesResponse({ "1:3": childC }));

    const result = await fetchNodesChunked("token", "fileKey", ["1:0"], undefined, 2);

    expect(result["1:0"]).toBeDefined();
    expect(result["1:0"].children).toHaveLength(3);
    expect(result["1:0"].children![0].name).toBe("A");
    expect(result["1:0"].children![2].name).toBe("C");
  });

  it("uses shallow result directly for leaf nodes (no extra fetch)", async () => {
    const leaf: FigmaNode = { id: "2:0", name: "Leaf", type: "TEXT" };

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      // depth=1 batch discovery
      .mockResolvedValueOnce(mockNodesResponse({ "2:0": leaf }));

    const result = await fetchNodesChunked("token", "fileKey", ["2:0"]);

    expect(result["2:0"].name).toBe("Leaf");
    // Only 1 fetch call (discovery), no extra re-fetch for leaf
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("passes depth-1 to child fetches", async () => {
    const parent: FigmaNode = {
      id: "1:0",
      name: "Page",
      type: "CANVAS",
      children: [{ id: "1:1", name: "A", type: "FRAME" }],
    };
    const childA: FigmaNode = { id: "1:1", name: "A", type: "FRAME" };

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockNodesResponse({ "1:0": parent }))
      .mockResolvedValueOnce(mockNodesResponse({ "1:1": childA }));

    await fetchNodesChunked("token", "fileKey", ["1:0"], 3, 10);

    // Second call should include depth=2 (parent depth 3 minus 1)
    const secondUrl = fetchSpy.mock.calls[1][0] as string;
    expect(secondUrl).toContain("depth=2");
  });

  it("passes depth=0 when parent depth is 1", async () => {
    const parent: FigmaNode = {
      id: "1:0",
      name: "Page",
      type: "CANVAS",
      children: [{ id: "1:1", name: "A", type: "FRAME" }],
    };
    const childA: FigmaNode = { id: "1:1", name: "A", type: "FRAME" };

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockNodesResponse({ "1:0": parent }))
      .mockResolvedValueOnce(mockNodesResponse({ "1:1": childA }));

    await fetchNodesChunked("token", "fileKey", ["1:0"], 1, 10);

    const secondUrl = fetchSpy.mock.calls[1][0] as string;
    expect(secondUrl).toContain("depth=0");
  });
});
