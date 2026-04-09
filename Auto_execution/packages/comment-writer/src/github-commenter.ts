import { config } from "dotenv";
config();
import { Octokit } from "@octokit/rest";
import { formatSummary, formatFinding } from "./formatter";
import { generateFix } from "./suggestion";

export async function postPRComment(
  event: any,
  findings: any[]
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !event.repo || !event.pullRequest?.number) {
    console.log("[commenter] No token or PR info — skipping");
    console.log("[commenter] Findings:", JSON.stringify(findings, null, 2));
    return;
  }

  const octokit = new Octokit({ auth: token });
  const { owner, name } = event.repo;
  const prNumber = event.pullRequest.number;
  const headSha = event.pullRequest.headSha;

  const hasCritical = findings.some(f =>
    ["critical", "high"].includes(f.severity?.toLowerCase())
  );

  // Post as official GitHub PR review
  try {
    const reviewEvent = findings.length === 0
      ? "APPROVE"
      : hasCritical
        ? "REQUEST_CHANGES"
        : "COMMENT";

    const body = formatSummary(findings);

    // Build inline review comments for findings with file+line
    const comments = findings
      .filter(f => f.file && f.line && headSha)
      .slice(0, 10)
      .map(f => ({
        path: f.file,
        line: f.line,
        body: [
          `**${f.severity?.toUpperCase()} — ${f.title}**`,
          "",
          f.explanation,
          "",
          `**Fix:** ${f.suggestion}`,
        ].join("\n"),
      }));

    await octokit.pulls.createReview({
      owner,
      repo: name,
      pull_number: prNumber,
      commit_id: headSha,
      body,
      event: reviewEvent,
      comments: comments.length > 0 ? comments : undefined,
    });

    console.log(`[commenter] Posted ${reviewEvent} review on PR #${prNumber} with ${comments.length} inline comments`);

  } catch (err: any) {
    console.warn("[commenter] PR review failed, falling back to comment:", err.message);

    // Fallback to plain comment
    await octokit.issues.createComment({
      owner,
      repo: name,
      issue_number: prNumber,
      body: formatSummary(findings),
    });

    console.log(`[commenter] Posted fallback comment on PR #${prNumber}`);
  }
}

export async function postIssueComment(
  event: any,
  findings: any[]
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !event.repo || !event.meta?.issueNumber) return;

  const octokit = new Octokit({ auth: token });
  const { owner, name } = event.repo;
  const issueNumber = event.meta.issueNumber;

  const body = findings.length === 0
    ? "**Autopm:** Analyzed the codebase — no specific issues found related to this report."
    : formatSummary(findings);

  await octokit.issues.createComment({
    owner,
    repo: name,
    issue_number: issueNumber,
    body,
  });

  console.log(`[commenter] Posted comment on Issue #${issueNumber}`);
}
