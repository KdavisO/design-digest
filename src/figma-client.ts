export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  [key: string]: unknown;
}

export interface FigmaFile {
  name: string;
  lastModified: string;
  version: string;
  document: FigmaNode;
}

export interface FigmaUser {
  handle: string;
  img_url: string;
  id: string;
}

export interface FigmaVersion {
  id: string;
  created_at: string;
  label: string;
  description: string;
  user: FigmaUser;
}

export interface FigmaVersionsResponse {
  versions: FigmaVersion[];
}

const FIGMA_API_BASE = "https://api.figma.com/v1";

const NOISE_KEYS = new Set([
  "absoluteBoundingBox",
  "absoluteRenderBounds",
  "transitionNodeID",
  "prototypeDevice",
  "flowStartingPoints",
  "pluginData",
  "sharedPluginData",
  "exportSettings",
  "reactions",
  "prototypeStartNodeID",
  "scrollBehavior",
]);

export async function fetchFile(
  token: string,
  fileKey: string,
  depth?: number,
): Promise<FigmaFile> {
  let url = `${FIGMA_API_BASE}/files/${fileKey}`;
  if (depth !== undefined) url += `?depth=${depth}`;
  return figmaRequest(url, token);
}

/**
 * Fetch only the file name from Figma API (lightweight depth=1 call).
 * Returns undefined if the request fails, allowing callers to fall back to fileKey.
 */
export async function fetchFileName(
  token: string,
  fileKey: string,
): Promise<string | undefined> {
  try {
    const file = await fetchFile(token, fileKey, 1);
    return file.name;
  } catch {
    return undefined;
  }
}

export async function fetchNodes(
  token: string,
  fileKey: string,
  nodeIds: string[],
  depth?: number,
): Promise<Record<string, FigmaNode>> {
  const ids = nodeIds.join(",");
  let url = `${FIGMA_API_BASE}/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`;
  if (depth !== undefined) url += `&depth=${depth}`;
  const resp = await figmaRequest<{ nodes: Record<string, { document: FigmaNode }> }>(
    url,
    token,
  );
  const result: Record<string, FigmaNode> = {};
  for (const [id, node] of Object.entries(resp.nodes)) {
    result[id] = node.document;
  }
  return result;
}

/**
 * Calculate an adaptive batch size based on the number of child nodes.
 * Larger child counts get smaller batch sizes to avoid payload limits.
 */
export function adaptiveBatchSize(childCount: number, baseBatchSize: number): number {
  if (childCount <= 10) return baseBatchSize;
  if (childCount <= 50) return Math.min(baseBatchSize, 5);
  if (childCount <= 200) return Math.min(baseBatchSize, 3);
  return Math.min(baseBatchSize, 2);
}

/**
 * Fetch nodes in batches to avoid payload size limits on large files.
 * First fetches at depth=1 to get child IDs, then fetches children in batches.
 * If `precomputedShallow` is provided, skips the initial depth=1 discovery request.
 */
export async function fetchNodesChunked(
  token: string,
  fileKey: string,
  nodeIds: string[],
  depth?: number,
  batchSize: number = 5,
  precomputedShallow?: Record<string, FigmaNode>,
): Promise<Record<string, FigmaNode>> {
  const result: Record<string, FigmaNode> = {};

  // Use precomputed shallow data if available, otherwise fetch at depth=1
  const shallowAll = precomputedShallow ?? await fetchNodes(token, fileKey, nodeIds, 1);

  for (const nodeId of nodeIds) {
    const parentNode = shallowAll[nodeId];
    if (!parentNode) continue;

    const childIds = (parentNode.children ?? []).map((c) => c.id);

    if (childIds.length === 0) {
      // No children — use the shallow result directly (leaf nodes are complete)
      result[nodeId] = parentNode;
      continue;
    }

    console.log(
      `  Chunked fetch: ${parentNode.name} (${childIds.length} children, batch size ${batchSize})`,
    );

    if (childIds.length > 100) {
      console.warn(
        `  Warning: ${childIds.length} child nodes — this may take a while and approach API rate limits.`,
      );
    }

    // If depth=1, children were already included in discovery — use them directly
    if (depth === 1) {
      result[nodeId] = parentNode;
      continue;
    }

    // Fetch children in batches (depth-1 since children are one level deeper)
    const childDepth = depth !== undefined ? depth - 1 : depth;
    const children: FigmaNode[] = [];
    for (let i = 0; i < childIds.length; i += batchSize) {
      const batch = childIds.slice(i, i + batchSize);
      const batchNodes = await fetchNodes(token, fileKey, batch, childDepth);
      for (const id of batch) {
        if (batchNodes[id]) children.push(batchNodes[id]);
      }
    }

    // Reassemble parent with fully fetched children
    result[nodeId] = { ...parentNode, children };
  }

  return result;
}

/** Threshold for proactive chunking: if a page has more children than this, chunk instead of fetching full. */
export const PROACTIVE_CHUNK_THRESHOLD = 50;

/**
 * Fetch file with proactive chunking for large pages.
 * Fetches at depth=1 first to estimate size, then decides per-page whether
 * to fetch the full subtree or chunk by children.
 * Returns pages keyed by page name, plus targetPageIds for fallback use.
 */
export async function fetchFileProactive(
  token: string,
  fileKey: string,
  watchPages: string[],
  depth?: number,
  batchSize: number = 5,
): Promise<{ pages: Record<string, FigmaNode>; chunkedPages: string[]; targetPageIds: string[]; fileName: string }> {
  // Step 1: Fetch shallow file to get page-level structure
  const shallowFile = await fetchFile(token, fileKey, 1);
  const targetPages = filterWatchTargets(shallowFile, watchPages);

  const pages: Record<string, FigmaNode> = {};
  const chunkedPages: string[] = [];

  // Step 2: Classify pages by complexity
  const smallPages: FigmaNode[] = [];
  const largePages: FigmaNode[] = [];

  for (const page of targetPages) {
    const childCount = page.children?.length ?? 0;
    if (childCount > PROACTIVE_CHUNK_THRESHOLD) {
      largePages.push(page);
    } else {
      smallPages.push(page);
    }
  }

  // Step 3: Fetch small pages together via /nodes endpoint (single request if possible)
  if (smallPages.length > 0) {
    if (depth === 1) {
      // depth=1: the shallow file already contains the full page nodes we need
      for (const page of smallPages) {
        pages[page.name || page.id] = page;
      }
    } else {
      const smallPageIds = smallPages.map((p) => p.id);
      const nodes = await fetchNodes(token, fileKey, smallPageIds, depth);
      for (const [id, node] of Object.entries(nodes)) {
        pages[node.name || id] = node;
      }
    }
  }

  // Step 4: Fetch large pages — use shallow result for depth=1, chunked fetch otherwise
  if (largePages.length > 0) {
    if (depth === 1) {
      // depth=1: shallow file already contains the full page nodes
      for (const page of largePages) {
        pages[page.name || page.id] = page;
      }
    } else {
      const perPageBatches = largePages.map((page) => {
        const childCount = page.children?.length ?? 0;
        return adaptiveBatchSize(childCount, batchSize);
      });
      const globalEffectiveBatch = Math.min(...perPageBatches);

      for (const page of largePages) {
        const childCount = page.children?.length ?? 0;
        console.log(
          `  Proactive chunked fetch: ${page.name} (${childCount} children, batch size ${globalEffectiveBatch})`,
        );
        chunkedPages.push(page.name);
      }

      const largePageIds = largePages.map((p) => p.id);
      // Build precomputed shallow map from the depth=1 file fetch to avoid redundant API call
      const precomputedShallow: Record<string, FigmaNode> = {};
      for (const page of largePages) {
        precomputedShallow[page.id] = page;
      }
      const chunkedNodes = await fetchNodesChunked(
        token,
        fileKey,
        largePageIds,
        depth,
        globalEffectiveBatch,
        precomputedShallow,
      );
      for (const page of largePages) {
        const node = chunkedNodes[page.id];
        if (node) {
          pages[node.name || page.id] = node;
        }
      }
    }
  }

  const targetPageIds = targetPages.map((p) => p.id);
  return { pages, chunkedPages, targetPageIds, fileName: shallowFile.name };
}

/**
 * Fetch specific nodes with proactive chunking for large nodes.
 * Fetches at depth=1 first, then decides per-node whether to chunk.
 */
export async function fetchNodesProactive(
  token: string,
  fileKey: string,
  nodeIds: string[],
  depth?: number,
  batchSize: number = 5,
): Promise<{ nodes: Record<string, FigmaNode>; chunkedNodes: string[] }> {
  // Step 1: Fetch all nodes at depth=1 to check complexity
  const shallowNodes = await fetchNodes(token, fileKey, nodeIds, 1);

  const result: Record<string, FigmaNode> = {};
  const chunkedNodeNames: string[] = [];
  const smallNodeIds: string[] = [];
  const largeNodeIds: string[] = [];

  for (const nodeId of nodeIds) {
    const node = shallowNodes[nodeId];
    if (!node) continue;
    const childCount = node.children?.length ?? 0;
    if (childCount > PROACTIVE_CHUNK_THRESHOLD) {
      largeNodeIds.push(nodeId);
    } else {
      smallNodeIds.push(nodeId);
    }
  }

  // Step 2: Fetch small nodes in a single request
  if (smallNodeIds.length > 0) {
    // If depth=1, we already have the data from the shallow fetch
    if (depth === 1) {
      for (const id of smallNodeIds) {
        if (shallowNodes[id]) result[id] = shallowNodes[id];
      }
    } else {
      const nodes = await fetchNodes(token, fileKey, smallNodeIds, depth);
      for (const [id, node] of Object.entries(nodes)) {
        result[id] = node;
      }
    }
  }

  // Step 3: Fetch large nodes
  if (largeNodeIds.length > 0) {
    // For depth=1, reuse shallow nodes directly (no extra API calls)
    if (depth === 1) {
      for (const nodeId of largeNodeIds) {
        const node = shallowNodes[nodeId];
        if (node) {
          result[nodeId] = node;
        }
      }
    } else {
      // Batch all large nodes into a single fetchNodesChunked call
      const perNodeBatches = largeNodeIds.map((nodeId) => {
        const childCount = shallowNodes[nodeId]?.children?.length ?? 0;
        return adaptiveBatchSize(childCount, batchSize);
      });
      const globalEffectiveBatch = Math.min(...perNodeBatches);

      for (const nodeId of largeNodeIds) {
        const node = shallowNodes[nodeId];
        const childCount = node?.children?.length ?? 0;
        console.log(
          `  Proactive chunked fetch: ${node?.name ?? nodeId} (${childCount} children, batch size ${globalEffectiveBatch})`,
        );
        chunkedNodeNames.push(node?.name ?? nodeId);
      }

      // Build precomputed shallow map to avoid redundant depth=1 fetch
      const precomputedShallow: Record<string, FigmaNode> = {};
      for (const nodeId of largeNodeIds) {
        if (shallowNodes[nodeId]) precomputedShallow[nodeId] = shallowNodes[nodeId];
      }
      const chunkedNodes = await fetchNodesChunked(
        token,
        fileKey,
        largeNodeIds,
        depth,
        globalEffectiveBatch,
        precomputedShallow,
      );
      for (const nodeId of largeNodeIds) {
        if (chunkedNodes[nodeId]) {
          result[nodeId] = chunkedNodes[nodeId];
        }
      }
    }
  }

  return { nodes: result, chunkedNodes: chunkedNodeNames };
}

/**
 * Check if a file's version has changed since the given version ID.
 * Returns `{ changed, latestVersionId }` where `latestVersionId` may be
 * undefined if the versions list is empty.
 */
export async function checkVersionChanged(
  token: string,
  fileKey: string,
  lastVersionId: string | undefined,
): Promise<{ changed: boolean; latestVersionId: string | undefined }> {
  const versions = await fetchVersions(token, fileKey);
  const latestVersionId = versions.length > 0 ? versions[0].id : undefined;

  if (!lastVersionId || !latestVersionId || latestVersionId !== lastVersionId) {
    return { changed: true, latestVersionId };
  }

  return { changed: false, latestVersionId };
}

export async function fetchVersions(
  token: string,
  fileKey: string,
): Promise<FigmaVersion[]> {
  const url = `${FIGMA_API_BASE}/files/${fileKey}/versions`;
  const resp = await figmaRequest<FigmaVersionsResponse>(url, token);
  return resp.versions;
}

/**
 * Extract unique editors from version history since a given timestamp.
 * Returns deduplicated users who made changes after `sinceTimestamp`.
 */
export function extractEditorsSince(
  versions: FigmaVersion[],
  sinceTimestamp: string,
): FigmaUser[] {
  const sinceDate = new Date(sinceTimestamp);
  const recentVersions = versions.filter(
    (v) => new Date(v.created_at) > sinceDate,
  );

  const seen = new Set<string>();
  const editors: FigmaUser[] = [];

  for (const version of recentVersions) {
    if (!seen.has(version.user.id)) {
      seen.add(version.user.id);
      editors.push(version.user);
    }
  }

  return editors;
}

export function filterWatchTargets(
  file: FigmaFile,
  watchPages: string[],
): FigmaNode[] {
  const pages = file.document.children ?? [];
  if (watchPages.length === 0) return pages;
  return pages.filter((page) => watchPages.includes(page.name));
}

export function sanitizeNode<T>(node: T): T {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(sanitizeNode) as T;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (NOISE_KEYS.has(key)) continue;
    result[key] = sanitizeNode(value);
  }
  return result as T;
}

/**
 * Heuristic detection of payload-too-large / OOM-style failures.
 * Shared across REST adapter (API response errors) and design-check (file parse errors).
 */
export function isPayloadTooLargeError(err: unknown): boolean {
  // Check error code first (e.g. Node.js ERR_STRING_TOO_LONG)
  if (err instanceof Error && "code" in err) {
    const code = (err as Error & { code?: string }).code;
    if (code === "ERR_STRING_TOO_LONG") return true;
  }
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    message.includes("request too large") ||
    message.includes("try a smaller request") ||
    message.includes("invalid string length") ||
    message.includes("allocation failed") ||
    message.includes("out of memory") ||
    message.includes("string longer than")
  );
}

async function figmaRequest<T>(url: string, token: string): Promise<T> {
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "X-Figma-Token": token },
    });

    if (response.status === 429) {
      if (attempt === maxRetries) {
        throw new Error("Figma API rate limit exceeded after retries");
      }
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = Math.min(parseRetryAfter(retryAfter, attempt), 30000);
      console.warn(
        `Rate limited by Figma API, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`,
      );
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Figma API error: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
      );
    }

    return (await response.json()) as T;
  }

  throw new Error("Unreachable");
}

function parseRetryAfter(header: string | null, attempt: number): number {
  if (!header) return 1000 * 2 ** attempt;

  // Try as seconds first
  const seconds = Number(header);
  if (!isNaN(seconds) && seconds > 0 && seconds < 600) {
    return seconds * 1000;
  }

  // Try as HTTP-date
  const date = new Date(header);
  if (!isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    if (delayMs > 0) return delayMs;
  }

  return 1000 * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
