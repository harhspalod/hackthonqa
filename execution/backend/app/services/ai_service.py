"""
Gemini AI Service — Handles all interactions with Google Gemini API
for code generation and code review.
"""

import os
import json
import re
import httpx
import google.generativeai as genai
from typing import Optional


class GeminiService:
    """Wrapper around Google Gemini API for code intelligence tasks."""

    def __init__(self):
        api_key = os.getenv("GEMINI_API_KEY")
        self.gemini_model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        self.ollama_enabled = os.getenv("OLLAMA_FALLBACK_ENABLED", "true").lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        self.ollama_base_url = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
        self.ollama_model = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:7b")
        self.timeout_seconds = float(os.getenv("AI_TIMEOUT_SECONDS", "120"))

        self.model = None
        self.gemini_available = bool(api_key)

        if self.gemini_available:
            genai.configure(api_key=api_key)
            self.model = genai.GenerativeModel(self.gemini_model_name)

        if not self.gemini_available and not self.ollama_enabled:
            raise ValueError(
                "GEMINI_API_KEY not found and OLLAMA_FALLBACK_ENABLED is disabled"
            )

    def generate_code(
        self,
        issue_title: str,
        issue_description: str,
        language: str = "python",
        existing_code: Optional[str] = None,
        affected_file: Optional[str] = None,
    ) -> dict:
        """
        Generate code fix/feature from an issue description.
        Returns dict with: generated_code, explanation, changes_summary
        """
        existing_code_section = ""
        if existing_code:
            existing_code_section = f"""
## Current Code (that needs fixing):
```{language}
{existing_code}
```
"""
        file_section = ""
        if affected_file:
            file_section = f"\n## Affected File: `{affected_file}`\n"

        prompt = f"""You are an expert {language} software engineer. Your task is to generate a code fix or feature implementation based on the following issue.

## Issue Title: {issue_title}

## Issue Description:
{issue_description}
{file_section}
{existing_code_section}

## Instructions:
1. Write clean, production-ready {language} code that fixes the issue
2. Follow {language} best practices and conventions
3. Include proper error handling
4. Add clear comments where necessary
5. If existing code is provided, maintain the same style and structure

## Response Format:
You MUST respond with a valid JSON object (no markdown, no code fences) with exactly these keys:
{{
    "generated_code": "the complete fixed/new code here",
    "explanation": "one paragraph explaining what the fix does and why",
    "changes_summary": "bullet-point summary of what changed"
}}

        Respond ONLY with the JSON object. No other text."""

        return self._run_prompt(prompt, task_name="code generation")

    def review_code(
        self,
        code: str,
        language: str = "python",
        filename: Optional[str] = None,
        context: Optional[str] = None,
        review_level: str = "thorough",
    ) -> dict:
        """
        Review code for bugs, security issues, performance, and best practices.
        Returns dict with: overall_score, verdict, issues[], improved_code, summary
        """
        context_section = ""
        if context:
            context_section = f"\n## Context: {context}\n"
        filename_section = ""
        if filename:
            filename_section = f"\n## Filename: `{filename}`\n"

        depth_instruction = {
            "quick": "Focus only on critical bugs and security issues.",
            "standard": "Check for bugs, security issues, and major performance problems.",
            "thorough": "Do a comprehensive review covering bugs, security, performance, best practices, readability, error handling, and edge cases.",
        }.get(review_level, "Do a comprehensive review.")

        prompt = f"""You are a senior code reviewer with deep expertise in {language}. Review the following code carefully.

{filename_section}
{context_section}

## Code to Review:
```{language}
{code}
```

## Review Depth: {review_level}
{depth_instruction}

## Review Checklist:
1. **Bugs**: Null references, off-by-one errors, unhandled exceptions, logic errors, race conditions
2. **Security**: SQL injection, XSS, hardcoded secrets, insecure API usage, input validation
3. **Performance**: N+1 queries, unnecessary loops, memory leaks, inefficient algorithms
4. **Best Practices**: Naming conventions, DRY violations, SOLID principles, code complexity
5. **Error Handling**: Missing try/catch, unhelpful error messages, swallowed exceptions
6. **Readability**: Code clarity, comments, function length, variable names

## Response Format:
You MUST respond with a valid JSON object (no markdown, no code fences) with exactly these keys:
{{
    "overall_score": <number from 1.0 to 10.0>,
    "verdict": "<one of: APPROVED, APPROVED_WITH_SUGGESTIONS, NEEDS_CHANGES, REJECTED>",
    "issues": [
        {{
            "severity": "<one of: CRITICAL, WARNING, INFO, SUGGESTION>",
            "category": "<one of: bug, security, performance, best_practice, readability, error_handling>",
            "line": <line number or null>,
            "message": "description of the issue",
            "suggestion": "how to fix it"
        }}
    ],
    "improved_code": "the complete improved version of the code (or null if no changes needed)",
    "summary": "2-3 sentence summary of the review findings"
}}

Be honest and thorough. If the code is good, say so. If it has issues, be specific.
Respond ONLY with the JSON object. No other text."""

        return self._run_prompt(prompt, task_name="code review")

    def _run_prompt(self, prompt: str, task_name: str) -> dict:
        """
        Run prompt using Gemini first, then fallback to Ollama if Gemini hits rate limits.
        """
        if self.gemini_available and self.model is not None:
            try:
                response = self.model.generate_content(prompt)
                return self._parse_json_response(response.text)
            except Exception as gemini_err:  # pylint: disable=broad-except
                error_msg = str(gemini_err)
                if self._should_fallback_to_ollama(error_msg):
                    fallback = self._run_ollama(prompt)
                    if "error" not in fallback:
                        return fallback
                    return {
                        "error": (
                            f"Gemini rate-limited; Ollama fallback failed: {fallback.get('error')}"
                        )
                    }
                return {"error": f"Gemini API error during {task_name}: {error_msg}"}

        if self.ollama_enabled:
            return self._run_ollama(prompt)

        return {"error": f"No AI provider available for {task_name}"}

    def _should_fallback_to_ollama(self, error_msg: str) -> bool:
        lowered = error_msg.lower()
        return self.ollama_enabled and (
            "429" in lowered
            or "quota" in lowered
            or "rate limit" in lowered
            or "resource has been exhausted" in lowered
            or "too many requests" in lowered
        )

    def _run_ollama(self, prompt: str) -> dict:
        """
        Call local Ollama server for JSON output.
        """
        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = client.post(
                    f"{self.ollama_base_url.rstrip('/')}/api/generate",
                    json={
                        "model": self.ollama_model,
                        "prompt": prompt,
                        "stream": False,
                        "format": "json",
                    },
                )
            response.raise_for_status()
            payload = response.json()
            text = payload.get("response", "")
            parsed = self._parse_json_response(text)
            if "error" in parsed and "raw_response" in parsed:
                return {
                    "error": f"Ollama returned non-JSON output: {parsed.get('error')}",
                    "raw_response": parsed.get("raw_response"),
                }
            return parsed
        except Exception as ollama_err:  # pylint: disable=broad-except
            return {"error": f"Ollama fallback error: {str(ollama_err)}"}

    def _parse_json_response(self, text: str) -> dict:
        """Parse JSON from Gemini response, handling markdown fences and extra text."""
        # Try direct parse first
        text = text.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Try extracting JSON from markdown code fences
        json_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1).strip())
            except json.JSONDecodeError:
                pass

        # Try finding first { to last }
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass

        # Fallback — return raw text wrapped
        return {
            "raw_response": text,
            "error": "Could not parse structured response from AI",
        }


# Singleton instance
_service: Optional[GeminiService] = None


def get_gemini_service() -> GeminiService:
    """Get or create the singleton GeminiService instance."""
    global _service
    if _service is None:
        _service = GeminiService()
    return _service
