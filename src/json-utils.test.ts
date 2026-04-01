import { describe, it, expect } from "vitest";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonParseError, readJsonFile } from "./json-utils.js";

describe("readJsonFile", () => {
  const testDir = join(tmpdir(), "json-utils-test");

  async function writeTempFile(name: string, content: string): Promise<string> {
    await mkdir(testDir, { recursive: true });
    const path = join(testDir, name);
    await writeFile(path, content);
    return path;
  }

  it("parses valid JSON file", async () => {
    const path = await writeTempFile("valid.json", '{"key": "value"}');
    const result = await readJsonFile<{ key: string }>(path);
    expect(result).toEqual({ key: "value" });
    await rm(path);
  });

  it("throws JsonParseError for invalid JSON", async () => {
    const path = await writeTempFile("invalid.json", "{broken");
    await expect(readJsonFile(path)).rejects.toThrow(JsonParseError);
    await expect(readJsonFile(path)).rejects.toThrow(/invalid\.json/);
    await rm(path);
  });

  it("JsonParseError preserves filePath and cause", async () => {
    const path = await writeTempFile("bad.json", "not json");
    try {
      await readJsonFile(path);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(JsonParseError);
      const parseErr = err as JsonParseError;
      expect(parseErr.filePath).toBe(path);
      expect(parseErr.cause).toBeInstanceOf(SyntaxError);
    }
    await rm(path);
  });

  it("throws ENOENT for missing file", async () => {
    await expect(readJsonFile("/nonexistent/path.json")).rejects.toThrow(/ENOENT/);
  });
});
