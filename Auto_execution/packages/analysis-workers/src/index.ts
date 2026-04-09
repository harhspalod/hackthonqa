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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getRepoContext(event: any): Promise<string> {
  try {
    const key = `repo-tree:${event.repo?.fullName}`;
    const data = await redis.get(key);
    if (!data) return "";
    const tree = JSON.parse(data);
    const prFiles = (event.changedFiles ?? []).map((f: any) => f.path);
    const relevant = tree.files
      .filter((f: any) => prFiles.some((pf: string) =>
        f.imports?.some((imp: string) => imp.includes(pf.replace(/\.[^.]+$/, "")))
      ))
      .slice(0, 5);
    if (relevant.length === 0) return "";
    return `PROJECT CONTEXT:\n${relevant.map((f: any) =>
      `File: ${f.path}\nFunctions: ${f.functions?.map((fn: any) => fn.name).join(", ")}`
    ).join("\n\n")}`;
  } catch { return ""; }
}

async function runAnalysis(category: string, event: any, repoContext: string) {
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

  const fullPrompt = `${systemPrompt}

${repoContext ? repoContext + "\n\n" : ""}Code to review:
${diff}

Return ONLY a JSON array. Each item: {severity, file, line, title, explanation, suggestion, confidence, relevant}.
Set relevant=false if change is unnecessary for this codebase.
If none found return [].`;

  // Retry with backoff on rate limit
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: fullPrompt }],
        max_tokens: 1024,
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
      if (err.message?.includes("429") && attempt < 2) {
        const wait = (attempt + 1) * 15000;
        console.warn(`[analysis:${category}] Rate limited — waiting ${wait/1000}s...`);
        await sleep(wait);
      } else {
        console.error(`[analysis:${category}] Groq error:`, err.message);
        return [];
      }
    }
  }
  return [];
}

console.log("[analysis] Workers starting with Groq (llama-3.3-70b) + repo context...");

const worker = new Worker(
  "analysis-jobs",
  async (job) => {
    const event = job.data;
    console.log(`[analysis] Processing ${event.id}`);

    const repoContext = await getRepoContext(event);

    // Run sequentially with delay to avoid rate limits
    const allFindings: any[] = [];
    for (const cat of CATEGORIES) {
      const findings = await runAnalysis(cat, event, repoContext);
      allFindings.push(...findings);
      await sleep(2000); // 2s between calls
    }

    const irrelevant = allFindings.filter(f => f.relevant === false);
    if (irrelevant.length > 0) {
      console.log(`[analysis] ${irrelevant.length} findings flagged as irrelevant`);
    }

    console.log(`[analysis] Done ${event.id} — ${allFindings.length} findings`);
    await outputQueue.add("aggregate", { event, findings: allFindings });
    return { findings: allFindings.length, irrelevant: irrelevant.length };
  },
  { connection: redis, concurrency: 1 } // process one at a time
);

worker.on("completed", (job, result) => console.log(`[analysis] Done ${job.id}:`, result));
worker.on("failed", (job, err) => console.error(`[analysis] Failed ${job?.id}:`, err.message));
