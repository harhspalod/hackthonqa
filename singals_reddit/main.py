"""
AutoPM — Reddit → QA Pipeline
User provides site_url → Reddit posts filtered for that site → classify → KB lookup → QA signal
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
from pipeline.kb_client import get_kb_page, ensure_kb_built


# ================== CONFIG ==================
load_dotenv()

QA_SERVER_URL    = os.getenv("QA_SERVER_URL", "http://localhost:3000/signal")
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
    version="3.0.0",
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
    site_url: str               # user provides this — e.g. "https://bharatmcp.com"
    limit:    int = 5


class PostsRequest(BaseModel):
    site_url: str
    limit:    int = 10


class KBRequest(BaseModel):
    site_url: str


# ================== CORE LOGIC ==================

def map_issue_to_page(issue: str) -> str:
    """Keyword → page fallback when KB has no match."""
    text = issue.lower()

    mapping = {
        "/login":        ["login", "signin", "auth"],
        "/signup":       ["signup", "register"],
        "/checkout":     ["payment", "checkout"],
        "/talk-with-us": ["booking", "schedule", "meeting", "calendar"],
        "/contact":      ["contact"],
        "/early-access": ["early access", "early-access", "get access", "access", "waitlist"],
    }

    for page, keywords in mapping.items():
        if any(k in text for k in keywords):
            return page

    return "/"


def resolve_page(issue: str, site_url: str) -> tuple[str, str]:
    """
    Resolve issue → page path.
      1. KB lookup  (real crawled pages from QA server)
      2. Keyword map (static fallback)
    Returns (page_path, resolution_method)
    """
    kb_page = get_kb_page(site_url=site_url, issue=issue)
    if kb_page:
        logger.info("Page resolved via KB: %s", kb_page)
        return kb_page, "kb"

    keyword_page = map_issue_to_page(issue)
    logger.info("Page resolved via keyword map: %s", keyword_page)
    return keyword_page, "keyword_map"


def build_qa_payload(issue: str, page: str, priority: str, site_url: str) -> Dict:
    return {
        "site_url": site_url,
        "issue":    issue,
        "page":     page,
        "source":   "reddit",
        "severity": priority or "medium",
    }


def send_to_qa(payload: Dict) -> Dict:
    try:
        res = requests.post(QA_SERVER_URL, json=payload, timeout=8)
        if res.status_code not in (200, 201):
            return {"error": f"QA server error: {res.status_code}", "response": res.text}
        return res.json()
    except requests.exceptions.Timeout:
        return {"error": "QA request timeout"}
    except Exception as e:
        logger.error("QA call failed: %s", e)
        return {"error": str(e)}


def process_single_post(post: Dict, site_url: str) -> Dict:
    """
    Full pipeline for one Reddit post:
      classify → KB page lookup (auto-build if needed) → QA signal
    """
    text = post.get("text", "").strip()
    if not text:
        return {"error": "empty post"}

    # 1. Classify
    classification = classify_feedback(text)

    # 2. Extract issue summary
    issue = classification.get("issue") or text[:120]

    # 3. Resolve page — KB first, keyword map fallback
    page, resolution_method = resolve_page(issue=issue, site_url=site_url)

    # 4. Build + send QA payload
    qa_payload  = build_qa_payload(
        issue    = issue,
        page     = page,
        priority = classification.get("priority", "medium"),
        site_url = site_url,
    )
    qa_response = send_to_qa(qa_payload)

    return {
        "post_id":           post.get("id"),
        "issue":             issue,
        "page":              page,
        "page_resolved_via": resolution_method,
        "relevance_method":  post.get("relevance_method", "unknown"),
        "classification":    classification,
        "qa_payload":        qa_payload,
        "qa_response":       qa_response,
    }


# ================== ROUTES ==================

@app.get("/")
async def root():
    return {
        "service":   "AutoPM Reddit → QA",
        "version":   "3.0.0",
        "status":    "running",
        "qa_server": QA_SERVER_URL,
    }


@app.post("/api/posts")
async def get_posts(request: PostsRequest):
    """
    Fetch Reddit posts filtered to the user-supplied site.
    Body: { "site_url": "https://yoursite.com", "limit": 10 }
    """
    try:
        result = fetch_reddit_posts(limit=request.limit, site_url=request.site_url)
        return result
    except Exception as e:
        logger.exception("Failed to fetch posts")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/kb/build")
async def build_kb(request: KBRequest):
    """
    Manually trigger a KB build for any site.
    Body: { "site_url": "https://yoursite.com" }
    """
    try:
        success = ensure_kb_built(request.site_url)
        return {
            "success":  success,
            "site_url": request.site_url,
            "message":  "KB ready" if success else "KB build failed — check QA server logs",
        }
    except Exception as e:
        logger.exception("KB build failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/process")
async def process_posts(request: ProcessRequest):
    """
    Full pipeline for a user-supplied site:
      Reddit → relevance filter → classify → KB lookup → QA signal

    Body: { "site_url": "https://yoursite.com", "limit": 5 }
    """
    try:
        result = fetch_reddit_posts(limit=request.limit, site_url=request.site_url)
        posts: List[Dict] = result.get("posts", [])

        if not posts:
            return {
                "success":        False,
                "site_url":       request.site_url,
                "message":        f"No relevant posts found for {request.site_url}",
                "total_fetched":  result.get("total_fetched", 0),
                "total_relevant": 0,
            }

        selected = posts[: request.limit]
        logger.info(
            "Processing %d relevant posts for %s",
            len(selected), request.site_url,
        )

        results = [process_single_post(post, request.site_url) for post in selected]

        return {
            "success":        True,
            "site_url":       request.site_url,
            "processed":      len(results),
            "total_fetched":  result.get("total_fetched", 0),
            "total_relevant": result.get("total_relevant", 0),
            "results":        results,
        }

    except Exception as e:
        logger.exception("Pipeline failed")
        raise HTTPException(status_code=500, detail=str(e))