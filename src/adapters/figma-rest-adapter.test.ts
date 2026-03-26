import { describe, it, expect, vi, beforeEach } from "vitest";
import { FigmaRestAdapter } from "./figma-rest-adapter.js";

// Mock the figma-client module
vi.mock("../figma-client.js", () => ({
  fetchFileProactive: vi.fn(),
  fetchNodesProactive: vi.fn(),
  fetchNodesChunked: vi.fn(),
  fetchFile: vi.fn(),
  filterWatchTargets: vi.fn(),
  sanitizeNode: vi.fn((node: unknown) => node),
}));

import {
  fetchFileProactive,
  fetchNodesProactive,
} from "../figma-client.js";

const mockFetchFileProactive = vi.mocked(fetchFileProactive);
const mockFetchNodesProactive = vi.mocked(fetchNodesProactive);

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
});
