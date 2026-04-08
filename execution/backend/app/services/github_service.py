"""
GitHub Service — Automates branch creation, commits, and PR creation
using the GitHub REST API via PyGithub.
"""

import os
from typing import Optional
from github import Github, GithubException


class GitHubService:
    """Handles all GitHub operations: branches, commits, PRs."""

    def __init__(
        self,
        token: Optional[str] = None,
        owner: Optional[str] = None,
        repo_name: Optional[str] = None,
    ):
        self.token = token or os.getenv("GITHUB_TOKEN")
        self.owner = owner or os.getenv("GITHUB_OWNER")
        self.repo_name = repo_name or os.getenv("GITHUB_REPO")

        if not self.token:
            raise ValueError("GITHUB_TOKEN not set")
        if not self.owner or not self.repo_name:
            raise ValueError("GITHUB_OWNER and GITHUB_REPO must be set")

        self.github = Github(self.token)
        self.repo = self.github.get_repo(f"{self.owner}/{self.repo_name}")

    def get_pull_request(self, pr_number: int):
        """Return PullRequest object for a PR number."""
        return self.repo.get_pull(pr_number)

    def list_pull_request_files(self, pr_number: int) -> list[dict]:
        """List files changed in a pull request."""
        pr = self.get_pull_request(pr_number)
        files: list[dict] = []
        for changed in pr.get_files():
            files.append(
                {
                    "filename": changed.filename,
                    "status": changed.status,
                    "additions": changed.additions,
                    "deletions": changed.deletions,
                    "changes": changed.changes,
                    "patch": changed.patch or "",
                }
            )
        return files

    def get_file_content_at_ref(self, file_path: str, ref: str) -> str:
        """Get file content from a specific ref (branch/SHA)."""
        content = self.repo.get_contents(file_path, ref=ref)
        decoded = content.decoded_content
        return decoded.decode("utf-8", errors="replace")

    def create_branch(self, branch_name: str, base_branch: str = "main") -> str:
        """Create a new branch from base. Returns the branch ref."""
        try:
            base_ref = self.repo.get_branch(base_branch)
            base_sha = base_ref.commit.sha
            ref = self.repo.create_git_ref(
                ref=f"refs/heads/{branch_name}", sha=base_sha
            )
            return ref.ref
        except GithubException as e:
            if e.status == 422:  # Branch already exists
                return f"refs/heads/{branch_name}"
            raise

    def commit_file(
        self,
        branch_name: str,
        file_path: str,
        content: str,
        commit_message: str,
    ) -> str:
        """Create or update a file on the given branch. Returns commit SHA."""
        try:
            # Try to get existing file (update)
            existing = self.repo.get_contents(file_path, ref=branch_name)
            result = self.repo.update_file(
                path=file_path,
                message=commit_message,
                content=content,
                sha=existing.sha,
                branch=branch_name,
            )
        except GithubException:
            # File doesn't exist, create it
            result = self.repo.create_file(
                path=file_path,
                message=commit_message,
                content=content,
                branch=branch_name,
            )
        return result["commit"].sha

    def create_pull_request(
        self,
        title: str,
        body: str,
        branch_name: str,
        base_branch: str = "main",
        labels: Optional[list[str]] = None,
    ) -> dict:
        """Create a pull request. Returns PR details."""
        try:
            pr = self.repo.create_pull(
                title=title,
                body=body,
                head=branch_name,
                base=base_branch,
            )

            # Add labels if provided
            if labels:
                try:
                    pr.add_to_labels(*labels)
                except GithubException:
                    pass  # Labels might not exist, that's ok

            return {
                "pr_number": pr.number,
                "pr_url": pr.html_url,
                "state": pr.state,
            }
        except GithubException as e:
            if e.status == 422:
                # PR might already exist
                pulls = self.repo.get_pulls(
                    state="open", head=f"{self.owner}:{branch_name}"
                )
                for pr in pulls:
                    return {
                        "pr_number": pr.number,
                        "pr_url": pr.html_url,
                        "state": pr.state,
                    }
            raise

    def add_review_comment(
        self, pr_number: int, body: str, commit_sha: str, path: str, line: int
    ):
        """Add an inline review comment to a PR."""
        try:
            pr = self.repo.get_pull(pr_number)
            commit = self.repo.get_commit(commit_sha)
            pr.create_review_comment(
                body=body,
                commit=commit,
                path=path,
                line=line,
            )
        except GithubException:
            # Fallback: add as a regular PR comment
            pr = self.repo.get_pull(pr_number)
            pr.create_issue_comment(f"**Review Comment** ({path}:{line})\n\n{body}")

    def add_issue_comment(self, pr_number: int, body: str):
        """Add a non-inline PR issue comment."""
        pr = self.repo.get_pull(pr_number)
        pr.create_issue_comment(body)

    def full_push_flow(
        self,
        issue_id: str,
        title: str,
        description: str,
        file_path: str,
        code: str,
        review_summary: Optional[str] = None,
        base_branch: str = "main",
    ) -> dict:
        """
        Complete push flow: create branch → commit → create PR.
        Returns dict with branch_name, commit_sha, pr_number, pr_url.
        """
        # Generate branch name from issue
        safe_title = title.lower().replace(" ", "-")[:40]
        safe_title = "".join(c for c in safe_title if c.isalnum() or c == "-")
        branch_name = f"fix/{issue_id}-{safe_title}"

        # 1. Create branch
        self.create_branch(branch_name, base_branch)

        # 2. Commit the code
        commit_message = f"fix: {title} (#{issue_id})\n\nAuto-generated by AutoPM"
        commit_sha = self.commit_file(branch_name, file_path, code, commit_message)

        # 3. Build PR body
        pr_body = f"""## 🤖 Auto-Generated by AutoPM

### Issue: {issue_id}
**{title}**

{description}

---

### 📝 Changes
- Updated `{file_path}`
- Auto-generated fix by AutoPM Code Engine

"""
        if review_summary:
            pr_body += f"""### 🔍 AI Code Review Summary
{review_summary}

---
"""
        pr_body += "\n> 🚀 *This PR was automatically created by [AutoPM](https://github.com/autopm) — Autonomous Code Review & Product Intelligence System*"

        # 4. Create PR
        pr_title = f"[AutoPM] Fix: {title}"
        pr_result = self.create_pull_request(
            title=pr_title,
            body=pr_body,
            branch_name=branch_name,
            base_branch=base_branch,
            labels=["auto-generated", "autopm"],
        )

        return {
            "success": True,
            "branch_name": branch_name,
            "commit_sha": commit_sha,
            "pr_number": pr_result["pr_number"],
            "pr_url": pr_result["pr_url"],
            "message": f"PR #{pr_result['pr_number']} created successfully",
        }


# Singleton
_service: Optional[GitHubService] = None


def get_github_service() -> GitHubService:
    global _service
    if _service is None:
        _service = GitHubService()
    return _service
