"""
AutoPM — Reddit → QA Pipeline (Clean Version)
"""

import logging
import os
from typing import List, Dict

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from pipeline.fetch_reddit import fetch_reddit_posts
from pipeline.classify import classify_feedback


# ================== CONFIG ==================
load_dotenv()

QA_SERVER_URL = os.getenv("QA_SERVER_URL", "http://localhost:3000/signal")
DEFAULT_SITE_URL = os.getenv("DEFAULT_SITE_URL", "https://bharatmcp.com")


# ================== LOGGING ==================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("autopm")


# ================== FASTAPI ==================
app = FastAPI(
    title="AutoPM Reddit → QA",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ================== MODELS ==================
class ProcessRequest(BaseModel):
    limit: int = 5


# ================== CORE LOGIC ==================

def map_issue_to_page(issue: str) -> str:
    """
    Keyword → Page mapping (simple version)
    """
    text = issue.lower()

    mapping = {
        "/login": ["login", "signin", "auth"],
        "/signup": ["signup", "register"],
        "/checkout": ["payment", "checkout"],
        "/talk-with-us": ["booking", "schedule", "meeting"],
        "/contact": ["contact"],
    }

    for page, keywords in mapping.items():
        if any(k in text for k in keywords):
            return page

    return "/"


def build_qa_payload(issue: str, page: str, priority: str) -> Dict:
    return {
        "site_url": DEFAULT_SITE_URL,
        "issue": issue,
        "page": page,
        "source": "reddit",
        "severity": priority or "medium",
    }


def send_to_qa(payload: Dict) -> Dict:
    try:
        res = requests.post(QA_SERVER_URL, json=payload, timeout=8)

        if res.status_code != 200:
            return {
                "error": f"QA server error: {res.status_code}",
                "response": res.text
            }

        return res.json()

    except requests.exceptions.Timeout:
        return {"error": "QA request timeout"}

    except Exception as e:
        logger.error(f"QA call failed: {e}")
        return {"error": str(e)}


def process_single_post(post: Dict) -> Dict:
    """
    Process one Reddit post
    """
    text = post.get("text", "").strip()

    if not text:
        return {"error": "empty post"}

    # 1. classify
    classification = classify_feedback(text)

    # 2. extract issue
    issue = classification.get("issue") or text[:120]

    # 3. map to page
    page = map_issue_to_page(issue)

    # 4. build payload
    qa_payload = build_qa_payload(
        issue=issue,
        page=page,
        priority=classification.get("priority", "medium")
    )

    # 5. send to QA
    qa_response = send_to_qa(qa_payload)

    return {
        "post_id": post.get("id"),
        "issue": issue,
        "page": page,
        "classification": classification,
        "qa_response": qa_response,
    }


# ================== ROUTES ==================

@app.get("/")
async def root():
    return {
        "service": "AutoPM Reddit → QA",
        "status": "running",
        "qa_server": QA_SERVER_URL
    }


@app.get("/api/posts")
async def get_posts():
    try:
        result = fetch_reddit_posts()
        return result
    except Exception as e:
        logger.exception("Failed to fetch posts")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/process")
async def process_posts(request: ProcessRequest):
    """
    Reddit → classify → map → QA
    """

    try:
        result = fetch_reddit_posts()
        posts: List[Dict] = result.get("posts", [])

        if not posts:
            return {"success": False, "message": "No posts found"}

        selected_posts = posts[:request.limit]

        logger.info(f"Processing {len(selected_posts)} posts")

        results = [process_single_post(post) for post in selected_posts]

        return {
            "success": True,
            "processed": len(results),
            "results": results
        }

    except Exception as e:
        logger.exception("Pipeline failed")
        raise HTTPException(status_code=500, detail=str(e))