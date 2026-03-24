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
import type { ChangeEntry } from "./diff-engine.js";
import type { Config } from "./config.js";

async function processFile(
  config: Config,
  fileKey: string,
): Promise<{ fileKey: string; changes: ChangeEntry[] }> {
  // Fetch current state from Figma
  let pages: Record<string, FigmaNode>;

  if (config.figmaWatchNodeIds.length > 0) {
    console.log(
      `  Fetching specific nodes: ${config.figmaWatchNodeIds.join(", ")}`,
    );
    const nodes = await fetchNodes(
      config.figmaToken,
      fileKey,
      config.figmaWatchNodeIds,
    );
    pages = {};
    for (const [id, node] of Object.entries(nodes)) {
      pages[node.name || id] = sanitizeNode(node);
    }
  } else {
    console.log(`  Fetching full file...`);
    const file = await fetchFile(config.figmaToken, fileKey);
    const targetPages = filterWatchTargets(file, config.figmaWatchPages);
    pages = {};
    for (const page of targetPages) {
      pages[page.name] = sanitizeNode(page);
    }
  }

  console.log(`  Fetched ${Object.keys(pages).length} page(s)`);

  // Load previous snapshot
  const previous = await loadSnapshot(config.snapshotDir, fileKey);

  // Save current snapshot
  await saveSnapshot(config.snapshotDir, fileKey, pages);
  console.log("  Snapshot saved.");

  if (!previous) {
    console.log("  No previous snapshot found. First run — baseline saved.");
    return { fileKey, changes: [] };
  }

  // Detect changes
  const changes = detectChanges(previous.pages, pages);
  const report = buildReport(fileKey, changes);

  console.log(report.summary);

  return { fileKey, changes };
}

async function main(): Promise<void> {
  console.log("DesignDigest: Starting diff check...");

  const config = loadConfig();
  const allChanges: { fileKey: string; changes: ChangeEntry[] }[] = [];

  for (const fileKey of config.figmaFileKeys) {
    console.log(
      `\n--- File: ${fileKey} (${config.figmaFileKeys.indexOf(fileKey) + 1}/${config.figmaFileKeys.length}) ---`,
    );
    const result = await processFile(config, fileKey);
    allChanges.push(result);
  }

  const totalChanges = allChanges.flatMap((r) => r.changes);

  if (totalChanges.length === 0) {
    console.log("\nNo changes detected across all files. Done.");
    return;
  }

  // Optional: AI summary
  let aiSummary: string | undefined;
  if (config.claudeSummaryEnabled && config.anthropicApiKey) {
    console.log("\nGenerating AI summary...");
    try {
      aiSummary = await generateSummary(config.anthropicApiKey, totalChanges);
      console.log("\n--- AI Summary ---");
      console.log(aiSummary);
    } catch (err) {
      console.warn("AI summary generation failed:", err);
    }
  }

  // Send Slack notification
  if (!config.dryRun && config.slackWebhookUrl) {
    console.log("\nSending Slack notification...");
    const slackParts = allChanges
      .filter((r) => r.changes.length > 0)
      .map((r) => formatSlackReport(r.fileKey, r.changes));
    let slackText = slackParts.join("\n---\n");
    if (aiSummary) {
      slackText += `\n---\n*AI Summary:*\n${aiSummary}`;
    }
    await sendSlackNotification(config.slackWebhookUrl, slackText);
    console.log("Slack notification sent.");
  } else if (config.dryRun) {
    console.log("\nDry run mode — skipping Slack notification.");
  } else if (!config.slackWebhookUrl) {
    console.log("\nNo SLACK_WEBHOOK_URL configured — skipping notification.");
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("DesignDigest failed:", err);
  process.exit(1);
});
