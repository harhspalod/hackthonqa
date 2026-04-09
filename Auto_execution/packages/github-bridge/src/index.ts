import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import webhookRouter from "./webhook";

const app = express();

app.use((req: Request, res: Response, next: NextFunction) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    (req as any).rawBody = raw;
    try {
      req.body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
    } catch {
      req.body = {};
    }
    console.log(`[debug] ${req.method} ${req.path}`);
    next();
  });
});

app.use("/webhook", webhookRouter);
app.get("/health", (_req: Request, res: Response) => res.json({ ok: true }));

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`GitHub bridge listening on :${PORT}`);
  console.log(`[config] GITHUB_TOKEN set: ${!!process.env.GITHUB_TOKEN}`);
});
