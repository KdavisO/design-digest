import { describe, it, expect, vi } from "vitest";
import type { ChangeEntry } from "./diff-engine.js";
import { generatePageSummaries } from "./claude-summary.js";

describe("generatePageSummaries", () => {
  it("generates summaries for each page independently", async () => {
    const mockGenerate = vi.fn().mockResolvedValue("Mock summary");

    const changesByPage: Record<string, ChangeEntry[]> = {
      Home: [
        { pageName: "Home", nodeId: "1:1", nodeName: "Button", nodeType: "FRAME", kind: "added" },
      ],
      Settings: [
        { pageName: "Settings", nodeId: "2:1", nodeName: "Toggle", nodeType: "FRAME", kind: "added" },
      ],
    };

    const { summaries, failedPages } = await generatePageSummaries("fake-key", changesByPage, mockGenerate);
    expect(summaries.size).toBe(2);
    expect(summaries.get("Home")).toBe("Mock summary");
    expect(summaries.get("Settings")).toBe("Mock summary");
    expect(failedPages).toEqual([]);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it("isolates failures — one page failing does not affect others", async () => {
    let callCount = 0;
    const mockGenerate = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("API error");
      }
      return "Success summary";
    });

    const changesByPage: Record<string, ChangeEntry[]> = {
      FailPage: [
        { pageName: "FailPage", nodeId: "1:1", nodeName: "A", nodeType: "FRAME", kind: "added" },
      ],
      SuccessPage: [
        { pageName: "SuccessPage", nodeId: "2:1", nodeName: "B", nodeType: "FRAME", kind: "added" },
      ],
    };

    const { summaries, failedPages } = await generatePageSummaries("fake-key", changesByPage, mockGenerate);
    expect(summaries.size).toBe(1);
    expect(summaries.has("FailPage")).toBe(false);
    expect(summaries.get("SuccessPage")).toBe("Success summary");
    expect(failedPages).toEqual(["FailPage"]);
  });

  it("throws when all pages fail", async () => {
    const mockGenerate = vi.fn().mockRejectedValue(new Error("API error"));

    const changesByPage: Record<string, ChangeEntry[]> = {
      Page1: [
        { pageName: "Page1", nodeId: "1:1", nodeName: "A", nodeType: "FRAME", kind: "added" },
      ],
      Page2: [
        { pageName: "Page2", nodeId: "2:1", nodeName: "B", nodeType: "FRAME", kind: "added" },
      ],
    };

    await expect(
      generatePageSummaries("fake-key", changesByPage, mockGenerate),
    ).rejects.toThrow("Failed to generate summaries for all pages");
  });

  it("returns empty result for empty input", async () => {
    const mockGenerate = vi.fn();

    const { summaries, failedPages } = await generatePageSummaries("fake-key", {}, mockGenerate);
    expect(summaries.size).toBe(0);
    expect(failedPages).toEqual([]);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
