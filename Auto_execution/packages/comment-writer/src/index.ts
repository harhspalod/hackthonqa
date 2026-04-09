import { config } from "dotenv";
config();
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { postPRComment } from "./github-commenter";

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
    console.log(`[commenter] Posting ${findings.length} findings for ${event.id}`);
    await postPRComment(event, findings);
    return { posted: findings.length };
  },
  { connection: redis, concurrency: 3 }
);

worker.on("completed", (job, result) => console.log(`[commenter] Done ${job.id}:`, result));
worker.on("failed", (job, err) => console.error(`[commenter] Failed ${job?.id}:`, err.message));
