import type { FigmaNode } from "../figma-client.js";
import {
  fetchFileProactive,
  fetchNodesProactive,
  fetchNodesChunked,
  fetchFile,
  filterWatchTargets,
  sanitizeNode,
} from "../figma-client.js";
import type { FigmaDataAdapter, FetchPagesOptions } from "./figma-data-adapter.js";

/**
 * Adapter that fetches Figma data via the REST API.
 * Wraps the existing figma-client.ts functions with the common adapter interface.
 */
export class FigmaRestAdapter implements FigmaDataAdapter {
  readonly name = "REST API";
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async fetchPages(
    fileKey: string,
    options?: FetchPagesOptions,
  ): Promise<Record<string, FigmaNode>> {
    const watchPages = options?.watchPages ?? [];
    const watchNodeIds = options?.watchNodeIds ?? [];
    const depth = options?.depth;
    const batchSize = options?.batchSize ?? 5;

    if (watchNodeIds.length > 0) {
      return this.fetchByNodeIds(fileKey, watchNodeIds, depth, batchSize);
    }

    return this.fetchByPages(fileKey, watchPages, depth, batchSize);
  }

  private async fetchByNodeIds(
    fileKey: string,
    nodeIds: string[],
    depth: number | undefined,
    batchSize: number,
  ): Promise<Record<string, FigmaNode>> {
    try {
      const { nodes } = await fetchNodesProactive(
        this.token,
        fileKey,
        nodeIds,
        depth,
        batchSize,
      );
      const pages: Record<string, FigmaNode> = {};
      for (const [id, node] of Object.entries(nodes)) {
        pages[node.name || id] = sanitizeNode(node);
      }
      return pages;
    } catch (err) {
      if (isPayloadTooLargeError(err)) {
        console.log("  Payload too large — switching to chunked fetch...");
        const nodes = await fetchNodesChunked(
          this.token,
          fileKey,
          nodeIds,
          depth,
          batchSize,
        );
        const pages: Record<string, FigmaNode> = {};
        for (const [id, node] of Object.entries(nodes)) {
          pages[node.name || id] = sanitizeNode(node);
        }
        return pages;
      }
      throw err;
    }
  }

  private async fetchByPages(
    fileKey: string,
    watchPages: string[],
    depth: number | undefined,
    batchSize: number,
  ): Promise<Record<string, FigmaNode>> {
    try {
      const { pages: fetchedPages } = await fetchFileProactive(
        this.token,
        fileKey,
        watchPages,
        depth,
        batchSize,
      );
      const pages: Record<string, FigmaNode> = {};
      for (const [name, node] of Object.entries(fetchedPages)) {
        pages[name] = sanitizeNode(node);
      }
      return pages;
    } catch (err) {
      if (isPayloadTooLargeError(err)) {
        console.log("  Payload too large — fetching page list and chunking...");
        const file = await fetchFile(this.token, fileKey, 1);
        const targetPages = filterWatchTargets(file, watchPages);
        const pageIds = targetPages.map((p) => p.id);
        const nodes = await fetchNodesChunked(
          this.token,
          fileKey,
          pageIds,
          depth,
          batchSize,
        );
        const pages: Record<string, FigmaNode> = {};
        for (const [id, node] of Object.entries(nodes)) {
          pages[node.name || id] = sanitizeNode(node);
        }
        return pages;
      }
      throw err;
    }
  }
}

function isPayloadTooLargeError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    message.includes("request too large") ||
    message.includes("try a smaller request") ||
    message.includes("invalid string length")
  );
}
