/**
 * MCP-based design check entry point.
 *
 * Usage:
 *   tsx src/design-check.ts --input <path-to-mcp-response.json> [--file-key <key>]
 *   tsx src/design-check.ts --input <chunk1.json> --input <chunk2.json> [--file-key <key>]
 *   tsx src/design-check.ts --input-dir <dir-with-chunks> [--file-key <key>]
 *
 * Chunked fetching:
 *   For large files (100+ pages), split MCP calls into chunks and provide
 *   multiple --input files or use --input-dir. All chunks are merged.
 *
 * This script:
 * 1. Reads MCP response data from the specified JSON file(s)
 * 2. Normalizes it via FigmaMcpAdapter
 * 3. Compares with the previous snapshot (if any)
 * 4. Outputs the diff report
 * 5. Sends Slack notification unless DRY_RUN=true
 */
import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { FigmaMcpAdapter } from "./adapters/figma-mcp-adapter.js";
import type { McpFigmaFileResponse } from "./adapters/figma-mcp-adapter.js";
import { isPayloadTooLargeError } from "./figma-client.js";
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
  inputPaths: string[];
  fileKey: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const inputPaths: string[] = [];
  let fileKey: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) {
      inputPaths.push(args[++i]);
    } else if (args[i] === "--input-dir" && args[i + 1]) {
      // Push dir marker in CLI order so merge order matches argument order
      inputPaths.push(`__dir__:${args[++i]}`);
    } else if (args[i] === "--file-key" && args[i + 1]) {
      fileKey = args[++i];
    }
  }

  if (inputPaths.length === 0) {
    console.error("Usage: tsx src/design-check.ts --input <path> [--input <path2> ...] [--input-dir <dir>] [--file-key <key>]");
    process.exit(1);
  }

  // Require file key from args or env
  if (!fileKey) {
    const rawEnvKey = process.env.FIGMA_FILE_KEY;
    const envKeys = rawEnvKey
      ? rawEnvKey.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    if (envKeys.length > 1) {
      console.error("Error: FIGMA_FILE_KEY contains multiple keys. Use --file-key to specify which one.");
      process.exit(1);
    }
    fileKey = envKeys[0];
  }

  if (!fileKey) {
    console.error("Error: --file-key is required (or set FIGMA_FILE_KEY env var)");
    process.exit(1);
  }

  return { inputPaths, fileKey };
}

/**
 * Resolve all input paths, expanding --input-dir entries.
 */
async function resolveInputPaths(rawPaths: string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const p of rawPaths) {
    if (p.startsWith("__dir__:")) {
      const dir = p.slice("__dir__:".length);
      const entries = await readdir(dir);
      const jsonFiles = entries
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => join(dir, f));
      resolved.push(...jsonFiles);
    } else {
      resolved.push(p);
    }
  }
  return resolved;
}

/**
 * Load MCP responses from input files.
 * Handles JSON parse errors gracefully with payload-too-large detection.
 */
async function loadMcpResponses(inputPaths: string[]): Promise<McpFigmaFileResponse[]> {
  const responses: McpFigmaFileResponse[] = [];
  for (const inputPath of inputPaths) {
    try {
      const rawData = await readFile(inputPath, "utf-8");
      const parsed: McpFigmaFileResponse = JSON.parse(rawData);
      responses.push(parsed);
    } catch (err) {
      if (isPayloadTooLargeError(err)) {
        console.error(
          `Error: Failed to parse ${inputPath} — payload too large.\n` +
          `  Split the MCP response into smaller chunks (per-page) and use multiple --input flags or --input-dir.`,
        );
        process.exit(1);
      }
      throw err;
    }
  }
  return responses;
}

async function main(): Promise<void> {
  const { inputPaths: rawInputPaths, fileKey } = parseArgs();
  const snapshotDir = process.env.SNAPSHOT_DIR || "./snapshots";
  const dryRun = process.env.DRY_RUN === "true";
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  // Resolve input paths (expand --input-dir)
  const inputPaths = await resolveInputPaths(rawInputPaths);

  if (inputPaths.length === 0) {
    console.error("Error: No input files found.");
    process.exit(1);
  }

  const isChunked = inputPaths.length > 1;
  console.log(
    isChunked
      ? `DesignDigest (MCP, chunked): Merging ${inputPaths.length} responses for file ${fileKey}`
      : `DesignDigest (MCP): Processing ${inputPaths[0]} for file ${fileKey}`,
  );

  // 1. Load and merge MCP response data
  const responses = await loadMcpResponses(inputPaths);
  const adapter = isChunked
    ? FigmaMcpAdapter.fromMcpResponses(responses)
    : FigmaMcpAdapter.fromMcpResponse(responses[0]);

  // 2. Normalize via adapter
  const watchNodeIds =
    process.env.FIGMA_WATCH_NODE_IDS?.split(",")?.map((s) => s.trim())?.filter(Boolean) ?? [];
  const watchPages =
    process.env.FIGMA_WATCH_PAGES?.split(",")?.map((s) => s.trim())?.filter(Boolean) ?? [];
  const pages = watchNodeIds.length > 0
    ? await adapter.fetchPages(fileKey, { watchNodeIds })
    : await adapter.fetchPages(fileKey, { watchPages });

  console.log(`  Fetched ${Object.keys(pages).length} page(s) via MCP${isChunked ? " (chunked)" : ""}`);

  // If single response, check if chunking would have been beneficial
  if (!isChunked && responses.length === 1 && FigmaMcpAdapter.needsChunking(responses[0])) {
    const pageList = FigmaMcpAdapter.extractPageList(responses[0]);
    const largePages = pageList.filter((p) => p.needsChunking);
    if (largePages.length > 0) {
      console.warn(
        `  Warning: ${largePages.length} page(s) exceed chunking threshold (${largePages.map((p) => `${p.name}: ${p.childCount} children`).join(", ")}). ` +
        `Consider using chunked fetching for more reliable results.`,
      );
    } else {
      console.warn(
        `  Warning: File has ${pageList.length} page(s), which triggers the chunking threshold. ` +
        `Consider using chunked fetching for more reliable results.`,
      );
    }
  }

  // 3. Load previous snapshot
  const previous = await loadSnapshot(snapshotDir, fileKey);

  // 4. Save current snapshot (preserving existing versionId, if any)
  await saveSnapshot(snapshotDir, fileKey, pages, previous?.versionId);
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
      try {
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
      } catch (err) {
        console.warn("Slack notification failed (no changes):", err);
      }
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
    const MAX_BLOCKS = 50;
    let blocks = formatSlackBlocks(fileKey, changes, undefined, pageSummaries);
    if (blocks.length > MAX_BLOCKS) {
      blocks = blocks.slice(0, MAX_BLOCKS - 1);
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `⚠️ Output truncated (${MAX_BLOCKS} block limit). See full report in logs.` }],
      });
    }
    const fallbackText = formatSlackReport(fileKey, changes);
    await sendSlackNotification(slackWebhookUrl, { text: fallbackText, blocks });
    console.log("Slack notification sent.");
  } else if (dryRun) {
    console.log("\nDry run mode — skipping notifications.");
  } else if (!slackWebhookUrl) {
    console.log("\nSLACK_WEBHOOK_URL not set — skipping Slack notification.");
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("DesignDigest (MCP) failed:", err);
  process.exit(1);
});
