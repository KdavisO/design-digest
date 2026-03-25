import type { SlackBlock } from "./diff-engine.js";

export interface SlackPayload {
  text: string;
  blocks?: SlackBlock[];
  icon_url?: string;
  icon_emoji?: string;
}

export async function sendSlackNotification(
  webhookUrl: string,
  payload: SlackPayload,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Slack webhook failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
    );
  }
}
