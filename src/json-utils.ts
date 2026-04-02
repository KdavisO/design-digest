import { readFile } from "node:fs/promises";

/**
 * JSON parse error that retains the file path and the underlying cause.
 */
export class JsonParseError extends Error {
  public readonly filePath: string;

  constructor(filePath: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to parse JSON from ${filePath}: ${detail}`, { cause });
    this.name = "JsonParseError";
    this.filePath = filePath;
  }
}

/**
 * Read a file and parse it as JSON.
 *
 * Throws JsonParseError on JSON parse failure (includes the file path).
 * Note: I/O errors from readFile (e.g. ENOENT, EACCES) are not wrapped and
 * will be thrown as-is, so callers may need to handle filesystem errors
 * separately.
 */
export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new JsonParseError(filePath, err);
  }
}
