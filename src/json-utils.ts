import { readFile } from "node:fs/promises";

/**
 * JSON パースエラー。元のエラーとファイルパスを保持する。
 */
export class JsonParseError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to parse JSON from ${filePath}: ${detail}`);
    this.name = "JsonParseError";
  }
}

/**
 * ファイルを読み込み JSON としてパースする。
 * パース失敗時は JsonParseError をスローする（ファイルパス付き）。
 */
export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new JsonParseError(filePath, err);
  }
}
