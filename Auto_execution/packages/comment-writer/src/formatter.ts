import type { Finding } from "./types";
export function formatFinding(f: Finding): string {
  const sev = f.severity.toUpperCase();
  return [
    `### [${sev}] ${f.title}`,
    `**File:** \`${f.file}\`${f.line ? ` line ${f.line}` : ""}`,
    `**Issue:** ${f.explanation}`,
    `**Fix:** ${f.suggestion}`,
  ].join("\n\n");
}
export function formatSummary(findings: Finding[]): string {
  if (findings.length === 0) return "**Autopm:** No issues found.";
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const summary = Object.entries(counts)
    .map(([s, n]) => `${n} ${s}`)
    .join(", ");
  return [
    `## Autopm Code Review`,
    `Found **${findings.length} issues** (${summary})`,
    "",
    findings.map(formatFinding).join("\n\n---\n\n"),
  ].join("\n");
}
