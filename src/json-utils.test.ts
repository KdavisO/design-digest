import { describe, it, expect, afterAll } from "vitest";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonParseError, readJsonFile } from "./json-utils.js";

describe("readJsonFile", () => {
  let testDir: string;

  async function setup(): Promise<string> {
    if (!testDir) {
      testDir = await mkdtemp(join(tmpdir(), "json-utils-test-"));
    }
    return testDir;
  }

  async function writeTempFile(name: string, content: string): Promise<string> {
    const dir = await setup();
    const path = join(dir, name);
    await writeFile(path, content);
    return path;
  }

  afterAll(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("parses valid JSON file", async () => {
    const path = await writeTempFile("valid.json", '{"key": "value"}');
    const result = await readJsonFile<{ key: string }>(path);
    expect(result).toEqual({ key: "value" });
  });

  it("throws JsonParseError for invalid JSON", async () => {
    const path = await writeTempFile("invalid.json", "{broken");
    await expect(readJsonFile(path)).rejects.toThrow(JsonParseError);
    await expect(readJsonFile(path)).rejects.toThrow(/invalid\.json/);
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
  });

  it("throws ENOENT for missing file", async () => {
    const dir = await setup();
    const missingPath = join(dir, "missing.json");
    await expect(readJsonFile(missingPath)).rejects.toThrow(/ENOENT/);
  });
});
