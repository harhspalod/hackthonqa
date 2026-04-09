import { config } from "dotenv";
config();
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { postPRComment } from "./github-commenter";
import { autoFixAndPush } from "./auto-fixer";

const redis = new IORedis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null,
});

console.log("[commenter] Starting...");

const worker = new Worker(
  "comment-jobs",
  async (job) => {
    const { event, findings } = job.data;
    console.log(`[commenter] Processing ${findings.length} findings for ${event.id}`);

    // 1. Post review comment on PR
    await postPRComment(event, findings);

    // 2. Auto-fix and push if there are findings and it's a real PR
    if (findings.length > 0 && event.pullRequest?.headBranch) {
      console.log("[commenter] Starting auto-fix...");
      await autoFixAndPush(event, findings);
    }

    return { posted: findings.length };
  },
  { connection: redis, concurrency: 1 }
);

worker.on("completed", (job, result) => console.log(`[commenter] Done ${job.id}:`, result));
worker.on("failed", (job, err) => console.error(`[commenter] Failed ${job?.id}:`, err.message));
