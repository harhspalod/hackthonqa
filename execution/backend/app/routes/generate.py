"""
Code Generation Route — /api/generate-code
Takes an issue description and generates a code fix using Gemini AI.
"""

from fastapi import APIRouter, HTTPException
from app.models.schemas import CodeGenRequest, CodeGenResponse
from app.services.ai_service import get_gemini_service

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


@router.post("/generate-code", response_model=CodeGenResponse)
def generate_code(request: CodeGenRequest):
    """
    Generate code fix/feature from an issue description.

    This endpoint takes a structured issue (bug report, feature request)
    and uses Gemini AI to generate production-ready code.
    """
    try:
        ai = get_gemini_service()
        result = ai.generate_code(
            issue_title=request.title,
            issue_description=request.description,
            language=request.language,
            existing_code=request.existing_code,
            affected_file=request.affected_file,
        )

        # Handle parse errors
        if "error" in result:
            raise HTTPException(
                status_code=500,
                detail=f"AI generation failed: {result.get('error')}",
            )

        return CodeGenResponse(
            issue_id=request.issue_id,
            generated_code=_coerce_text(result.get("generated_code")),
            explanation=_coerce_text(result.get("explanation")),
            changes_summary=_coerce_text(result.get("changes_summary")),
            language=request.language,
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Code generation failed: {str(e)}")
