/**
 * MCP-based design check entry point.
 *
 * Usage:
 *   tsx src/design-check.ts --input <path-to-mcp-response.json> [--file-key <key>]
 *
 * This script:
 * 1. Reads MCP response data from the specified JSON file
 * 2. Normalizes it via FigmaMcpAdapter
 * 3. Compares with the previous snapshot (if any)
 * 4. Outputs the diff report
 * 5. Sends notifications (Slack / GitHub Issue / Backlog) unless DRY_RUN=true
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { FigmaMcpAdapter } from "./adapters/figma-mcp-adapter.js";
import type { McpFigmaFileResponse } from "./adapters/figma-mcp-adapter.js";
import { loadSnapshot, saveSnapshot } from "./snapshot.js";
import {
  detectChanges,
  buildReport,
  formatSlackBlocks,
  formatSlackReport,
  groupByPage,
} from "./diff-engine.js";
import { generatePageSummaries } from "./claude-summary.js";
import { sendSlackNotification } from "./notify.js";

interface CliArgs {
  inputPath: string;
  fileKey: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let inputPath: string | undefined;
  let fileKey: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) {
      inputPath = args[++i];
    } else if (args[i] === "--file-key" && args[i + 1]) {
      fileKey = args[++i];
    }
  }

  if (!inputPath) {
    console.error("Usage: tsx src/design-check.ts --input <path> [--file-key <key>]");
    process.exit(1);
  }

  // Default file key from env or derive from input filename
  fileKey ??= process.env.FIGMA_FILE_KEY?.split(",")[0]?.trim() ?? "mcp-check";

  return { inputPath, fileKey };
}

async function main(): Promise<void> {
  const { inputPath, fileKey } = parseArgs();
  const snapshotDir = process.env.SNAPSHOT_DIR || "./snapshots";
  const dryRun = process.env.DRY_RUN === "true";
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  console.log(`DesignDigest (MCP): Processing ${inputPath} for file ${fileKey}`);

  // 1. Load MCP response data
  const rawData = await readFile(inputPath, "utf-8");
  const mcpResponse: McpFigmaFileResponse = JSON.parse(rawData);

  // 2. Normalize via adapter
  const watchPages = process.env.FIGMA_WATCH_PAGES?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const adapter = FigmaMcpAdapter.fromMcpResponse(mcpResponse);
  const pages = await adapter.fetchPages(fileKey, { watchPages });

  console.log(`  Fetched ${Object.keys(pages).length} page(s) via MCP`);

  // 3. Load previous snapshot
  const previous = await loadSnapshot(snapshotDir, fileKey);

  // 4. Save current snapshot
  await saveSnapshot(snapshotDir, fileKey, pages);
  console.log("  Snapshot saved.");

  if (!previous) {
    console.log("  No previous snapshot found. First run — baseline saved.");
    console.log("Done.");
    return;
  }

  // 5. Detect changes
  const changes = detectChanges(previous.pages, pages);
  const report = buildReport(fileKey, changes);
  console.log(report.summary);

  if (changes.length === 0) {
    console.log("\n✅ No changes detected.");
    if (!dryRun && slackWebhookUrl) {
      await sendSlackNotification(slackWebhookUrl, {
        text: "✅ No changes detected (MCP check)",
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "✅ No changes detected (MCP)", emoji: true },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: "MCP-based design check: no changes found." },
          },
        ],
      });
      console.log("Slack notification sent (no changes).");
    }
    console.log("Done.");
    return;
  }

  // 6. Generate AI summaries if configured
  const claudeSummaryEnabled = process.env.CLAUDE_SUMMARY_ENABLED === "true";
  let pageSummaries: Map<string, string> | undefined;
  if (anthropicApiKey && claudeSummaryEnabled && !dryRun && slackWebhookUrl) {
    try {
      console.log("\nGenerating AI summaries...");
      const changesByPage = groupByPage(changes);
      const { summaries } = await generatePageSummaries(anthropicApiKey, changesByPage);
      pageSummaries = summaries;
      for (const [pageName, summary] of summaries) {
        console.log(`\n--- AI Summary: ${pageName} ---`);
        console.log(summary);
      }
    } catch (err) {
      console.warn("AI summary generation failed:", err);
    }
  }

  // 7. Send Slack notification
  if (!dryRun && slackWebhookUrl) {
    console.log("\nSending Slack notification...");
    const blocks = formatSlackBlocks(fileKey, changes, undefined, pageSummaries);
    const fallbackText = formatSlackReport(fileKey, changes);
    await sendSlackNotification(slackWebhookUrl, { text: fallbackText, blocks });
    console.log("Slack notification sent.");
  } else if (dryRun) {
    console.log("\nDry run mode — skipping notifications.");
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("DesignDigest (MCP) failed:", err);
  process.exit(1);
});
