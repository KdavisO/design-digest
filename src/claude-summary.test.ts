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

    const result = await generatePageSummaries("fake-key", changesByPage, mockGenerate);
    expect(result.size).toBe(2);
    expect(result.get("Home")).toBe("Mock summary");
    expect(result.get("Settings")).toBe("Mock summary");
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

    const result = await generatePageSummaries("fake-key", changesByPage, mockGenerate);
    expect(result.size).toBe(1);
    expect(result.has("FailPage")).toBe(false);
    expect(result.get("SuccessPage")).toBe("Success summary");
  });

  it("returns empty map for empty input", async () => {
    const mockGenerate = vi.fn();

    const result = await generatePageSummaries("fake-key", {}, mockGenerate);
    expect(result.size).toBe(0);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
