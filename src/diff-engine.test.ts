import { describe, it, expect } from "vitest";
import { detectChanges, formatConsoleReport, formatSlackReport } from "./diff-engine.js";
import type { FigmaNode } from "./figma-client.js";

function makeNode(overrides: Partial<FigmaNode> & { id: string; name: string }): FigmaNode {
  return {
    type: "FRAME",
    ...overrides,
  };
}

function makePage(name: string, children: FigmaNode[]): FigmaNode {
  return {
    id: `page:${name}`,
    name,
    type: "PAGE",
    children,
  };
}

describe("detectChanges", () => {
  it("detects no changes when pages are identical", () => {
    const page = makePage("Home", [
      makeNode({ id: "1", name: "Header", fills: [{ color: "#000" }] }),
    ]);
    const pages = { Home: page };
    const changes = detectChanges(pages, structuredClone(pages));
    expect(changes).toHaveLength(0);
  });

  it("detects added page", () => {
    const oldPages = {};
    const newPages = {
      Home: makePage("Home", []),
    };
    const changes = detectChanges(oldPages, newPages);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("added");
    expect(changes[0].pageName).toBe("Home");
  });

  it("detects deleted page", () => {
    const oldPages = {
      Home: makePage("Home", []),
    };
    const newPages = {};
    const changes = detectChanges(oldPages, newPages);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("deleted");
    expect(changes[0].pageName).toBe("Home");
  });

  it("detects added node", () => {
    const oldPages = {
      Home: makePage("Home", [
        makeNode({ id: "1", name: "Header" }),
      ]),
    };
    const newPages = {
      Home: makePage("Home", [
        makeNode({ id: "1", name: "Header" }),
        makeNode({ id: "2", name: "Footer" }),
      ]),
    };
    const changes = detectChanges(oldPages, newPages);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("added");
    expect(changes[0].nodeName).toBe("Footer");
    expect(changes[0].nodeId).toBe("2");
  });

  it("detects deleted node", () => {
    const oldPages = {
      Home: makePage("Home", [
        makeNode({ id: "1", name: "Header" }),
        makeNode({ id: "2", name: "Footer" }),
      ]),
    };
    const newPages = {
      Home: makePage("Home", [
        makeNode({ id: "1", name: "Header" }),
      ]),
    };
    const changes = detectChanges(oldPages, newPages);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("deleted");
    expect(changes[0].nodeName).toBe("Footer");
  });

  it("detects modified property", () => {
    const oldPages = {
      Home: makePage("Home", [
        makeNode({ id: "1", name: "Button", fontSize: 14 }),
      ]),
    };
    const newPages = {
      Home: makePage("Home", [
        makeNode({ id: "1", name: "Button", fontSize: 16 }),
      ]),
    };
    const changes = detectChanges(oldPages, newPages);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("modified");
    expect(changes[0].property).toBe("fontSize");
    expect(changes[0].oldValue).toBe(14);
    expect(changes[0].newValue).toBe(16);
  });

  it("detects multiple property changes on same node", () => {
    const oldPages = {
      Home: makePage("Home", [
        makeNode({ id: "1", name: "Text", fontSize: 14, opacity: 1 }),
      ]),
    };
    const newPages = {
      Home: makePage("Home", [
        makeNode({ id: "1", name: "Text", fontSize: 16, opacity: 0.5 }),
      ]),
    };
    const changes = detectChanges(oldPages, newPages);
    expect(changes).toHaveLength(2);
    expect(changes.every((c) => c.kind === "modified")).toBe(true);
  });

  it("detects changes across multiple pages", () => {
    const oldPages = {
      Home: makePage("Home", [
        makeNode({ id: "1", name: "Header", fontSize: 14 }),
      ]),
      Settings: makePage("Settings", [
        makeNode({ id: "2", name: "Toggle", visible: true }),
      ]),
    };
    const newPages = {
      Home: makePage("Home", [
        makeNode({ id: "1", name: "Header", fontSize: 16 }),
      ]),
      Settings: makePage("Settings", [
        makeNode({ id: "2", name: "Toggle", visible: false }),
      ]),
    };
    const changes = detectChanges(oldPages, newPages);
    expect(changes).toHaveLength(2);
    expect(changes.map((c) => c.pageName).sort()).toEqual(["Home", "Settings"]);
  });

  it("detects nested node changes", () => {
    const oldPages = {
      Home: makePage("Home", [
        makeNode({
          id: "1",
          name: "Card",
          children: [
            makeNode({ id: "1:1", name: "Title", characters: "Hello" }),
          ],
        }),
      ]),
    };
    const newPages = {
      Home: makePage("Home", [
        makeNode({
          id: "1",
          name: "Card",
          children: [
            makeNode({ id: "1:1", name: "Title", characters: "World" }),
          ],
        }),
      ]),
    };
    const changes = detectChanges(oldPages, newPages);
    expect(changes).toHaveLength(1);
    expect(changes[0].nodeName).toBe("Title");
    expect(changes[0].property).toBe("characters");
    expect(changes[0].oldValue).toBe("Hello");
    expect(changes[0].newValue).toBe("World");
  });

  it("detects fill color changes", () => {
    const oldPages = {
      Home: makePage("Home", [
        makeNode({
          id: "1",
          name: "Box",
          fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
        }),
      ]),
    };
    const newPages = {
      Home: makePage("Home", [
        makeNode({
          id: "1",
          name: "Box",
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }],
        }),
      ]),
    };
    const changes = detectChanges(oldPages, newPages);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0].property).toBe("fills");
  });

  it("detects node rename (same ID, different name)", () => {
    const oldPages = {
      Home: makePage("Home", [
        makeNode({ id: "1", name: "OldName" }),
      ]),
    };
    const newPages = {
      Home: makePage("Home", [
        makeNode({ id: "1", name: "NewName" }),
      ]),
    };
    const changes = detectChanges(oldPages, newPages);
    const rename = changes.find((c) => c.kind === "renamed");
    expect(rename).toBeDefined();
    expect(rename!.oldValue).toBe("OldName");
    expect(rename!.newValue).toBe("NewName");
  });

  it("matches nodes with changed IDs by type+name instead of add+delete", () => {
    const oldPages = {
      Home: makePage("Home", [
        makeNode({ id: "1", name: "Button", fontSize: 14 }),
      ]),
    };
    const newPages = {
      Home: makePage("Home", [
        makeNode({ id: "99", name: "Button", fontSize: 16 }),
      ]),
    };
    const changes = detectChanges(oldPages, newPages);
    // Should detect as modified, not add+delete
    const added = changes.filter((c) => c.kind === "added");
    const deleted = changes.filter((c) => c.kind === "deleted");
    const modified = changes.filter((c) => c.kind === "modified");
    expect(added).toHaveLength(0);
    expect(deleted).toHaveLength(0);
    expect(modified).toHaveLength(1);
    expect(modified[0].property).toBe("fontSize");
  });

  it("marks override changes on INSTANCE nodes", () => {
    const oldPages = {
      Home: makePage("Home", [
        makeNode({
          id: "1",
          name: "MyButton",
          type: "INSTANCE",
          componentId: "comp:1",
          characters: "Click",
        }),
      ]),
    };
    const newPages = {
      Home: makePage("Home", [
        makeNode({
          id: "1",
          name: "MyButton",
          type: "INSTANCE",
          componentId: "comp:1",
          characters: "Submit",
        }),
      ]),
    };
    const changes = detectChanges(oldPages, newPages);
    expect(changes).toHaveLength(1);
    expect(changes[0].isOverride).toBe(true);
  });

  it("marks non-override changes on INSTANCE nodes", () => {
    const oldPages = {
      Home: makePage("Home", [
        makeNode({
          id: "1",
          name: "MyButton",
          type: "INSTANCE",
          componentId: "comp:1",
          layoutMode: "HORIZONTAL",
        }),
      ]),
    };
    const newPages = {
      Home: makePage("Home", [
        makeNode({
          id: "1",
          name: "MyButton",
          type: "INSTANCE",
          componentId: "comp:1",
          layoutMode: "VERTICAL",
        }),
      ]),
    };
    const changes = detectChanges(oldPages, newPages);
    expect(changes).toHaveLength(1);
    expect(changes[0].isOverride).toBe(false);
  });
});

describe("color formatting in reports", () => {
  it("formats fill color changes as hex in console report", () => {
    const changes = [
      {
        pageName: "Home",
        nodeId: "1",
        nodeName: "Box",
        nodeType: "FRAME",
        kind: "modified" as const,
        property: "fills",
        oldValue: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
        newValue: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }],
      },
    ];
    const report = formatConsoleReport("abc123", changes);
    expect(report).toContain("#ff0000");
    expect(report).toContain("#0000ff");
  });

  it("formats color with opacity", () => {
    const changes = [
      {
        pageName: "Home",
        nodeId: "1",
        nodeName: "Box",
        nodeType: "FRAME",
        kind: "modified" as const,
        property: "fills",
        oldValue: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0.5 }],
        newValue: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 }],
      },
    ];
    const report = formatConsoleReport("abc123", changes);
    expect(report).toContain("#ffffff 50%");
    expect(report).toContain("#000000");
  });
});

describe("formatConsoleReport", () => {
  it("returns no-changes message when empty", () => {
    const report = formatConsoleReport("abc123", []);
    expect(report).toContain("No changes");
  });

  it("formats added/deleted/modified entries", () => {
    const changes = [
      {
        pageName: "Home",
        nodeId: "1",
        nodeName: "Button",
        nodeType: "FRAME",
        kind: "added" as const,
      },
      {
        pageName: "Home",
        nodeId: "2",
        nodeName: "Header",
        nodeType: "FRAME",
        kind: "deleted" as const,
      },
      {
        pageName: "Home",
        nodeId: "3",
        nodeName: "Text",
        nodeType: "TEXT",
        kind: "modified" as const,
        property: "fontSize",
        oldValue: 14,
        newValue: 16,
      },
    ];
    const report = formatConsoleReport("abc123", changes);
    expect(report).toContain("3 change(s)");
    expect(report).toContain("Button");
    expect(report).toContain("Header");
    expect(report).toContain("フォントサイズ");
    expect(report).toContain("14");
    expect(report).toContain("16");
  });

  it("aggregates when same node has more than 5 changes", () => {
    const changes = Array.from({ length: 7 }, (_, i) => ({
      pageName: "Home",
      nodeId: "1",
      nodeName: "BigFrame",
      nodeType: "FRAME",
      kind: "modified" as const,
      property: `prop${i}`,
      oldValue: i,
      newValue: i + 1,
    }));
    const report = formatConsoleReport("abc123", changes);
    expect(report).toContain("7 properties changed");
  });
});

describe("formatSlackReport", () => {
  it("returns empty string for no changes", () => {
    expect(formatSlackReport("abc123", [])).toBe("");
  });

  it("includes Figma link", () => {
    const changes = [
      {
        pageName: "Home",
        nodeId: "1",
        nodeName: "Button",
        nodeType: "FRAME",
        kind: "added" as const,
      },
    ];
    const report = formatSlackReport("abc123", changes);
    expect(report).toContain("figma.com/design/abc123");
  });
});
