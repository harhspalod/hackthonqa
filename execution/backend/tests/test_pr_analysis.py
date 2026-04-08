from app.routes import pr_analysis as pr_analysis_route
from app.models.schemas import PRAnalysisRequest


class FakePRAnalysisService:
    def start_job(
        self,
        pr_number,
        repo_owner=None,
        repo_name=None,
        min_confidence=0.72,
        post_inline_comments=True,
        max_inline_comments=20,
    ):
        return "job-123"

    def get_job(self, job_id):
        if job_id != "job-123":
            return None
        return {
            "job_id": "job-123",
            "status": "completed",
            "created_at": 1.0,
            "updated_at": 2.0,
            "pr_number": 7,
            "repo_owner": "acme",
            "repo_name": "repo",
            "error": None,
            "result": {
                "repository": "acme/repo",
                "pr_number": 7,
                "findings": [],
                "summary": {
                    "total_findings": 0,
                    "by_category": {},
                    "by_severity": {},
                    "false_positive_controls": {},
                },
                "posted_inline_comments": 0,
            },
        }


def test_start_pr_analysis(monkeypatch):
    monkeypatch.setattr(
        pr_analysis_route, "get_pr_analysis_service", lambda: FakePRAnalysisService()
    )
    req = PRAnalysisRequest(
        pr_number=7,
        repo_owner="acme",
        repo_name="repo",
        min_confidence=0.8,
        post_inline_comments=True,
        max_inline_comments=10,
    )
    response = pr_analysis_route.start_pr_analysis(req)
    assert response.job_id == "job-123"
    assert response.status == "queued"


def test_get_pr_analysis_status(monkeypatch):
    monkeypatch.setattr(
        pr_analysis_route, "get_pr_analysis_service", lambda: FakePRAnalysisService()
    )
    response = pr_analysis_route.get_pr_analysis_status("job-123")
    assert response.status == "completed"
    assert response.result is not None
    assert response.result.repository == "acme/repo"
