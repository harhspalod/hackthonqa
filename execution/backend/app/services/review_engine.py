"""
Code Review Engine — Orchestrates AI-powered code review with
structured output, scoring, and statistics.
"""

from typing import Optional
from app.services.ai_service import get_gemini_service
from app.models.schemas import (
    CodeReviewRequest,
    CodeReviewResponse,
    ReviewIssue,
    ReviewVerdict,
    Severity,
    IssueCategory,
)


class ReviewEngine:
    """Orchestrates AI code review and post-processes results."""

    def __init__(self):
        self.ai = get_gemini_service()

    def review(self, request: CodeReviewRequest) -> CodeReviewResponse:
        """
        Run a full code review and return structured results.
        """
        # Call Gemini for the review
        raw = self.ai.review_code(
            code=request.code,
            language=request.language,
            filename=request.filename,
            context=request.context,
            review_level=request.review_level.value,
        )

        # Handle parse failures gracefully
        if "error" in raw:
            return CodeReviewResponse(
                overall_score=5.0,
                verdict=ReviewVerdict.NEEDS_CHANGES,
                issues=[
                    ReviewIssue(
                        severity=Severity.WARNING,
                        category=IssueCategory.BUG,
                        message=f"AI review parse error: {raw.get('error', 'Unknown')}",
                        suggestion="Please retry the review",
                    )
                ],
                summary=raw.get("raw_response", "Review could not be parsed"),
                stats={},
            )

        # Parse issues
        issues = []
        for issue_data in raw.get("issues", []):
            try:
                issues.append(
                    ReviewIssue(
                        severity=issue_data.get("severity", "INFO"),
                        category=issue_data.get("category", "best_practice"),
                        line=issue_data.get("line"),
                        message=issue_data.get("message", ""),
                        suggestion=issue_data.get("suggestion"),
                    )
                )
            except Exception:
                continue  # Skip malformed issues

        # Calculate stats
        stats = self._calculate_stats(issues)

        # Determine verdict
        verdict_str = raw.get("verdict", "NEEDS_CHANGES")
        try:
            verdict = ReviewVerdict(verdict_str)
        except ValueError:
            verdict = ReviewVerdict.NEEDS_CHANGES

        return CodeReviewResponse(
            overall_score=min(10.0, max(0.0, float(raw.get("overall_score", 5.0)))),
            verdict=verdict,
            issues=issues,
            improved_code=raw.get("improved_code"),
            summary=raw.get("summary", "Review complete."),
            stats=stats,
        )

    def _calculate_stats(self, issues: list[ReviewIssue]) -> dict:
        """Calculate review statistics from issues."""
        stats = {
            "total_issues": len(issues),
            "by_severity": {},
            "by_category": {},
        }

        for issue in issues:
            sev = issue.severity.value
            cat = issue.category.value
            stats["by_severity"][sev] = stats["by_severity"].get(sev, 0) + 1
            stats["by_category"][cat] = stats["by_category"].get(cat, 0) + 1

        return stats


# Singleton
_engine: Optional[ReviewEngine] = None


def get_review_engine() -> ReviewEngine:
    global _engine
    if _engine is None:
        _engine = ReviewEngine()
    return _engine
