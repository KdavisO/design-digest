import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatGitHubIssueBody,
  githubDefaultTitle,
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

describe("findExistingGitHubIssue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when no matching issues found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    const result = await findExistingGitHubIssue(mockConfig, "abc123");
    expect(result).toBeNull();
  });

  it("returns null when issues exist but none contain marker", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            number: 1,
            title: "Unrelated issue",
            html_url: "https://github.com/test-owner/test-repo/issues/1",
            body: "No marker here",
          },
        ]),
        { status: 200 },
      ),
    );

    const result = await findExistingGitHubIssue(mockConfig, "abc123");
    expect(result).toBeNull();
  });

  it("returns existing issue when marker found in body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          {
            number: 42,
            title: "[DesignDigest] design changes",
            html_url: "https://github.com/test-owner/test-repo/issues/42",
            body: "[DesignDigest] abc123\n\nSome description",
          },
        ]),
        { status: 200 },
      ),
    );

    const result = await findExistingGitHubIssue(mockConfig, "abc123");
    expect(result).toEqual({
      number: 42,
      title: "[DesignDigest] design changes",
      html_url: "https://github.com/test-owner/test-repo/issues/42",
    });
  });

  it("throws on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );

    await expect(
      findExistingGitHubIssue(mockConfig, "abc123"),
    ).rejects.toThrow("GitHub issues list failed: 401 Unauthorized");
  });

  it("sends correct authorization header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    await findExistingGitHubIssue(mockConfig, "abc123");

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghp_test_token");
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
