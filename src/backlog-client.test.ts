import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatBacklogDescription,
  defaultTitle,
  findExistingIssue,
  createBacklogIssue,
} from "./backlog-client.js";
import type { ChangeEntry } from "./diff-engine.js";
import type { BacklogConfig } from "./backlog-client.js";

const mockConfig: BacklogConfig = {
  apiKey: "test-api-key",
  spaceId: "test-space",
  projectId: "12345",
};

const sampleChanges: ChangeEntry[] = [
  {
    pageName: "Home",
    nodeId: "1:2",
    nodeName: "HeaderTitle",
    nodeType: "TEXT",
    kind: "modified",
    property: "fontSize",
    oldValue: 24,
    newValue: 28,
  },
  {
    pageName: "Home",
    nodeId: "1:3",
    nodeName: "NewBanner",
    nodeType: "FRAME",
    kind: "added",
  },
  {
    pageName: "Settings",
    nodeId: "2:1",
    nodeName: "OldToggle",
    nodeType: "INSTANCE",
    kind: "deleted",
  },
];

describe("formatBacklogDescription", () => {
  it("formats changes grouped by page", () => {
    const desc = formatBacklogDescription("abc123", sampleChanges);

    expect(desc).toContain("https://www.figma.com/design/abc123");
    expect(desc).toContain("3 change(s) detected");
    expect(desc).toContain("### Home");
    expect(desc).toContain("### Settings");
    expect(desc).toContain("Modified: HeaderTitle.fontSize: 24 → 28");
    expect(desc).toContain("Added: NewBanner (FRAME)");
    expect(desc).toContain("Deleted: OldToggle (INSTANCE)");
  });

  it("includes AI summary when provided", () => {
    const desc = formatBacklogDescription("abc123", sampleChanges, "Summary text");

    expect(desc).toContain("## AI Summary");
    expect(desc).toContain("Summary text");
  });

  it("handles renamed entries", () => {
    const changes: ChangeEntry[] = [
      {
        pageName: "Home",
        nodeId: "1:2",
        nodeName: "Button",
        nodeType: "FRAME",
        kind: "renamed",
        property: "name",
        oldValue: "OldButton",
        newValue: "NewButton",
      },
    ];
    const desc = formatBacklogDescription("abc123", changes);
    expect(desc).toContain("Renamed: OldButton → NewButton");
  });
});

describe("defaultTitle", () => {
  it("generates title with all change types", () => {
    const title = defaultTitle(sampleChanges);
    expect(title).toBe("[DesignDigest] 1 added, 1 deleted, 1 modified");
  });

  it("handles single change type", () => {
    const changes: ChangeEntry[] = [
      {
        pageName: "Home",
        nodeId: "1:2",
        nodeName: "A",
        nodeType: "FRAME",
        kind: "added",
      },
      {
        pageName: "Home",
        nodeId: "1:3",
        nodeName: "B",
        nodeType: "FRAME",
        kind: "added",
      },
    ];
    const title = defaultTitle(changes);
    expect(title).toBe("[DesignDigest] 2 added");
  });

  it("counts renamed as modified", () => {
    const changes: ChangeEntry[] = [
      {
        pageName: "Home",
        nodeId: "1:2",
        nodeName: "Button",
        nodeType: "FRAME",
        kind: "renamed",
        property: "name",
        oldValue: "Old",
        newValue: "New",
      },
    ];
    const title = defaultTitle(changes);
    expect(title).toBe("[DesignDigest] 1 modified");
  });
});

describe("findExistingIssue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when no matching issues found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    const result = await findExistingIssue(mockConfig, "abc123");
    expect(result).toBeNull();
  });

  it("returns existing issue when found", async () => {
    const mockIssue = {
      id: 1,
      issueKey: "TEST-1",
      summary: "[DesignDigest] abc123 changes",
      description: "test description",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([mockIssue]), { status: 200 }),
    );

    const result = await findExistingIssue(mockConfig, "abc123");
    expect(result).toEqual(mockIssue);
  });

  it("throws on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );

    await expect(findExistingIssue(mockConfig, "abc123")).rejects.toThrow(
      "Backlog API search failed: 401 Unauthorized",
    );
  });
});

describe("createBacklogIssue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an issue and returns it", async () => {
    const mockResponse = {
      id: 1,
      issueKey: "TEST-1",
      summary: "Test summary",
      description: "Test description",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    const result = await createBacklogIssue(
      mockConfig,
      "Test summary",
      "Test description",
    );
    expect(result).toEqual(mockResponse);
  });

  it("includes optional fields when configured", async () => {
    const configWithOptions: BacklogConfig = {
      ...mockConfig,
      issueTypeId: "1",
      priorityId: "2",
      assigneeId: "3",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 1,
          issueKey: "TEST-1",
          summary: "Test",
          description: "Desc",
        }),
        { status: 201 },
      ),
    );

    await createBacklogIssue(configWithOptions, "Test", "Desc");

    const calledBody = fetchSpy.mock.calls[0][1]?.body as URLSearchParams;
    expect(calledBody.get("issueTypeId")).toBe("1");
    expect(calledBody.get("priorityId")).toBe("2");
    expect(calledBody.get("assigneeId")).toBe("3");
  });

  it("throws on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Bad Request", { status: 400, statusText: "Bad Request" }),
    );

    await expect(
      createBacklogIssue(mockConfig, "Test", "Desc"),
    ).rejects.toThrow("Backlog API issue creation failed: 400 Bad Request");
  });
});
