import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FigmaNode } from "./figma-client.js";

export interface Snapshot {
  timestamp: string;
  fileKey: string;
  pages: Record<string, FigmaNode>;
}

function snapshotPath(dir: string, fileKey: string): string {
  return join(dir, `${fileKey}.json`);
}

export async function loadSnapshot(
  dir: string,
  fileKey: string,
): Promise<Snapshot | null> {
  const path = snapshotPath(dir, fileKey);
  if (!existsSync(path)) return null;

  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as Snapshot;
}

export async function saveSnapshot(
  dir: string,
  fileKey: string,
  pages: Record<string, FigmaNode>,
): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  const snapshot: Snapshot = {
    timestamp: new Date().toISOString(),
    fileKey,
    pages,
  };

  await writeFile(snapshotPath(dir, fileKey), JSON.stringify(snapshot, null, 2));
}
