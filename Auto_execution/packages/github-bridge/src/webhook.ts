import { Router, Request, Response } from "express";
import { normalizeGitHubPR, normalizeQAPayload } from "./normalizer";
import { enqueueReviewJob } from "./queue";

const router = Router();

router.post("/github", async (req: Request, res: Response) => {
  const event = req.headers["x-github-event"] as string;
  const payload = req.body;

  console.log(`[webhook] GitHub event: ${event} action: ${payload?.action}`);

  const supportedPRActions = ["opened", "synchronize", "reopened"];

  if (event === "pull_request" && supportedPRActions.includes(payload.action)) {
    const reviewEvent = await normalizeGitHubPR(payload);
    console.log(`[webhook] Changed files fetched: ${reviewEvent.changedFiles?.length ?? 0}`);
    console.log(`[webhook] Files:`, reviewEvent.changedFiles?.map((f: any) => f.path));
    await enqueueReviewJob(reviewEvent);
    return res.status(202).json({ queued: reviewEvent.id });
  }

  if (event === "ping") {
    return res.status(200).json({ ok: true, message: "pong" });
  }

  return res.status(200).json({ ignored: event });
});

router.post("/qa", async (req: Request, res: Response) => {
  const apiKey = process.env.QA_WEBHOOK_API_KEY;
  if (apiKey) {
    const provided = (req.headers["authorization"] ?? "").replace(/^Bearer\s+/i, "");
    if (provided !== apiKey) {
      return res.status(401).json({ error: "Invalid API key" });
    }
  }

  const body = req.body;
  const required = ["issue", "severity", "source", "timestamp"];
  const missing = required.filter((k) => !body[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
  }

  const reviewEvent = await normalizeQAPayload(body);
  await enqueueReviewJob(reviewEvent);
  return res.status(202).json({ queued: reviewEvent.id });
});

export default router;
