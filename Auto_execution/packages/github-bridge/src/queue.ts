import { Queue } from "bullmq";
import IORedis from "ioredis";

const QUEUE_NAME = "review-jobs";

const redis = new IORedis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null,
});

const reviewQueue = new Queue(QUEUE_NAME, { connection: redis });

export async function enqueueReviewJob(event: any): Promise<void> {
  await reviewQueue.add("review", event, { jobId: event.id });
  console.log(`[queue] Enqueued ${event.id} | source=${event.source} severity=${event.severity}`);
}
