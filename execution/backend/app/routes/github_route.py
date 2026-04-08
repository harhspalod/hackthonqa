"""
GitHub Integration Route — /api/push-to-github
Automates branch creation, commits, and PR creation on GitHub.
"""

from fastapi import APIRouter, HTTPException
from app.models.schemas import (
    GitHubPushRequest,
    GitHubPushResponse,
    FullPipelineRequest,
    FullPipelineResponse,
    PipelineDashboardSummary,
    CodeGenRequest,
    CodeGenResponse,
    CodeReviewRequest,
    CodeReviewResponse,
    ReviewVerdict,
    ReviewIssue,
    Severity,
    IssueCategory,
)
from app.services.github_service import get_github_service
from app.services.ai_service import get_gemini_service
from app.services.review_engine import get_review_engine

router = APIRouter()


def _coerce_text(value: object) -> str:
    """Normalize AI outputs into strings for schema compatibility."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(str(item) for item in value)
    if isinstance(value, dict):
        return "\n".join(f"{k}: {v}" for k, v in value.items())
    return str(value)


@router.post("/push-to-github", response_model=GitHubPushResponse)
async def push_to_github(request: GitHubPushRequest):
    """
    Push code to GitHub: create branch → commit file → open PR.

    Automatically generates:
    - Branch name from issue ID
    - Commit message
    - PR with description and review summary
    """
    try:
        gh = get_github_service()
        result = gh.full_push_flow(
            issue_id=request.issue_id,
            title=request.title,
            description=request.description,
            file_path=request.file_path,
            code=request.code,
            review_summary=request.review_summary,
            base_branch=request.base_branch,
        )

        return GitHubPushResponse(**result)

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"GitHub push failed: {str(e)}"
        )


@router.post("/pipeline", response_model=FullPipelineResponse)
def run_full_pipeline(request: FullPipelineRequest):
    """
    🚀 Full AutoPM Pipeline: Generate → Review → (optionally) Push to GitHub.

    This is the end-to-end automation:
    1. Takes an issue description
    2. Generates code fix with AI
    3. Reviews the generated code with AI
    4. If auto_push=True and review passes, pushes to GitHub

    This is the STAR endpoint for the hackathon demo.
    """
    try:
        ai = get_gemini_service()
        review_engine = get_review_engine()

        # ── Step 1: Generate Code ──────────────────────────
        gen_result = ai.generate_code(
            issue_title=request.title,
            issue_description=request.description,
            language=request.language,
            existing_code=request.existing_code,
            affected_file=request.affected_file,
        )

        if "error" in gen_result:
            raise HTTPException(
                status_code=500,
                detail=f"Code generation failed: {gen_result.get('error')}",
            )

        generation = CodeGenResponse(
            issue_id=request.issue_id,
            generated_code=_coerce_text(gen_result.get("generated_code")),
            explanation=_coerce_text(gen_result.get("explanation")),
            changes_summary=_coerce_text(gen_result.get("changes_summary")),
            language=request.language,
        )

        # ── Step 2: Review Generated Code ──────────────────
        review_request = CodeReviewRequest(
            code=generation.generated_code,
            language=request.language,
            filename=request.affected_file,
            context=f"Auto-generated fix for: {request.title}",
            review_level="thorough",
        )
        review = review_engine.review(review_request)

        # ── Step 3: Push to GitHub (if enabled and review passes) ──
        github_result = None
        pipeline_status = "generated_and_reviewed"

        if request.auto_push and review.verdict in [
            ReviewVerdict.APPROVED,
            ReviewVerdict.APPROVED_WITH_SUGGESTIONS,
        ]:
            try:
                gh = get_github_service()
                file_path = request.affected_file or f"src/fixes/{request.issue_id}.{_get_extension(request.language)}"

                push_result = gh.full_push_flow(
                    issue_id=request.issue_id,
                    title=request.title,
                    description=request.description,
                    file_path=file_path,
                    code=generation.generated_code,
                    review_summary=review.summary,
                )

                github_result = GitHubPushResponse(**push_result)
                pipeline_status = "fully_deployed"
            except Exception as e:
                pipeline_status = f"reviewed_but_push_failed: {str(e)}"

        elif request.auto_push:
            pipeline_status = f"reviewed_but_blocked (verdict: {review.verdict.value})"

        return FullPipelineResponse(
            issue_id=request.issue_id,
            generation=generation,
            review=review,
            github=github_result,
            pipeline_status=pipeline_status,
            dashboard=_build_dashboard(review, github_result, pipeline_status),
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Pipeline failed: {str(e)}"
        )


def _get_extension(language: str) -> str:
    """Get file extension for a programming language."""
    extensions = {
        "python": "py",
        "javascript": "js",
        "typescript": "ts",
        "java": "java",
        "go": "go",
        "rust": "rs",
        "cpp": "cpp",
        "c": "c",
    }
    return extensions.get(language.lower(), "txt")


def _build_dashboard(
    review: CodeReviewResponse,
    github: GitHubPushResponse | None,
    pipeline_status: str,
) -> PipelineDashboardSummary:
    """Build compact dashboard payload for clients."""
    return PipelineDashboardSummary(
        review_score=review.overall_score,
        review_verdict=review.verdict,
        issues_found=len(review.issues),
        github_pushed=bool(github and github.success),
        pr_number=github.pr_number if github else None,
        pr_url=github.pr_url if github else None,
        pipeline_status=pipeline_status,
    )


@router.post("/demo-mode", response_model=FullPipelineResponse)
def run_demo_mode(request: FullPipelineRequest):
    """
    Deterministic hackathon endpoint that returns stable output
    without external AI/GitHub dependencies.
    """
    issue_id = request.issue_id or "ISS-DEMO-001"
    language = request.language or "python"
    extension = _get_extension(language)
    target_file = request.affected_file or f"src/fixes/{issue_id}.{extension}"

    generated_code = (
        "def export_data_with_retry(fetch_fn, retries=3):\n"
        "    \"\"\"Deterministic demo fix: retries export fetch failures.\"\"\"\n"
        "    last_error = None\n"
        "    for _ in range(retries):\n"
        "        try:\n"
        "            return fetch_fn()\n"
        "        except Exception as err:  # pragma: no cover\n"
        "            last_error = err\n"
        "    raise RuntimeError(f\"Export failed after {retries} retries\") from last_error\n"
    )

    generation = CodeGenResponse(
        issue_id=issue_id,
        generated_code=generated_code,
        explanation="Added deterministic retry logic for export failures.",
        changes_summary="- Added bounded retries.\n- Added explicit failure message.",
        language=language,
    )

    review = CodeReviewResponse(
        overall_score=8.8,
        verdict=ReviewVerdict.APPROVED_WITH_SUGGESTIONS,
        issues=[
            ReviewIssue(
                severity=Severity.INFO,
                category=IssueCategory.BEST_PRACTICE,
                line=2,
                message="Docstring could mention exception type guarantees.",
                suggestion="Document expected fetch_fn exceptions for maintainers.",
            )
        ],
        improved_code=generated_code,
        summary="Deterministic demo review: good structure, minor documentation suggestion.",
        stats={"total_issues": 1, "deterministic": True},
    )

    github = None
    pipeline_status = "generated_and_reviewed_demo"
    if request.auto_push:
        github = GitHubPushResponse(
            success=True,
            branch_name=f"demo/{issue_id.lower()}",
            commit_sha="demo-commit-sha",
            pr_number=101,
            pr_url=f"https://github.com/demo/repo/pull/101?file={target_file}",
            message="Demo mode PR simulated successfully.",
        )
        pipeline_status = "fully_deployed_demo"

    return FullPipelineResponse(
        issue_id=issue_id,
        generation=generation,
        review=review,
        github=github,
        pipeline_status=pipeline_status,
        dashboard=_build_dashboard(review, github, pipeline_status),
    )
