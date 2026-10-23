"""Compatibility entry point for feeding LeetCode questions into the AI pipeline.

Historically this script called Groq and wrote directly to PostgreSQL. It now
submits BeautifulSoup-normalized Markdown to the backend so the required
Google AI Studio -> Groq provider chain is always used.
"""

import os
import sys
import time

import requests
from dotenv import load_dotenv

from leetcode_scraper import LeetCodeScraper


env_path = os.path.join(os.path.dirname(__file__), "..", "backend", ".env")
load_dotenv(env_path)
API_BASE = os.getenv("FEEDER_API_URL", "http://localhost:3000")


def submit_question(question: dict) -> bool:
    title_slug = question.get("titleSlug")
    payload = {
        "raw_text": (
            f"Problem Title: {question.get('title')}\n"
            f"Difficulty: {question.get('difficulty')}\n\n"
            f"{question.get('markdown_content') or question.get('raw_text') or ''}"
        ),
        "source": "LeetCode_Seeder",
        "tags": question.get("tags", []),
        "hints": question.get("hints", []),
        "source_url": question.get("source_url"),
        "external_id": f"leetcode:{question.get('external_id')}" if question.get("external_id") else None,
        "source_metadata": {
            "provider": "leetcode",
            "titleSlug": title_slug,
            "difficulty": question.get("difficulty"),
        },
    }
    try:
        response = requests.post(f"{API_BASE}/api/ingest", json=payload, timeout=15)
        if response.status_code in (200, 201):
            print(f"Queued {question.get('title')}: {response.json().get('questionId')}")
            return True
        print(f"Failed {question.get('title')}: HTTP {response.status_code} {response.text}")
    except requests.RequestException as error:
        print(f"Failed {question.get('title')}: {error}")
    return False


def main() -> None:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    questions = LeetCodeScraper().fetch_questions(limit=limit)
    accepted = 0
    for question in questions:
        accepted += int(submit_question(question))
        time.sleep(0.25)
    print(f"Accepted {accepted}/{len(questions)} questions into the staged AI pipeline.")


if __name__ == "__main__":
    main()
