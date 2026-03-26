import type { ChangeEntry } from "./diff-engine.js";

export interface PageSummaryResult {
  summaries: Map<string, string>;
  failedPages: string[];
}

/**
 * Generate AI summaries per page. Returns summaries and failed page names.
 * Each page's summary is generated independently; failures are isolated.
 * Throws when all pages fail. Caller is responsible for logging failures with context.
 */
export async function generatePageSummaries(
  apiKey: string,
  changesByPage: Record<string, ChangeEntry[]>,
  generate: (apiKey: string, changes: ChangeEntry[]) => Promise<string> = generateSummary,
): Promise<PageSummaryResult> {
  const summaries = new Map<string, string>();
  const entries = Object.entries(changesByPage);

  const settled = await Promise.allSettled(
    entries.map(async ([pageName, pageChanges]) => {
      const summary = await generate(apiKey, pageChanges);
      return { pageName, summary };
    }),
  );

  const failedPages: string[] = [];

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === "fulfilled") {
      summaries.set(result.value.pageName, result.value.summary);
    } else {
      failedPages.push(entries[i][0]);
    }
  }

  if (failedPages.length === entries.length && entries.length > 0) {
    throw new Error(
      `Failed to generate summaries for all pages: ${failedPages.join(", ")}`,
    );
  }

  return { summaries, failedPages };
}

export async function generateSummary(
  apiKey: string,
  changes: ChangeEntry[],
): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const changesText = changes
    .map((c) => {
      if (c.kind === "added") return `- Added: ${c.nodeName} (${c.nodeType}) in ${c.pageName}`;
      if (c.kind === "deleted") return `- Deleted: ${c.nodeName} (${c.nodeType}) in ${c.pageName}`;
      return `- Modified: ${c.nodeName}.${c.property}: ${formatVal(c.oldValue)} → ${formatVal(c.newValue)} in ${c.pageName}`;
    })
    .join("\n");

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are a design-to-engineering change analyst. Summarize the following Figma design changes for frontend engineers. Focus on implementation impact.

Changes detected:
${changesText}

Provide:
1. A brief summary of what changed (2-3 sentences)
2. Implementation impact (what frontend code might need updating)
3. Priority level (high/medium/low)

Be concise and actionable. Respond in the same language as the node names.`,
      },
    ],
  });

  const block = message.content[0];
  if (block.type === "text") return block.text;
  return "Unable to generate summary.";
}

function formatVal(value: unknown): string {
  if (value === undefined) return "(none)";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
