import { config } from "dotenv";
config();
import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import { mergeAndRank } from "./merge";
import { filterLowConfidence } from "./confidence";

const redis = new IORedis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null,
});

const commentQueue = new Queue("comment-jobs", { connection: redis });

console.log("[aggregator] Starting...");

const worker = new Worker(
  "aggregator-jobs",
  async (job) => {
    const { event, findings } = job.data;
    console.log(`[aggregator] Processing ${event.id} — ${findings.length} raw findings`);

    const filtered = filterLowConfidence(findings);
    const merged = mergeAndRank(filtered);

    console.log(`[aggregator] After filter+rank: ${merged.length} findings`);
    merged.forEach(f => console.log(`  [${f.severity}] ${f.file}:${f.line} — ${f.title}`));

    await commentQueue.add("comment", { event, findings: merged });
    return { findings: merged.length };
  },
  { connection: redis, concurrency: 5 }
);

worker.on("completed", (job, result) => console.log(`[aggregator] Done ${job.id}:`, result));
worker.on("failed", (job, err) => console.error(`[aggregator] Failed ${job?.id}:`, err.message));
