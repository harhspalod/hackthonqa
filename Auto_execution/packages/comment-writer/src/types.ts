export type Severity = "critical" | "high" | "medium" | "low";
export interface Finding {
  id: string;
  category: string;
  severity: Severity;
  file: string;
  line: number | null;
  title: string;
  explanation: string;
  suggestion: string;
  confidence: number;
}
