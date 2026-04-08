"""
PR Analysis Service
Asynchronously analyzes pull requests for bugs, security risks,
code smells, and architecture violations, then posts GitHub comments.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
import re
import threading
import time
import uuid
from typing import Optional

from app.services.github_service import GitHubService, get_github_service


SUPPORTED_EXTENSIONS = (
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".java",
    ".go",
    ".rs",
    ".cpp",
    ".c",
)


@dataclass
class PRFinding:
    category: str
    severity: str
    rule_id: str
    title: str
    message: str
    suggestion: str
    file_path: str
    line: Optional[int]
    confidence: float
    explanation: str


class PRAnalysisService:
    """In-memory async PR analysis engine for hackathon MVP."""

    def __init__(self):
        self._jobs: dict[str, dict] = {}
        self._lock = threading.Lock()

    def start_job(
        self,
        pr_number: int,
        repo_owner: Optional[str] = None,
        repo_name: Optional[str] = None,
        min_confidence: float = 0.72,
        post_inline_comments: bool = True,
        max_inline_comments: int = 20,
    ) -> str:
        job_id = str(uuid.uuid4())
        with self._lock:
            self._jobs[job_id] = {
                "job_id": job_id,
                "status": "queued",
                "created_at": time.time(),
                "updated_at": time.time(),
                "pr_number": pr_number,
                "repo_owner": repo_owner,
                "repo_name": repo_name,
                "min_confidence": min_confidence,
                "post_inline_comments": post_inline_comments,
                "max_inline_comments": max_inline_comments,
                "result": None,
                "error": None,
            }

        worker = threading.Thread(
            target=self._run_job,
            args=(
                job_id,
                pr_number,
                repo_owner,
                repo_name,
                min_confidence,
                post_inline_comments,
                max_inline_comments,
            ),
            daemon=True,
        )
        worker.start()
        return job_id

    def get_job(self, job_id: str) -> Optional[dict]:
        with self._lock:
            job = self._jobs.get(job_id)
            return None if job is None else dict(job)

    def _run_job(
        self,
        job_id: str,
        pr_number: int,
        repo_owner: Optional[str],
        repo_name: Optional[str],
        min_confidence: float,
        post_inline_comments: bool,
        max_inline_comments: int,
    ) -> None:
        self._set_status(job_id, "running")
        try:
            gh = self._build_github_service(repo_owner, repo_name)
            pr = gh.get_pull_request(pr_number)
            files = gh.list_pull_request_files(pr_number)

            findings = self._analyze_files(files, pr.head.sha, gh, min_confidence)
            summary = self._build_summary(findings)

            posted_comments = 0
            if post_inline_comments and findings:
                posted_comments = self._post_inline_comments(
                    gh=gh,
                    pr_number=pr_number,
                    commit_sha=pr.head.sha,
                    findings=findings,
                    max_comments=max_inline_comments,
                )

            gh.add_issue_comment(pr_number, self._build_pr_summary_comment(summary))

            result = {
                "repository": f"{gh.owner}/{gh.repo_name}",
                "pr_number": pr_number,
                "findings": [asdict(f) for f in findings],
                "summary": summary,
                "posted_inline_comments": posted_comments,
            }
            self._set_result(job_id, result)
            self._set_status(job_id, "completed")
        except Exception as exc:  # pylint: disable=broad-except
            self._set_error(job_id, str(exc))
            self._set_status(job_id, "failed")

    def _build_github_service(
        self, repo_owner: Optional[str], repo_name: Optional[str]
    ) -> GitHubService:
        if repo_owner or repo_name:
            return GitHubService(owner=repo_owner, repo_name=repo_name)
        return get_github_service()

    def _set_status(self, job_id: str, status: str) -> None:
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id]["status"] = status
                self._jobs[job_id]["updated_at"] = time.time()

    def _set_result(self, job_id: str, result: dict) -> None:
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id]["result"] = result
                self._jobs[job_id]["updated_at"] = time.time()

    def _set_error(self, job_id: str, error: str) -> None:
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id]["error"] = error
                self._jobs[job_id]["updated_at"] = time.time()

    def _analyze_files(
        self,
        files: list[dict],
        head_sha: str,
        gh: GitHubService,
        min_confidence: float,
    ) -> list[PRFinding]:
        findings: list[PRFinding] = []

        for file in files:
            filename = file["filename"]
            if not filename.endswith(SUPPORTED_EXTENSIONS):
                continue

            patch = file.get("patch", "")
            added_lines = self._extract_added_line_numbers(patch)

            try:
                content = gh.get_file_content_at_ref(filename, head_sha)
            except Exception:
                continue

            file_findings = self._analyze_file_content(filename, content, added_lines)
            findings.extend(file_findings)

        deduped = self._dedupe_findings(findings)
        return [f for f in deduped if f.confidence >= min_confidence]

    def _analyze_file_content(
        self, file_path: str, content: str, added_lines: set[int]
    ) -> list[PRFinding]:
        findings: list[PRFinding] = []
        lines = content.splitlines()
        for idx, line in enumerate(lines, start=1):
            if added_lines and idx not in added_lines:
                continue
            lower = line.lower()

            # Security
            if "eval(" in line:
                findings.append(
                    self._finding(
                        "security",
                        "CRITICAL",
                        "SEC_EVAL_USAGE",
                        "Unsafe eval usage detected",
                        "Using eval on dynamic input can lead to code execution vulnerabilities.",
                        "Replace eval with a strict parser or literal_eval equivalent.",
                        file_path,
                        idx,
                        0.95,
                    )
                )
            if "subprocess" in line and "shell=True" in line:
                findings.append(
                    self._finding(
                        "security",
                        "CRITICAL",
                        "SEC_SHELL_TRUE",
                        "subprocess shell=True risk",
                        "shell=True may permit shell injection with unsafe input.",
                        "Use argument arrays and shell=False.",
                        file_path,
                        idx,
                        0.9,
                    )
                )
            if re.search(r"(api[_-]?key|secret|token)\s*=\s*['\"][^'\"]+['\"]", lower):
                findings.append(
                    self._finding(
                        "security",
                        "WARNING",
                        "SEC_HARDCODED_SECRET",
                        "Possible hardcoded secret",
                        "Credential-like value appears hardcoded in source code.",
                        "Move secrets to environment variables or secret manager.",
                        file_path,
                        idx,
                        0.86,
                    )
                )

            # Bugs
            if "except Exception" in line and "pass" in line:
                findings.append(
                    self._finding(
                        "bug",
                        "WARNING",
                        "BUG_SWALLOWED_EXCEPTION",
                        "Exception swallowed silently",
                        "Swallowing exceptions hides failures and makes debugging difficult.",
                        "Log and re-raise or return a controlled error path.",
                        file_path,
                        idx,
                        0.82,
                    )
                )
            if "== None" in line or "!= None" in line:
                findings.append(
                    self._finding(
                        "bug",
                        "INFO",
                        "BUG_NONE_COMPARISON",
                        "Non-idiomatic None comparison",
                        "Direct None comparisons can be error-prone in Python.",
                        "Use 'is None' or 'is not None'.",
                        file_path,
                        idx,
                        0.75,
                    )
                )

            # Code smells
            if len(line) > 140:
                findings.append(
                    self._finding(
                        "code_smell",
                        "INFO",
                        "SMELL_LONG_LINE",
                        "Very long line detected",
                        "Long lines reduce readability and reviewability.",
                        "Split line into smaller logical statements.",
                        file_path,
                        idx,
                        0.74,
                    )
                )
            if "todo" in lower or "fixme" in lower:
                findings.append(
                    self._finding(
                        "code_smell",
                        "INFO",
                        "SMELL_TODO_LEFT",
                        "TODO/FIXME left in changed code",
                        "Temporary TODOs in production paths often become long-term debt.",
                        "Convert TODO to tracked issue reference or complete before merge.",
                        file_path,
                        idx,
                        0.73,
                    )
                )

            # Architecture
            if "/routes/" in file_path and "from app.main import" in line:
                findings.append(
                    self._finding(
                        "architecture",
                        "WARNING",
                        "ARCH_ROUTE_MAIN_COUPLING",
                        "Route imports app.main directly",
                        "Route layer should not depend on app bootstrap to avoid tight coupling.",
                        "Move shared logic to a service/util module and import from there.",
                        file_path,
                        idx,
                        0.84,
                    )
                )
            if "/models/" in file_path and "from app.routes" in line:
                findings.append(
                    self._finding(
                        "architecture",
                        "WARNING",
                        "ARCH_MODEL_ROUTE_DEP",
                        "Model layer depends on route layer",
                        "Layer inversion increases coupling and harms maintainability.",
                        "Keep models independent; move cross-layer logic to services.",
                        file_path,
                        idx,
                        0.88,
                    )
                )

        return findings

    def _finding(
        self,
        category: str,
        severity: str,
        rule_id: str,
        title: str,
        message: str,
        suggestion: str,
        file_path: str,
        line: Optional[int],
        confidence: float,
    ) -> PRFinding:
        return PRFinding(
            category=category,
            severity=severity,
            rule_id=rule_id,
            title=title,
            message=message,
            suggestion=suggestion,
            file_path=file_path,
            line=line,
            confidence=confidence,
            explanation=(
                f"{title}: {message} Suggested action: {suggestion} "
                f"Confidence={confidence:.2f}"
            ),
        )

    def _extract_added_line_numbers(self, patch: str) -> set[int]:
        line_numbers: set[int] = set()
        if not patch:
            return line_numbers

        current_new_line = None
        for raw in patch.splitlines():
            if raw.startswith("@@"):
                match = re.search(r"\+(\d+)", raw)
                if match:
                    current_new_line = int(match.group(1))
                continue
            if current_new_line is None:
                continue
            if raw.startswith("+") and not raw.startswith("+++"):
                line_numbers.add(current_new_line)
                current_new_line += 1
                continue
            if raw.startswith("-") and not raw.startswith("---"):
                continue
            current_new_line += 1

        return line_numbers

    def _dedupe_findings(self, findings: list[PRFinding]) -> list[PRFinding]:
        by_key: dict[tuple, PRFinding] = {}
        for finding in findings:
            key = (finding.file_path, finding.line, finding.rule_id)
            existing = by_key.get(key)
            if existing is None or finding.confidence > existing.confidence:
                by_key[key] = finding
        return sorted(
            by_key.values(),
            key=lambda f: (f.file_path, f.line or 0, -f.confidence),
        )

    def _post_inline_comments(
        self,
        gh: GitHubService,
        pr_number: int,
        commit_sha: str,
        findings: list[PRFinding],
        max_comments: int,
    ) -> int:
        posted = 0
        for finding in findings:
            if posted >= max_comments:
                break
            if finding.line is None:
                continue
            body = (
                f"[{finding.severity}] {finding.title}\n\n"
                f"{finding.message}\n\n"
                f"Suggestion: {finding.suggestion}\n"
                f"Category: {finding.category} | Confidence: {finding.confidence:.2f}"
            )
            gh.add_review_comment(
                pr_number=pr_number,
                body=body,
                commit_sha=commit_sha,
                path=finding.file_path,
                line=finding.line,
            )
            posted += 1
        return posted

    def _build_summary(self, findings: list[PRFinding]) -> dict:
        by_category: dict[str, int] = {}
        by_severity: dict[str, int] = {}
        for finding in findings:
            by_category[finding.category] = by_category.get(finding.category, 0) + 1
            by_severity[finding.severity] = by_severity.get(finding.severity, 0) + 1

        return {
            "total_findings": len(findings),
            "by_category": by_category,
            "by_severity": by_severity,
            "false_positive_controls": {
                "confidence_threshold_applied": True,
                "deduplication_applied": True,
                "diff_only_scope": True,
            },
        }

    def _build_pr_summary_comment(self, summary: dict) -> str:
        return (
            "## AutoPM Async PR Analysis\n\n"
            f"Total Findings: {summary['total_findings']}\n\n"
            f"By Category: {summary['by_category']}\n\n"
            f"By Severity: {summary['by_severity']}\n\n"
            "Low false-positive controls: confidence threshold, dedupe, changed-lines scope."
        )


_pr_analysis_service: Optional[PRAnalysisService] = None


def get_pr_analysis_service() -> PRAnalysisService:
    global _pr_analysis_service
    if _pr_analysis_service is None:
        _pr_analysis_service = PRAnalysisService()
    return _pr_analysis_service
