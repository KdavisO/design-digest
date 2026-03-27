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

      expect(Object.keys(nodes)).toEqual(["1:1", "1:3"]);
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
});
