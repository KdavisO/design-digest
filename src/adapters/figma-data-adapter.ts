import type { FigmaNode, FigmaVersion, FigmaUser } from "../figma-client.js";

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

  /**
   * Fetch specific nodes by ID from a Figma file.
   * Returns sanitized nodes keyed by node ID.
   */
  fetchNodes(
    fileKey: string,
    nodeIds: string[],
    depth?: number,
  ): Promise<Record<string, FigmaNode>>;

  /**
   * Fetch version history for a Figma file.
   */
  fetchVersions(fileKey: string): Promise<FigmaVersion[]>;

  /**
   * Check if a file's version has changed since the given version ID.
   */
  checkVersionChanged(
    fileKey: string,
    lastVersionId: string | undefined,
  ): Promise<{ changed: boolean; latestVersionId: string | undefined }>;

  /**
   * Extract unique editors from version history since a given timestamp.
   */
  extractEditorsSince(
    versions: FigmaVersion[],
    sinceTimestamp: string,
  ): FigmaUser[];
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
