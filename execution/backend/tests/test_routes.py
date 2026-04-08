import asyncio

from app.models.schemas import (
    CodeGenRequest,
    CodeReviewRequest,
    CodeReviewResponse,
    FullPipelineRequest,
    ReviewIssue,
    ReviewVerdict,
    Severity,
    IssueCategory,
)
from app.routes import review as review_route
from app.routes import generate as generate_route
from app.routes import github_route
from app.main import health_check


class FakeReviewEngine:
    def review(self, request):
        return CodeReviewResponse(
            overall_score=9.1,
            verdict=ReviewVerdict.APPROVED_WITH_SUGGESTIONS,
            issues=[
                ReviewIssue(
                    severity=Severity.INFO,
                    category=IssueCategory.BEST_PRACTICE,
                    line=1,
                    message="Looks good overall",
                    suggestion="Optional: add a docstring",
                )
            ],
            improved_code=request.code,
            summary="Solid code with minor improvements possible.",
            stats={"total_issues": 1},
        )


class FakeAIService:
    def generate_code(
        self,
        issue_title,
        issue_description,
        language="python",
        existing_code=None,
        affected_file=None,
    ):
        return {
            "generated_code": "def safe_div(a, b):\n    return a / b if b else 0\n",
            "explanation": "Prevents division-by-zero crashes.",
            "changes_summary": "- Added zero guard for denominator.",
        }


class FakeGitHubService:
    def full_push_flow(
        self,
        issue_id,
        title,
        description,
        file_path,
        code,
        review_summary=None,
        base_branch="main",
    ):
        return {
            "success": True,
            "branch_name": f"fix/{issue_id}-demo",
            "commit_sha": "abc123",
            "pr_number": 1,
            "pr_url": "https://example.com/pr/1",
            "message": "PR created",
        }


def test_health_check():
    result = asyncio.run(health_check())
    assert result["status"] == "healthy"
    assert "config" in result


def test_review_code_endpoint(monkeypatch):
    monkeypatch.setattr(review_route, "get_review_engine", lambda: FakeReviewEngine())
    req = CodeReviewRequest(
        code="def add(a,b):\n    return a+b",
        language="python",
        filename="math.py",
        context="unit test",
        review_level="thorough",
    )

    result = review_route.review_code(req)
    assert result.verdict == ReviewVerdict.APPROVED_WITH_SUGGESTIONS
    assert result.overall_score == 9.1
    assert len(result.issues) == 1


def test_generate_code_endpoint(monkeypatch):
    monkeypatch.setattr(generate_route, "get_gemini_service", lambda: FakeAIService())
    req = CodeGenRequest(
        issue_id="ISS-2",
        title="Fix crash",
        description="Division by zero occurs",
        language="python",
        affected_file="math_utils.py",
        existing_code="def div(a,b): return a/b",
    )

    result = generate_route.generate_code(req)
    assert result.issue_id == "ISS-2"
    assert "safe_div" in result.generated_code


def test_full_pipeline_with_auto_push(monkeypatch):
    monkeypatch.setattr(github_route, "get_gemini_service", lambda: FakeAIService())
    monkeypatch.setattr(github_route, "get_review_engine", lambda: FakeReviewEngine())
    monkeypatch.setattr(github_route, "get_github_service", lambda: FakeGitHubService())

    req = FullPipelineRequest(
        issue_id="ISS-3",
        title="Fix zero divide",
        description="Users hit divide-by-zero in payments",
        language="python",
        affected_file="payments.py",
        existing_code="def pay(a,b): return a/b",
        auto_push=True,
    )

    result = github_route.run_full_pipeline(req)
    assert result.pipeline_status == "fully_deployed"
    assert result.github is not None
    assert result.github.success is True
    assert result.github.pr_number == 1
    assert result.dashboard.review_score == 9.1
    assert result.dashboard.pr_url == "https://example.com/pr/1"
    assert result.dashboard.github_pushed is True


def test_demo_mode_is_deterministic():
    req = FullPipelineRequest(
        issue_id="ISS-DEMO-1",
        title="Export failing",
        description="Export intermittently fails",
        language="python",
        affected_file="app/export.py",
        auto_push=True,
    )

    result = github_route.run_demo_mode(req)
    assert result.pipeline_status == "fully_deployed_demo"
    assert result.review.overall_score == 8.8
    assert result.dashboard.review_score == 8.8
    assert result.dashboard.github_pushed is True
    assert result.github is not None
    assert result.github.pr_url is not None
