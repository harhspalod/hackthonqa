"""
Pydantic Models / Schemas for AutoPM
"""

from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


# ─── Code Generation ────────────────────────────────────────────

class CodeGenRequest(BaseModel):
    """Request to generate code from an issue description."""
    issue_id: str = Field(..., description="Unique issue identifier")
    title: str = Field(..., description="Short issue title")
    description: str = Field(..., description="Detailed issue description")
    language: str = Field(default="python", description="Programming language")
    affected_file: Optional[str] = Field(None, description="Path of the affected file")
    existing_code: Optional[str] = Field(None, description="Current code that needs fixing")

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "issue_id": "ISS-001",
                    "title": "Export feature crashes on large datasets",
                    "description": "Users report the export API times out when dataset > 10K rows",
                    "language": "python",
                    "affected_file": "src/api/export.py",
                    "existing_code": "def export_data(query):\n    results = db.fetch_all(query)\n    return generate_csv(results)",
                }
            ]
        }
    }


class CodeGenResponse(BaseModel):
    """Response from code generation."""
    issue_id: str
    generated_code: str
    explanation: str
    changes_summary: str
    language: str


# ─── Code Review ─────────────────────────────────────────────────

class ReviewLevel(str, Enum):
    QUICK = "quick"
    STANDARD = "standard"
    THOROUGH = "thorough"


class CodeReviewRequest(BaseModel):
    """Request to review a piece of code."""
    code: str = Field(..., description="The code to review")
    language: str = Field(default="python", description="Programming language")
    filename: Optional[str] = Field(None, description="Original filename for context")
    context: Optional[str] = Field(None, description="Additional context about what this code does")
    review_level: ReviewLevel = Field(default=ReviewLevel.THOROUGH, description="How deep to review")

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "code": "def login(user, pwd):\n    query = f\"SELECT * FROM users WHERE name='{user}' AND pass='{pwd}'\"\n    return db.execute(query)",
                    "language": "python",
                    "filename": "auth.py",
                    "context": "User authentication endpoint",
                    "review_level": "thorough",
                }
            ]
        }
    }


class Severity(str, Enum):
    CRITICAL = "CRITICAL"
    WARNING = "WARNING"
    INFO = "INFO"
    SUGGESTION = "SUGGESTION"


class IssueCategory(str, Enum):
    BUG = "bug"
    SECURITY = "security"
    PERFORMANCE = "performance"
    BEST_PRACTICE = "best_practice"
    READABILITY = "readability"
    ERROR_HANDLING = "error_handling"


class ReviewIssue(BaseModel):
    """A single issue found during code review."""
    severity: Severity
    category: IssueCategory
    line: Optional[int] = None
    message: str
    suggestion: Optional[str] = None


class ReviewVerdict(str, Enum):
    APPROVED = "APPROVED"
    APPROVED_WITH_SUGGESTIONS = "APPROVED_WITH_SUGGESTIONS"
    NEEDS_CHANGES = "NEEDS_CHANGES"
    REJECTED = "REJECTED"


class CodeReviewResponse(BaseModel):
    """Full code review result."""
    overall_score: float = Field(..., ge=0, le=10, description="Score from 0-10")
    verdict: ReviewVerdict
    issues: list[ReviewIssue]
    improved_code: Optional[str] = None
    summary: str
    stats: dict = Field(default_factory=dict, description="Review statistics")


# ─── GitHub Integration ─────────────────────────────────────────

class GitHubPushRequest(BaseModel):
    """Request to push code to GitHub."""
    issue_id: str = Field(..., description="Issue ID for branch naming")
    title: str = Field(..., description="PR title")
    description: str = Field(..., description="PR body / description")
    file_path: str = Field(..., description="File path in repo to create/update")
    code: str = Field(..., description="The code content to push")
    review_summary: Optional[str] = Field(None, description="Optional review summary to include in PR")
    base_branch: str = Field(default="main", description="Base branch to create PR against")


class GitHubPushResponse(BaseModel):
    """Result of GitHub push operation."""
    success: bool
    branch_name: str
    commit_sha: Optional[str] = None
    pr_number: Optional[int] = None
    pr_url: Optional[str] = None
    message: str


# ─── Full Pipeline ───────────────────────────────────────────────

class FullPipelineRequest(BaseModel):
    """Run the complete pipeline: generate → review → push."""
    issue_id: str
    title: str
    description: str
    language: str = "python"
    affected_file: Optional[str] = None
    existing_code: Optional[str] = None
    auto_push: bool = Field(default=False, description="Auto-push to GitHub if review passes")


class PipelineDashboardSummary(BaseModel):
    """Compact payload for hackathon dashboards and quick UI rendering."""
    review_score: float = Field(..., ge=0, le=10)
    review_verdict: ReviewVerdict
    issues_found: int = Field(..., ge=0)
    github_pushed: bool
    pr_number: Optional[int] = None
    pr_url: Optional[str] = None
    pipeline_status: str


class FullPipelineResponse(BaseModel):
    """Result of the full pipeline execution."""
    issue_id: str
    generation: CodeGenResponse
    review: CodeReviewResponse
    github: Optional[GitHubPushResponse] = None
    pipeline_status: str
    dashboard: PipelineDashboardSummary


# ─── Async PR Analysis ───────────────────────────────────────────

class PRAnalysisRequest(BaseModel):
    """Start asynchronous pull request analysis."""
    pr_number: int = Field(..., gt=0, description="Pull request number")
    repo_owner: Optional[str] = Field(
        default=None, description="Optional owner override (defaults to env)"
    )
    repo_name: Optional[str] = Field(
        default=None, description="Optional repo override (defaults to env)"
    )
    min_confidence: float = Field(
        default=0.72, ge=0.0, le=1.0, description="Confidence threshold"
    )
    post_inline_comments: bool = Field(
        default=True, description="Post inline comments on PR"
    )
    max_inline_comments: int = Field(
        default=20, ge=1, le=100, description="Maximum inline comments to post"
    )


class PRAnalysisFinding(BaseModel):
    category: str
    severity: str
    rule_id: str
    title: str
    message: str
    suggestion: str
    file_path: str
    line: Optional[int] = None
    confidence: float = Field(..., ge=0.0, le=1.0)
    explanation: str


class PRAnalysisSummary(BaseModel):
    total_findings: int
    by_category: dict
    by_severity: dict
    false_positive_controls: dict


class PRAnalysisResult(BaseModel):
    repository: str
    pr_number: int
    findings: list[PRAnalysisFinding]
    summary: PRAnalysisSummary
    posted_inline_comments: int


class PRAnalysisStartResponse(BaseModel):
    job_id: str
    status: str
    message: str


class PRAnalysisJobResponse(BaseModel):
    job_id: str
    status: str
    pr_number: int
    repo_owner: Optional[str] = None
    repo_name: Optional[str] = None
    created_at: float
    updated_at: float
    error: Optional[str] = None
    result: Optional[PRAnalysisResult] = None
