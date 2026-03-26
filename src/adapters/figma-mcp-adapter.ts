import type { FigmaNode } from "../figma-client.js";
import { sanitizeNode } from "../figma-client.js";
import type { FigmaDataAdapter, FetchPagesOptions } from "./figma-data-adapter.js";

/**
 * MCP response structure from Figma MCP's `get_file` tool.
 *
 * The Figma MCP server returns file data in a structure similar to the REST API
 * but accessed through the MCP protocol. This adapter normalizes the response
 * for use with the diff engine.
 *
 * Since MCP tools are invoked by Claude (not programmatically), this adapter
 * works with pre-fetched data: Claude calls the MCP tool, then passes the
 * result to this adapter for normalization.
 */
export interface McpFigmaFileResponse {
  /** File name */
  name?: string;
  /** Last modified timestamp */
  lastModified?: string;
  /** Document root node */
  document?: FigmaNode;
  /** Nodes keyed by ID (from get_nodes-style responses) */
  nodes?: Record<string, { document: FigmaNode } | FigmaNode>;
}

/**
 * Adapter that normalizes Figma MCP tool responses into the format
 * expected by the diff engine.
 *
 * Usage flow:
 * 1. Claude calls Figma MCP's `get_file` or similar tool
 * 2. The response JSON is passed to FigmaMcpAdapter.fromMcpResponse()
 * 3. The adapter normalizes and sanitizes the data
 * 4. fetchPages() returns data compatible with the diff engine
 */
export class FigmaMcpAdapter implements FigmaDataAdapter {
  readonly name = "MCP";
  private readonly data: Record<string, FigmaNode>;

  private constructor(data: Record<string, FigmaNode>) {
    this.data = data;
  }

  /**
   * Create an adapter from raw MCP tool response data.
   * Handles both full file responses and node-specific responses.
   */
  static fromMcpResponse(response: McpFigmaFileResponse): FigmaMcpAdapter {
    const pages: Record<string, FigmaNode> = {};

    if (response.document?.children) {
      // Full file response — extract pages from document.children
      for (const page of response.document.children) {
        pages[page.name || page.id] = sanitizeNode(page);
      }
    } else if (response.nodes) {
      // Node-specific response — normalize nodes
      for (const [id, nodeData] of Object.entries(response.nodes)) {
        const node: FigmaNode = isWrappedNode(nodeData)
          ? nodeData.document
          : nodeData as FigmaNode;
        if (!isValidNode(node)) continue;
        pages[node.name || id] = sanitizeNode(node);
      }
    }

    return new FigmaMcpAdapter(pages);
  }

  /**
   * Create an adapter from a pre-parsed pages map.
   * Useful when Claude has already extracted and structured the page data.
   */
  static fromPages(pages: Record<string, FigmaNode>): FigmaMcpAdapter {
    const sanitized: Record<string, FigmaNode> = {};
    for (const [name, node] of Object.entries(pages)) {
      sanitized[name] = sanitizeNode(node);
    }
    return new FigmaMcpAdapter(sanitized);
  }

  async fetchPages(
    _fileKey: string,
    options?: FetchPagesOptions,
  ): Promise<Record<string, FigmaNode>> {
    const watchNodeIds = options?.watchNodeIds ?? [];
    const watchPages = options?.watchPages ?? [];

    // watchNodeIds takes priority: filter by node ID
    if (watchNodeIds.length > 0) {
      const filtered: Record<string, FigmaNode> = {};
      for (const [name, node] of Object.entries(this.data)) {
        if (watchNodeIds.includes(node.id)) {
          filtered[name] = node;
        }
      }
      return filtered;
    }

    if (watchPages.length === 0) {
      return { ...this.data };
    }

    // Filter to only watched pages
    const filtered: Record<string, FigmaNode> = {};
    for (const [name, node] of Object.entries(this.data)) {
      if (watchPages.includes(name)) {
        filtered[name] = node;
      }
    }
    return filtered;
  }
}

function isWrappedNode(
  data: { document: FigmaNode } | FigmaNode,
): data is { document: FigmaNode } {
  if (data == null || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  return "document" in data && record.document != null && typeof record.document === "object";
}

function isValidNode(node: unknown): node is FigmaNode {
  if (node == null || typeof node !== "object") return false;
  const n = node as Record<string, unknown>;
  return typeof n.id === "string" && typeof n.name === "string" && typeof n.type === "string";
}
