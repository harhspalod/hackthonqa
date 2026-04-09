import "dotenv/config";
import { v4 as uuid } from "uuid";
import { enrichEventWithGitHubContext } from "./github-client";

export type Severity = "critical" | "high" | "medium" | "low";
export type EventSource = "github_pr" | "github_issue" | "qa_json" | "reddit" | "slack" | "monitoring";

export interface ReviewEvent {
  id: string;
  createdAt: string;
  source: EventSource;
  severity: Severity;
  repo: {
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
    cloneUrl: string;
  } | null;
  pullRequest: {
    number: number;
    headSha: string;
    headBranch: string;
    baseSha: string;
    baseBranch: string;
    title: string;
    author: string;
    url: string;
  } | null;
  issueDescription: string;
  issueUrl: string | null;
  changedFiles: any[];
  meta: Record<string, unknown>;
}

function coerceSeverity(raw: string | undefined): Severity {
  const s = (raw ?? "medium").toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high") return "high";
  if (s === "low") return "low";
  return "medium";
}

function coerceSource(raw: string | undefined): EventSource {
  const s = (raw ?? "").toLowerCase();
  if (s === "reddit") return "reddit";
  if (s === "slack") return "slack";
  if (s === "github_issue") return "github_issue";
  if (s === "monitoring") return "monitoring";
  return "qa_json";
}

export async function normalizeGitHubPR(payload: any): Promise<ReviewEvent> {
  const pr = payload.pull_request;
  const repo = payload.repository;

  console.log(`[normalizer] PR #${pr.number} ${repo.full_name} headSha=${pr.head.sha}`);

  const event: ReviewEvent = {
    id: uuid(),
    createdAt: new Date().toISOString(),
    source: "github_pr",
    severity: "medium",
    repo: {
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      cloneUrl: repo.clone_url,
    },
    pullRequest: {
      number: pr.number,
      headSha: pr.head.sha,
      headBranch: pr.head.ref,
      baseSha: pr.base.sha,
      baseBranch: pr.base.ref,
      title: pr.title,
      author: pr.user.login,
      url: pr.html_url,
    },
    issueDescription: pr.body ?? pr.title,
    issueUrl: pr.html_url,
    changedFiles: [],
    meta: { action: payload.action },
  };

  console.log(`[normalizer] Fetching diff for PR #${pr.number}...`);
  try {
    const context = await enrichEventWithGitHubContext(event);
    if (context) {
      event.changedFiles = context.changedFiles;
      console.log(`[normalizer] Got ${event.changedFiles.length} changed files`);
    } else {
      console.warn(`[normalizer] enrichEventWithGitHubContext returned null`);
    }
  } catch (err: any) {
    console.error(`[normalizer] Failed to fetch diff:`, err.message);
  }

  return event;
}

export async function normalizeQAPayload(body: any): Promise<ReviewEvent> {
  let repo: ReviewEvent["repo"] = null;
  let pullRequest: ReviewEvent["pullRequest"] | null = null;

  const ghPrMatch = (body.target_url ?? "").match(
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
  );
  if (ghPrMatch) {
    repo = {
      owner: ghPrMatch[1],
      name: ghPrMatch[2],
      fullName: `${ghPrMatch[1]}/${ghPrMatch[2]}`,
      defaultBranch: "main",
      cloneUrl: `https://github.com/${ghPrMatch[1]}/${ghPrMatch[2]}.git`,
    };
    pullRequest = {
      number: parseInt(ghPrMatch[3], 10),
      headSha: "",
      headBranch: "",
      baseSha: "",
      baseBranch: "",
      title: body.issue,
      author: "",
      url: body.target_url,
    };
  }

  return {
    id: uuid(),
    createdAt: body.timestamp ?? new Date().toISOString(),
    source: coerceSource(body.source),
    severity: coerceSeverity(body.severity),
    repo,
    pullRequest,
    issueDescription: [body.issue, body.reason].filter(Boolean).join("\n\n"),
    issueUrl: body.target_url ?? body.site_url ?? null,
    changedFiles: body.changedFiles ?? [],
    meta: {
      siteUrl: body.site_url,
      kbPage: body.kb_page,
      status: body.status,
    },
  };
}
