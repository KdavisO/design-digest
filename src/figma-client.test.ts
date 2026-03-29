import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sanitizeNode,
  filterWatchTargets,
  extractEditorsSince,
  checkVersionChanged,
  fetchNodesChunked,
  adaptiveBatchSize,
  fetchFileProactive,
  fetchFileProactiveIter,
  fetchNodesProactive,
  isPayloadTooLargeError,
  fetchFileName,
  fetchFile,
  fetchVersions,
  fetchNodes,
} from "./figma-client.js";
import type { FigmaNode, FigmaFile, FigmaVersion, PageEntry, PageIterMeta } from "./figma-client.js";

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

  it("returns null-prototype objects to prevent prototype pollution", () => {
    // Use JSON.parse to create a node with "__proto__" as a real own property,
    // since object literal `__proto__:` is special-cased in JS and may not
    // appear in Object.entries.
    const node = JSON.parse(`{
      "id": "1",
      "name": "Frame",
      "type": "FRAME",
      "__proto__": { "polluted": true },
      "children": [
        {
          "id": "2",
          "name": "Child",
          "type": "TEXT",
          "constructor": { "polluted": true }
        }
      ]
    }`);
    const result = sanitizeNode(node);

    // All returned objects should be null-prototype
    expect(Object.getPrototypeOf(result)).toBeNull();
    const child = (result as Record<string, unknown>).children as unknown[];
    expect(Object.getPrototypeOf(child[0])).toBeNull();

    // __proto__ key is preserved as a data property on null-prototype object
    expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(true);

    // Prototype pollution should not occur
    const plain = {};
    expect((plain as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("handles __proto__ key in Figma payload without pollution", () => {
    // Simulate a Figma node that has "__proto__" as an actual data key
    const malicious = Object.create(null) as Record<string, unknown>;
    malicious["id"] = "1";
    malicious["name"] = "Malicious";
    malicious["type"] = "FRAME";
    malicious["__proto__"] = { injected: true };

    const result = sanitizeNode(malicious);
    expect(Object.getPrototypeOf(result)).toBeNull();
    // The __proto__ key is stored as a plain data property, not as a prototype link
    expect((result as Record<string, unknown>)["__proto__"]).toEqual({ injected: true });
    // No pollution on Object.prototype
    expect(({} as Record<string, unknown>).injected).toBeUndefined();
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

  it("uses shallow result for all pages when depth=1 (no extra API calls)", async () => {
    const manyChildren = Array.from({ length: 60 }, (_, i) => ({
      id: `1:${i + 1}`, name: `Child${i + 1}`, type: "FRAME" as const,
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
          { id: "1:0", name: "SmallPage", type: "CANVAS", children: [
            { id: "1:1", name: "Frame", type: "FRAME" },
          ]},
          { id: "2:0", name: "BigPage", type: "CANVAS", children: manyChildren },
        ],
      },
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFileResponse(shallowFile)); // depth=1 file fetch only

    const { pages, chunkedPages } = await fetchFileProactive("token", "fileKey", [], 1, 5);

    // Only 1 fetch call — no /nodes or chunked fetches
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(Object.keys(pages).sort()).toEqual(["BigPage", "SmallPage"]);
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

    // Mock: depth=1 file fetch, then batch responses (no discovery fetch — precomputedShallow is used)
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFileResponse(shallowFile)); // depth=1 file fetch

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

describe("fetchFileProactiveIter", () => {
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

  it("yields metadata first, then pages one at a time", async () => {
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
          { id: "2:0", name: "Page2", type: "CANVAS", children: [
            { id: "2:1", name: "Frame2", type: "FRAME" },
          ]},
        ],
      },
    };
    const fullPage1: FigmaNode = {
      id: "1:0", name: "Page1", type: "CANVAS",
      children: [{ id: "1:1", name: "Frame", type: "FRAME", fills: [] }],
    };
    const fullPage2: FigmaNode = {
      id: "2:0", name: "Page2", type: "CANVAS",
      children: [{ id: "2:1", name: "Frame2", type: "FRAME", fills: [] }],
    };

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFileResponse(shallowFile))
      .mockResolvedValueOnce(mockNodesResponse({ "1:0": fullPage1, "2:0": fullPage2 }));

    const iter = fetchFileProactiveIter("token", "fileKey", []);
    const results: (PageEntry | PageIterMeta)[] = [];
    for await (const item of iter) {
      results.push(item);
    }

    // First yield is metadata with kind discriminant
    expect(results[0]).toHaveProperty("kind", "meta");
    expect(results[0]).toHaveProperty("fileName", "Test");
    expect((results[0] as PageIterMeta).targetPageIds).toEqual(["1:0", "2:0"]);
    // Subsequent yields are page entries with kind discriminant
    expect(results).toHaveLength(3); // meta + 2 pages
    expect(results[1]).toHaveProperty("kind", "page");
    expect((results[1] as PageEntry).pageName).toBe("Page1");
    expect((results[2] as PageEntry).pageName).toBe("Page2");
  });

  it("yields large pages individually with chunked=true", async () => {
    const manyChildren = Array.from({ length: 60 }, (_, i) => ({
      id: `1:${i + 1}`, name: `Child${i + 1}`, type: "FRAME" as const,
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

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockFileResponse(shallowFile));

    for (let i = 0; i < 60; i += 3) {
      const batch: Record<string, FigmaNode> = {};
      for (let j = i; j < Math.min(i + 3, 60); j++) {
        batch[`1:${j + 1}`] = { id: `1:${j + 1}`, name: `Child${j + 1}`, type: "FRAME" };
      }
      fetchSpy.mockResolvedValueOnce(mockNodesResponse(batch));
    }

    const iter = fetchFileProactiveIter("token", "fileKey", []);
    const results: (PageEntry | PageIterMeta)[] = [];
    for await (const item of iter) {
      results.push(item);
    }

    expect(results).toHaveLength(2); // meta + 1 large page
    const pageEntry = results[1] as PageEntry;
    expect(pageEntry.kind).toBe("page");
    expect(pageEntry.pageName).toBe("BigPage");
    expect(pageEntry.chunked).toBe(true);
    expect(pageEntry.node.children).toHaveLength(60);
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

  it("proactively chunks large nodes with many children", async () => {
    const childCount = 60;
    const manyChildren = Array.from({ length: childCount }, (_, i) => ({
      id: `1:${i + 1}`, name: `Child${i + 1}`, type: "FRAME" as const,
    }));

    const shallowNode: FigmaNode = {
      id: "1:0", name: "LargeNode", type: "CANVAS",
      children: manyChildren,
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      // 1st call: shallow fetch at depth=1
      .mockResolvedValueOnce(mockNodesResponse({ "1:0": shallowNode }));

    // fetchNodesChunked receives precomputedShallow, so no discovery fetch needed.
    // It will batch children directly. With adaptiveBatchSize(60, 5) = 3, that's 20 batches.
    for (let i = 0; i < childCount; i += 3) {
      const batch: Record<string, FigmaNode> = {};
      for (let j = i; j < Math.min(i + 3, childCount); j++) {
        batch[`1:${j + 1}`] = { id: `1:${j + 1}`, name: `Child${j + 1}`, type: "FRAME" };
      }
      fetchSpy.mockResolvedValueOnce(mockNodesResponse(batch));
    }

    const { nodes, chunkedNodes } = await fetchNodesProactive("token", "fileKey", ["1:0"]);

    expect(nodes["1:0"]).toBeDefined();
    expect(nodes["1:0"].children).toHaveLength(childCount);
    expect(chunkedNodes).toContain("LargeNode");
    // 1 shallow fetch + 20 child batch fetches (no redundant discovery fetch)
    expect(fetchSpy).toHaveBeenCalledTimes(21);
  });

  it("uses shallow result for large nodes when depth=1 (no chunking)", async () => {
    const manyChildren = Array.from({ length: 60 }, (_, i) => ({
      id: `1:${i + 1}`, name: `Child${i + 1}`, type: "FRAME" as const,
    }));
    const largeNode: FigmaNode = {
      id: "1:0", name: "LargeNode", type: "CANVAS",
      children: manyChildren,
    };

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockNodesResponse({ "1:0": largeNode })); // depth=1 check only

    const { nodes, chunkedNodes } = await fetchNodesProactive("token", "fileKey", ["1:0"], 1);

    expect(nodes["1:0"].name).toBe("LargeNode");
    expect(nodes["1:0"].children).toHaveLength(60);
    // Only 1 fetch call — shallow result reused, no chunking
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Large nodes are NOT reported as chunked when depth=1
    expect(chunkedNodes).toEqual([]);
  });
});

describe("isPayloadTooLargeError", () => {
  it("detects Figma API 'request too large' error", () => {
    expect(isPayloadTooLargeError(new Error("Request too large"))).toBe(true);
  });

  it("detects Figma API 'try a smaller request' error", () => {
    expect(isPayloadTooLargeError(new Error("Try a smaller request"))).toBe(true);
  });

  it("detects 'invalid string length' error", () => {
    expect(isPayloadTooLargeError(new Error("Invalid string length"))).toBe(true);
  });

  it("detects 'allocation failed' error", () => {
    expect(isPayloadTooLargeError(new Error("JavaScript heap out of memory - allocation failed"))).toBe(true);
  });

  it("detects ERR_STRING_TOO_LONG by error code", () => {
    const err = new Error("Cannot create a string longer than 0x1fffffe8 characters");
    (err as Error & { code: string }).code = "ERR_STRING_TOO_LONG";
    expect(isPayloadTooLargeError(err)).toBe(true);
  });

  it("detects ERR_STRING_TOO_LONG by message pattern", () => {
    expect(
      isPayloadTooLargeError(new Error("Cannot create a string longer than 0x1fffffe8 characters")),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isPayloadTooLargeError(new Error("Network timeout"))).toBe(false);
    expect(isPayloadTooLargeError(new Error("404 Not Found"))).toBe(false);
  });

  it("handles non-Error values", () => {
    expect(isPayloadTooLargeError("request too large")).toBe(true);
    expect(isPayloadTooLargeError("something else")).toBe(false);
  });
});

describe("fetchFileName", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns file name on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ name: "Design System v2", lastModified: "", version: "", document: { id: "0:0", name: "Document", type: "DOCUMENT" } }), { status: 200 }),
    );
    const name = await fetchFileName("token", "abc123");
    expect(name).toBe("Design System v2");
  });

  it("returns undefined on API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );
    const name = await fetchFileName("token", "bad-key");
    expect(name).toBeUndefined();
  });

  it("returns undefined on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const name = await fetchFileName("token", "abc123");
    expect(name).toBeUndefined();
  });
});

describe("API response schema validation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects fetchFile response missing required fields", async () => {
    // Missing 'document' and 'version' fields
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ name: "Test", lastModified: "2024-01-01", version: "1" }), { status: 200 }),
    );

    await expect(fetchFile("token", "fileKey")).rejects.toThrow(
      /response validation failed/,
    );
  });

  it("rejects fetchFile response with missing document.id", async () => {
    // document is present but missing required 'id' field
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          name: "Test",
          lastModified: "2024-01-01",
          version: "1",
          document: { name: "Doc", type: "DOCUMENT" },
        }),
        { status: 200 },
      ),
    );

    await expect(fetchFile("token", "fileKey")).rejects.toThrow(
      /response validation failed/,
    );
  });

  it("accepts valid fetchFile response with extra properties", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          name: "Test",
          lastModified: "2024-01-01",
          version: "1",
          document: { id: "0:0", name: "Doc", type: "DOCUMENT" },
          thumbnailUrl: "https://example.com/thumb.png",
          editorType: "figma",
        }),
        { status: 200 },
      ),
    );

    const file = await fetchFile("token", "fileKey");
    expect(file.name).toBe("Test");
  });

  it("rejects fetchVersions response with invalid version structure", async () => {
    // versions[0] missing 'user' field
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          versions: [{ id: "v1", created_at: "2024-01-01", label: "", description: "" }],
        }),
        { status: 200 },
      ),
    );

    await expect(fetchVersions("token", "fileKey")).rejects.toThrow(
      /response validation failed/,
    );
  });

  it("rejects fetchNodes response with invalid node structure", async () => {
    // nodes["1:0"].document is missing 'id' field
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          nodes: { "1:0": { document: { name: "Page", type: "CANVAS" } } },
        }),
        { status: 200 },
      ),
    );

    await expect(fetchNodes("token", "fileKey", ["1:0"])).rejects.toThrow(
      /response validation failed/,
    );
  });

  it("accepts valid fetchNodes response with extra properties", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          nodes: {
            "1:0": {
              document: { id: "1:0", name: "Page", type: "CANVAS", fills: [] },
              components: {},
            },
          },
        }),
        { status: 200 },
      ),
    );

    const result = await fetchNodes("token", "fileKey", ["1:0"]);
    expect(result["1:0"].name).toBe("Page");
  });
});
