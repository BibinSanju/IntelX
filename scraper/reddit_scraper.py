"""Approved Reddit API ingestion for student-recalled interview questions.

Reddit access is intentionally OAuth-only and opt-in. The scraper will not
make a request unless the operator confirms API approval and supplies the
approved application's credentials.
"""

from __future__ import annotations

import html
import os
import re
import time
from dataclasses import dataclass
from typing import Dict, Iterable, List

import requests


TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
OAUTH_BASE = "https://oauth.reddit.com"
DEFAULT_SUBREDDITS = ("leetcode", "cscareerquestions", "developersIndia")
DEFAULT_QUERY = '"interview question" OR "asked in interview" OR "online assessment"'
INTERVIEW_SIGNAL = re.compile(r"\b(interview|asked|question|online assessment|\boa\b|coding round|technical round)\b", re.I)


def _clean_markdown(value: object, maximum: int) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f]", "", text)
    text = re.sub(r"\[([^\]]+)]\(https?://[^)]+\)", r"\1", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:maximum]


def extract_top_comments(payload: object, limit: int = 3) -> List[str]:
    if not isinstance(payload, list) or len(payload) < 2:
        return []
    children = payload[1].get("data", {}).get("children", []) if isinstance(payload[1], dict) else []
    ranked: list[tuple[int, str]] = []
    for child in children:
        data = child.get("data", {}) if isinstance(child, dict) else {}
        body = _clean_markdown(data.get("body"), 1_500)
        if not body or body in {"[deleted]", "[removed]"}:
            continue
        ranked.append((int(data.get("score") or 0), body))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [body for _, body in ranked[:limit]]


def build_reddit_question(post: Dict, comments: Iterable[str]) -> Dict | None:
    post_id = str(post.get("id") or "").strip()
    subreddit = str(post.get("subreddit") or "").strip()
    title = _clean_markdown(post.get("title"), 300)
    body = _clean_markdown(post.get("selftext"), 12_000)
    permalink = str(post.get("permalink") or "").strip()
    if not post_id or not subreddit or not title or len(body) < 40:
        return None
    if not INTERVIEW_SIGNAL.search(f"{title}\n{body}"):
        return None
    if post.get("over_18") or post.get("stickied"):
        return None

    comment_list = [_clean_markdown(comment, 1_500) for comment in comments]
    discussion = "\n\n".join(
        f"### Discussion excerpt {index + 1}\n{comment}"
        for index, comment in enumerate(comment_list) if comment
    )
    raw_text = (
        f"# {title}\n\n"
        f"## Student recollection\n{body}\n\n"
        f"## Community discussion excerpts\n{discussion or 'No discussion excerpts were retained.'}"
    )[:50_000]
    return {
        "title": title,
        "raw_text": raw_text,
        "source": f"Reddit r/{subreddit}",
        "source_url": f"https://www.reddit.com{permalink}" if permalink.startswith("/") else permalink,
        "external_id": f"reddit:{post_id}",
        "tags": ["Reddit", subreddit, "Student Recollection"],
        "hints": [],
        "source_metadata": {
            "provider": "reddit",
            "subreddit": subreddit,
            "content_type": "auto",
            "reddit_post_id": post_id,
            "score": int(post.get("score") or 0),
            "comment_count": int(post.get("num_comments") or 0),
        },
    }


@dataclass(frozen=True)
class RedditConfig:
    client_id: str
    client_secret: str
    user_agent: str
    subreddits: tuple[str, ...]
    query: str

    @classmethod
    def from_env(cls) -> "RedditConfig | None":
        if os.getenv("REDDIT_API_APPROVED", "").strip().lower() not in {"1", "true", "yes"}:
            print("Reddit skipped: set REDDIT_API_APPROVED=true only after Reddit grants API approval.")
            return None
        client_id = os.getenv("REDDIT_CLIENT_ID", "").strip()
        client_secret = os.getenv("REDDIT_CLIENT_SECRET", "").strip()
        user_agent = os.getenv("REDDIT_USER_AGENT", "").strip()
        if not client_id or not client_secret or not user_agent:
            print("Reddit skipped: approved REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, and REDDIT_USER_AGENT are required.")
            return None
        configured = os.getenv("REDDIT_SUBREDDITS", ",".join(DEFAULT_SUBREDDITS))
        subreddits = tuple(
            subreddit for subreddit in (item.strip() for item in configured.split(","))
            if re.fullmatch(r"[A-Za-z0-9_]{2,30}", subreddit)
        )
        return cls(
            client_id=client_id,
            client_secret=client_secret,
            user_agent=user_agent,
            subreddits=subreddits or DEFAULT_SUBREDDITS,
            query=os.getenv("REDDIT_SEARCH_QUERY", DEFAULT_QUERY).strip() or DEFAULT_QUERY,
        )


class RedditClient:
    def __init__(self, config: RedditConfig, session: requests.Session | None = None):
        self.config = config
        self.session = session or requests.Session()
        self.access_token = ""

    def authenticate(self) -> None:
        response = self.session.post(
            TOKEN_URL,
            auth=(self.config.client_id, self.config.client_secret),
            headers={"User-Agent": self.config.user_agent},
            data={"grant_type": "client_credentials"},
            timeout=15,
        )
        response.raise_for_status()
        self.access_token = str(response.json().get("access_token") or "")
        if not self.access_token:
            raise RuntimeError("Reddit OAuth returned no access token.")

    def _get(self, path: str, params: Dict) -> object:
        if not self.access_token:
            self.authenticate()
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "User-Agent": self.config.user_agent,
        }
        for attempt in range(3):
            response = self.session.get(f"{OAUTH_BASE}{path}", params=params, headers=headers, timeout=20)
            if response.status_code == 429 and attempt < 2:
                time.sleep(min(30, max(1, int(float(response.headers.get("Retry-After", "2"))))))
                continue
            response.raise_for_status()
            return response.json()
        raise RuntimeError("Reddit API retries exhausted.")

    def search(self, subreddit: str, limit: int) -> List[Dict]:
        payload = self._get(f"/r/{subreddit}/search", {
            "q": self.config.query,
            "restrict_sr": "1",
            "sort": "new",
            "t": "month",
            "limit": min(100, max(10, limit)),
            "raw_json": "1",
        })
        return payload.get("data", {}).get("children", []) if isinstance(payload, dict) else []

    def comments(self, subreddit: str, post_id: str) -> List[str]:
        payload = self._get(f"/r/{subreddit}/comments/{post_id}", {
            "sort": "top", "depth": "1", "limit": "10", "raw_json": "1",
        })
        return extract_top_comments(payload, 3)


def fetch_reddit_questions(limit: int = 4, config: RedditConfig | None = None) -> List[Dict]:
    config = config or RedditConfig.from_env()
    if not config or limit <= 0:
        return []
    client = RedditClient(config)
    batches: list[list[Dict]] = []
    for subreddit in config.subreddits:
        batch: list[Dict] = []
        try:
            for child in client.search(subreddit, limit * 3):
                post = child.get("data", {}) if isinstance(child, dict) else {}
                if not build_reddit_question(post, []):
                    continue
                item = build_reddit_question(post, client.comments(subreddit, str(post.get("id") or "")))
                if item:
                    batch.append(item)
        except (requests.RequestException, RuntimeError, ValueError) as exc:
            print(f"Reddit r/{subreddit} skipped: {exc}")
        print(f"Extracted {len(batch)} Reddit interview recollections from r/{subreddit}.")
        batches.append(batch)

    selected: list[Dict] = []
    index = 0
    while len(selected) < limit:
        made_progress = False
        for batch in batches:
            if index < len(batch):
                selected.append(batch[index])
                made_progress = True
                if len(selected) >= limit:
                    break
        if not made_progress:
            break
        index += 1
    return selected
