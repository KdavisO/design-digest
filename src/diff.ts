import "dotenv/config";
import { loadConfig } from "./config.js";
import { FigmaRestAdapter } from "./adapters/figma-rest-adapter.js";
import { fetchFileName } from "./figma-client.js";
import type { FigmaUser } from "./figma-client.js";
import { loadSnapshot, saveSnapshot } from "./snapshot.js";
import {
  detectChanges,
  buildReport,
  formatSlackBlocks,
  formatSlackReport,
  groupByPage,
  groupChangesForIssues,
  convertMarkdownToSlackMrkdwn,
  escapeSlackLinkText,
} from "./diff-engine.js";
import { generatePageSummaries } from "./claude-summary.js";
import { sendSlackNotification } from "./notify.js";
import {
  fetchOpenIssues,
  findExistingGitHubIssue,
  createGitHubIssue,
  addGitHubIssueComment,
  formatGitHubIssueBody,
  formatGitHubIssueComment,
  generateGitHubIssueTitle,
  githubDefaultTitle,
} from "./github-issue-client.js";
import type { GitHubIssueConfig } from "./github-issue-client.js";
import {
  findExistingIssue,
  createBacklogIssue,
  addBacklogComment,
  formatBacklogDescription,
  formatBacklogComment,
  generateBacklogTitle,
  defaultTitle,
} from "./backlog-client.js";
import type { BacklogConfig } from "./backlog-client.js";
import type { ChangeEntry, SlackBlock } from "./diff-engine.js";
import type { Config } from "./config.js";

// Uses concrete FigmaRestAdapter (not FigmaDataAdapter interface) because diff.ts
// requires version history methods (checkVersionChanged, fetchVersions, extractEditorsSince)
// that are REST API-specific and not part of the common adapter interface.
async function processFile(
  adapter: FigmaRestAdapter,
  config: Config,
  fileKey: string,
): Promise<{ fileKey: string; changes: ChangeEntry[]; editors: FigmaUser[]; baselineCreated: boolean; pageNames?: string[]; fileName?: string }> {
  // Load previous snapshot
  const previous = await loadSnapshot(config.snapshotDir, fileKey);

  // Step 1: Version history check (skip if no previous snapshot)
  let latestVersionId: string | undefined;
  let versionCheckAttempted = false;
  if (previous?.versionId) {
    try {
      console.log("  Checking version history...");
      const versionCheck = await adapter.checkVersionChanged(
        fileKey,
        previous.versionId,
      );
      versionCheckAttempted = true;
      latestVersionId = versionCheck.latestVersionId;
      if (!versionCheck.changed) {
        console.log("  No version change detected — skipping snapshot comparison.");
        return { fileKey, changes: [], editors: [], baselineCreated: false };
      }
      console.log("  Version changed — fetching current state.");
    } catch (err) {
      console.warn("  Version check failed, falling back to full fetch:", err);
    }
  }

  // Step 2: Fetch current state from Figma via FigmaRestAdapter
  // The adapter handles proactive chunking, payload-too-large fallback, and sanitization.
  const fetchOptions = {
    watchPages: config.figmaWatchPages,
    watchNodeIds: config.figmaWatchNodeIds,
    depth: config.figmaNodeDepth,
    batchSize: config.figmaBatchSize,
  };

  if (config.figmaWatchNodeIds.length > 0) {
    console.log(
      `  Fetching specific nodes: ${config.figmaWatchNodeIds.join(", ")}`,
    );
  } else if (config.figmaWatchPages.length > 0) {
    console.log(
      `  Fetching watched pages (proactive strategy): ${config.figmaWatchPages.join(", ")}`,
    );
  } else {
    console.log(`  Fetching full file (proactive strategy)...`);
  }

  const pages = await adapter.fetchPages(fileKey, fetchOptions);

  console.log(`  Fetched ${Object.keys(pages).length} page(s)`);

  // Fetch latest version ID if we didn't already attempt it
  if (!versionCheckAttempted) {
    try {
      const versions = await adapter.fetchVersions(fileKey);
      if (versions.length > 0) latestVersionId = versions[0].id;
    } catch {
      // Non-critical — version ID is optional for snapshot
    }
  }

  // Preserve previous versionId if we couldn't obtain a new one
  if (!latestVersionId && previous?.versionId) {
    latestVersionId = previous.versionId;
  }

  // Save current snapshot (with version ID)
  await saveSnapshot(config.snapshotDir, fileKey, pages, latestVersionId);
  console.log("  Snapshot saved.");

  if (!previous) {
    console.log("  No previous snapshot found. First run — baseline saved.");
    const fileName = await fetchFileName(config.figmaToken, fileKey);
    if (fileName) console.log(`  File name: ${fileName}`);
    return { fileKey, changes: [], editors: [], baselineCreated: true, pageNames: Object.keys(pages), fileName };
  }

  // Detect changes
  const changes = detectChanges(previous.pages, pages);

  // Fetch editors since last snapshot only if there are changes
  let editors: FigmaUser[] = [];
  if (changes.length > 0) {
    try {
      console.log("  Fetching version history...");
      const versions = await adapter.fetchVersions(fileKey);
      editors = adapter.extractEditorsSince(versions, previous.timestamp);
      if (editors.length > 0) {
        console.log(`  Editors: ${editors.map((e) => e.handle).join(", ")}`);
      }
    } catch (err) {
      console.warn("  Failed to fetch version history:", err);
    }
  }
  const report = buildReport(fileKey, changes, editors);

  console.log(report.summary);

  // Fetch file name only when there are changes to report (avoids unnecessary API call)
  let fileName: string | undefined;
  if (changes.length > 0) {
    fileName = await fetchFileName(config.figmaToken, fileKey);
    if (fileName) console.log(`  File name: ${fileName}`);
  }

  return { fileKey, changes, editors, baselineCreated: false, fileName };
}

async function main(): Promise<void> {
  console.log("DesignDigest: Starting diff check...");

  const config = loadConfig();
  const adapter = new FigmaRestAdapter(config.figmaToken);
  const allChanges: { fileKey: string; changes: ChangeEntry[]; editors: FigmaUser[]; baselineCreated: boolean; pageNames?: string[]; fileName?: string }[] = [];

  for (const fileKey of config.figmaFileKeys) {
    console.log(
      `\n--- File: ${fileKey} (${config.figmaFileKeys.indexOf(fileKey) + 1}/${config.figmaFileKeys.length}) ---`,
    );
    const result = await processFile(adapter, config, fileKey);
    allChanges.push(result);
  }

  const totalChanges = allChanges.flatMap((r) => r.changes);

  // Send baseline notification independently of change detection
  const baselineResults = allChanges.filter((r) => r.baselineCreated);
  if (baselineResults.length > 0) {
    if (!config.dryRun && config.slackWebhookUrl) {
      try {
        const SLACK_TEXT_LIMIT = 3000;
        const baselineBlocks: SlackBlock[] = [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "📋 Baseline created — now monitoring",
              emoji: true,
            },
          },
        ];
        for (const r of baselineResults) {
          const figmaUrl = `https://www.figma.com/design/${r.fileKey}`;
          const names = r.pageNames ?? [];
          const pageList = names.length > 0
            ? names.map((p) => `• ${p}`).join("\n")
            : "(no pages detected)";
          const displayName = escapeSlackLinkText(r.fileName ?? r.fileKey);
          const prefix = `*<${figmaUrl}|${displayName}>*\nPages:\n`;
          let text: string;
          if (prefix.length + pageList.length <= SLACK_TEXT_LIMIT) {
            text = prefix + pageList;
          } else {
            // Truncate by whole lines to avoid cutting mid-line or mid-character
            const truncatedNote = "\n(truncated)";
            const available = Math.max(0, SLACK_TEXT_LIMIT - prefix.length - truncatedNote.length);
            const lines = pageList.split("\n");
            let truncated = "";
            for (const line of lines) {
              const next = truncated ? truncated + "\n" + line : line;
              if (next.length > available) break;
              truncated = next;
            }
            text = prefix + (truncated || lines[0]) + truncatedNote;
          }
          baselineBlocks.push({
            type: "section",
            text: { type: "mrkdwn", text },
          });
        }
        // Slack limits messages to 50 blocks — truncate with a note if exceeded
        const MAX_BASELINE_BLOCKS = 50;
        let finalBaselineBlocks: SlackBlock[] = baselineBlocks;
        if (baselineBlocks.length > MAX_BASELINE_BLOCKS) {
          // Log full baseline details before truncating
          for (const r of baselineResults) {
            const names = r.pageNames ?? [];
            console.log(`  Baseline: ${r.fileKey} — ${names.length} page(s): ${names.join(", ")}`);
          }
          finalBaselineBlocks = baselineBlocks.slice(0, MAX_BASELINE_BLOCKS - 1);
          finalBaselineBlocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: `⚠️ Output truncated (${MAX_BASELINE_BLOCKS} block limit). Full details logged to console.` }],
          });
        }
        await sendSlackNotification(config.slackWebhookUrl, {
          text: "📋 Baseline created — now monitoring",
          blocks: finalBaselineBlocks,
        });
        console.log("Slack notification sent (baseline created).");
      } catch (err) {
        console.warn("Failed to send Slack notification:", err);
      }
    } else if (config.dryRun) {
      console.log("Baseline created — dry run mode, skipping Slack notification.");
    } else {
      console.log("Baseline created — no SLACK_WEBHOOK_URL configured, skipping notification.");
    }
  }

  if (totalChanges.length === 0) {
    console.log("\n✅ No changes detected across all files.");

    // Send "no changes" Slack notification (only when no baseline was created)
    if (baselineResults.length === 0 && !config.dryRun && config.slackWebhookUrl) {
      try {
        await sendSlackNotification(config.slackWebhookUrl, {
          text: "✅ No changes detected",
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: "✅ No changes detected",
                emoji: true,
              },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "All monitored Figma files are unchanged.",
              },
            },
          ],
        });
        console.log("Slack notification sent (no changes).");
      } catch (err) {
        console.warn("Failed to send Slack notification:", err);
      }
    } else if (baselineResults.length === 0 && config.dryRun) {
      console.log("Dry run mode — skipping Slack notification.");
    } else if (baselineResults.length === 0 && !config.slackWebhookUrl) {
      console.log("No SLACK_WEBHOOK_URL configured — skipping notification.");
    }

    console.log("Done.");
    return;
  }

  // Generate per-page AI summaries only when API key is available and at least
  // one integration will actually use them (checking required config, not just flags)
  const slackNeedsSummaries =
    config.claudeSummaryEnabled && !!config.slackWebhookUrl && !config.dryRun;
  const githubNeedsSummaries =
    config.githubIssueEnabled && !!config.githubIssueToken && !!config.githubIssueRepo && !config.dryRun;
  const backlogNeedsSummaries =
    config.backlogEnabled && !!config.backlogApiKey && !!config.backlogSpaceId && !!config.backlogProjectId && !config.dryRun;
  const needsSummaries: boolean =
    !!config.anthropicApiKey &&
    (slackNeedsSummaries || githubNeedsSummaries || backlogNeedsSummaries);
  const perFileSummaries = new Map<string, Map<string, string>>();
  if (needsSummaries) {
    const anthropicApiKey = config.anthropicApiKey!;
    console.log("\nGenerating AI summaries (per page)...");
    for (const { fileKey, changes } of allChanges) {
      if (!changes.length) continue;
      try {
        const changesByPage = groupByPage(changes);
        const { summaries, failedPages } = await generatePageSummaries(anthropicApiKey, changesByPage);
        perFileSummaries.set(fileKey, summaries);
        for (const [pageName, summary] of summaries) {
          console.log(`\n--- AI Summary: ${fileKey} / ${pageName} ---`);
          console.log(summary);
        }
        if (failedPages.length > 0) {
          console.warn(`  Failed to generate summaries for ${fileKey}: ${failedPages.join(", ")}`);
        }
      } catch (err) {
        console.warn(`AI summary generation failed for ${fileKey}:`, err);
      }
    }
  }

  // Send Slack notification
  if (!config.dryRun && config.slackWebhookUrl) {
    console.log("\nSending Slack notification...");

    // Build Block Kit blocks for all files, inserting dividers between file reports
    const MAX_BLOCKS = 50;
    const fileResults = allChanges.filter((r) => r.changes.length > 0);
    // Only include AI summaries in Slack when configured
    const slackSummaries = slackNeedsSummaries ? perFileSummaries : undefined;
    let blocks = fileResults.flatMap((r, i) => {
      const fileBlocks = formatSlackBlocks(r.fileKey, r.changes, r.editors, slackSummaries?.get(r.fileKey), r.fileName);
      return i < fileResults.length - 1
        ? [...fileBlocks, { type: "divider" as const }]
        : fileBlocks;
    });

    // Slack limits messages to 50 blocks — truncate with a note if exceeded
    if (blocks.length > MAX_BLOCKS) {
      blocks = blocks.slice(0, MAX_BLOCKS - 1);
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `⚠️ Output truncated (${MAX_BLOCKS} block limit). See full report in logs.` }],
      });
    }

    // Plain text fallback for notifications/emails
    const fallbackText = allChanges
      .filter((r) => r.changes.length > 0)
      .map((r) => {
        const baseReport = formatSlackReport(r.fileKey, r.changes, r.editors, r.fileName);
        const fileSummaries = slackSummaries?.get(r.fileKey);
        if (!fileSummaries || fileSummaries.size === 0) return baseReport;
        const summaryLines = [...fileSummaries.entries()]
          .map(([pageName, summary]) => {
            const mrkdwn = convertMarkdownToSlackMrkdwn(summary);
            return `💡 ${pageName}:\n${mrkdwn}`;
          })
          .join("\n");
        return `${baseReport}\n\n${summaryLines}`;
      })
      .join("\n---\n");

    await sendSlackNotification(config.slackWebhookUrl, {
      text: fallbackText,
      blocks,
    });
    console.log("Slack notification sent.");
  } else if (config.dryRun) {
    console.log("\nDry run mode — skipping Slack notification.");
  } else if (!config.slackWebhookUrl) {
    console.log("\nNo SLACK_WEBHOOK_URL configured — skipping notification.");
  }

  // Reuse per-page summaries for issue bodies instead of making additional API calls.
  // Returns the summary for the pages that the given changes belong to.
  function getSummaryForChanges(fileKey: string, changes: ChangeEntry[]): string | undefined {
    const fileSummaries = perFileSummaries.get(fileKey);
    if (!fileSummaries || fileSummaries.size === 0) return undefined;
    // Collect unique page names from the changes
    const pageNames = new Set(changes.map((c) => c.pageName));
    const relevantSummaries = [...fileSummaries.entries()]
      .filter(([pageName]) => pageNames.has(pageName));
    if (relevantSummaries.length === 0) return undefined;
    if (relevantSummaries.length === 1) return relevantSummaries[0][1];
    return relevantSummaries
      .map(([pageName, summary]) => `### ${pageName}\n${summary}`)
      .join("\n\n");
  }

  // Create GitHub Issues (node-level with page-level fallback)
  if (
    !config.dryRun &&
    config.githubIssueEnabled &&
    config.githubIssueToken &&
    config.githubIssueRepo
  ) {
    console.log("\nCreating GitHub Issues...");
    try {
      const segments = config.githubIssueRepo
        .trim()
        .split("/")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (segments.length !== 2) {
        throw new Error(
          `Invalid GITHUB_ISSUE_REPO format: "${config.githubIssueRepo}" (expected "owner/repo")`,
        );
      }
      const [owner, repo] = segments;

      const ghIssueConfig: GitHubIssueConfig = {
        token: config.githubIssueToken,
        owner,
        repo,
        labels: config.githubIssueLabels,
        assignees: config.githubIssueAssignees,
      };

      // Fetch open issues once for duplicate checking
      const openIssues = await fetchOpenIssues(ghIssueConfig);

      for (const result of allChanges.filter((r) => r.changes.length > 0)) {
        const issueUnits = groupChangesForIssues(result.fileKey, result.changes);

        for (const unit of issueUnits) {
          try {
            // Check for duplicate issues using the unit marker
            const existing = findExistingGitHubIssue(openIssues, unit.marker);
            if (existing) {
              // Add comment with updated changes instead of skipping
              const summary = getSummaryForChanges(result.fileKey, unit.changes);
              const commentBody = formatGitHubIssueComment(unit.changes, summary);
              await addGitHubIssueComment(ghIssueConfig, existing.number, commentBody);
              console.log(
                `  Comment added to #${existing.number} — ${unit.label}`,
              );
              continue;
            }

            // Generate title
            let title: string;
            if (config.anthropicApiKey) {
              try {
                title = await generateGitHubIssueTitle(
                  config.anthropicApiKey,
                  unit.changes,
                );
              } catch {
                title = githubDefaultTitle(unit.changes);
              }
            } else {
              title = githubDefaultTitle(unit.changes);
            }

            const aiSummary = getSummaryForChanges(result.fileKey, unit.changes);
            const scopeLabel = unit.scope === "node"
              ? `Node: ${unit.label}`
              : `Page: ${unit.label}`;

            const body = formatGitHubIssueBody(
              result.fileKey,
              unit.changes,
              aiSummary,
              { marker: unit.marker, scopeLabel },
            );

            const issue = await createGitHubIssue(ghIssueConfig, title, body);
            // Add to cache to prevent duplicates within the same run
            openIssues.push({
              number: issue.number,
              title: issue.title,
              html_url: issue.html_url,
              body,
              pull_request: undefined,
            });
            console.log(
              `  GitHub Issue created: #${issue.number} — ${issue.title}`,
            );
          } catch (unitErr) {
            console.warn(`  Failed to process unit "${unit.label}":`, unitErr);
          }
        }
      }
    } catch (err) {
      console.warn("GitHub Issue creation failed:", err);
    }
  } else if (config.dryRun && config.githubIssueEnabled) {
    console.log("\nDry run mode — skipping GitHub Issue creation.");
  } else if (config.githubIssueEnabled) {
    const missing: string[] = [];
    if (!config.githubIssueToken) missing.push("GITHUB_ISSUE_TOKEN or GITHUB_TOKEN");
    if (!config.githubIssueRepo) missing.push("GITHUB_ISSUE_REPO");
    console.warn(
      `\nGitHub Issue integration enabled but missing required env vars: ${missing.join(", ")}`,
    );
  }

  // Create Backlog issues (node-level with page-level fallback)
  if (
    !config.dryRun &&
    config.backlogEnabled &&
    config.backlogApiKey &&
    config.backlogSpaceId &&
    config.backlogProjectId
  ) {
    console.log("\nCreating Backlog issues...");
    try {
      const backlogConfig: BacklogConfig = {
        apiKey: config.backlogApiKey,
        spaceId: config.backlogSpaceId,
        projectId: config.backlogProjectId,
        issueTypeId: config.backlogIssueTypeId,
        priorityId: config.backlogPriorityId,
        assigneeId: config.backlogAssigneeId,
      };

      for (const result of allChanges.filter((r) => r.changes.length > 0)) {
        const issueUnits = groupChangesForIssues(result.fileKey, result.changes);

        for (const unit of issueUnits) {
          try {
            // Check for duplicate issues using the unit marker
            const existing = await findExistingIssue(backlogConfig, unit.marker);
            if (existing) {
              // Add comment with updated changes instead of skipping
              const summary = getSummaryForChanges(result.fileKey, unit.changes);
              const commentBody = formatBacklogComment(unit.changes, summary);
              await addBacklogComment(backlogConfig, existing.issueKey, commentBody);
              console.log(
                `  Comment added to ${existing.issueKey} — ${unit.label}`,
              );
              continue;
            }

            // Generate title (use Claude if available, otherwise default)
            let title: string;
            if (config.anthropicApiKey) {
              try {
                title = await generateBacklogTitle(
                  config.anthropicApiKey,
                  unit.changes,
                );
              } catch {
                title = defaultTitle(unit.changes);
              }
            } else {
              title = defaultTitle(unit.changes);
            }

            const aiSummary = getSummaryForChanges(result.fileKey, unit.changes);
            const scopeLabel = unit.scope === "node"
              ? `Node: ${unit.label}`
              : `Page: ${unit.label}`;

            const description = formatBacklogDescription(
              result.fileKey,
              unit.changes,
              aiSummary,
              { marker: unit.marker, scopeLabel },
            );

            const issue = await createBacklogIssue(
              backlogConfig,
              title,
              description,
            );
            console.log(`  Backlog issue created: ${issue.issueKey} — ${issue.summary}`);
          } catch (unitErr) {
            console.warn(`  Failed to process unit "${unit.label}":`, unitErr);
          }
        }
      }
    } catch (err) {
      console.warn("Backlog issue creation failed:", err);
    }
  } else if (config.dryRun && config.backlogEnabled) {
    console.log("\nDry run mode — skipping Backlog issue creation.");
  } else if (config.backlogEnabled) {
    const missing: string[] = [];
    if (!config.backlogApiKey) missing.push("BACKLOG_API_KEY");
    if (!config.backlogSpaceId) missing.push("BACKLOG_SPACE_ID");
    if (!config.backlogProjectId) missing.push("BACKLOG_PROJECT_ID");
    console.warn(
      `\nBacklog integration enabled but missing required env vars: ${missing.join(", ")}`,
    );
  }

  console.log("Done.");
}

main().catch(async (err) => {
  console.error("DesignDigest failed:", err);

  // Send error notification to Slack (skip in dry-run for consistency)
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const isDryRun = process.env.DRY_RUN === "true";
  if (webhookUrl && !isDryRun) {
    try {
      const MAX_TEXT_LENGTH = 2900;
      const rawMessage = err instanceof Error ? err.message : String(err);
      const errorMessage = rawMessage.slice(0, MAX_TEXT_LENGTH);
      const rawStack = err instanceof Error && err.stack
        ? err.stack.split("\n").slice(0, 5).join("\n")
        : "";
      const stackTrace = rawStack.slice(0, MAX_TEXT_LENGTH);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      try {
        await sendSlackNotification(webhookUrl, {
          text: `⚠️ Error: ${errorMessage}`,
          blocks: [
            {
              type: "header",
              text: { type: "plain_text", text: "⚠️ Error", emoji: true },
            },
            {
              type: "section",
              text: { type: "mrkdwn", text: `*Error:*\n\`\`\`${errorMessage}\`\`\`` },
            },
            ...(stackTrace
              ? [{
                  type: "section",
                  text: { type: "mrkdwn", text: `*Stack trace:*\n\`\`\`${stackTrace}\`\`\`` },
                }]
              : []),
          ],
        }, controller.signal);
        console.log("Error notification sent to Slack.");
      } finally {
        clearTimeout(timeout);
      }
    } catch (notifyErr) {
      console.error("Failed to send error notification to Slack:", notifyErr);
    }
  }

  process.exit(1);
});
