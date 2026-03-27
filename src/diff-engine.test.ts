import { describe, it, expect } from "vitest";
import { detectChanges, formatConsoleReport, formatSlackReport, formatSlackBlocks, nodeUrl, convertMarkdownToSlackMrkdwn, groupChangesForIssues } from "./diff-engine.js";
import type { FigmaNode, FigmaUser } from "./figma-client.js";

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
    expect(report).toContain("7 changes");
  });

  it("includes per-page summary counts", () => {
    const changes = [
      {
        pageName: "Home",
        nodeId: "1",
        nodeName: "A",
        nodeType: "FRAME",
        kind: "added" as const,
      },
      {
        pageName: "Home",
        nodeId: "2",
        nodeName: "B",
        nodeType: "FRAME",
        kind: "deleted" as const,
      },
      {
        pageName: "Settings",
        nodeId: "3",
        nodeName: "C",
        nodeType: "TEXT",
        kind: "modified" as const,
        property: "fontSize",
        oldValue: 14,
        newValue: 16,
      },
    ];
    const report = formatConsoleReport("abc123", changes);
    // Verify per-page summaries appear after their respective page headers
    const homeIndex = report.search(/^📄 Home/m);
    const settingsIndex = report.search(/^📄 Settings/m);
    expect(homeIndex).toBeGreaterThanOrEqual(0);
    expect(settingsIndex).toBeGreaterThanOrEqual(0);
    expect(homeIndex).toBeLessThan(settingsIndex);

    // "1 added" should appear between Home and Settings headers
    const homeAddedIndex = report.indexOf("1 added", homeIndex);
    expect(homeAddedIndex).toBeGreaterThan(homeIndex);
    expect(homeAddedIndex).toBeLessThan(settingsIndex);

    // "1 deleted" should appear between Home and Settings headers
    const homeDeletedIndex = report.indexOf("1 deleted", homeIndex);
    expect(homeDeletedIndex).toBeGreaterThan(homeIndex);
    expect(homeDeletedIndex).toBeLessThan(settingsIndex);

    // "1 modified" should appear after Settings header
    const settingsModifiedIndex = report.indexOf("1 modified", settingsIndex);
    expect(settingsModifiedIndex).toBeGreaterThan(settingsIndex);
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

  it("includes per-page summary counts", () => {
    const changes = [
      {
        pageName: "Home",
        nodeId: "1",
        nodeName: "A",
        nodeType: "FRAME",
        kind: "added" as const,
      },
      {
        pageName: "Settings",
        nodeId: "2",
        nodeName: "B",
        nodeType: "FRAME",
        kind: "deleted" as const,
      },
    ];
    const report = formatSlackReport("abc123", changes);
    // Verify per-page summaries appear after their respective page headers
    const homeIndex = report.indexOf("*Home*");
    const settingsIndex = report.indexOf("*Settings*");
    expect(homeIndex).toBeGreaterThanOrEqual(0);
    expect(settingsIndex).toBeGreaterThanOrEqual(0);
    expect(homeIndex).toBeLessThan(settingsIndex);

    // "1 added" should appear between Home and Settings headers
    const homeAddedIndex = report.indexOf("1 added", homeIndex);
    expect(homeAddedIndex).toBeGreaterThan(homeIndex);
    expect(homeAddedIndex).toBeLessThan(settingsIndex);

    // "1 deleted" should appear after Settings header
    const settingsDeletedIndex = report.indexOf("1 deleted", settingsIndex);
    expect(settingsDeletedIndex).toBeGreaterThan(settingsIndex);
  });
});

describe("formatSlackBlocks", () => {
  it("returns empty array for no changes", () => {
    expect(formatSlackBlocks("abc123", [])).toEqual([]);
  });

  it("includes header, file section with button, and divider", () => {
    const changes = [
      {
        pageName: "Home",
        nodeId: "1",
        nodeName: "Button",
        nodeType: "FRAME",
        kind: "added" as const,
      },
    ];
    const blocks = formatSlackBlocks("abc123", changes);

    // Header block
    const header = blocks.find((b) => b.type === "header");
    expect(header).toBeDefined();
    expect(header!.text!.text).toContain("1 change(s)");

    // Button with Figma link
    const fileSection = blocks.find((b) => b.accessory?.url);
    expect(fileSection).toBeDefined();
    expect(fileSection!.accessory!.url).toContain("figma.com/design/abc123");
  });

  it("groups changes by page with section headers", () => {
    const changes = [
      {
        pageName: "Home",
        nodeId: "1",
        nodeName: "Header",
        nodeType: "FRAME",
        kind: "added" as const,
      },
      {
        pageName: "Settings",
        nodeId: "2",
        nodeName: "Toggle",
        nodeType: "FRAME",
        kind: "deleted" as const,
      },
    ];
    const blocks = formatSlackBlocks("abc123", changes);
    const sections = blocks.filter(
      (b) => b.type === "section" && b.text?.text?.startsWith("*"),
    );
    expect(sections).toHaveLength(2);
    expect(sections[0].text!.text).toBe("*Home*");
    expect(sections[1].text!.text).toBe("*Settings*");
  });

  it("includes per-page context block with summary counts", () => {
    const changes = [
      {
        pageName: "Home",
        nodeId: "1",
        nodeName: "A",
        nodeType: "FRAME",
        kind: "added" as const,
      },
      {
        pageName: "Home",
        nodeId: "2",
        nodeName: "B",
        nodeType: "FRAME",
        kind: "deleted" as const,
      },
      {
        pageName: "Home",
        nodeId: "3",
        nodeName: "C",
        nodeType: "TEXT",
        kind: "modified" as const,
        property: "fontSize",
        oldValue: 14,
        newValue: 16,
      },
    ];
    const blocks = formatSlackBlocks("abc123", changes);
    const contextBlocks = blocks.filter(
      (b) => b.type === "context" && b.elements?.some((e) => e.text.includes("added")),
    );
    expect(contextBlocks).toHaveLength(1);
    const text = contextBlocks[0].elements![0].text;
    expect(text).toContain("1 added");
    expect(text).toContain("1 deleted");
    expect(text).toContain("1 modified");
  });

  it("includes per-page renamed count in context", () => {
    const changes = [
      {
        pageName: "Home",
        nodeId: "1",
        nodeName: "NewName",
        nodeType: "FRAME",
        kind: "renamed" as const,
        property: "name",
        oldValue: "OldName",
        newValue: "NewName",
      },
    ];
    const blocks = formatSlackBlocks("abc123", changes);
    const contextBlocks = blocks.filter(
      (b) => b.type === "context" && b.elements?.some((e) => e.text.includes("renamed")),
    );
    expect(contextBlocks).toHaveLength(1);
    expect(contextBlocks[0].elements![0].text).toContain("1 renamed");
  });

  it("shows separate per-page summary counts for multi-page changes", () => {
    const changes = [
      {
        pageName: "Home",
        nodeId: "1",
        nodeName: "A",
        nodeType: "FRAME",
        kind: "added" as const,
      },
      {
        pageName: "Home",
        nodeId: "2",
        nodeName: "B",
        nodeType: "FRAME",
        kind: "added" as const,
      },
      {
        pageName: "Settings",
        nodeId: "3",
        nodeName: "C",
        nodeType: "FRAME",
        kind: "deleted" as const,
      },
    ];
    const blocks = formatSlackBlocks("abc123", changes);
    const contextBlocks = blocks.filter(
      (b) => b.type === "context" && b.elements?.some((e) =>
        e.text.includes("added") || e.text.includes("deleted"),
      ),
    );
    expect(contextBlocks).toHaveLength(2);
    expect(contextBlocks[0].elements![0].text).toContain("2 added");
    expect(contextBlocks[0].elements![0].text).not.toContain("deleted");
    expect(contextBlocks[1].elements![0].text).toContain("1 deleted");
    expect(contextBlocks[1].elements![0].text).not.toContain("added");
  });

  it("does not end with a trailing divider", () => {
    const changes = [
      {
        pageName: "Home",
        nodeId: "1",
        nodeName: "A",
        nodeType: "FRAME",
        kind: "added" as const,
      },
    ];
    const blocks = formatSlackBlocks("abc123", changes);
    expect(blocks[blocks.length - 1].type).not.toBe("divider");
  });

  it("uses dividers between pages but not after the last page", () => {
    const changes = [
      {
        pageName: "Home",
        nodeId: "1",
        nodeName: "A",
        nodeType: "FRAME",
        kind: "added" as const,
      },
      {
        pageName: "Settings",
        nodeId: "2",
        nodeName: "B",
        nodeType: "FRAME",
        kind: "deleted" as const,
      },
    ];
    const blocks = formatSlackBlocks("abc123", changes);
    // Last block should NOT be a divider (dividers only appear between pages and after the header)
    expect(blocks[blocks.length - 1].type).not.toBe("divider");
    // Should have dividers: one after header section, one between the two pages
    const dividers = blocks.filter((b) => b.type === "divider");
    expect(dividers).toHaveLength(2);
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
    const blocks = formatSlackBlocks("abc123", changes);
    const contentSections = blocks.filter(
      (b) => b.type === "section" && b.text?.text && !b.text.text.startsWith("*") && !b.text.text.startsWith("File:"),
    );
    // Should have one section with aggregated "7 changes"
    expect(contentSections.length).toBeGreaterThan(0);
    const text = contentSections.map((b) => b.text!.text).join("\n");
    expect(text).toContain("7 changes");
  });

  it("splits long content into multiple sections within 3000 char limit", () => {
    // Create many changes to exceed 3000 chars
    const changes = Array.from({ length: 50 }, (_, i) => ({
      pageName: "Home",
      nodeId: `node-${i}`,
      nodeName: `VeryLongComponentName_${i}_${"x".repeat(40)}`,
      nodeType: "FRAME",
      kind: "modified" as const,
      property: "fontSize",
      oldValue: 14,
      newValue: 16,
    }));
    const blocks = formatSlackBlocks("abc123", changes);
    // All section text fields should be within 3000 chars
    const contentSections = blocks.filter(
      (b) => b.type === "section" && b.text?.type === "mrkdwn",
    );
    for (const section of contentSections) {
      expect(section.text!.text.length).toBeLessThanOrEqual(3000);
    }
    // Should have been split into multiple sections (more than just the page header)
    const changeSections = contentSections.filter(
      (b) => !b.text!.text.startsWith("*") && !b.text!.text.startsWith("File:"),
    );
    expect(changeSections.length).toBeGreaterThan(1);
  });
});

describe("nodeUrl", () => {
  it("converts colon-separated node IDs to hyphen format", () => {
    expect(nodeUrl("abc123", "1:2")).toBe(
      "https://www.figma.com/design/abc123?node-id=1-2",
    );
  });

  it("handles nested node IDs", () => {
    expect(nodeUrl("abc123", "100:200")).toBe(
      "https://www.figma.com/design/abc123?node-id=100-200",
    );
  });
});

describe("node links in reports", () => {
  const changes = [
    {
      pageName: "Home",
      nodeId: "1:2",
      nodeName: "Button",
      nodeType: "FRAME",
      kind: "added" as const,
    },
  ];

  it("console report includes node URL", () => {
    const report = formatConsoleReport("abc123", changes);
    expect(report).toContain("figma.com/design/abc123?node-id=1-2");
  });

  it("Slack report includes node link", () => {
    const report = formatSlackReport("abc123", changes);
    expect(report).toContain("<https://www.figma.com/design/abc123?node-id=1-2|Button>");
  });

  it("Block Kit includes node link", () => {
    const blocks = formatSlackBlocks("abc123", changes);
    const content = blocks
      .filter((b) => b.type === "section")
      .map((b) => b.text?.text ?? "")
      .join("\n");
    expect(content).toContain("<https://www.figma.com/design/abc123?node-id=1-2|Button>");
  });

  it("escapes special characters in node names for Slack links", () => {
    const specialChanges = [
      {
        pageName: "Home",
        nodeId: "1:2",
        nodeName: "Icon <beta> | v2 & more",
        nodeType: "FRAME",
        kind: "added" as const,
      },
    ];
    const report = formatSlackReport("abc123", specialChanges);
    // Display text should have escaped special chars
    expect(report).toContain("Icon &lt;beta&gt; │ v2 &amp; more");
    expect(report).toContain("│"); // pipe replaced with box drawing char
  });
});

describe("convertMarkdownToSlackMrkdwn", () => {
  it("converts ATX headings to bold", () => {
    expect(convertMarkdownToSlackMrkdwn("## Summary")).toBe("*Summary*");
    expect(convertMarkdownToSlackMrkdwn("### Details")).toBe("*Details*");
    expect(convertMarkdownToSlackMrkdwn("# Top Level")).toBe("*Top Level*");
  });

  it("converts bold syntax", () => {
    expect(convertMarkdownToSlackMrkdwn("**bold text**")).toBe("*bold text*");
    expect(convertMarkdownToSlackMrkdwn("__bold text__")).toBe("*bold text*");
  });

  it("converts strikethrough", () => {
    expect(convertMarkdownToSlackMrkdwn("~~deleted~~")).toBe("~deleted~");
  });

  it("converts markdown links to Slack links", () => {
    expect(convertMarkdownToSlackMrkdwn("[Click here](https://example.com)")).toBe(
      "<https://example.com|Click here>",
    );
  });

  it("preserves inline code", () => {
    expect(convertMarkdownToSlackMrkdwn("`code`")).toBe("`code`");
  });

  it("does not transform markdown inside inline code spans", () => {
    expect(convertMarkdownToSlackMrkdwn("`**bold**`")).toBe("`**bold**`");
    expect(convertMarkdownToSlackMrkdwn("text `## heading` text")).toBe("text `## heading` text");
  });

  it("escapes special chars in link text for Slack", () => {
    expect(convertMarkdownToSlackMrkdwn("[A & B](https://example.com)")).toBe(
      "<https://example.com|A &amp; B>",
    );
    expect(convertMarkdownToSlackMrkdwn("[<tag>](https://example.com)")).toBe(
      "<https://example.com|&lt;tag&gt;>",
    );
  });

  it("skips image syntax ![alt](url)", () => {
    expect(convertMarkdownToSlackMrkdwn("![logo](https://example.com/img.png)")).toBe(
      "![logo](https://example.com/img.png)",
    );
  });

  it("escapes reserved chars in URLs for Slack", () => {
    expect(convertMarkdownToSlackMrkdwn("[link](https://example.com?a=1|b=2)")).toBe(
      "<https://example.com?a=1%7Cb=2|link>",
    );
    expect(convertMarkdownToSlackMrkdwn("[link](https://example.com/a>b)")).toBe(
      "<https://example.com/a%3Eb|link>",
    );
    expect(convertMarkdownToSlackMrkdwn("[link](https://example.com/<path>)")).toBe(
      "<https://example.com/%3Cpath%3E|link>",
    );
  });

  it("handles URLs with balanced parentheses", () => {
    expect(
      convertMarkdownToSlackMrkdwn("[Wiki](https://en.wikipedia.org/wiki/Foo_(bar))"),
    ).toBe("<https://en.wikipedia.org/wiki/Foo_(bar)|Wiki>");
  });

  it("preserves bullet lists", () => {
    expect(convertMarkdownToSlackMrkdwn("- item one\n- item two")).toBe(
      "- item one\n- item two",
    );
  });

  it("handles a realistic Claude API response", () => {
    const input = [
      "## Summary",
      "The **button component** color was changed from `#000` to `#333`.",
      "",
      "## Implementation Impact",
      "- Update CSS variables for button colors",
      "- Check [design system docs](https://example.com/docs) for details",
      "",
      "## Priority",
      "**High** — affects multiple components",
    ].join("\n");

    const result = convertMarkdownToSlackMrkdwn(input);

    expect(result).toContain("*Summary*");
    expect(result).toContain("*button component*");
    expect(result).toContain("`#000`");
    expect(result).toContain("*Implementation Impact*");
    expect(result).toContain("- Update CSS variables");
    expect(result).toContain("<https://example.com/docs|design system docs>");
    expect(result).toContain("*High*");
    // Should NOT contain markdown artifacts
    expect(result).not.toContain("##");
    expect(result).not.toContain("**");
  });

  it("passes through plain text unchanged", () => {
    const plain = "No formatting here, just text.";
    expect(convertMarkdownToSlackMrkdwn(plain)).toBe(plain);
  });
});

describe("editors in reports", () => {
  const editors: FigmaUser[] = [
    { id: "u1", handle: "Alice", img_url: "https://img.example.com/u1" },
    { id: "u2", handle: "Bob", img_url: "https://img.example.com/u2" },
  ];

  const changes = [
    {
      pageName: "Home",
      nodeId: "1",
      nodeName: "Button",
      nodeType: "FRAME",
      kind: "added" as const,
    },
  ];

  it("console report includes editors", () => {
    const report = formatConsoleReport("abc123", changes, editors);
    expect(report).toContain("Edited by: Alice, Bob");
  });

  it("console report omits editors when empty", () => {
    const report = formatConsoleReport("abc123", changes, []);
    expect(report).not.toContain("Edited by");
  });

  it("console report omits editors when undefined", () => {
    const report = formatConsoleReport("abc123", changes);
    expect(report).not.toContain("Edited by");
  });

  it("Slack report includes editors", () => {
    const report = formatSlackReport("abc123", changes, editors);
    expect(report).toContain("Edited by: Alice, Bob");
  });

  it("Block Kit includes editors context block", () => {
    const blocks = formatSlackBlocks("abc123", changes, editors);
    const contextBlocks = blocks.filter((b) => b.type === "context");
    const editorsBlock = contextBlocks.find((b) =>
      b.elements?.some((e) => e.text.includes("Edited by")),
    );
    expect(editorsBlock).toBeDefined();
    expect(editorsBlock!.elements![0].text).toContain("Alice, Bob");
  });

  it("Block Kit omits editors context when empty", () => {
    const blocks = formatSlackBlocks("abc123", changes, []);
    const editorsBlock = blocks.filter((b) => b.type === "context").find((b) =>
      b.elements?.some((e) => e.text.includes("Edited by")),
    );
    expect(editorsBlock).toBeUndefined();
  });
});

describe("formatSlackBlocks with pageSummaries", () => {
  it("inserts per-page AI summary after each page's changes", () => {
    const changes = [
      { pageName: "Home", nodeId: "1:1", nodeName: "Button", nodeType: "FRAME", kind: "added" as const },
      { pageName: "Settings", nodeId: "2:1", nodeName: "Toggle", nodeType: "FRAME", kind: "added" as const },
    ];
    const pageSummaries = new Map([
      ["Home", "Home page got a new button."],
      ["Settings", "Settings page got a toggle."],
    ]);

    const blocks = formatSlackBlocks("abc123", changes, undefined, pageSummaries);

    // Find summary blocks by the 💡 prefix
    const summaryBlocks = blocks.filter(
      (b) => b.type === "section" && b.text?.text?.startsWith("💡"),
    );
    expect(summaryBlocks).toHaveLength(2);
    expect(summaryBlocks[0].text!.text).toContain("Home page got a new button.");
    expect(summaryBlocks[1].text!.text).toContain("Settings page got a toggle.");
  });

  it("skips summary for pages without a generated summary", () => {
    const changes = [
      { pageName: "Home", nodeId: "1:1", nodeName: "Button", nodeType: "FRAME", kind: "added" as const },
      { pageName: "Settings", nodeId: "2:1", nodeName: "Toggle", nodeType: "FRAME", kind: "added" as const },
    ];
    const pageSummaries = new Map([
      ["Home", "Home page summary."],
      // Settings is missing — simulates a generation failure
    ]);

    const blocks = formatSlackBlocks("abc123", changes, undefined, pageSummaries);

    const summaryBlocks = blocks.filter(
      (b) => b.type === "section" && b.text?.text?.startsWith("💡"),
    );
    expect(summaryBlocks).toHaveLength(1);
    expect(summaryBlocks[0].text!.text).toContain("Home page summary.");
  });

  it("works without pageSummaries (undefined)", () => {
    const changes = [
      { pageName: "Home", nodeId: "1:1", nodeName: "Button", nodeType: "FRAME", kind: "added" as const },
    ];

    const blocks = formatSlackBlocks("abc123", changes);
    const summaryBlocks = blocks.filter(
      (b) => b.type === "section" && b.text?.text?.startsWith("💡"),
    );
    expect(summaryBlocks).toHaveLength(0);
  });
});

describe("formatSlackBlocks with fileName", () => {
  it("displays fileName instead of fileKey when provided", () => {
    const changes = [
      { pageName: "Home", nodeId: "1:1", nodeName: "Button", nodeType: "FRAME", kind: "added" as const },
    ];
    const blocks = formatSlackBlocks("abc123", changes, undefined, undefined, "Design System v2");
    const fileSection = blocks.find((b) => b.type === "section" && b.accessory);
    expect(fileSection?.text?.text).toBe("File: `Design System v2`");
    // URL should still use fileKey
    expect(fileSection?.accessory?.url).toBe("https://www.figma.com/design/abc123");
    expect(fileSection?.accessory?.action_id).toBe("open_figma_abc123");
  });

  it("falls back to fileKey when fileName is undefined", () => {
    const changes = [
      { pageName: "Home", nodeId: "1:1", nodeName: "Button", nodeType: "FRAME", kind: "added" as const },
    ];
    const blocks = formatSlackBlocks("abc123", changes);
    const fileSection = blocks.find((b) => b.type === "section" && b.accessory);
    expect(fileSection?.text?.text).toBe("File: `abc123`");
  });
});

describe("formatSlackReport with fileName", () => {
  it("displays fileName instead of fileKey when provided", () => {
    const changes = [
      { pageName: "Home", nodeId: "1:1", nodeName: "Button", nodeType: "FRAME", kind: "added" as const },
    ];
    const report = formatSlackReport("abc123", changes, undefined, "Design System v2");
    expect(report).toContain("File: `Design System v2`");
    // URL should still use fileKey
    expect(report).toContain("https://www.figma.com/design/abc123");
  });

  it("falls back to fileKey when fileName is undefined", () => {
    const changes = [
      { pageName: "Home", nodeId: "1:1", nodeName: "Button", nodeType: "FRAME", kind: "added" as const },
    ];
    const report = formatSlackReport("abc123", changes);
    expect(report).toContain("File: `abc123`");
  });
});

describe("groupChangesForIssues", () => {
  it("groups by node when unique nodes <= 10", () => {
    const changes = [
      { pageName: "Home", nodeId: "1:1", nodeName: "Button", nodeType: "FRAME", kind: "modified" as const, property: "fills" },
      { pageName: "Home", nodeId: "1:1", nodeName: "Button", nodeType: "FRAME", kind: "modified" as const, property: "opacity" },
      { pageName: "Home", nodeId: "1:2", nodeName: "Header", nodeType: "TEXT", kind: "added" as const },
    ];

    const units = groupChangesForIssues("fileKey1", changes);
    expect(units).toHaveLength(2);
    expect(units[0].scope).toBe("node");
    expect(units[0].marker).toBe("[DesignDigest] fileKey1 node:1:1");
    expect(units[0].label).toBe("Button (FRAME)");
    expect(units[0].changes).toHaveLength(2);
    expect(units[1].marker).toBe("[DesignDigest] fileKey1 node:1:2");
    expect(units[1].changes).toHaveLength(1);
  });

  it("falls back to page grouping when unique nodes > 10", () => {
    const changes = Array.from({ length: 11 }, (_, i) => ({
      pageName: i < 6 ? "Home" : "Settings",
      nodeId: `1:${i}`,
      nodeName: `Node${i}`,
      nodeType: "FRAME",
      kind: "modified" as const,
      property: "fills",
    }));

    const units = groupChangesForIssues("fileKey1", changes);
    expect(units).toHaveLength(2);
    expect(units[0].scope).toBe("page");
    expect(units[0].marker).toBe("[DesignDigest] fileKey1 page:Home");
    expect(units[0].label).toBe("Home");
    expect(units[0].changes).toHaveLength(6);
    expect(units[1].marker).toBe("[DesignDigest] fileKey1 page:Settings");
    expect(units[1].changes).toHaveLength(5);
  });

  it("groups exactly 10 nodes as node-level", () => {
    const changes = Array.from({ length: 10 }, (_, i) => ({
      pageName: "Home",
      nodeId: `1:${i}`,
      nodeName: `Node${i}`,
      nodeType: "FRAME",
      kind: "added" as const,
    }));

    const units = groupChangesForIssues("fileKey1", changes);
    expect(units).toHaveLength(10);
    expect(units[0].scope).toBe("node");
  });

  it("combines multiple property changes of the same node into one unit", () => {
    const changes = [
      { pageName: "Home", nodeId: "1:1", nodeName: "Text", nodeType: "TEXT", kind: "modified" as const, property: "fontSize" },
      { pageName: "Home", nodeId: "1:1", nodeName: "Text", nodeType: "TEXT", kind: "modified" as const, property: "fontFamily" },
      { pageName: "Home", nodeId: "1:1", nodeName: "Text", nodeType: "TEXT", kind: "modified" as const, property: "fills" },
    ];

    const units = groupChangesForIssues("fileKey1", changes);
    expect(units).toHaveLength(1);
    expect(units[0].changes).toHaveLength(3);
    expect(units[0].marker).toBe("[DesignDigest] fileKey1 node:1:1");
  });
});
