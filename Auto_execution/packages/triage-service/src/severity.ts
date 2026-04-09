const CRITICAL_PATTERNS = [
  /sql\s*injection/i, /remote\s*code\s*exec/i, /rce/i,
  /auth\s*bypass/i, /credentials?\s*leak/i, /secret/i,
  /payment/i, /billing/i, /prod(uction)?\s*down/i,
];

const HIGH_PATTERNS = [
  /xss/i, /csrf/i, /overflow/i, /null\s*pointer/i,
  /data\s*loss/i, /corrupt/i, /security/i, /vulnerability/i,
];

const LOW_PATTERNS = [
  /typo/i, /comment/i, /whitespace/i, /lint/i, /formatting/i,
];

const CRITICAL_PATHS = [
  /auth/, /login/, /payment/, /billing/, /admin/, /secret/, /token/, /cred/,
];

type Severity = "critical" | "high" | "medium" | "low";

export function computeSeverity(event: any): Severity {
  const text = [
    event.issueDescription ?? "",
    event.pullRequest?.title ?? "",
  ].join(" ").toLowerCase();

  const changedPaths: string[] = (event.changedFiles ?? []).map((f: any) => f.path ?? "");

  // Critical path touched = minimum high
  const touchesCriticalPath = changedPaths.some(p =>
    CRITICAL_PATHS.some(pattern => pattern.test(p))
  );

  if (CRITICAL_PATTERNS.some(p => p.test(text))) return "critical";
  if (touchesCriticalPath && event.severity !== "low") return "high";
  if (HIGH_PATTERNS.some(p => p.test(text))) return "high";
  if (LOW_PATTERNS.some(p => p.test(text))) return "low";

  // Fall back to what the source provided
  return (event.severity as Severity) ?? "medium";
}
