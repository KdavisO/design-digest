import type { FigmaNode } from "../figma-client.js";
import { sanitizeNode } from "../figma-client.js";

// Re-export for adapters that need the base function alongside the helpers
export { sanitizeNode };

/**
 * Sanitize all nodes in a record, preserving original keys.
 * Use for ID-keyed or name-keyed records where the key should stay unchanged.
 *
 * Uses `Object.create(null)` to avoid prototype pollution from Figma-controlled keys.
 */
export function sanitizeRecord(
  nodes: Record<string, FigmaNode>,
): Record<string, FigmaNode> {
  const result = Object.create(null) as Record<string, FigmaNode>;
  for (const [key, node] of Object.entries(nodes)) {
    result[key] = sanitizeNode(node);
  }
  return result;
}

/**
 * Sanitize all nodes in a record, re-keying by node.name (falling back to the original key).
 * Use when converting from ID-keyed API responses to name-keyed page maps.
 *
 * Uses `Object.create(null)` to avoid prototype pollution from Figma-controlled names.
 * If multiple nodes share the same name, last-write-wins (later entries overwrite earlier ones).
 */
export function sanitizeRecordByName(
  nodes: Record<string, FigmaNode>,
): Record<string, FigmaNode> {
  const result = Object.create(null) as Record<string, FigmaNode>;
  for (const [id, node] of Object.entries(nodes)) {
    result[node.name || id] = sanitizeNode(node);
  }
  return result;
}
