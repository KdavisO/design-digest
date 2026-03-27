import { describe, it, expect, vi, beforeEach } from "vitest";
import { FigmaRestAdapter } from "./figma-rest-adapter.js";

// Mock the figma-client module
vi.mock("../figma-client.js", () => ({
  fetchFileProactive: vi.fn(),
  fetchNodesProactive: vi.fn(),
  fetchNodesChunked: vi.fn(),
  fetchFile: vi.fn(),
  fetchVersions: vi.fn(),
  checkVersionChanged: vi.fn(),
  extractEditorsSince: vi.fn(),
  filterWatchTargets: vi.fn(),
  sanitizeNode: vi.fn((node: unknown) => node),
}));

import {
  fetchFileProactive,
  fetchNodesProactive,
  fetchNodesChunked,
  fetchFile,
  fetchVersions,
  checkVersionChanged,
  extractEditorsSince,
  filterWatchTargets,
} from "../figma-client.js";

const mockFetchFileProactive = vi.mocked(fetchFileProactive);
const mockFetchNodesProactive = vi.mocked(fetchNodesProactive);
const mockFetchNodesChunked = vi.mocked(fetchNodesChunked);
const mockFetchFile = vi.mocked(fetchFile);
const mockFetchVersions = vi.mocked(fetchVersions);
const mockCheckVersionChanged = vi.mocked(checkVersionChanged);
const mockExtractEditorsSince = vi.mocked(extractEditorsSince);
const mockFilterWatchTargets = vi.mocked(filterWatchTargets);

describe("FigmaRestAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have name property set to REST API", () => {
    const adapter = new FigmaRestAdapter("test-token");
    expect(adapter.name).toBe("REST API");
  });

  it("should use fetchFileProactive for page-based fetching", async () => {
    mockFetchFileProactive.mockResolvedValue({
      pages: {
        "Page 1": { id: "1:1", name: "Page 1", type: "CANVAS" },
      },
      chunkedPages: [],
      targetPageIds: ["1:1"],
    });

    const adapter = new FigmaRestAdapter("test-token");
    const pages = await adapter.fetchPages("file-key", {
      watchPages: ["Page 1"],
    });

    expect(mockFetchFileProactive).toHaveBeenCalledWith(
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
    mockFetchFileProactive.mockResolvedValue({
      pages: {},
      chunkedPages: [],
      targetPageIds: [],
    });

    const adapter = new FigmaRestAdapter("test-token");
    await adapter.fetchPages("file-key", {
      depth: 3,
      batchSize: 10,
    });

    expect(mockFetchFileProactive).toHaveBeenCalledWith(
      "test-token",
      "file-key",
      [],
      3,
      10,
    );
  });

  it("should fall back to chunked fetch on payload-too-large error (page-based)", async () => {
    mockFetchFileProactive.mockRejectedValue(new Error("Request too large"));
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

    expect(mockFetchFileProactive).toHaveBeenCalled();
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
    mockFetchFileProactive.mockRejectedValue(new Error("Network error"));

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
});
