import type { Config } from "./config.js";

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
]);

export async function fetchFile(config: Config): Promise<FigmaFile> {
  const url = `${FIGMA_API_BASE}/files/${config.figmaFileKey}`;
  return figmaRequest(url, config.figmaToken);
}

export async function fetchNodes(
  config: Config,
): Promise<Record<string, FigmaNode>> {
  const ids = config.figmaWatchNodeIds.join(",");
  const url = `${FIGMA_API_BASE}/files/${config.figmaFileKey}/nodes?ids=${encodeURIComponent(ids)}`;
  const resp = await figmaRequest<{ nodes: Record<string, { document: FigmaNode }> }>(
    url,
    config.figmaToken,
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
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : Math.min(1000 * 2 ** attempt, 30000);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
