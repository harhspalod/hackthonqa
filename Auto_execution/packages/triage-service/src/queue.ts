import { Queue, Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";

export const QUEUE_NAME = "review-jobs";

export const redis = new IORedis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null,
});

export const reviewQueue = new Queue(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export async function enqueueReviewJob(event: any): Promise<void> {
  await reviewQueue.add("review", event, {
    jobId: event.id, // dedup by event id
  });
  console.log(`[queue] Enqueued ${event.id} | source=${event.source} severity=${event.severity}`);
}
