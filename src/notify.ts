export async function sendSlackNotification(
  webhookUrl: string,
  text: string,
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Slack webhook failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
    );
  }
}
