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
 * Fetch nodes in batches to avoid payload size limits on large files.
 * First fetches at depth=1 to get child IDs, then fetches children in batches.
 */
export async function fetchNodesChunked(
  token: string,
  fileKey: string,
  nodeIds: string[],
  depth?: number,
  batchSize: number = 5,
): Promise<Record<string, FigmaNode>> {
  const result: Record<string, FigmaNode> = {};

  for (const nodeId of nodeIds) {
    // Get child IDs at depth=1
    const shallow = await fetchNodes(token, fileKey, [nodeId], 1);
    const parentNode = shallow[nodeId];
    if (!parentNode) continue;

    const childIds = (parentNode.children ?? []).map((c) => c.id);

    if (childIds.length === 0) {
      // No children — fetch the node itself at full depth
      const full = await fetchNodes(token, fileKey, [nodeId], depth);
      if (full[nodeId]) result[nodeId] = full[nodeId];
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

    // Fetch children in batches
    const children: FigmaNode[] = [];
    for (let i = 0; i < childIds.length; i += batchSize) {
      const batch = childIds.slice(i, i + batchSize);
      const batchNodes = await fetchNodes(token, fileKey, batch, depth);
      for (const id of batch) {
        if (batchNodes[id]) children.push(batchNodes[id]);
      }
    }

    // Reassemble parent with fully fetched children
    result[nodeId] = { ...parentNode, children };
  }

  return result;
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
