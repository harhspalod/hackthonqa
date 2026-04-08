"""
Code Review Route — /api/review-code
Reviews code for bugs, security issues, performance, and best practices.
"""

from fastapi import APIRouter, HTTPException
from app.models.schemas import CodeReviewRequest, CodeReviewResponse
from app.services.review_engine import get_review_engine

router = APIRouter()


@router.post("/review-code", response_model=CodeReviewResponse)
def review_code(request: CodeReviewRequest):
    """
    AI-powered code review.

    Reviews the submitted code for:
    - Bugs (null refs, logic errors, unhandled exceptions)
    - Security (SQL injection, XSS, hardcoded secrets)
    - Performance (N+1 queries, memory leaks)
    - Best practices (naming, DRY, SOLID)
    - Error handling (missing try/catch)
    - Readability (clarity, comments)

    Returns a score (0-10), verdict, detailed issues, and improved code.
    """
    try:
        engine = get_review_engine()
        result = engine.review(request)
        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Code review failed: {str(e)}")
