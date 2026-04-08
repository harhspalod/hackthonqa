"""
kb_client.py — Queries the QA server's Knowledge Base to resolve
issue text → best matching page path.

Flow:
  1. GET /signal/kb          → check if site KB exists
  2. POST /signal/kb/build   → auto-build if missing (waits for completion)
  3. Score KB pages against issue keywords → return best match
  4. Caller falls back to keyword mapping if no confident match found
"""

import logging
import os
from typing import Optional

import requests

logger = logging.getLogger("autopm.kb_client")

QA_SERVER_URL = os.getenv("QA_SERVER_URL", "http://localhost:3000")
KB_SCORE_THRESHOLD = 1       # minimum keyword hits to trust KB result
KB_BUILD_TIMEOUT   = 120     # seconds to wait for a fresh crawl
KB_LOOKUP_TIMEOUT  = 8       # seconds for normal GET requests


# ------------------------------------------------------------------ #
#  Internal helpers                                                    #
# ------------------------------------------------------------------ #

def _base_url() -> str:
    """Strip trailing /signal so we can compose any path cleanly."""
    base = QA_SERVER_URL.rstrip("/")
    if base.endswith("/signal"):
        base = base[: -len("/signal")]
    return base


def _list_kb() -> list:
    """
    GET /signal/kb → list of { site, page_count, crawled_at, … }
    Returns [] on any error.
    """
    try:
        res = requests.get(
            f"{_base_url()}/signal/kb",
            timeout=KB_LOOKUP_TIMEOUT,
        )
        res.raise_for_status()
        return res.json()          # list of site entries
    except Exception as e:
        logger.warning("KB list fetch failed: %s", e)
        return []


def _site_in_kb(site_url: str, kb_list: list) -> bool:
    """Check whether a site already has a KB entry."""
    normalized = site_url.rstrip("/").lower()
    for entry in kb_list:
        if entry.get("site", "").rstrip("/").lower() == normalized:
            return True
    return False


def _build_kb(site_url: str) -> bool:
    """
    POST /signal/kb/build — triggers a full site crawl.
    Blocks until the server responds (crawl is synchronous on the QA side).
    Returns True on success.
    """
    logger.info("KB not found for %s — triggering build …", site_url)
    try:
        res = requests.post(
            f"{_base_url()}/signal/kb/build",
            json={"site_url": site_url},
            timeout=KB_BUILD_TIMEOUT,
        )
        res.raise_for_status()
        logger.info("KB build complete for %s", site_url)
        return True
    except Exception as e:
        logger.error("KB build failed for %s: %s", site_url, e)
        return False


def _get_kb_tree(site_url: str) -> Optional[dict]:
    """
    GET /signal/kb/<host> — fetch the full KB tree for a site.
    Falls back to GET /signal/kb and filters if a per-site endpoint
    isn't available (depends on your NestJS routes).
    """
    from urllib.parse import urlparse
    host = urlparse(site_url).netloc          # e.g. bharatmcp.com

    try:
        # Try a per-site endpoint first (if your backend exposes one)
        res = requests.get(
            f"{_base_url()}/signal/kb/{host}",
            timeout=KB_LOOKUP_TIMEOUT,
        )
        if res.status_code == 200:
            return res.json()
    except Exception:
        pass

    # Fallback: list endpoint may embed pages inline
    for entry in _list_kb():
        if entry.get("site", "").rstrip("/") == site_url.rstrip("/"):
            return entry

    return None


def _score_page(page: dict, issue: str) -> int:
    """
    Score a KB page against the issue text.
    Checks individual words AND key phrases against page URL, title, known_errors.
    """
    issue_lower = issue.lower()
    issue_words = set(issue_lower.split())

    # Key phrases that map directly to page URL segments
    phrase_map = {
        "early-access": ["access", "early access", "early-access", "get access", "waitlist"],
        "talk-with-us": ["schedule", "meeting", "booking", "book", "calendar", "talk"],
        "login":        ["login", "signin", "auth"],
        "signup":       ["signup", "register"],
        "checkout":     ["payment", "checkout"],
        "contact":      ["contact"],
    }

    page_url = page.get("url", "").lower()

    # Bonus score if issue phrases match the page URL segment directly
    for url_segment, phrases in phrase_map.items():
        if url_segment in page_url:
            if any(phrase in issue_lower for phrase in phrases):
                return 10   # strong match — return immediately

    # Standard word overlap score
    searchable = " ".join(filter(None, [
        page_url,
        page.get("title", ""),
        " ".join(page.get("known_errors", [])),
        " ".join(
            step
            for flow in page.get("flows", [])
            for step in flow.get("steps", [])
        ),
    ])).lower()

    return sum(1 for w in issue_words if w in searchable)


# ------------------------------------------------------------------ #
#  Public API                                                          #
# ------------------------------------------------------------------ #

def ensure_kb_built(site_url: str) -> bool:
    """
    Guarantee a KB exists for site_url.
    Builds one automatically if missing.
    Returns True if KB is available after this call.
    """
    kb_list = _list_kb()

    if _site_in_kb(site_url, kb_list):
        logger.info("KB already exists for %s", site_url)
        return True

    return _build_kb(site_url)


def get_kb_page(site_url: str, issue: str) -> Optional[str]:
    """
    Main entry point — resolves an issue string to the best matching
    page path using the QA server's Knowledge Base.

    Returns a page path string (e.g. "/talk-with-us") or None if
    no confident match is found (caller should fall back to keyword map).
    """
    # 1. Make sure KB exists (auto-build if not)
    if not ensure_kb_built(site_url):
        logger.warning("KB unavailable for %s — skipping KB lookup", site_url)
        return None

    # 2. Fetch KB tree
    tree = _get_kb_tree(site_url)
    if not tree:
        logger.warning("Could not retrieve KB tree for %s", site_url)
        return None

    pages = tree.get("pages", [])
    if not pages:
        logger.warning("KB has no pages for %s", site_url)
        return None

    # 3. Score each page against the issue text
    scored = [
        (page, _score_page(page, issue))
        for page in pages
    ]
    scored.sort(key=lambda x: x[1], reverse=True)

    best_page, best_score = scored[0]

    logger.info(
        "KB page match: '%s' (score=%d) for issue: '%s'",
        best_page.get("url"), best_score, issue[:60],
    )

    if best_score < KB_SCORE_THRESHOLD:
        logger.info("Score below threshold — no KB match, will use keyword map")
        return None

    return best_page.get("url")        # e.g. "/talk-with-us"