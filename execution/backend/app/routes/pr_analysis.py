"""
Async PR Analysis Routes
"""

from fastapi import APIRouter, HTTPException, Request

from app.models.schemas import (
    PRAnalysisRequest,
    PRAnalysisStartResponse,
    PRAnalysisJobResponse,
)
from app.services.pr_analysis_service import get_pr_analysis_service

router = APIRouter()


@router.post("/analyze-pr/start", response_model=PRAnalysisStartResponse)
def start_pr_analysis(request: PRAnalysisRequest):
    """Start async analysis for a pull request."""
    try:
        service = get_pr_analysis_service()
        job_id = service.start_job(
            pr_number=request.pr_number,
            repo_owner=request.repo_owner,
            repo_name=request.repo_name,
            min_confidence=request.min_confidence,
            post_inline_comments=request.post_inline_comments,
            max_inline_comments=request.max_inline_comments,
        )
        return PRAnalysisStartResponse(
            job_id=job_id,
            status="queued",
            message="PR analysis job started",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # pylint: disable=broad-except
        raise HTTPException(status_code=500, detail=f"Failed to start PR analysis: {exc}")


@router.get("/analyze-pr/status/{job_id}", response_model=PRAnalysisJobResponse)
def get_pr_analysis_status(job_id: str):
    """Get status/result for a PR analysis job."""
    service = get_pr_analysis_service()
    job = service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return PRAnalysisJobResponse(**job)


@router.post("/github-webhook")
async def github_webhook(request: Request):
    """
    Minimal webhook entry point:
    auto-start async analysis on PR opened/synchronize/reopened.
    """
    event = request.headers.get("X-GitHub-Event", "")
    payload = await request.json()

    if event != "pull_request":
        return {"status": "ignored", "reason": f"Unsupported event: {event}"}

    action = payload.get("action")
    if action not in {"opened", "synchronize", "reopened"}:
        return {"status": "ignored", "reason": f"Unsupported pull_request action: {action}"}

    pr = payload.get("pull_request", {})
    repo = payload.get("repository", {})
    pr_number = pr.get("number")
    owner = (repo.get("owner") or {}).get("login")
    repo_name = repo.get("name")

    if not pr_number:
        raise HTTPException(status_code=400, detail="Missing pull_request.number in webhook")

    service = get_pr_analysis_service()
    job_id = service.start_job(
        pr_number=pr_number,
        repo_owner=owner,
        repo_name=repo_name,
        min_confidence=0.75,
        post_inline_comments=True,
        max_inline_comments=20,
    )
    return {
        "status": "accepted",
        "job_id": job_id,
        "pr_number": pr_number,
        "repository": f"{owner}/{repo_name}",
    }
