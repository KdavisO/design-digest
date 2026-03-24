import deepDiff from "deep-diff";
const { diff } = deepDiff;
type Diff<L, R> = deepDiff.Diff<L, R>;
import type { FigmaNode } from "./figma-client.js";

export interface ChangeEntry {
  pageName: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  kind: "added" | "deleted" | "modified" | "renamed";
  property?: string;
  oldValue?: unknown;
  newValue?: unknown;
  /** For INSTANCE nodes: whether this is an override change vs master component change */
  isOverride?: boolean;
}

export interface ChangeReport {
  fileKey: string;
  changes: ChangeEntry[];
  summary: string;
}

const PROPERTY_LABELS: Record<string, string> = {
  fills: "塗り",
  strokes: "線",
  strokeWeight: "線の太さ",
  cornerRadius: "角丸",
  opacity: "不透明度",
  visible: "表示/非表示",
  characters: "テキスト内容",
  fontSize: "フォントサイズ",
  fontFamily: "フォントファミリー",
  fontWeight: "フォントウェイト",
  lineHeightPx: "行の高さ",
  letterSpacing: "字間",
  textAlignHorizontal: "水平揃え",
  textAlignVertical: "垂直揃え",
  constraints: "制約",
  layoutMode: "レイアウトモード",
  primaryAxisSizingMode: "主軸サイズ",
  counterAxisSizingMode: "交差軸サイズ",
  paddingLeft: "左パディング",
  paddingRight: "右パディング",
  paddingTop: "上パディング",
  paddingBottom: "下パディング",
  itemSpacing: "アイテム間隔",
  effects: "エフェクト",
  blendMode: "ブレンドモード",
  size: "サイズ",
  width: "幅",
  height: "高さ",
};

export function detectChanges(
  oldPages: Record<string, FigmaNode>,
  newPages: Record<string, FigmaNode>,
): ChangeEntry[] {
  const changes: ChangeEntry[] = [];

  const allPageNames = new Set([
    ...Object.keys(oldPages),
    ...Object.keys(newPages),
  ]);

  for (const pageName of allPageNames) {
    const oldPage = oldPages[pageName];
    const newPage = newPages[pageName];

    if (!oldPage && newPage) {
      changes.push({
        pageName,
        nodeId: newPage.id,
        nodeName: newPage.name,
        nodeType: newPage.type,
        kind: "added",
      });
      continue;
    }

    if (oldPage && !newPage) {
      changes.push({
        pageName,
        nodeId: oldPage.id,
        nodeName: oldPage.name,
        nodeType: oldPage.type,
        kind: "deleted",
      });
      continue;
    }

    const oldNodes = flattenNodes(oldPage);
    const newNodes = flattenNodes(newPage);

    const matchedOldIds = new Set<string>();
    const matchedNewIds = new Set<string>();

    // Pass 1: Match nodes by same ID (existing or modified)
    for (const nodeId of Object.keys(oldNodes)) {
      if (newNodes[nodeId]) {
        matchedOldIds.add(nodeId);
        matchedNewIds.add(nodeId);

        const oldNode = oldNodes[nodeId];
        const newNode = newNodes[nodeId];

        // Detect rename
        if (oldNode.name !== newNode.name) {
          changes.push({
            pageName,
            nodeId,
            nodeName: newNode.name,
            nodeType: newNode.type,
            kind: "renamed",
            property: "name",
            oldValue: oldNode.name,
            newValue: newNode.name,
          });
        }

        const diffs = diff(oldNode, newNode);
        if (!diffs) continue;

        const isInstance = newNode.type === "INSTANCE";

        for (const d of diffs) {
          const property = diffPath(d);
          if (property === "children" || property === "name") continue;

          const isOverride = isInstance && isOverrideProperty(property);

          changes.push({
            pageName,
            nodeId,
            nodeName: newNode.name,
            nodeType: newNode.type,
            kind: "modified",
            property,
            oldValue: "lhs" in d ? d.lhs : undefined,
            newValue: "rhs" in d ? d.rhs : undefined,
            ...(isInstance ? { isOverride } : {}),
          });
        }
      }
    }

    // Pass 2: Detect renames for nodes with changed IDs (same type + same parent structure)
    const unmatchedOld = Object.entries(oldNodes).filter(([id]) => !matchedOldIds.has(id));
    const unmatchedNew = Object.entries(newNodes).filter(([id]) => !matchedNewIds.has(id));

    for (const [oldId, oldNode] of unmatchedOld) {
      const match = unmatchedNew.find(
        ([newId, newNode]) =>
          !matchedNewIds.has(newId) &&
          newNode.type === oldNode.type &&
          newNode.name === oldNode.name,
      );

      if (match) {
        const [newId, newNode] = match;
        matchedOldIds.add(oldId);
        matchedNewIds.add(newId);

        const diffs = diff(oldNode, newNode);
        if (diffs) {
          for (const d of diffs) {
            const property = diffPath(d);
            if (property === "children" || property === "id") continue;

            changes.push({
              pageName,
              nodeId: newId,
              nodeName: newNode.name,
              nodeType: newNode.type,
              kind: "modified",
              property,
              oldValue: "lhs" in d ? d.lhs : undefined,
              newValue: "rhs" in d ? d.rhs : undefined,
            });
          }
        }
      }
    }

    // Pass 3: Remaining unmatched = truly added/deleted
    for (const [id, node] of unmatchedOld) {
      if (!matchedOldIds.has(id)) {
        changes.push({
          pageName,
          nodeId: id,
          nodeName: node.name,
          nodeType: node.type,
          kind: "deleted",
        });
      }
    }

    for (const [id, node] of unmatchedNew) {
      if (!matchedNewIds.has(id)) {
        changes.push({
          pageName,
          nodeId: id,
          nodeName: node.name,
          nodeType: node.type,
          kind: "added",
        });
      }
    }
  }

  return changes;
}

export function buildReport(
  fileKey: string,
  changes: ChangeEntry[],
): ChangeReport {
  return {
    fileKey,
    changes,
    summary: formatConsoleReport(fileKey, changes),
  };
}

export function formatConsoleReport(
  fileKey: string,
  changes: ChangeEntry[],
): string {
  if (changes.length === 0) return `No changes detected in ${fileKey}`;

  const lines: string[] = [
    `=== DesignDigest Report: ${fileKey} ===`,
    `${changes.length} change(s) detected`,
    "",
  ];

  const grouped = groupByPage(changes);

  for (const [pageName, pageChanges] of Object.entries(grouped)) {
    lines.push(`📄 ${pageName}`);
    const nodeGrouped = groupByNode(pageChanges);

    for (const nodeChanges of Object.values(nodeGrouped)) {
      const first = nodeChanges[0];

      if (nodeChanges.length > 5) {
        lines.push(
          `  ${kindIcon(first.kind)} ${first.nodeName} (${first.nodeType}): ${nodeChanges.length} properties changed`,
        );
        continue;
      }

      for (const change of nodeChanges) {
        const propLabel = change.property
          ? propertyLabel(change.property)
          : "";
        const overrideTag = change.isOverride ? " [override]" : "";
        if (change.kind === "added") {
          lines.push(
            `  ➕ ${change.nodeName} (${change.nodeType}) added`,
          );
        } else if (change.kind === "deleted") {
          lines.push(
            `  ➖ ${change.nodeName} (${change.nodeType}) deleted`,
          );
        } else if (change.kind === "renamed") {
          lines.push(
            `  🏷️  ${formatValue(change.oldValue)} → ${formatValue(change.newValue)} (renamed)`,
          );
        } else {
          lines.push(
            `  ✏️  ${change.nodeName}.${propLabel}: ${formatValue(change.oldValue)} → ${formatValue(change.newValue)}${overrideTag}`,
          );
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatSlackReport(
  fileKey: string,
  changes: ChangeEntry[],
): string {
  if (changes.length === 0) return "";

  const lines: string[] = [
    `*DesignDigest Report*`,
    `File: \`${fileKey}\` | ${changes.length} change(s) detected`,
    `<https://www.figma.com/design/${fileKey}|Open in Figma>`,
    "",
  ];

  const grouped = groupByPage(changes);

  for (const [pageName, pageChanges] of Object.entries(grouped)) {
    lines.push(`*${pageName}*`);
    const nodeGrouped = groupByNode(pageChanges);

    for (const nodeChanges of Object.values(nodeGrouped)) {
      const first = nodeChanges[0];

      if (nodeChanges.length > 5) {
        lines.push(
          `  ${kindIcon(first.kind)} \`${first.nodeName}\` (${first.nodeType}): ${nodeChanges.length} properties changed`,
        );
        continue;
      }

      for (const change of nodeChanges) {
        const propLabel = change.property
          ? propertyLabel(change.property)
          : "";
        const overrideTag = change.isOverride ? " _[override]_" : "";
        if (change.kind === "added") {
          lines.push(
            `  ➕ \`${change.nodeName}\` (${change.nodeType}) added`,
          );
        } else if (change.kind === "deleted") {
          lines.push(
            `  ➖ \`${change.nodeName}\` (${change.nodeType}) deleted`,
          );
        } else if (change.kind === "renamed") {
          lines.push(
            `  🏷️ \`${formatValue(change.oldValue)}\` → \`${formatValue(change.newValue)}\` (renamed)`,
          );
        } else {
          lines.push(
            `  ✏️ \`${change.nodeName}\`.${propLabel}: \`${formatValue(change.oldValue)}\` → \`${formatValue(change.newValue)}\`${overrideTag}`,
          );
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: { type: string; text: string }[];
  accessory?: { type: string; text: { type: string; text: string; emoji?: boolean }; url: string; action_id: string };
}

export function formatSlackBlocks(
  fileKey: string,
  changes: ChangeEntry[],
): SlackBlock[] {
  if (changes.length === 0) return [];

  const blocks: SlackBlock[] = [];
  const figmaUrl = `https://www.figma.com/design/${fileKey}`;

  // Header
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: `DesignDigest: ${changes.length} change(s) detected`,
      emoji: true,
    },
  });

  // File info with link button
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `File: \`${fileKey}\``,
    },
    accessory: {
      type: "button",
      text: { type: "plain_text", text: "Open in Figma", emoji: true },
      url: figmaUrl,
      action_id: `open_figma_${fileKey}`,
    },
  });

  blocks.push({ type: "divider" });

  // Changes grouped by page
  const grouped = groupByPage(changes);

  for (const [pageName, pageChanges] of Object.entries(grouped)) {
    // Page header
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${pageName}*`,
      },
    });

    // Build change lines for this page
    const lines: string[] = [];
    const nodeGrouped = groupByNode(pageChanges);

    for (const nodeChanges of Object.values(nodeGrouped)) {
      const first = nodeChanges[0];

      if (nodeChanges.length > 5) {
        lines.push(
          `${kindIcon(first.kind)} \`${first.nodeName}\` (${first.nodeType}): ${nodeChanges.length} properties changed`,
        );
        continue;
      }

      for (const change of nodeChanges) {
        lines.push(formatBlockKitChange(change));
      }
    }

    // Slack blocks have a 3000 char limit per text field — chunk by char length
    for (const chunk of chunkLines(lines, 3000)) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: chunk },
      });
    }

    blocks.push({ type: "divider" });
  }

  // Summary counts
  const added = changes.filter((c) => c.kind === "added").length;
  const deleted = changes.filter((c) => c.kind === "deleted").length;
  const modified = changes.filter((c) => c.kind === "modified").length;
  const renamed = changes.filter((c) => c.kind === "renamed").length;

  const parts: string[] = [];
  if (added > 0) parts.push(`➕ ${added} added`);
  if (deleted > 0) parts.push(`➖ ${deleted} deleted`);
  if (modified > 0) parts.push(`✏️ ${modified} modified`);
  if (renamed > 0) parts.push(`🏷️ ${renamed} renamed`);

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: parts.join("  |  ") }],
  });

  return blocks;
}

function chunkLines(lines: string[], maxChars: number): string[] {
  const truncatedSuffix = " …(truncated)";
  const chunks: string[] = [];
  let current = "";

  for (let line of lines) {
    // Ensure a single line never exceeds the limit
    if (line.length > maxChars) {
      line = line.slice(0, maxChars - truncatedSuffix.length) + truncatedSuffix;
    }

    const separator = current.length === 0 ? "" : "\n";
    const candidate = current + separator + line;

    if (candidate.length > maxChars && current.length > 0) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function formatBlockKitChange(change: ChangeEntry): string {
  const propLabel = change.property ? propertyLabel(change.property) : "";
  const overrideTag = change.isOverride ? " _[override]_" : "";

  switch (change.kind) {
    case "added":
      return `➕ \`${change.nodeName}\` (${change.nodeType}) added`;
    case "deleted":
      return `➖ \`${change.nodeName}\` (${change.nodeType}) deleted`;
    case "renamed":
      return `🏷️ \`${formatValue(change.oldValue)}\` → \`${formatValue(change.newValue)}\` (renamed)`;
    case "modified":
      return `✏️ \`${change.nodeName}\`.${propLabel}: \`${formatValue(change.oldValue)}\` → \`${formatValue(change.newValue)}\`${overrideTag}`;
    default: {
      const _exhaustive: never = change.kind;
      return `Unknown change: ${_exhaustive}`;
    }
  }
}

function flattenNodes(node: FigmaNode): Record<string, FigmaNode> {
  const result: Record<string, FigmaNode> = {};
  const { children, ...rest } = node;
  result[node.id] = rest as FigmaNode;

  if (children) {
    for (const child of children) {
      Object.assign(result, flattenNodes(child));
    }
  }
  return result;
}

function diffPath(d: Diff<unknown, unknown>): string {
  return d.path?.[0]?.toString() ?? "";
}

function groupByPage(changes: ChangeEntry[]): Record<string, ChangeEntry[]> {
  const grouped: Record<string, ChangeEntry[]> = {};
  for (const change of changes) {
    (grouped[change.pageName] ??= []).push(change);
  }
  return grouped;
}

function groupByNode(changes: ChangeEntry[]): Record<string, ChangeEntry[]> {
  const grouped: Record<string, ChangeEntry[]> = {};
  for (const change of changes) {
    const key = `${change.nodeId}:${change.nodeName}`;
    (grouped[key] ??= []).push(change);
  }
  return grouped;
}

function kindIcon(kind: ChangeEntry["kind"]): string {
  switch (kind) {
    case "added":
      return "➕";
    case "deleted":
      return "➖";
    case "modified":
      return "✏️";
    case "renamed":
      return "🏷️";
  }
}

/** Properties that are instance overrides rather than master component changes */
const OVERRIDE_PROPERTIES = new Set([
  "characters",
  "fills",
  "strokes",
  "opacity",
  "visible",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "letterSpacing",
  "lineHeightPx",
  "textAlignHorizontal",
  "textAlignVertical",
  "effects",
]);

function isOverrideProperty(property: string): boolean {
  return OVERRIDE_PROPERTIES.has(property);
}

function propertyLabel(property: string): string {
  return PROPERTY_LABELS[property] ?? property;
}

function formatValue(value: unknown): string {
  if (value === undefined) return "(none)";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);

  // Format Figma color objects as #RRGGBB
  if (isColorObject(value)) return colorToHex(value);

  // Format fills array with readable colors
  if (Array.isArray(value) && value.length > 0 && value[0]?.type === "SOLID" && value[0]?.color) {
    return value
      .map((fill) => {
        const hex = isColorObject(fill.color) ? colorToHex(fill.color) : "";
        const opacity = fill.opacity !== undefined && fill.opacity !== 1
          ? ` ${Math.round(fill.opacity * 100)}%`
          : "";
        return hex ? `${hex}${opacity}` : JSON.stringify(fill);
      })
      .join(", ");
  }

  return JSON.stringify(value);
}

interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

function isColorObject(value: unknown): value is FigmaColor {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.r === "number" && typeof v.g === "number" && typeof v.b === "number";
}

function colorToHex(color: FigmaColor): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  if (color.a !== undefined && color.a !== 1) {
    return `${hex} ${Math.round(color.a * 100)}%`;
  }
  return hex;
}
