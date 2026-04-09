import type { Finding } from "./types";
const SEVERITY_RANK: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1
};
export function mergeAndRank(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.file}:${f.line}:${f.title?.slice(0, 30)}`;
    const existing = seen.get(key);
    if (!existing || SEVERITY_RANK[f.severity] > SEVERITY_RANK[existing.severity]) {
      seen.set(key, f);
    }
  }
  return [...seen.values()].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
  );
}
