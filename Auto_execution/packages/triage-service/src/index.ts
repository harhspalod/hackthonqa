import { Worker, Queue } from "bullmq";
import { redis, QUEUE_NAME } from "./queue";
import { isDuplicate } from "./dedup";
import { isRateLimited } from "./rate-limiter";
import { computeSeverity } from "./severity";

const analysisQueue = new Queue("analysis-jobs", { connection: redis });

console.log("[triage] Worker starting...");

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const event = job.data;
    console.log(`[triage] Processing ${job.id} | ${event.source}`);

    if (await isRateLimited(event)) return { skipped: "rate_limited" };
    if (await isDuplicate(event)) return { skipped: "duplicate" };

    const severity = computeSeverity(event);
    const enrichedEvent = { ...event, severity };

    await analysisQueue.add("analyze", enrichedEvent);
    console.log(`[triage] Forwarded ${job.id} to analysis | severity=${severity}`);

    return { processed: true, severity };
  },
  { connection: redis, concurrency: 5 }
);

worker.on("completed", (job, result) => console.log(`[triage] Done ${job.id}:`, result));
worker.on("failed", (job, err) => console.error(`[triage] Failed ${job?.id}:`, err.message));
