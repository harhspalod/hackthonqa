import { Octokit } from "@octokit/rest";
import type { ReviewEvent } from "./normalizer";

export interface ChangedFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
  rawUrl: string;
  contentsUrl: string;
}

export interface EnrichedContext {
  changedFiles: ChangedFile[];
  headSha: string;
  baseSha: string;
  tree: any[];
  blame: any[];
}

function makeOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  console.log(`[github-client] Token available: ${!!token}`);
  return new Octokit({ auth: token });
}

export async function fetchPRDiff(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<ChangedFile[]> {
  console.log(`[github-client] Fetching diff for ${owner}/${repo} PR#${prNumber}`);
  const files = await octokit.paginate(octokit.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  console.log(`[github-client] Got ${files.length} files`);
  return files.map((f) => ({
    path: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: (f as any).patch ?? null,
    rawUrl: f.raw_url,
    contentsUrl: f.contents_url,
  }));
}

export async function enrichEventWithGitHubContext(
  event: ReviewEvent
): Promise<EnrichedContext | null> {
  if (!event.repo || !event.pullRequest?.number) {
    console.log("[github-client] No repo or PR number — skipping enrichment");
    return null;
  }

  const octokit = makeOctokit();
  const { owner, name } = event.repo;
  const prNumber = event.pullRequest.number;

  try {
    const changedFiles = await fetchPRDiff(octokit, owner, name, prNumber);
    return {
      changedFiles,
      headSha: event.pullRequest.headSha,
      baseSha: event.pullRequest.baseSha,
      tree: [],
      blame: [],
    };
  } catch (err: any) {
    console.error(`[github-client] Failed to fetch diff:`, err.message);
    return null;
  }
}
