import type { FigmaNode } from "../figma-client.js";

/**
 * Common interface for fetching Figma file data.
 * Abstracts the data source (REST API vs MCP) so the diff engine
 * can work with either without changes.
 */
export interface FigmaDataAdapter {
  /** Human-readable name of the adapter (e.g. "REST API", "MCP") */
  readonly name: string;

  /**
   * Fetch pages from a Figma file.
   * Returns sanitized pages keyed by page name.
   */
  fetchPages(
    fileKey: string,
    options?: FetchPagesOptions,
  ): Promise<Record<string, FigmaNode>>;
}

export interface FetchPagesOptions {
  /** Page names to watch (empty = all pages) */
  watchPages?: string[];
  /** Specific node IDs to watch (overrides watchPages if set) */
  watchNodeIds?: string[];
  /** Depth limit for node tree fetching */
  depth?: number;
  /** Batch size for chunked fetching */
  batchSize?: number;
}
