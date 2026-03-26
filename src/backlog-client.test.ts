import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatBacklogDescription,
  formatBacklogComment,
  defaultTitle,
  findExistingIssue,
  createBacklogIssue,
  addBacklogComment,
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

    expect(desc).toContain("[DesignDigest] abc123");
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

    const result = await findExistingIssue(mockConfig, "[DesignDigest] abc123 node:1:2");
    expect(result).toBeNull();
  });

  it("returns existing issue when found with node marker", async () => {
    const mockIssue = {
      id: 1,
      issueKey: "TEST-1",
      summary: "[DesignDigest] changes",
      description: "[DesignDigest] abc123 node:1:2\n\ntest description",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([mockIssue]), { status: 200 }),
    );

    const result = await findExistingIssue(mockConfig, "[DesignDigest] abc123 node:1:2");
    expect(result).toEqual(mockIssue);
  });

  it("passes full marker as keyword to API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    await findExistingIssue(mockConfig, "[DesignDigest] abc123 page:Home");

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("keyword=%5BDesignDigest%5D+abc123+page%3AHome");
    expect(url).toContain("count=100");
  });

  it("excludes closed issues (status.id === 4)", async () => {
    const closedIssue = {
      id: 1,
      issueKey: "TEST-1",
      summary: "changes",
      description: "[DesignDigest] abc123 node:1:2\n\ntest",
      status: { id: 4, name: "Closed" },
    };
    const openIssue = {
      id: 2,
      issueKey: "TEST-2",
      summary: "changes",
      description: "[DesignDigest] abc123 node:1:2\n\ntest",
      status: { id: 1, name: "Open" },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([closedIssue, openIssue]), { status: 200 }),
    );

    const result = await findExistingIssue(mockConfig, "[DesignDigest] abc123 node:1:2");
    expect(result).toEqual({
      id: 2,
      issueKey: "TEST-2",
      summary: "changes",
      description: "[DesignDigest] abc123 node:1:2\n\ntest",
    });
  });

  it("matches issues with custom statuses (non-closed)", async () => {
    const customStatusIssue = {
      id: 1,
      issueKey: "TEST-1",
      summary: "changes",
      description: "[DesignDigest] abc123 node:1:2\n\ntest",
      status: { id: 5, name: "Review" },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([customStatusIssue]), { status: 200 }),
    );

    const result = await findExistingIssue(mockConfig, "[DesignDigest] abc123 node:1:2");
    expect(result).toEqual({
      id: 1,
      issueKey: "TEST-1",
      summary: "changes",
      description: "[DesignDigest] abc123 node:1:2\n\ntest",
    });
  });

  it("rejects partial marker matches in description", async () => {
    const mockIssue = {
      id: 1,
      issueKey: "TEST-1",
      summary: "changes",
      description: "[DesignDigest] abc123 node:1:23\n\ntest description",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([mockIssue]), { status: 200 }),
    );

    const result = await findExistingIssue(mockConfig, "[DesignDigest] abc123 node:1:2");
    expect(result).toBeNull();
  });

  it("throws on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );

    await expect(findExistingIssue(mockConfig, "[DesignDigest] abc123 node:1:2")).rejects.toThrow(
      "Backlog API search failed: 401 Unauthorized",
    );
  });

  it("logs warning when results reach the limit (100)", async () => {
    const issues = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      issueKey: `TEST-${i + 1}`,
      summary: "changes",
      description: "no match here",
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(issues), { status: 200 }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await findExistingIssue(mockConfig, "[DesignDigest] abc123 node:1:2");

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("100 issues (limit: 100)");
    warnSpy.mockRestore();
  });

  it("does not log warning when results are below limit", async () => {
    const issues = Array.from({ length: 99 }, (_, i) => ({
      id: i + 1,
      issueKey: `TEST-${i + 1}`,
      summary: "changes",
      description: "no match here",
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(issues), { status: 200 }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await findExistingIssue(mockConfig, "[DesignDigest] abc123 node:1:2");

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
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

describe("formatBacklogDescription with options", () => {
  it("uses custom marker when provided", () => {
    const desc = formatBacklogDescription("abc123", sampleChanges, undefined, {
      marker: "[DesignDigest] abc123 node:1:2",
    });
    expect(desc).toContain("[DesignDigest] abc123 node:1:2");
  });

  it("includes scope label when provided", () => {
    const desc = formatBacklogDescription("abc123", sampleChanges, undefined, {
      marker: "[DesignDigest] abc123 node:1:2",
      scopeLabel: "Node: HeaderTitle (TEXT)",
    });
    expect(desc).toContain("Scope: Node: HeaderTitle (TEXT)");
  });

  it("uses default marker when options not provided", () => {
    const desc = formatBacklogDescription("abc123", sampleChanges);
    expect(desc).toMatch(/^\[DesignDigest\] abc123\n/);
  });
});

describe("formatBacklogComment", () => {
  it("formats comment with change details", () => {
    const comment = formatBacklogComment(sampleChanges);
    expect(comment).toContain("3 new change(s) detected");
    expect(comment).toContain("### Home");
    expect(comment).toContain("### Settings");
  });

  it("includes AI summary when provided", () => {
    const comment = formatBacklogComment(sampleChanges, "AI summary");
    expect(comment).toContain("## AI Summary");
    expect(comment).toContain("AI summary");
  });
});

describe("addBacklogComment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("adds a comment to an issue", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1 }), { status: 201 }),
    );

    await addBacklogComment(mockConfig, "TEST-1", "Comment body");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("/issues/TEST-1/comments");
    const body = fetchSpy.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get("content")).toBe("Comment body");
  });

  it("throws on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404, statusText: "Not Found" }),
    );

    await expect(
      addBacklogComment(mockConfig, "TEST-999", "Comment"),
    ).rejects.toThrow("Backlog API comment creation failed: 404 Not Found");
  });
});
