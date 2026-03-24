import { describe, it, expect } from "vitest";
import { sanitizeNode, filterWatchTargets, extractEditorsSince } from "./figma-client.js";
import type { FigmaNode, FigmaFile, FigmaVersion } from "./figma-client.js";

describe("sanitizeNode", () => {
  it("removes noise keys", () => {
    const node = {
      id: "1",
      name: "Frame",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      absoluteRenderBounds: { x: 0, y: 0, width: 100, height: 100 },
      pluginData: { foo: "bar" },
      sharedPluginData: { baz: "qux" },
      exportSettings: [{}],
      reactions: [],
      scrollBehavior: "SCROLLS",
      fills: [{ type: "SOLID" }],
    };
    const result = sanitizeNode(node);
    expect(result).not.toHaveProperty("absoluteBoundingBox");
    expect(result).not.toHaveProperty("absoluteRenderBounds");
    expect(result).not.toHaveProperty("pluginData");
    expect(result).not.toHaveProperty("sharedPluginData");
    expect(result).not.toHaveProperty("exportSettings");
    expect(result).not.toHaveProperty("reactions");
    expect(result).not.toHaveProperty("scrollBehavior");
    expect(result).toHaveProperty("fills");
    expect(result).toHaveProperty("name");
  });

  it("recursively sanitizes children", () => {
    const node = {
      id: "1",
      name: "Parent",
      type: "FRAME",
      children: [
        {
          id: "2",
          name: "Child",
          type: "TEXT",
          absoluteBoundingBox: { x: 10, y: 10, width: 50, height: 20 },
          characters: "Hello",
        },
      ],
    };
    const result = sanitizeNode(node) as FigmaNode;
    const child = (result.children as FigmaNode[])[0];
    expect(child).not.toHaveProperty("absoluteBoundingBox");
    expect(child).toHaveProperty("characters", "Hello");
  });

  it("handles arrays", () => {
    const arr = [
      { absoluteBoundingBox: {}, name: "a" },
      { absoluteRenderBounds: {}, name: "b" },
    ];
    const result = sanitizeNode(arr);
    expect(result[0]).not.toHaveProperty("absoluteBoundingBox");
    expect(result[1]).not.toHaveProperty("absoluteRenderBounds");
  });

  it("handles null and primitives", () => {
    expect(sanitizeNode(null)).toBeNull();
    expect(sanitizeNode(42)).toBe(42);
    expect(sanitizeNode("hello")).toBe("hello");
  });
});

describe("filterWatchTargets", () => {
  const file: FigmaFile = {
    name: "Test File",
    lastModified: "2024-01-01",
    version: "1",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [
        { id: "1:0", name: "Home", type: "PAGE" },
        { id: "2:0", name: "Settings", type: "PAGE" },
        { id: "3:0", name: "Archive", type: "PAGE" },
      ],
    },
  };

  it("returns all pages when no filter specified", () => {
    const result = filterWatchTargets(file, []);
    expect(result).toHaveLength(3);
  });

  it("filters to specified pages", () => {
    const result = filterWatchTargets(file, ["Home", "Settings"]);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.name)).toEqual(["Home", "Settings"]);
  });

  it("handles non-matching page names", () => {
    const result = filterWatchTargets(file, ["NonExistent"]);
    expect(result).toHaveLength(0);
  });
});

describe("extractEditorsSince", () => {
  const makeVersion = (
    id: string,
    createdAt: string,
    userId: string,
    handle: string,
  ): FigmaVersion => ({
    id,
    created_at: createdAt,
    label: "",
    description: "",
    user: { id: userId, handle, img_url: `https://img.example.com/${userId}` },
  });

  it("returns editors after the given timestamp", () => {
    const versions: FigmaVersion[] = [
      makeVersion("v3", "2024-01-03T00:00:00Z", "u1", "Alice"),
      makeVersion("v2", "2024-01-02T00:00:00Z", "u2", "Bob"),
      makeVersion("v1", "2024-01-01T00:00:00Z", "u3", "Charlie"),
    ];
    const editors = extractEditorsSince(versions, "2024-01-01T12:00:00Z");
    expect(editors).toHaveLength(2);
    expect(editors.map((e) => e.handle)).toEqual(["Alice", "Bob"]);
  });

  it("deduplicates users", () => {
    const versions: FigmaVersion[] = [
      makeVersion("v3", "2024-01-03T00:00:00Z", "u1", "Alice"),
      makeVersion("v2", "2024-01-02T00:00:00Z", "u1", "Alice"),
    ];
    const editors = extractEditorsSince(versions, "2024-01-01T00:00:00Z");
    expect(editors).toHaveLength(1);
    expect(editors[0].handle).toBe("Alice");
  });

  it("returns empty array when no versions are after the timestamp", () => {
    const versions: FigmaVersion[] = [
      makeVersion("v1", "2024-01-01T00:00:00Z", "u1", "Alice"),
    ];
    const editors = extractEditorsSince(versions, "2024-01-02T00:00:00Z");
    expect(editors).toHaveLength(0);
  });

  it("returns empty array for empty versions list", () => {
    const editors = extractEditorsSince([], "2024-01-01T00:00:00Z");
    expect(editors).toHaveLength(0);
  });
});
