import type { FigmaNode, FigmaVersion, FigmaUser } from "../figma-client.js";
import {
  fetchFileProactiveIter,
  fetchNodesProactive,
  fetchNodesChunked,
  fetchFile,
  fetchVersions as fetchVersionsFn,
  checkVersionChanged as checkVersionChangedFn,
  extractEditorsSince as extractEditorsSinceFn,
  filterWatchTargets,
  isPayloadTooLargeError,
} from "../figma-client.js";
import type { FigmaDataAdapter, FetchPagesOptions } from "./figma-data-adapter.js";
import { sanitizeNode, sanitizeRecord, sanitizeRecordByName } from "./sanitize-helpers.js";

const DEFAULT_BATCH_SIZE = 5;

/**
 * Adapter that fetches Figma data via the REST API.
 * Wraps the existing figma-client.ts functions with the common adapter interface.
 */
export class FigmaRestAdapter implements FigmaDataAdapter {
  readonly name = "REST API";
  private readonly token: string;
  /** File name from the most recent fetchPages call (set during page-based fetching) */
  lastFileName: string | undefined;

  constructor(token: string) {
    this.token = token;
  }

  async fetchPages(
    fileKey: string,
    options?: FetchPagesOptions,
  ): Promise<Record<string, FigmaNode>> {
    // Reset to prevent stale values from a previous file leaking through
    this.lastFileName = undefined;

    const watchPages = options?.watchPages ?? [];
    const watchNodeIds = options?.watchNodeIds ?? [];
    const depth = options?.depth;
    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;

    if (watchNodeIds.length > 0) {
      const pages = await this.fetchByNodeIds(fileKey, watchNodeIds, depth, batchSize);
      // Node-based path doesn't fetch file metadata, so do a lightweight lookup
      try {
        const file = await fetchFile(this.token, fileKey, 1);
        this.lastFileName = file.name;
      } catch {
        // Non-critical — fileName is optional for display
      }
      return pages;
    }

    return this.fetchByPages(fileKey, watchPages, depth, batchSize);
  }

  async fetchNodes(
    fileKey: string,
    nodeIds: string[],
    depth?: number,
  ): Promise<Record<string, FigmaNode>> {
    const batchSize = DEFAULT_BATCH_SIZE;
    try {
      const { nodes } = await fetchNodesProactive(
        this.token,
        fileKey,
        nodeIds,
        depth,
        batchSize,
      );
      return sanitizeRecord(nodes);
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
        return sanitizeRecord(nodes);
      }
      throw err;
    }
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
      return sanitizeRecordByName(nodes);
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
        return sanitizeRecordByName(nodes);
      }
      throw err;
    }
  }

  /**
   * Check if a file's version has changed since the given version ID.
   */
  async checkVersionChanged(
    fileKey: string,
    lastVersionId: string | undefined,
  ): Promise<{ changed: boolean; latestVersionId: string | undefined }> {
    return checkVersionChangedFn(this.token, fileKey, lastVersionId);
  }

  /**
   * Fetch version history for a file.
   */
  async fetchVersions(fileKey: string): Promise<FigmaVersion[]> {
    return fetchVersionsFn(this.token, fileKey);
  }

  /**
   * Extract unique editors from version history since a given timestamp.
   */
  extractEditorsSince(versions: FigmaVersion[], sinceTimestamp: string): FigmaUser[] {
    return extractEditorsSinceFn(versions, sinceTimestamp);
  }

  /**
   * Streaming version of fetchByPages — yields sanitized pages one at a time.
   * Peak memory = largest single page (not sum of all pages).
   */
  async *fetchPagesIter(
    fileKey: string,
    options?: FetchPagesOptions,
  ): AsyncGenerator<{ pageName: string; node: FigmaNode }, void, undefined> {
    this.lastFileName = undefined;

    const watchPages = options?.watchPages ?? [];
    const watchNodeIds = options?.watchNodeIds ?? [];
    const depth = options?.depth;
    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;

    if (watchNodeIds.length > 0) {
      // Node-based path: not streamable, yield all at once
      const pages = await this.fetchByNodeIds(fileKey, watchNodeIds, depth, batchSize);
      try {
        const file = await fetchFile(this.token, fileKey, 1);
        this.lastFileName = file.name;
      } catch {
        // Non-critical
      }
      for (const [pageName, node] of Object.entries(pages)) {
        yield { pageName, node };
      }
      return;
    }

    // Use the async generator to stream pages
    try {
      const iter = fetchFileProactiveIter(
        this.token,
        fileKey,
        watchPages,
        depth,
        batchSize,
      );

      const metaResult = await iter.next();
      if (metaResult.done || !metaResult.value || metaResult.value.kind !== "meta") {
        throw new Error("Expected initial metadata from fetchFileProactiveIter");
      }
      this.lastFileName = metaResult.value.fileName;

      for await (const entry of iter) {
        if (entry.kind !== "page") continue;
        yield { pageName: entry.pageName, node: sanitizeNode(entry.node) };
      }
    } catch (err) {
      if (isPayloadTooLargeError(err)) {
        console.log("  Payload too large — fetching page list and chunking...");
        const file = await fetchFile(this.token, fileKey, 1);
        this.lastFileName = file.name;
        const targetPages = filterWatchTargets(file, watchPages);
        const pageIds = targetPages.map((p) => p.id);
        const precomputedShallow: Record<string, FigmaNode> = {};
        for (const page of targetPages) {
          precomputedShallow[page.id] = page;
        }
        const nodes = await fetchNodesChunked(
          this.token,
          fileKey,
          pageIds,
          depth,
          batchSize,
          precomputedShallow,
        );
        const sanitized = sanitizeRecordByName(nodes);
        for (const [pageName, node] of Object.entries(sanitized)) {
          yield { pageName, node };
        }
      } else {
        throw err;
      }
    }
  }

  private async fetchByPages(
    fileKey: string,
    watchPages: string[],
    depth: number | undefined,
    batchSize: number,
  ): Promise<Record<string, FigmaNode>> {
    try {
      // Use the async generator to process pages one at a time as they are yielded,
      // sanitizing each page before storing it.
      // This keeps peak memory roughly proportional to the largest single page,
      // since large pages are fetched individually (small pages are batched).
      const iter = fetchFileProactiveIter(
        this.token,
        fileKey,
        watchPages,
        depth,
        batchSize,
      );

      // First yield is metadata — validate via discriminant
      const metaResult = await iter.next();
      if (metaResult.done || !metaResult.value || metaResult.value.kind !== "meta") {
        throw new Error("Expected initial metadata from fetchFileProactiveIter");
      }
      this.lastFileName = metaResult.value.fileName;

      const pages: Record<string, FigmaNode> = Object.create(null);
      for await (const entry of iter) {
        if (entry.kind !== "page") continue;
        pages[entry.pageName] = sanitizeNode(entry.node);
      }

      return pages;
    } catch (err) {
      if (isPayloadTooLargeError(err)) {
        console.log("  Payload too large — fetching page list and chunking...");
        const file = await fetchFile(this.token, fileKey, 1);
        this.lastFileName = file.name;
        const targetPages = filterWatchTargets(file, watchPages);
        const pageIds = targetPages.map((p) => p.id);
        const precomputedShallow: Record<string, FigmaNode> = {};
        for (const page of targetPages) {
          precomputedShallow[page.id] = page;
        }
        const nodes = await fetchNodesChunked(
          this.token,
          fileKey,
          pageIds,
          depth,
          batchSize,
          precomputedShallow,
        );
        return sanitizeRecordByName(nodes);
      }
      throw err;
    }
  }
}

