"""
fetch_reddit.py — Fetches real-time posts from Reddit using public JSON.
Filters posts to only those relevant to a given site (passed by the user).
"""
import os
import json
import requests
import logging
from typing import List, Dict, Optional
from datetime import datetime

logger = logging.getLogger("autopm.fetch_reddit")

SUBREDDITS = ["androiddev", "webdev", "startups", "apps", "ios"]


RELEVANCE_PROMPT = """You are a content filter for a product called "{site_name}" ({site_url}).

Given this Reddit post, decide: is it relevant to "{site_name}" or describes a problem that "{site_name}" would care about (bugs, UX issues, feature requests, performance complaints related to their product area)?

Post:
\"\"\"{post_text}\"\"\"

Return ONLY valid JSON, no markdown:
{{
  "relevant": true | false,
  "reason": "one sentence explanation"
}}

Be generous — if the post describes an issue that could apply to this product, mark it relevant."""


def _extract_site_name(site_url: str) -> str:
    """Extract a readable name from the URL. e.g. https://bharatmcp.com → BharatMCP"""
    from urllib.parse import urlparse
    host = urlparse(site_url).netloc or site_url
    host = host.replace("www.", "")
    name = host.split(".")[0]
    return name.replace("-", " ").title()


def _is_hard_match(text: str, site_url: str, site_name: str) -> bool:
    """Fast path: check if post explicitly mentions the site by name or URL."""
    from urllib.parse import urlparse
    lower = text.lower()
    host  = urlparse(site_url).netloc.replace("www.", "").lower()

    candidates = [
        host,                               # bharatmcp.com
        host.split(".")[0],                 # bharatmcp
        site_name.lower(),                  # bharatmcp
        site_name.lower().replace(" ", ""), # bharatmcp (no spaces)
    ]
    return any(c in lower for c in candidates)


def _is_relevant_via_gemini(post_text: str, site_url: str, site_name: str) -> bool:
    """
    Use Gemini to decide if this post is relevant to the given site.
    Falls back to True (keep post) if Gemini is unavailable.
    """
    api_key    = "AIzaSyBx7tRSg_SrO5dPGdFLGw_kukPHDC3Aot0"
    model_name = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")

    if not api_key:
        logger.info("No Gemini key — keeping all posts by default")
        return True

    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(model_name)

        prompt = RELEVANCE_PROMPT.format(
            site_name=site_name,
            site_url=site_url,
            post_text=post_text[:600],
        )

        response = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                temperature=0.1,
                max_output_tokens=100,
            ),
        )

        text = response.text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]

        parsed   = json.loads(text)
        relevant = parsed.get("relevant", False)
        reason   = parsed.get("reason", "")

        logger.info(
            "Relevance [%s] → %s | %s",
            site_name,
            "KEEP" if relevant else "SKIP",
            reason,
        )
        return bool(relevant)

    except Exception as e:
        logger.warning("Gemini relevance check failed: %s — keeping post", e)
        return True


def _filter_relevant_posts(posts: List[Dict], site_url: str) -> List[Dict]:
    """
    Filter posts to those relevant to the given site.
      1. Hard keyword match (free, instant)
      2. Gemini AI check
    """
    site_name = _extract_site_name(site_url)
    relevant  = []

    for post in posts:
        text = post.get("text", "")

        if _is_hard_match(text, site_url, site_name):
            logger.info("Post %s matched via keyword", post.get("id"))
            post["relevance_method"] = "keyword"
            relevant.append(post)
            continue

        if _is_relevant_via_gemini(text, site_url, site_name):
            post["relevance_method"] = "gemini"
            relevant.append(post)
        else:
            logger.info(
                "Post %s filtered out — not relevant to %s",
                post.get("id"), site_name,
            )

    logger.info(
        "Relevance filter [%s]: %d/%d posts kept",
        site_name, len(relevant), len(posts),
    )
    return relevant


def _get_demo_posts() -> List[Dict]:
    return [
        {
            "id": "demo-1",
            "text": "The booking/scheduling page keeps crashing. Every time I submit the form it just reloads.",
            "author": "user_abc",
            "created_at": datetime.now().isoformat(),
            "subreddit": "webdev",
            "metrics": {"ups": 45, "comments": 12},
        },
        {
            "id": "demo-2",
            "text": "Login button is unresponsive on Safari. Works fine on Chrome.",
            "author": "ios_user",
            "created_at": datetime.now().isoformat(),
            "subreddit": "ios",
            "metrics": {"ups": 15, "comments": 5},
        },
        {
            "id": "demo-3",
            "text": "Unrelated post about React hooks and state management patterns.",
            "author": "dev_rants",
            "created_at": datetime.now().isoformat(),
            "subreddit": "webdev",
            "metrics": {"ups": 30, "comments": 8},
        },
    ]


def fetch_reddit_posts(limit: int = 5, site_url: Optional[str] = None) -> Dict:
    """
    Fetch posts from Reddit and filter to those relevant to site_url.
    site_url comes from user input — passed in by the caller.
    """
    headers = {"User-Agent": "AutoPM/1.0"}
    cache_error = None

    try:
        subreddit_str = "+".join(SUBREDDITS)
        url = f"https://www.reddit.com/r/{subreddit_str}/new.json?limit={limit}"
        logger.info("Fetching live posts from Reddit")

        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()

        data     = response.json()
        children = data.get("data", {}).get("children", [])

        posts = []
        for item in children:
            pd          = item.get("data", {})
            title       = pd.get("title", "")
            selftext    = pd.get("selftext", "")
            combined    = f"{title} {selftext}".strip()
            created_utc = pd.get("created_utc")
            created_at  = (
                datetime.fromtimestamp(created_utc).isoformat()
                if created_utc else datetime.now().isoformat()
            )
            posts.append({
                "id":         pd.get("id", "unknown"),
                "text":       combined,
                "author":     pd.get("author", "deleted"),
                "created_at": created_at,
                "subreddit":  pd.get("subreddit", "unknown"),
                "metrics": {
                    "ups":      pd.get("ups", 0),
                    "comments": pd.get("num_comments", 0),
                },
            })

        if not posts:
            raise ValueError("Empty response from Reddit")

        source = "live"
        logger.info("Fetched %d live posts", len(posts))

    except Exception as e:
        cache_error = str(e)
        logger.error("Reddit fetch failed: %s — using demo data", cache_error)
        posts  = _get_demo_posts()
        source = "cache"

    # Relevance filter — only runs if site_url provided
    if site_url:
        relevant_posts = _filter_relevant_posts(posts, site_url)
    else:
        relevant_posts = posts

    result = {
        "posts":          relevant_posts,
        "source":         source,
        "total_fetched":  len(posts),
        "total_relevant": len(relevant_posts),
        "site_url":       site_url,
    }
    if cache_error:
        result["error"] = f"Reddit API error: {cache_error}"

    return result