import deepDiff from "deep-diff";
const { diff } = deepDiff;
type Diff<L, R> = deepDiff.Diff<L, R>;
import type { FigmaNode } from "./figma-client.js";

export interface ChangeEntry {
  pageName: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  kind: "added" | "deleted" | "modified";
  property?: string;
  oldValue?: unknown;
  newValue?: unknown;
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
    const allNodeIds = new Set([
      ...Object.keys(oldNodes),
      ...Object.keys(newNodes),
    ]);

    for (const nodeId of allNodeIds) {
      const oldNode = oldNodes[nodeId];
      const newNode = newNodes[nodeId];

      if (!oldNode && newNode) {
        changes.push({
          pageName,
          nodeId,
          nodeName: newNode.name,
          nodeType: newNode.type,
          kind: "added",
        });
        continue;
      }

      if (oldNode && !newNode) {
        changes.push({
          pageName,
          nodeId,
          nodeName: oldNode.name,
          nodeType: oldNode.type,
          kind: "deleted",
        });
        continue;
      }

      const diffs = diff(oldNode, newNode);
      if (!diffs) continue;

      for (const d of diffs) {
        const property = diffPath(d);
        if (property === "children") continue;

        changes.push({
          pageName,
          nodeId,
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
        if (change.kind === "added") {
          lines.push(
            `  ➕ ${change.nodeName} (${change.nodeType}) added`,
          );
        } else if (change.kind === "deleted") {
          lines.push(
            `  ➖ ${change.nodeName} (${change.nodeType}) deleted`,
          );
        } else {
          lines.push(
            `  ✏️  ${change.nodeName}.${propLabel}: ${formatValue(change.oldValue)} → ${formatValue(change.newValue)}`,
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
        if (change.kind === "added") {
          lines.push(
            `  ➕ \`${change.nodeName}\` (${change.nodeType}) added`,
          );
        } else if (change.kind === "deleted") {
          lines.push(
            `  ➖ \`${change.nodeName}\` (${change.nodeType}) deleted`,
          );
        } else {
          lines.push(
            `  ✏️ \`${change.nodeName}\`.${propLabel}: \`${formatValue(change.oldValue)}\` → \`${formatValue(change.newValue)}\``,
          );
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
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
  }
}

function propertyLabel(property: string): string {
  return PROPERTY_LABELS[property] ?? property;
}

function formatValue(value: unknown): string {
  if (value === undefined) return "(none)";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
