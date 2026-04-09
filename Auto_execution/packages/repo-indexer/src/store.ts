import IORedis from "ioredis";
import type { RepoTree, FileNode } from "./tree-builder";

export function makeRedis() {
  return new IORedis({
    host: process.env.REDIS_HOST ?? "localhost",
    port: Number(process.env.REDIS_PORT ?? 6379),
    maxRetriesPerRequest: null,
  });
}

export async function storeTree(redis: IORedis, tree: RepoTree): Promise<void> {
  const key = `repo-tree:${tree.owner}/${tree.repo}`;
  await redis.set(key, JSON.stringify(tree), "EX", 60 * 60 * 24); // 24h TTL
  console.log(`[store] Saved tree for ${tree.owner}/${tree.repo} — ${tree.totalFiles} files`);
}

export async function getTree(redis: IORedis, owner: string, repo: string): Promise<RepoTree | null> {
  const key = `repo-tree:${owner}/${repo}`;
  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
}

export function findRelevantFiles(tree: RepoTree, context: string, maxFiles = 8): FileNode[] {
  const keywords = context
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3)
    .filter(w => !["this", "that", "with", "from", "have", "when", "will", "been"].includes(w));

  const scored = tree.files.map(file => {
    let score = 0;
    const searchable = (file.path + " " + file.summary + " " +
      file.functions.map(f => f.name).join(" ")).toLowerCase();

    for (const keyword of keywords) {
      if (searchable.includes(keyword)) score += 2;
      if (file.path.toLowerCase().includes(keyword)) score += 3;
      if (file.functions.some(f => f.name.toLowerCase().includes(keyword))) score += 4;
    }

    return { file, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFiles)
    .map(s => s.file);
}
