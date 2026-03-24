import "dotenv/config";
import { loadConfig } from "./config.js";
import {
  fetchFile,
  fetchNodes,
  filterWatchTargets,
  sanitizeNode,
} from "./figma-client.js";
import { loadSnapshot, saveSnapshot } from "./snapshot.js";
import {
  detectChanges,
  buildReport,
  formatSlackReport,
} from "./diff-engine.js";
import { generateSummary } from "./claude-summary.js";
import { sendSlackNotification } from "./notify.js";
import type { FigmaNode } from "./figma-client.js";

async function main(): Promise<void> {
  console.log("DesignDigest: Starting diff check...");

  const config = loadConfig();

  // Fetch current state from Figma
  let pages: Record<string, FigmaNode>;

  if (config.figmaWatchNodeIds.length > 0) {
    console.log(
      `Fetching specific nodes: ${config.figmaWatchNodeIds.join(", ")}`,
    );
    const nodes = await fetchNodes(config);
    pages = {};
    for (const [id, node] of Object.entries(nodes)) {
      pages[node.name || id] = sanitizeNode(node);
    }
  } else {
    console.log("Fetching full file...");
    const file = await fetchFile(config);
    const targetPages = filterWatchTargets(file, config.figmaWatchPages);
    pages = {};
    for (const page of targetPages) {
      pages[page.name] = sanitizeNode(page);
    }
  }

  console.log(`Fetched ${Object.keys(pages).length} page(s)`);

  // Load previous snapshot
  const previous = await loadSnapshot(config.snapshotDir, config.figmaFileKey);

  // Save current snapshot
  await saveSnapshot(config.snapshotDir, config.figmaFileKey, pages);
  console.log("Snapshot saved.");

  if (!previous) {
    console.log("No previous snapshot found. First run — baseline saved.");
    return;
  }

  // Detect changes
  const changes = detectChanges(previous.pages, pages);
  const report = buildReport(config.figmaFileKey, changes);

  console.log(report.summary);

  if (changes.length === 0) {
    console.log("No changes detected. Done.");
    return;
  }

  // Optional: AI summary
  let aiSummary: string | undefined;
  if (config.claudeSummaryEnabled && config.anthropicApiKey) {
    console.log("Generating AI summary...");
    try {
      aiSummary = await generateSummary(config.anthropicApiKey, changes);
      console.log("\n--- AI Summary ---");
      console.log(aiSummary);
    } catch (err) {
      console.warn("AI summary generation failed:", err);
    }
  }

  // Send Slack notification
  if (!config.dryRun && config.slackWebhookUrl) {
    console.log("Sending Slack notification...");
    let slackText = formatSlackReport(config.figmaFileKey, changes);
    if (aiSummary) {
      slackText += `\n---\n*AI Summary:*\n${aiSummary}`;
    }
    await sendSlackNotification(config.slackWebhookUrl, slackText);
    console.log("Slack notification sent.");
  } else if (config.dryRun) {
    console.log("Dry run mode — skipping Slack notification.");
  } else if (!config.slackWebhookUrl) {
    console.log("No SLACK_WEBHOOK_URL configured — skipping notification.");
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("DesignDigest failed:", err);
  process.exit(1);
});
