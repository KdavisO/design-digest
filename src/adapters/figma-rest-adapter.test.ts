import { describe, it, expect, vi, beforeEach } from "vitest";
import { FigmaRestAdapter } from "./figma-rest-adapter.js";
import type { FigmaNode } from "../figma-client.js";
import type { PageEntry, PageIterMeta } from "../figma-client.js";

// Mock the figma-client module (keep isPayloadTooLargeError as real implementation)
vi.mock("../figma-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../figma-client.js")>();
  return {
    fetchFileProactive: vi.fn(),
    fetchFileProactiveIter: vi.fn(),
    fetchNodesProactive: vi.fn(),
    fetchNodesChunked: vi.fn(),
    fetchFile: vi.fn(),
    fetchVersions: vi.fn(),
    checkVersionChanged: vi.fn(),
    extractEditorsSince: vi.fn(),
    filterWatchTargets: vi.fn(),
    sanitizeNode: actual.sanitizeNode,
    isPayloadTooLargeError: actual.isPayloadTooLargeError,
  };
});

import {
  fetchFileProactiveIter,
  fetchNodesProactive,
  fetchNodesChunked,
  fetchFile,
  fetchVersions,
  checkVersionChanged,
  extractEditorsSince,
  filterWatchTargets,
} from "../figma-client.js";

const mockFetchFileProactiveIter = vi.mocked(fetchFileProactiveIter);
const mockFetchNodesProactive = vi.mocked(fetchNodesProactive);
const mockFetchNodesChunked = vi.mocked(fetchNodesChunked);
const mockFetchFile = vi.mocked(fetchFile);
const mockFetchVersions = vi.mocked(fetchVersions);
const mockCheckVersionChanged = vi.mocked(checkVersionChanged);
const mockExtractEditorsSince = vi.mocked(extractEditorsSince);
const mockFilterWatchTargets = vi.mocked(filterWatchTargets);

/** Helper: create a mock async generator from metadata + page entries */
function mockIter(meta: PageIterMeta, entries: PageEntry[]) {
  return async function* () {
    yield meta;
    for (const entry of entries) {
      yield entry;
    }
  };
}

describe("FigmaRestAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have name property set to REST API", () => {
    const adapter = new FigmaRestAdapter("test-token");
    expect(adapter.name).toBe("REST API");
  });

  it("should use fetchFileProactiveIter for page-based fetching", async () => {
    const page: FigmaNode = { id: "1:1", name: "Page 1", type: "CANVAS" };
    mockFetchFileProactiveIter.mockReturnValue(
      mockIter(
        { kind: "meta", fileName: "Test File", targetPageIds: ["1:1"] },
        [{ kind: "page", pageName: "Page 1", node: page, chunked: false }],
      )() as ReturnType<typeof fetchFileProactiveIter>,
    );

    const adapter = new FigmaRestAdapter("test-token");
    const pages = await adapter.fetchPages("file-key", {
      watchPages: ["Page 1"],
    });

    expect(mockFetchFileProactiveIter).toHaveBeenCalledWith(
      "test-token",
      "file-key",
      ["Page 1"],
      undefined,
      5,
    );
    expect(Object.keys(pages)).toEqual(["Page 1"]);
  });

  it("should use fetchNodesProactive for node-based fetching", async () => {
    mockFetchNodesProactive.mockResolvedValue({
      nodes: {
        "1:1": { id: "1:1", name: "Node A", type: "FRAME" },
      },
      chunkedNodes: [],
    });

    const adapter = new FigmaRestAdapter("test-token");
    const pages = await adapter.fetchPages("file-key", {
      watchNodeIds: ["1:1"],
    });

    expect(mockFetchNodesProactive).toHaveBeenCalledWith(
      "test-token",
      "file-key",
      ["1:1"],
      undefined,
      5,
    );
    expect(Object.keys(pages)).toEqual(["Node A"]);
  });

  it("should pass depth and batchSize options", async () => {
    mockFetchFileProactiveIter.mockReturnValue(
      mockIter(
        { kind: "meta", fileName: "Test File", targetPageIds: [] },
        [],
      )() as ReturnType<typeof fetchFileProactiveIter>,
    );

    const adapter = new FigmaRestAdapter("test-token");
    await adapter.fetchPages("file-key", {
      depth: 3,
      batchSize: 10,
    });

    expect(mockFetchFileProactiveIter).toHaveBeenCalledWith(
      "test-token",
      "file-key",
      [],
      3,
      10,
    );
  });

  it("should fall back to chunked fetch on payload-too-large error (page-based)", async () => {
    mockFetchFileProactiveIter.mockReturnValue(
      (async function* () {
        throw new Error("Request too large");
      })() as ReturnType<typeof fetchFileProactiveIter>,
    );
    mockFetchFile.mockResolvedValue({
      name: "Test",
      lastModified: "",
      version: "1",
      document: {
        id: "0:0",
        name: "Document",
        type: "DOCUMENT",
        children: [{ id: "1:1", name: "Page 1", type: "CANVAS" }],
      },
    });
    mockFilterWatchTargets.mockReturnValue([
      { id: "1:1", name: "Page 1", type: "CANVAS" },
    ]);
    mockFetchNodesChunked.mockResolvedValue({
      "1:1": { id: "1:1", name: "Page 1", type: "CANVAS" },
    });

    const adapter = new FigmaRestAdapter("test-token");
    const pages = await adapter.fetchPages("file-key");

    expect(mockFetchFileProactiveIter).toHaveBeenCalled();
    expect(mockFetchFile).toHaveBeenCalledWith("test-token", "file-key", 1);
    expect(mockFetchNodesChunked).toHaveBeenCalled();
    expect(Object.keys(pages)).toEqual(["Page 1"]);
  });

  it("should fall back to chunked fetch on payload-too-large error (node-based)", async () => {
    mockFetchNodesProactive.mockRejectedValue(new Error("try a smaller request"));
    mockFetchNodesChunked.mockResolvedValue({
      "1:1": { id: "1:1", name: "Node A", type: "FRAME" },
    });

    const adapter = new FigmaRestAdapter("test-token");
    const pages = await adapter.fetchPages("file-key", {
      watchNodeIds: ["1:1"],
    });

    expect(mockFetchNodesProactive).toHaveBeenCalled();
    expect(mockFetchNodesChunked).toHaveBeenCalled();
    expect(Object.keys(pages)).toEqual(["Node A"]);
  });

  it("should re-throw non-payload errors", async () => {
    mockFetchFileProactiveIter.mockReturnValue(
      (async function* () {
        throw new Error("Network error");
      })() as ReturnType<typeof fetchFileProactiveIter>,
    );

    const adapter = new FigmaRestAdapter("test-token");
    await expect(adapter.fetchPages("file-key")).rejects.toThrow("Network error");
  });

  it("should delegate checkVersionChanged to figma-client", async () => {
    mockCheckVersionChanged.mockResolvedValue({
      changed: true,
      latestVersionId: "v2",
    });

    const adapter = new FigmaRestAdapter("test-token");
    const result = await adapter.checkVersionChanged("file-key", "v1");

    expect(mockCheckVersionChanged).toHaveBeenCalledWith("test-token", "file-key", "v1");
    expect(result).toEqual({ changed: true, latestVersionId: "v2" });
  });

  it("should delegate fetchVersions to figma-client", async () => {
    const versions = [
      { id: "v1", created_at: "2026-01-01", label: "", description: "", user: { handle: "user1", img_url: "", id: "u1" } },
    ];
    mockFetchVersions.mockResolvedValue(versions);

    const adapter = new FigmaRestAdapter("test-token");
    const result = await adapter.fetchVersions("file-key");

    expect(mockFetchVersions).toHaveBeenCalledWith("test-token", "file-key");
    expect(result).toEqual(versions);
  });

  it("should delegate fetchNodes to figma-client", async () => {
    mockFetchNodesProactive.mockResolvedValue({
      nodes: {
        "1:1": { id: "1:1", name: "Node A", type: "FRAME" },
        "1:2": { id: "1:2", name: "Node B", type: "FRAME" },
      },
      chunkedNodes: [],
    });

    const adapter = new FigmaRestAdapter("test-token");
    const result = await adapter.fetchNodes("file-key", ["1:1", "1:2"], 2);

    expect(mockFetchNodesProactive).toHaveBeenCalledWith(
      "test-token",
      "file-key",
      ["1:1", "1:2"],
      2,
      5,
    );
    expect(Object.keys(result)).toEqual(["1:1", "1:2"]);
  });

  it("should fall back to chunked fetch on payload-too-large error in fetchNodes", async () => {
    mockFetchNodesProactive.mockRejectedValue(new Error("Request too large"));
    mockFetchNodesChunked.mockResolvedValue({
      "1:1": { id: "1:1", name: "Node A", type: "FRAME" },
    });

    const adapter = new FigmaRestAdapter("test-token");
    const result = await adapter.fetchNodes("file-key", ["1:1"]);

    expect(mockFetchNodesProactive).toHaveBeenCalled();
    expect(mockFetchNodesChunked).toHaveBeenCalledWith(
      "test-token",
      "file-key",
      ["1:1"],
      undefined,
      5,
    );
    expect(result).toEqual({
      "1:1": { id: "1:1", name: "Node A", type: "FRAME" },
    });
  });

  it("should re-throw non-payload errors in fetchNodes", async () => {
    mockFetchNodesProactive.mockRejectedValue(new Error("Network error"));

    const adapter = new FigmaRestAdapter("test-token");
    await expect(adapter.fetchNodes("file-key", ["1:1"])).rejects.toThrow("Network error");
  });

  it("should delegate extractEditorsSince to figma-client", () => {
    const editors = [{ handle: "user1", img_url: "", id: "u1" }];
    mockExtractEditorsSince.mockReturnValue(editors);

    const versions = [
      { id: "v1", created_at: "2026-01-02", label: "", description: "", user: { handle: "user1", img_url: "", id: "u1" } },
    ];

    const adapter = new FigmaRestAdapter("test-token");
    const result = adapter.extractEditorsSince(versions, "2026-01-01");

    expect(mockExtractEditorsSince).toHaveBeenCalledWith(versions, "2026-01-01");
    expect(result).toEqual(editors);
  });

  it("should sanitize each page individually via the iterator", async () => {
    const page: FigmaNode = {
      id: "1:1",
      name: "Page 1",
      type: "CANVAS",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 } as unknown,
    };
    mockFetchFileProactiveIter.mockReturnValue(
      mockIter(
        { kind: "meta", fileName: "Test File", targetPageIds: ["1:1"] },
        [{ kind: "page", pageName: "Page 1", node: page, chunked: false }],
      )() as ReturnType<typeof fetchFileProactiveIter>,
    );

    const adapter = new FigmaRestAdapter("test-token");
    const pages = await adapter.fetchPages("file-key");

    // sanitizeNode should have stripped the noise key
    expect(pages["Page 1"]).not.toHaveProperty("absoluteBoundingBox");
    expect(pages["Page 1"]).toHaveProperty("name", "Page 1");
  });
});
