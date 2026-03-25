import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatGitHubIssueBody,
  githubDefaultTitle,
  generateGitHubIssueTitle,
  fetchOpenIssues,
  findExistingGitHubIssue,
  createGitHubIssue,
} from "./github-issue-client.js";
import type { ChangeEntry } from "./diff-engine.js";
import type { GitHubIssueConfig } from "./github-issue-client.js";

const mockConfig: GitHubIssueConfig = {
  token: "ghp_test_token",
  owner: "test-owner",
  repo: "test-repo",
  labels: [],
  assignees: [],
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

describe("formatGitHubIssueBody", () => {
  it("formats changes grouped by page with Markdown", () => {
    const body = formatGitHubIssueBody("abc123", sampleChanges);

    expect(body).toContain("[DesignDigest] abc123");
    expect(body).toContain("[abc123](https://www.figma.com/design/abc123)");
    expect(body).toContain("3 change(s) detected");
    expect(body).toContain("### Home");
    expect(body).toContain("### Settings");
    expect(body).toContain("**HeaderTitle**");
    expect(body).toContain("**NewBanner**");
    expect(body).toContain("**OldToggle**");
  });

  it("includes AI summary when provided", () => {
    const body = formatGitHubIssueBody("abc123", sampleChanges, "AI summary here");

    expect(body).toContain("## AI Summary");
    expect(body).toContain("AI summary here");
  });

  it("includes DesignDigest footer", () => {
    const body = formatGitHubIssueBody("abc123", sampleChanges);
    expect(body).toContain("automatically created by");
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
    const body = formatGitHubIssueBody("abc123", changes);
    expect(body).toContain("`OldButton` → `NewButton`");
  });
});

describe("githubDefaultTitle", () => {
  it("generates title with all change types", () => {
    const title = githubDefaultTitle(sampleChanges);
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
    const title = githubDefaultTitle(changes);
    expect(title).toBe("[DesignDigest] 2 added");
  });
});

describe("fetchOpenIssues", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches open issues and filters out PRs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { number: 1, title: "Issue", html_url: "url1", body: "body", pull_request: undefined },
          { number: 2, title: "PR", html_url: "url2", body: "body", pull_request: {} },
        ]),
        { status: 200 },
      ),
    );

    const issues = await fetchOpenIssues(mockConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(1);
  });

  it("paginates until fewer results than per_page", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      title: `Issue ${i + 1}`,
      html_url: `url${i + 1}`,
      body: "body",
    }));
    const page2 = [
      { number: 101, title: "Issue 101", html_url: "url101", body: "body" },
    ];

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));

    const issues = await fetchOpenIssues(mockConfig);
    expect(issues).toHaveLength(101);
  });

  it("throws on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );

    await expect(fetchOpenIssues(mockConfig)).rejects.toThrow(
      "GitHub issues list failed: 401 Unauthorized",
    );
  });

  it("sends correct authorization header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    await fetchOpenIssues(mockConfig);

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_test_token");
  });
});

describe("findExistingGitHubIssue", () => {
  it("returns null when no matching issues", () => {
    const result = findExistingGitHubIssue([], "abc123");
    expect(result).toBeNull();
  });

  it("returns null when issues exist but none contain marker", () => {
    const issues = [
      { number: 1, title: "Unrelated", html_url: "url1", body: "No marker" as string | null },
    ];
    const result = findExistingGitHubIssue(issues, "abc123");
    expect(result).toBeNull();
  });

  it("returns null when body is null", () => {
    const issues = [
      { number: 1, title: "Null body", html_url: "url1", body: null as string | null },
    ];
    const result = findExistingGitHubIssue(issues, "abc123");
    expect(result).toBeNull();
  });

  it("returns existing issue when marker found in body", () => {
    const issues = [
      {
        number: 42,
        title: "[DesignDigest] changes",
        html_url: "https://github.com/test/repo/issues/42",
        body: "[DesignDigest] abc123\n\nSome description" as string | null,
      },
    ];
    const result = findExistingGitHubIssue(issues, "abc123");
    expect(result).toEqual({
      number: 42,
      title: "[DesignDigest] changes",
      html_url: "https://github.com/test/repo/issues/42",
    });
  });

  it("does not false-match on substring fileKeys", () => {
    const issues = [
      {
        number: 10,
        title: "[DesignDigest] changes",
        html_url: "url10",
        body: "[DesignDigest] abc123456\n\nDescription" as string | null,
      },
    ];
    const result = findExistingGitHubIssue(issues, "abc123");
    expect(result).toBeNull();
  });
});

describe("createGitHubIssue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an issue and returns it", async () => {
    const mockResponse = {
      number: 1,
      title: "Test issue",
      html_url: "https://github.com/test-owner/test-repo/issues/1",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    const result = await createGitHubIssue(mockConfig, "Test issue", "Body");
    expect(result).toEqual(mockResponse);
  });

  it("includes labels and assignees when configured", async () => {
    const configWithOptions: GitHubIssueConfig = {
      ...mockConfig,
      labels: ["design", "figma"],
      assignees: ["user1"],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          number: 1,
          title: "Test",
          html_url: "https://github.com/test-owner/test-repo/issues/1",
        }),
        { status: 201 },
      ),
    );

    await createGitHubIssue(configWithOptions, "Test", "Body");

    const calledBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(calledBody.labels).toEqual(["design", "figma"]);
    expect(calledBody.assignees).toEqual(["user1"]);
  });

  it("omits labels and assignees when empty", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          number: 1,
          title: "Test",
          html_url: "https://github.com/test-owner/test-repo/issues/1",
        }),
        { status: 201 },
      ),
    );

    await createGitHubIssue(mockConfig, "Test", "Body");

    const calledBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(calledBody.labels).toBeUndefined();
    expect(calledBody.assignees).toBeUndefined();
  });

  it("throws on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404, statusText: "Not Found" }),
    );

    await expect(
      createGitHubIssue(mockConfig, "Test", "Body"),
    ).rejects.toThrow("GitHub issue creation failed: 404 Not Found");
  });
});

describe("generateGitHubIssueTitle", () => {
  const mockCreate = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    mockCreate.mockReset();
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class MockAnthropic {
        constructor() {}
        messages = { create: mockCreate };
      },
    }));
  });

  it("returns Claude-generated title with [DesignDigest] prefix", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Update header font size and add banner" }],
    });

    const title = await generateGitHubIssueTitle("test-key", sampleChanges);
    expect(title).toBe("[DesignDigest] Update header font size and add banner");
  });

  it("does not duplicate [DesignDigest] prefix when Claude includes it", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "[DesignDigest] Header font update" }],
    });

    const title = await generateGitHubIssueTitle("test-key", sampleChanges);
    expect(title).toBe("[DesignDigest] Header font update");
    expect(title).not.toContain("[DesignDigest] [DesignDigest]");
  });

  it("throws when Claude API returns an error (caller handles fallback)", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API error"));

    await expect(generateGitHubIssueTitle("test-key", sampleChanges)).rejects.toThrow("API error");
  });

  it("falls back to githubDefaultTitle when content array is empty", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [],
    });

    const title = await generateGitHubIssueTitle("test-key", sampleChanges);
    expect(title).toBe(githubDefaultTitle(sampleChanges));
  });
});
