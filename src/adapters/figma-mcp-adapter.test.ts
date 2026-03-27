import { describe, it, expect } from "vitest";
import { FigmaMcpAdapter } from "./figma-mcp-adapter.js";
import type { McpFigmaFileResponse } from "./figma-mcp-adapter.js";
import type { FigmaNode } from "../figma-client.js";

describe("FigmaMcpAdapter", () => {
  describe("fromMcpResponse", () => {
    it("should extract pages from a full file response", async () => {
      const response: McpFigmaFileResponse = {
        name: "Test File",
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            {
              id: "1:1",
              name: "Page 1",
              type: "CANVAS",
              children: [
                { id: "2:1", name: "Frame A", type: "FRAME" },
              ],
            },
            {
              id: "1:2",
              name: "Page 2",
              type: "CANVAS",
              children: [
                { id: "2:2", name: "Frame B", type: "FRAME" },
              ],
            },
          ],
        },
      };

      const adapter = FigmaMcpAdapter.fromMcpResponse(response);
      const pages = await adapter.fetchPages("test-key");

      expect(Object.keys(pages)).toEqual(["Page 1", "Page 2"]);
      expect(pages["Page 1"].type).toBe("CANVAS");
      expect(pages["Page 1"].children?.[0]?.name).toBe("Frame A");
    });

    it("should extract nodes from a node-specific response", async () => {
      const response: McpFigmaFileResponse = {
        nodes: {
          "1:1": {
            document: {
              id: "1:1",
              name: "Component A",
              type: "COMPONENT",
            },
          },
          "1:2": {
            document: {
              id: "1:2",
              name: "Component B",
              type: "COMPONENT",
            },
          },
        },
      };

      const adapter = FigmaMcpAdapter.fromMcpResponse(response);
      const pages = await adapter.fetchPages("test-key");

      expect(Object.keys(pages)).toEqual(["Component A", "Component B"]);
    });

    it("should handle nodes without document wrapper", async () => {
      const response: McpFigmaFileResponse = {
        nodes: {
          "1:1": {
            id: "1:1",
            name: "Direct Node",
            type: "FRAME",
          },
        },
      };

      const adapter = FigmaMcpAdapter.fromMcpResponse(response);
      const pages = await adapter.fetchPages("test-key");

      expect(Object.keys(pages)).toEqual(["Direct Node"]);
    });

    it("should sanitize noise keys from MCP response", async () => {
      const response: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            {
              id: "1:1",
              name: "Page",
              type: "CANVAS",
              absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
              absoluteRenderBounds: { x: 0, y: 0, width: 100, height: 100 },
              children: [],
            },
          ],
        },
      };

      const adapter = FigmaMcpAdapter.fromMcpResponse(response);
      const pages = await adapter.fetchPages("test-key");
      const page = pages["Page"];

      expect(page).toBeDefined();
      expect((page as Record<string, unknown>)["absoluteBoundingBox"]).toBeUndefined();
      expect((page as Record<string, unknown>)["absoluteRenderBounds"]).toBeUndefined();
    });
  });

  describe("fromPages", () => {
    it("should create adapter from pre-parsed pages", async () => {
      const inputPages: Record<string, FigmaNode> = {
        "Page 1": {
          id: "1:1",
          name: "Page 1",
          type: "CANVAS",
          children: [{ id: "2:1", name: "Frame", type: "FRAME" }],
        },
      };

      const adapter = FigmaMcpAdapter.fromPages(inputPages);
      const pages = await adapter.fetchPages("test-key");

      expect(Object.keys(pages)).toEqual(["Page 1"]);
      expect(pages["Page 1"].children?.[0]?.name).toBe("Frame");
    });
  });

  describe("fetchPages with watchPages filter", () => {
    it("should filter to only watched pages", async () => {
      const response: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            { id: "1:1", name: "Page A", type: "CANVAS" },
            { id: "1:2", name: "Page B", type: "CANVAS" },
            { id: "1:3", name: "Page C", type: "CANVAS" },
          ],
        },
      };

      const adapter = FigmaMcpAdapter.fromMcpResponse(response);
      const pages = await adapter.fetchPages("test-key", {
        watchPages: ["Page A", "Page C"],
      });

      expect(Object.keys(pages)).toEqual(["Page A", "Page C"]);
    });

    it("should return all pages when watchPages is empty", async () => {
      const response: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            { id: "1:1", name: "Page A", type: "CANVAS" },
            { id: "1:2", name: "Page B", type: "CANVAS" },
          ],
        },
      };

      const adapter = FigmaMcpAdapter.fromMcpResponse(response);
      const pages = await adapter.fetchPages("test-key", { watchPages: [] });

      expect(Object.keys(pages)).toEqual(["Page A", "Page B"]);
    });
  });

  describe("fetchPages with watchNodeIds filter", () => {
    it("should filter by node IDs when watchNodeIds is provided", async () => {
      const response: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            { id: "1:1", name: "Page A", type: "CANVAS" },
            { id: "1:2", name: "Page B", type: "CANVAS" },
            { id: "1:3", name: "Page C", type: "CANVAS" },
          ],
        },
      };

      const adapter = FigmaMcpAdapter.fromMcpResponse(response);
      const pages = await adapter.fetchPages("test-key", {
        watchNodeIds: ["1:1", "1:3"],
      });

      expect(Object.keys(pages)).toEqual(["Page A", "Page C"]);
    });

    it("should prioritize watchNodeIds over watchPages", async () => {
      const response: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            { id: "1:1", name: "Page A", type: "CANVAS" },
            { id: "1:2", name: "Page B", type: "CANVAS" },
          ],
        },
      };

      const adapter = FigmaMcpAdapter.fromMcpResponse(response);
      const pages = await adapter.fetchPages("test-key", {
        watchNodeIds: ["1:2"],
        watchPages: ["Page A"],
      });

      expect(Object.keys(pages)).toEqual(["Page B"]);
    });
  });

  describe("null/invalid node data handling", () => {
    it("should skip nodes with null document wrapper", async () => {
      const response: McpFigmaFileResponse = {
        nodes: {
          "1:1": {
            document: { id: "1:1", name: "Valid", type: "FRAME" },
          },
          "1:2": { document: null },
        },
      };

      const adapter = FigmaMcpAdapter.fromMcpResponse(response);
      const pages = await adapter.fetchPages("test-key");
      expect(Object.keys(pages)).toEqual(["Valid"]);
      expect(pages["Valid"]).toBeDefined();
    });

    it("should treat non-wrapped nodes as direct FigmaNode", async () => {
      const response: McpFigmaFileResponse = {
        nodes: {
          "1:1": { id: "1:1", name: "Direct", type: "FRAME" },
        },
      };

      const adapter = FigmaMcpAdapter.fromMcpResponse(response);
      const pages = await adapter.fetchPages("test-key");
      expect(Object.keys(pages)).toEqual(["Direct"]);
    });
  });

  describe("fetchNodes", () => {
    it("should return matching nodes by ID from pre-fetched data", async () => {
      const response: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            { id: "1:1", name: "Page A", type: "CANVAS" },
            { id: "1:2", name: "Page B", type: "CANVAS" },
            { id: "1:3", name: "Page C", type: "CANVAS" },
          ],
        },
      };

      const adapter = FigmaMcpAdapter.fromMcpResponse(response);
      const nodes = await adapter.fetchNodes("test-key", ["1:1", "1:3"]);

      expect(Object.keys(nodes).sort()).toEqual(["1:1", "1:3"]);
      expect(nodes).toHaveProperty("1:1");
      expect(nodes).toHaveProperty("1:3");
      expect(nodes["1:1"].name).toBe("Page A");
      expect(nodes["1:3"].name).toBe("Page C");
    });

    it("should return empty object when no nodes match", async () => {
      const adapter = FigmaMcpAdapter.fromPages({
        "Page A": { id: "1:1", name: "Page A", type: "CANVAS" },
      });
      const nodes = await adapter.fetchNodes("test-key", ["9:9"]);

      expect(Object.keys(nodes)).toEqual([]);
    });
  });

  describe("unsupported version methods", () => {
    it("should throw on fetchVersions", async () => {
      const adapter = FigmaMcpAdapter.fromPages({});
      await expect(adapter.fetchVersions("test-key")).rejects.toThrow(
        "FigmaMcpAdapter does not support fetchVersions",
      );
    });

    it("should throw on checkVersionChanged", async () => {
      const adapter = FigmaMcpAdapter.fromPages({});
      await expect(adapter.checkVersionChanged("test-key", "v1")).rejects.toThrow(
        "FigmaMcpAdapter does not support checkVersionChanged",
      );
    });

    it("should throw on extractEditorsSince", () => {
      const adapter = FigmaMcpAdapter.fromPages({});
      expect(() => adapter.extractEditorsSince([], "2026-01-01")).toThrow(
        "FigmaMcpAdapter does not support extractEditorsSince",
      );
    });
  });

  it("should have name property set to MCP", () => {
    const adapter = FigmaMcpAdapter.fromPages({});
    expect(adapter.name).toBe("MCP");
  });

  it("should handle empty response gracefully", async () => {
    const adapter = FigmaMcpAdapter.fromMcpResponse({});
    const pages = await adapter.fetchPages("test-key");
    expect(Object.keys(pages)).toEqual([]);
  });

  describe("fromMcpResponses (chunked merging)", () => {
    it("should merge multiple document responses", async () => {
      const response1: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            { id: "1:1", name: "Page A", type: "CANVAS", children: [{ id: "2:1", name: "Frame A", type: "FRAME" }] },
          ],
        },
      };
      const response2: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            { id: "1:2", name: "Page B", type: "CANVAS", children: [{ id: "2:2", name: "Frame B", type: "FRAME" }] },
          ],
        },
      };

      const adapter = FigmaMcpAdapter.fromMcpResponses([response1, response2]);
      const pages = await adapter.fetchPages("test-key");

      expect(Object.keys(pages).sort()).toEqual(["Page A", "Page B"]);
      expect(pages["Page A"].children?.[0]?.name).toBe("Frame A");
      expect(pages["Page B"].children?.[0]?.name).toBe("Frame B");
    });

    it("should merge document and node responses", async () => {
      const docResponse: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            { id: "1:1", name: "Page A", type: "CANVAS" },
          ],
        },
      };
      const nodeResponse: McpFigmaFileResponse = {
        nodes: {
          "1:2": { document: { id: "1:2", name: "Page B", type: "CANVAS" } },
        },
      };

      const adapter = FigmaMcpAdapter.fromMcpResponses([docResponse, nodeResponse]);
      const pages = await adapter.fetchPages("test-key");

      expect(Object.keys(pages).sort()).toEqual(["Page A", "Page B"]);
    });

    it("should override earlier pages with later ones (last-write-wins)", async () => {
      const response1: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            { id: "1:1", name: "Page A", type: "CANVAS", children: [{ id: "2:1", name: "Old Frame", type: "FRAME" }] },
          ],
        },
      };
      const response2: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            { id: "1:1", name: "Page A", type: "CANVAS", children: [{ id: "2:1", name: "New Frame", type: "FRAME" }] },
          ],
        },
      };

      const adapter = FigmaMcpAdapter.fromMcpResponses([response1, response2]);
      const pages = await adapter.fetchPages("test-key");

      expect(Object.keys(pages)).toEqual(["Page A"]);
      expect(pages["Page A"].children?.[0]?.name).toBe("New Frame");
    });

    it("should handle empty responses array", async () => {
      const adapter = FigmaMcpAdapter.fromMcpResponses([]);
      const pages = await adapter.fetchPages("test-key");
      expect(Object.keys(pages)).toEqual([]);
    });

    it("should handle mix of empty and non-empty responses", async () => {
      const adapter = FigmaMcpAdapter.fromMcpResponses([
        {},
        {
          document: {
            id: "0:0",
            name: "Document",
            type: "DOCUMENT",
            children: [{ id: "1:1", name: "Page A", type: "CANVAS" }],
          },
        },
        {},
      ]);
      const pages = await adapter.fetchPages("test-key");
      expect(Object.keys(pages)).toEqual(["Page A"]);
    });
  });

  describe("extractPageList", () => {
    it("should extract page info from document response", () => {
      const children: FigmaNode[] = [];
      for (let i = 0; i < 60; i++) {
        children.push({ id: `child:${i}`, name: `Child ${i}`, type: "FRAME" });
      }
      const response: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            { id: "1:1", name: "Small Page", type: "CANVAS", children: [{ id: "2:1", name: "Frame", type: "FRAME" }] },
            { id: "1:2", name: "Large Page", type: "CANVAS", children },
          ],
        },
      };

      const pageList = FigmaMcpAdapter.extractPageList(response);

      expect(pageList).toHaveLength(2);
      expect(pageList[0]).toEqual({
        id: "1:1",
        name: "Small Page",
        childCount: 1,
        needsChunking: false,
      });
      expect(pageList[1]).toEqual({
        id: "1:2",
        name: "Large Page",
        childCount: 60,
        needsChunking: true,
      });
    });

    it("should extract page info from node response", () => {
      const response: McpFigmaFileResponse = {
        nodes: {
          "1:1": {
            document: {
              id: "1:1",
              name: "Node A",
              type: "CANVAS",
              children: [{ id: "2:1", name: "Frame", type: "FRAME" }],
            },
          },
        },
      };

      const pageList = FigmaMcpAdapter.extractPageList(response);
      expect(pageList).toHaveLength(1);
      expect(pageList[0]).toEqual({
        id: "1:1",
        name: "Node A",
        childCount: 1,
        needsChunking: false,
      });
    });

    it("should return empty array for empty response", () => {
      expect(FigmaMcpAdapter.extractPageList({})).toEqual([]);
    });

    it("should handle pages with no children", () => {
      const response: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            { id: "1:1", name: "Empty Page", type: "CANVAS" },
          ],
        },
      };

      const pageList = FigmaMcpAdapter.extractPageList(response);
      expect(pageList[0].childCount).toBe(0);
      expect(pageList[0].needsChunking).toBe(false);
    });
  });

  describe("needsChunking", () => {
    it("should return false for small files", () => {
      const response: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            { id: "1:1", name: "Page", type: "CANVAS", children: [{ id: "2:1", name: "Frame", type: "FRAME" }] },
          ],
        },
      };
      expect(FigmaMcpAdapter.needsChunking(response)).toBe(false);
    });

    it("should return true when a page has many children", () => {
      const children: FigmaNode[] = [];
      for (let i = 0; i < 51; i++) {
        children.push({ id: `child:${i}`, name: `Child ${i}`, type: "FRAME" });
      }
      const response: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: [
            { id: "1:1", name: "Large Page", type: "CANVAS", children },
          ],
        },
      };
      expect(FigmaMcpAdapter.needsChunking(response)).toBe(true);
    });

    it("should return true when there are many pages", () => {
      const pages: FigmaNode[] = [];
      for (let i = 0; i < 51; i++) {
        pages.push({ id: `page:${i}`, name: `Page ${i}`, type: "CANVAS" });
      }
      const response: McpFigmaFileResponse = {
        document: {
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
          children: pages,
        },
      };
      expect(FigmaMcpAdapter.needsChunking(response)).toBe(true);
    });

    it("should return false for empty response", () => {
      expect(FigmaMcpAdapter.needsChunking({})).toBe(false);
    });
  });
});
