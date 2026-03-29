import { z } from "zod";

/**
 * Zod schemas for Figma API responses.
 * Used by figmaRequest() to validate API responses at runtime,
 * catching unexpected response formats early with clear error messages.
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

type FigmaNodeInput = z.input<typeof baseFigmaNode> & {
  children?: FigmaNodeInput[];
  [key: string]: unknown;
};

// Recursive schema using z.lazy for children
export const figmaNodeSchema: z.ZodType<FigmaNodeInput> = baseFigmaNode.extend({
  children: z.lazy(() => z.array(figmaNodeSchema)).optional(),
}).passthrough() as z.ZodType<FigmaNodeInput>;

/** Schema for FigmaFile (GET /files/:key) */
export const figmaFileSchema = z.object({
  name: z.string(),
  lastModified: z.string(),
  version: z.string(),
  document: figmaNodeSchema,
}).passthrough();

/** Schema for FigmaUser */
export const figmaUserSchema = z.object({
  handle: z.string(),
  img_url: z.string(),
  id: z.string(),
}).passthrough();

/** Schema for FigmaVersion */
export const figmaVersionSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  label: z.string(),
  description: z.string(),
  user: figmaUserSchema,
}).passthrough();

/** Schema for FigmaVersionsResponse (GET /files/:key/versions) */
export const figmaVersionsResponseSchema = z.object({
  versions: z.array(figmaVersionSchema),
}).passthrough();

/** Schema for fetchNodes response (GET /files/:key/nodes) */
export const figmaNodesResponseSchema = z.object({
  nodes: z.record(z.string(), z.object({
    document: figmaNodeSchema,
  }).passthrough()),
}).passthrough();
