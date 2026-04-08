"""
classify.py — Classifies post feedback into structured QA-ready signal
Uses Google Gemini (fallback to rule-based)
"""

import json
import os
import logging

logger = logging.getLogger("autopm.classify")


# ------------------ PROMPT ------------------

CLASSIFY_PROMPT = """You are a product manager AI.

Analyze this user complaint and convert it into a structured issue.

Post:
"{post_text}"

Return ONLY valid JSON (no markdown, no explanation):

{{
  "issue_type": "bug" | "feature_request" | "performance",
  "priority": "high" | "medium" | "low",
  "issue": "Short clear issue (max 15 words)",
  "affected_component": "auth | booking | checkout | ui | api | general",
  "user_impact": "Short impact description"
}}
"""


# ------------------ MOCK (fallback) ------------------

def _mock_classify(post_text: str) -> dict:
    text = post_text.lower()

    if any(w in text for w in ["crash", "error", "broken", "fail", "not working"]):
        return {
            "issue_type": "bug",
            "priority": "high",
            "issue": "feature not working properly",
            "affected_component": "general",
            "user_impact": "users cannot complete action",
        }

    elif any(w in text for w in ["slow", "lag", "delay", "timeout"]):
        return {
            "issue_type": "performance",
            "priority": "medium",
            "issue": "system is slow",
            "affected_component": "api",
            "user_impact": "slow user experience",
        }

    else:
        return {
            "issue_type": "feature_request",
            "priority": "medium",
            "issue": "user requesting new feature",
            "affected_component": "ui",
            "user_impact": "missing functionality",
        }


# ------------------ SAFE JSON PARSER ------------------

def _safe_parse_json(text: str) -> dict:
    try:
        text = text.strip()

        # remove markdown fences if any
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            text = text.rsplit("```", 1)[0]

        return json.loads(text)

    except Exception:
        logger.warning("Failed to parse JSON from LLM response")
        return None


# ------------------ MAIN FUNCTION ------------------

def classify_feedback(post_text: str) -> dict:
    api_key = "AIzaSyBx7tRSg_SrO5dPGdFLGw_kukPHDC3Aot0"
    model_name ="gemini-3-flash-preview"

    # ---------- NO API → MOCK ----------
    if not api_key:
        logger.info("No Gemini API key — using mock classification")
        return _mock_classify(post_text)

    # ---------- GEMINI ----------
    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(model_name)

        response = model.generate_content(
            CLASSIFY_PROMPT.format(post_text=post_text),
            generation_config=genai.GenerationConfig(
                temperature=0.2,
                max_output_tokens=200,
            ),
        )

        parsed = _safe_parse_json(response.text)

        if not parsed:
            raise ValueError("Invalid JSON from Gemini")

        # ---------- NORMALIZATION ----------
        parsed["priority"] = parsed.get("priority", "medium").lower()
        parsed["issue_type"] = parsed.get("issue_type", "bug").lower()

        # ensure required fields exist
        parsed.setdefault("issue", post_text[:80])
        parsed.setdefault("affected_component", "general")
        parsed.setdefault("user_impact", "")

        logger.info(
            "Classification → %s / %s",
            parsed["issue_type"],
            parsed["priority"]
        )

        return parsed

    except Exception as e:
        logger.error("Gemini failed: %s → fallback to mock", str(e))
        return _mock_classify(post_text)