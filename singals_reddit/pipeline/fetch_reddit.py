"""
fetch_reddit.py — Fetches real-time posts from Reddit using public JSON.
"""
import requests
import logging
from typing import List, Dict, Optional
from datetime import datetime

logger = logging.getLogger("autopm.fetch_reddit")

SUBREDDITS = ["androiddev", "webdev", "startups", "apps", "ios"]

def _get_demo_posts() -> List[Dict]:
    """Mock Reddit posts for demo purposes when API is not configured or fails."""
    return [
        {
            "id": "reddit-1",
            "text": "App keeps crashing on Android 14. I just downloaded the latest version and it crashes every time I open the settings menu. Is anyone else facing this?",
            "author": "android_fan_99",
            "created_at": datetime.now().isoformat(),
            "subreddit": "androiddev",
            "metrics": {"ups": 45, "comments": 12}
        },
        {
            "id": "reddit-2",
            "text": "Feature Request: Dark Mode for the dashboard. The white background is blinding at night. Please add a dark mode toggle!",
            "author": "web_dev_pro",
            "created_at": datetime.now().isoformat(),
            "subreddit": "webdev",
            "metrics": {"ups": 120, "comments": 34}
        },
        {
            "id": "reddit-3",
            "text": "The login button is unresponsive on Safari. I tried clicking it multiple times but nothing happens. Works fine on Chrome though.",
            "author": "ios_user_abc",
            "created_at": datetime.now().isoformat(),
            "subreddit": "ios",
            "metrics": {"ups": 15, "comments": 5}
        }
    ]

def fetch_reddit_posts(limit: int = 5) -> Dict:
    """
    Fetch latest posts from specified subreddits via JSON endpoint.
    Attempts live fetch first, falls back to demo data if error occurs.
    """
    headers = {
        "User-Agent": "AutoPM/1.0"
    }

    try:
        posts = []
        subreddit_str = "+".join(SUBREDDITS)
        url = f"https://www.reddit.com/r/{subreddit_str}/new.json?limit={limit}"
        logger.info("Fetching live posts from %s", url)
        
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        data = response.json()
        children = data.get("data", {}).get("children", [])
        
        for item in children:
            post_data = item.get("data", {})
            title = post_data.get("title", "")
            selftext = post_data.get("selftext", "")
            combined_text = f"{title} {selftext}".strip()
            
            created_utc = post_data.get("created_utc")
            created_at = datetime.fromtimestamp(created_utc).isoformat() if created_utc else datetime.now().isoformat()
            
            posts.append({
                "id": post_data.get("id", "unknown"),
                "text": combined_text,
                "author": post_data.get("author", "deleted"),
                "created_at": created_at,
                "subreddit": post_data.get("subreddit", "unknown"),
                "metrics": {
                    "ups": post_data.get("ups", 0),
                    "comments": post_data.get("num_comments", 0)
                }
            })

        logger.info("Fetched %d live posts from Reddit", len(posts))
        
        if not posts:
            raise ValueError("Empty response or no posts found.")

        return {"posts": posts, "source": "live"}

    except Exception as e:
        err_msg = str(e)
        logger.error("Reddit JSON fetch failed: %s — falling back to demo data", err_msg)
        return {
            "posts": _get_demo_posts(),
            "source": "cache",
            "error": f"Reddit API error: {err_msg}"
        }
