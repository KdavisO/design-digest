import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sanitizeNode,
  filterWatchTargets,
  extractEditorsSince,
  checkVersionChanged,
  fetchNodesChunked,
  countShallowChildren,
  adaptiveBatchSize,
  fetchFileProactive,
  fetchNodesProactive,
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

  it("uses discovery result directly when depth=1 (no child refetch)", async () => {
    const parent: FigmaNode = {
      id: "1:0",
      name: "Page",
      type: "CANVAS",
      children: [{ id: "1:1", name: "A", type: "FRAME" }],
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockNodesResponse({ "1:0": parent }));

    const result = await fetchNodesChunked("token", "fileKey", ["1:0"], 1, 10);

    // Only 1 fetch call (discovery), children from shallow result used directly
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result["1:0"].children).toHaveLength(1);
  });
});

describe("countShallowChildren", () => {
  it("counts children across multiple nodes", () => {
    const nodes: FigmaNode[] = [
      { id: "1:0", name: "A", type: "CANVAS", children: [
        { id: "1:1", name: "C1", type: "FRAME" },
        { id: "1:2", name: "C2", type: "FRAME" },
      ]},
      { id: "2:0", name: "B", type: "CANVAS", children: [
        { id: "2:1", name: "C3", type: "FRAME" },
      ]},
    ];
    expect(countShallowChildren(nodes)).toBe(3);
  });

  it("returns 0 for nodes without children", () => {
    const nodes: FigmaNode[] = [
      { id: "1:0", name: "Leaf", type: "TEXT" },
    ];
    expect(countShallowChildren(nodes)).toBe(0);
  });
});

describe("adaptiveBatchSize", () => {
  it("returns base batch size for small child counts", () => {
    expect(adaptiveBatchSize(5, 10)).toBe(10);
    expect(adaptiveBatchSize(10, 10)).toBe(10);
  });

  it("caps at 5 for medium child counts", () => {
    expect(adaptiveBatchSize(30, 10)).toBe(5);
    expect(adaptiveBatchSize(50, 10)).toBe(5);
  });

  it("caps at 3 for large child counts", () => {
    expect(adaptiveBatchSize(100, 10)).toBe(3);
    expect(adaptiveBatchSize(200, 10)).toBe(3);
  });

  it("caps at 2 for very large child counts", () => {
    expect(adaptiveBatchSize(300, 10)).toBe(2);
    expect(adaptiveBatchSize(500, 10)).toBe(2);
  });

  it("respects base batch size when it is already small", () => {
    expect(adaptiveBatchSize(100, 2)).toBe(2);
    expect(adaptiveBatchSize(30, 3)).toBe(3);
  });
});

describe("fetchFileProactive", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function mockFileResponse(file: FigmaFile) {
    return new Response(JSON.stringify(file), { status: 200 });
  }

  function mockNodesResponse(nodes: Record<string, FigmaNode>) {
    const wrapped: Record<string, { document: FigmaNode }> = {};
    for (const [id, node] of Object.entries(nodes)) {
      wrapped[id] = { document: node };
    }
    return new Response(JSON.stringify({ nodes: wrapped }), { status: 200 });
  }

  it("fetches small pages in a single request without chunking", async () => {
    const shallowFile: FigmaFile = {
      name: "Test",
      lastModified: "2024-01-01",
      version: "1",
      document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        children: [
          { id: "1:0", name: "Page1", type: "CANVAS", children: [
            { id: "1:1", name: "Frame", type: "FRAME" },
          ]},
        ],
      },
    };
    const fullPage: FigmaNode = {
      id: "1:0", name: "Page1", type: "CANVAS",
      children: [{ id: "1:1", name: "Frame", type: "FRAME", fills: [] }],
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFileResponse(shallowFile)) // depth=1 file fetch
      .mockResolvedValueOnce(mockNodesResponse({ "1:0": fullPage })); // small pages fetch

    const { pages, chunkedPages } = await fetchFileProactive("token", "fileKey", [], undefined, 5);

    expect(Object.keys(pages)).toEqual(["Page1"]);
    expect(chunkedPages).toEqual([]);
  });

  it("chunks large pages proactively", async () => {
    // Create a page with >50 children to trigger proactive chunking
    const manyChildren = Array.from({ length: 60 }, (_, i) => ({
      id: `1:${i + 1}`,
      name: `Child${i + 1}`,
      type: "FRAME" as const,
    }));

    const shallowFile: FigmaFile = {
      name: "Test",
      lastModified: "2024-01-01",
      version: "1",
      document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        children: [
          { id: "1:0", name: "BigPage", type: "CANVAS", children: manyChildren },
        ],
      },
    };

    // fetchNodesChunked will first fetch at depth=1, then batch children
    const shallowPage: FigmaNode = {
      id: "1:0", name: "BigPage", type: "CANVAS",
      children: manyChildren,
    };

    // Mock: depth=1 file, then fetchNodesChunked internals (depth=1 discovery + batches)
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFileResponse(shallowFile)) // depth=1 file fetch
      .mockResolvedValueOnce(mockNodesResponse({ "1:0": shallowPage })); // chunked: depth=1 discovery

    // Mock batch responses for all 60 children (batch size 3 for 60 children)
    for (let i = 0; i < 60; i += 3) {
      const batch: Record<string, FigmaNode> = {};
      for (let j = i; j < Math.min(i + 3, 60); j++) {
        batch[`1:${j + 1}`] = { id: `1:${j + 1}`, name: `Child${j + 1}`, type: "FRAME" };
      }
      fetchSpy.mockResolvedValueOnce(mockNodesResponse(batch));
    }

    const { pages, chunkedPages } = await fetchFileProactive("token", "fileKey", [], undefined, 5);

    expect(chunkedPages).toEqual(["BigPage"]);
    expect(pages["BigPage"]).toBeDefined();
    expect(pages["BigPage"].children).toHaveLength(60);
  });
});

describe("fetchNodesProactive", () => {
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

  it("fetches small nodes without chunking", async () => {
    const node: FigmaNode = {
      id: "1:0", name: "SmallNode", type: "CANVAS",
      children: [{ id: "1:1", name: "Child", type: "FRAME" }],
    };
    const fullNode: FigmaNode = {
      id: "1:0", name: "SmallNode", type: "CANVAS",
      children: [{ id: "1:1", name: "Child", type: "FRAME", fills: [] }],
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockNodesResponse({ "1:0": node })) // depth=1 check
      .mockResolvedValueOnce(mockNodesResponse({ "1:0": fullNode })); // full fetch

    const { nodes, chunkedNodes } = await fetchNodesProactive("token", "fileKey", ["1:0"]);

    expect(nodes["1:0"].name).toBe("SmallNode");
    expect(chunkedNodes).toEqual([]);
  });

  it("uses shallow result when depth=1 for small nodes", async () => {
    const node: FigmaNode = {
      id: "1:0", name: "SmallNode", type: "CANVAS",
      children: [{ id: "1:1", name: "Child", type: "FRAME" }],
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockNodesResponse({ "1:0": node })); // depth=1 check

    const { nodes } = await fetchNodesProactive("token", "fileKey", ["1:0"], 1);

    expect(nodes["1:0"].name).toBe("SmallNode");
    // Only 1 fetch call — shallow result reused
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
