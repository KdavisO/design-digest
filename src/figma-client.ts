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
): Promise<FigmaFile> {
  const url = `${FIGMA_API_BASE}/files/${fileKey}`;
  return figmaRequest(url, token);
}

export async function fetchNodes(
  token: string,
  fileKey: string,
  nodeIds: string[],
): Promise<Record<string, FigmaNode>> {
  const ids = nodeIds.join(",");
  const url = `${FIGMA_API_BASE}/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`;
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
