import type { Finding } from "./types";
const MIN_CONFIDENCE = 0.4;
export function filterLowConfidence(findings: Finding[]): Finding[] {
  return findings.filter(f => f.confidence >= MIN_CONFIDENCE);
}
