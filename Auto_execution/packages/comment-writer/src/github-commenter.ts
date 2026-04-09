import { Octokit } from "@octokit/rest";
import type { Finding } from "./types";
import { formatSummary } from "./formatter";

export async function postPRComment(
  event: any,
  findings: Finding[]
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !event.repo || !event.pullRequest?.number) {
    console.log("[commenter] No GitHub token or PR info — skipping comment");
    console.log("[commenter] Would post findings:", JSON.stringify(findings, null, 2));
    return;
  }

  const octokit = new Octokit({ auth: token });
  const body = formatSummary(findings);

  await octokit.issues.createComment({
    owner: event.repo.owner,
    repo: event.repo.name,
    issue_number: event.pullRequest.number,
    body,
  });

  console.log(`[commenter] Posted comment on PR #${event.pullRequest.number}`);
}
