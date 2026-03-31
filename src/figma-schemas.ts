import { z } from "zod";
import type {
  FigmaNode,
  FigmaFile,
  FigmaVersion,
  FigmaUser,
  FigmaVersionsResponse,
  FigmaNodesResponse,
} from "./figma-client.js";

/**
 * Zod schemas for Figma API responses.
 * Used by figmaRequest() to validate API responses at runtime,
 * catching unexpected response formats early with clear error messages.
 *
 * Schemas are typed against the corresponding TypeScript interfaces
 * from figma-client.ts to prevent drift between runtime validation
 * and compile-time types.
 *
 * Schemas use passthrough() on objects to allow extra Figma properties
 * that we don't explicitly model (e.g. fills, strokes, effects).
 */

/** Schema for FigmaNode — recursive, allows extra keys via passthrough */
const baseFigmaNode = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
}).passthrough();

// Recursive schema using z.lazy for children.
// Typed against FigmaNode to ensure schema-interface alignment.
// baseFigmaNode already has passthrough(), so extend() inherits it.
export const figmaNodeSchema: z.ZodType<FigmaNode> = baseFigmaNode.extend({
  children: z.lazy(() => z.array(figmaNodeSchema)).optional(),
});

/** Schema for FigmaUser — typed against FigmaUser interface */
export const figmaUserSchema: z.ZodType<FigmaUser> = z.object({
  handle: z.string(),
  img_url: z.string(),
  id: z.string(),
}).passthrough();

/** Schema for FigmaVersion — typed against FigmaVersion interface */
export const figmaVersionSchema: z.ZodType<FigmaVersion> = z.object({
  id: z.string(),
  created_at: z.string(),
  label: z.string().nullable(),
  description: z.string().nullable(),
  user: figmaUserSchema,
}).passthrough();

/** Schema for FigmaFile (GET /files/:key) — typed against FigmaFile interface */
export const figmaFileSchema: z.ZodType<FigmaFile> = z.object({
  name: z.string(),
  lastModified: z.string(),
  version: z.string(),
  document: figmaNodeSchema,
}).passthrough();

/** Schema for FigmaVersionsResponse (GET /files/:key/versions) — typed against FigmaVersionsResponse interface */
export const figmaVersionsResponseSchema: z.ZodType<FigmaVersionsResponse> = z.object({
  versions: z.array(figmaVersionSchema),
}).passthrough();

/** Schema for fetchNodes response (GET /files/:key/nodes) — typed against FigmaNodesResponse interface */
export const figmaNodesResponseSchema: z.ZodType<FigmaNodesResponse> = z.object({
  nodes: z.record(z.string(), z.object({
    document: figmaNodeSchema,
  }).passthrough()),
}).passthrough();
