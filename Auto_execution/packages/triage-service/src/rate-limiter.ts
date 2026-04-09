import { redis } from "./queue";

const MAX_PER_HOUR = 20;

// Returns true if this repo has hit the rate limit
export async function isRateLimited(event: any): Promise<boolean> {
  const repoKey = event.repo?.fullName ?? event.source ?? "unknown";
  const windowKey = `ratelimit:${repoKey}:${currentHourSlot()}`;

  const count = await redis.incr(windowKey);
  if (count === 1) {
    await redis.expire(windowKey, 3600);
  }

  if (count > MAX_PER_HOUR) {
    console.warn(`[rate-limit] ${repoKey} hit limit (${count}/${MAX_PER_HOUR} this hour)`);
    return true;
  }
  return false;
}

function currentHourSlot(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
}
