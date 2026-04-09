import { config } from "dotenv";
config();

import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import OpenAI from "openai";
import { readFileSync } from "fs";
import { join } from "path";
import { v4 as uuid } from "uuid";

const redis = new IORedis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null,
});

const outputQueue = new Queue("aggregator-jobs", { connection: redis });

const groq = new OpenAI({
  apiKey: process.env.GROK_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const PROMPT_DIR = join(__dirname, "../prompts");
const CATEGORIES = ["bug", "security", "smell", "arch"] as const;

async function runAnalysis(category: string, event: any) {
  let systemPrompt = "";
  try {
    systemPrompt = readFileSync(join(PROMPT_DIR, `${category}.md`), "utf8");
  } catch {
    systemPrompt = `You are a code reviewer. Find ${category} issues. Return JSON array only.`;
  }

  const diff = (event.changedFiles ?? [])
    .filter((f: any) => f.patch)
    .map((f: any) => `--- ${f.path} ---\n${f.patch}`)
    .join("\n\n") || event.issueDescription || "No diff available";

  const fullPrompt = `${systemPrompt}\n\nCode to review:\n${diff}\n\nReturn ONLY a JSON array. Each item: {severity, file, line, title, explanation, suggestion, confidence}. If none found return [].`;

  try {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: fullPrompt }],
      max_tokens: 2048,
    });

    const raw = response.choices[0]?.message?.content ?? "[]";
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed)
      ? parsed.map((item: any) => ({ id: uuid(), category, ...item }))
      : [];
  } catch (err: any) {
    console.error(`[analysis:${category}] Groq error:`, err.message);
    return [];
  }
}

console.log("[analysis] Workers starting with Groq (llama-3.3-70b)...");

const worker = new Worker(
  "analysis-jobs",
  async (job) => {
    const event = job.data;
    console.log(`[analysis] Processing ${event.id}`);

    const results = await Promise.allSettled(
      CATEGORIES.map(cat => runAnalysis(cat, event))
    );

    const allFindings = results
      .filter(r => r.status === "fulfilled")
      .flatMap(r => (r as PromiseFulfilledResult<any[]>).value);

    console.log(`[analysis] Done ${event.id} — ${allFindings.length} findings`);

    await outputQueue.add("aggregate", { event, findings: allFindings });
    return { findings: allFindings.length };
  },
  { connection: redis, concurrency: 3 }
);

worker.on("completed", (job, result) => console.log(`[analysis] Done ${job.id}:`, result));
worker.on("failed", (job, err) => console.error(`[analysis] Failed ${job?.id}:`, err.message));
