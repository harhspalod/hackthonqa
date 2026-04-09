import { redis } from "./queue";

const TTL_SECONDS = 60 * 60 * 6; // 6 hours

// Returns true if this event is a duplicate and should be skipped
export async function isDuplicate(event: any): Promise<boolean> {
  const key = fingerprintKey(event);
  const result = await redis.set(key, "1", "EX", TTL_SECONDS, "NX");
  // NX = only set if not exists. null = already existed = duplicate
  return result === null;
}

function fingerprintKey(event: any): string {
  // For PR events: same repo + same PR + same commit = duplicate
  if (event.pullRequest?.headSha) {
    return `dedup:${event.repo?.fullName}:pr${event.pullRequest.number}:${event.pullRequest.headSha}`;
  }
  // For QA/issue events: same issue text + same source within 6h = duplicate
  const slug = event.issueDescription?.slice(0, 80).replace(/\s+/g, "-") ?? event.id;
  return `dedup:${event.source}:${slug}`;
}
