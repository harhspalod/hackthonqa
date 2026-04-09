import type { Finding } from "./types";

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  high: "🟠", 
  medium: "🟡",
  low: "🔵",
};

const CATEGORY_LABEL: Record<string, string> = {
  bug: "Bug",
  security: "Security",
  smell: "Code quality",
  architecture: "Architecture",
};

export function formatFinding(f: Finding): string {
  const sev = SEVERITY_EMOJI[f.severity?.toLowerCase()] ?? "⚪";
  const cat = CATEGORY_LABEL[f.category] ?? f.category;
  return [
    `#### ${sev} ${f.title}`,
    `**Category:** ${cat} · **Severity:** ${f.severity} · **File:** \`${f.file}\`${f.line ? ` line ${f.line}` : ""}`,
    "",
    `**What's wrong:** ${f.explanation}`,
    "",
    `**How to fix:** ${f.suggestion}`,
  ].join("\n");
}

export function formatSummary(findings: Finding[]): string {
  if (findings.length === 0) {
    return [
      "## Autopm Code Review",
      "",
      "No issues found in this pull request.",
      "",
      "> Analyzed by [Autopm](https://github.com/harhspalod/autopm) · powered by Groq llama-3.3-70b",
    ].join("\n");
  }

  const counts: Record<string, number> = {};
  const bySeverity: Record<string, Finding[]> = {
    critical: [], high: [], medium: [], low: []
  };

  for (const f of findings) {
    const sev = f.severity?.toLowerCase() ?? "medium";
    counts[sev] = (counts[sev] ?? 0) + 1;
    if (bySeverity[sev]) bySeverity[sev].push(f);
    else bySeverity.medium.push(f);
  }

  const autoFixed = findings.filter(f =>
    ["critical", "high"].includes(f.severity?.toLowerCase())
  );
  const needsReview = findings.filter(f =>
    ["medium", "low"].includes(f.severity?.toLowerCase())
  );

  const lines: string[] = [];

  // Header
  lines.push("## Autopm Code Review");
  lines.push("");

  // Summary table
  lines.push("### Summary");
  lines.push("");
  lines.push("| Severity | Count | Status |");
  lines.push("|---|---|---|");
  if (counts.critical) lines.push(`| 🔴 Critical | ${counts.critical} | Auto-fixed and pushed |`);
  if (counts.high) lines.push(`| 🟠 High | ${counts.high} | Auto-fixed and pushed |`);
  if (counts.medium) lines.push(`| 🟡 Medium | ${counts.medium} | Needs your review |`);
  if (counts.low) lines.push(`| 🔵 Low | ${counts.low} | Needs your review |`);
  lines.push("");

  // Auto-fixed section
  if (autoFixed.length > 0) {
    lines.push("### Auto-fixed");
    lines.push("");
    lines.push("> The following issues were automatically fixed and committed to this branch.");
    lines.push("");
    for (const f of autoFixed) {
      lines.push(formatFinding(f));
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  // Needs review section
  if (needsReview.length > 0) {
    lines.push("### Needs your review");
    lines.push("");
    lines.push("> These issues require a human decision before fixing.");
    lines.push("");
    for (const f of needsReview) {
      lines.push(formatFinding(f));
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  // Footer
  lines.push("");
  lines.push("> Reviewed by [Autopm](https://github.com/harhspalod/autopm) · Groq llama-3.3-70b · Reply with `autopm fix` to re-run");

  return lines.join("\n");
}
