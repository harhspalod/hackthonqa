import { config } from "dotenv";
config();
import { buildRepoTree } from "./tree-builder";
import { storeTree, makeRedis } from "./store";

const redis = makeRedis();

async function indexRepo(owner: string, repo: string, branch = "main") {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set");

  console.log(`[indexer] Starting index of ${owner}/${repo}@${branch}`);
  const tree = await buildRepoTree(owner, repo, branch, token);
  await storeTree(redis, tree);

  console.log(`[indexer] Done — ${tree.totalFiles} files indexed`);
  console.log(`[indexer] Sample files:`);
  tree.files.slice(0, 5).forEach(f => {
    console.log(`  ${f.path} — ${f.functions.length} functions`);
  });

  await redis.quit();
}

const [,, owner, repo, branch] = process.argv;
if (!owner || !repo) {
  console.error("Usage: ts-node src/index.ts <owner> <repo> [branch]");
  process.exit(1);
}

indexRepo(owner, repo, branch ?? "main").catch(console.error);
