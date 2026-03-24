import type { ChangeEntry } from "./diff-engine.js";

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
