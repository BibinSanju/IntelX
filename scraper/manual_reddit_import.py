"""Import user-supplied Reddit JSON without making requests to Reddit.

Supported inputs:
1. A Reddit thread JSON payload: [post_listing, comment_listing]
2. A Reddit listing JSON payload containing t3 children
3. The small manual template documented in README.md

The importer deliberately ignores author fields. Imported records pass through
the same filtering and normalization used by the approved OAuth connector.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, Iterable, List

import nightly_feeder
from reddit_scraper import build_reddit_question, extract_top_comments


MAX_FILE_BYTES = 10_000_000


def _unwrap_data(value: object) -> Dict:
    if not isinstance(value, dict):
        return {}
    data = value.get("data")
    return data if isinstance(data, dict) else value


def _manual_comments(value: object) -> List[str]:
    if not isinstance(value, list):
        return []
    ranked: list[tuple[int, str]] = []
    for entry in value:
        if isinstance(entry, str):
            ranked.append((0, entry))
            continue
        data = _unwrap_data(entry)
        body = data.get("body")
        if body and body not in {"[deleted]", "[removed]"}:
            ranked.append((int(data.get("score") or 0), str(body)))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [body for _, body in ranked[:3]]


def _listing_posts(value: object) -> List[Dict]:
    if not isinstance(value, dict):
        return []
    data = value.get("data")
    children = data.get("children", []) if isinstance(data, dict) else []
    posts: list[Dict] = []
    for child in children if isinstance(children, list) else []:
        if not isinstance(child, dict) or child.get("kind") not in {None, "t3"}:
            continue
        post = _unwrap_data(child)
        if post.get("id") and post.get("title"):
            posts.append(post)
    return posts


def extract_manual_questions(payload: object) -> List[Dict]:
    """Normalize supported JSON shapes into anonymous pipeline records."""
    candidates: list[tuple[Dict, Iterable[str]]] = []

    if isinstance(payload, dict) and "post" in payload:
        candidates.append((_unwrap_data(payload.get("post")), _manual_comments(payload.get("comments"))))
    elif isinstance(payload, dict) and isinstance(payload.get("posts"), list):
        for entry in payload["posts"]:
            if isinstance(entry, dict) and "post" in entry:
                candidates.append((_unwrap_data(entry.get("post")), _manual_comments(entry.get("comments"))))
            else:
                candidates.append((_unwrap_data(entry), []))
    elif isinstance(payload, dict):
        candidates.extend((post, []) for post in _listing_posts(payload))
    elif isinstance(payload, list):
        # Standard Reddit thread JSON: post listing followed by comment listing.
        if payload and _listing_posts(payload[0]):
            comments = extract_top_comments(payload, 3)
            candidates.extend((post, comments) for post in _listing_posts(payload[0]))
        else:
            for entry in payload:
                candidates.extend((item, []) for item in _listing_posts(entry))

    questions: list[Dict] = []
    seen: set[str] = set()
    for post, comments in candidates:
        question = build_reddit_question(post, comments)
        if not question or question["external_id"] in seen:
            continue
        seen.add(question["external_id"])
        questions.append(question)
    return questions


def load_questions(path: Path) -> List[Dict]:
    if not path.is_file():
        raise ValueError(f"File does not exist: {path}")
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError(f"File exceeds the {MAX_FILE_BYTES // 1_000_000} MB import limit: {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Could not read valid JSON from {path}: {exc}") from exc
    return extract_manual_questions(payload)


def main() -> int:
    parser = argparse.ArgumentParser(description="Import manually supplied Reddit JSON into the scraper pipeline.")
    parser.add_argument("files", nargs="+", type=Path, help="One or more local Reddit JSON files")
    parser.add_argument("--api-base", default=nightly_feeder.API_BASE, help="Backend base URL")
    parser.add_argument("--dry-run", action="store_true", help="Validate and preview records without ingestion")
    args = parser.parse_args()
    nightly_feeder.API_BASE = args.api_base.rstrip("/")

    imported = 0
    found = 0
    for path in args.files:
        try:
            questions = load_questions(path)
        except ValueError as exc:
            print(f"ERROR: {exc}")
            continue
        found += len(questions)
        print(f"Found {len(questions)} eligible Reddit recollection(s) in {path}.")
        for question in questions:
            if args.dry_run:
                print(json.dumps(question, indent=2, ensure_ascii=False))
            elif nightly_feeder.ingest_to_pipeline(question):
                imported += 1

    if args.dry_run:
        print(f"Dry run complete: {found} record(s) validated; nothing was submitted.")
        return 0 if found else 1
    print(f"Manual Reddit import complete: {imported}/{found} record(s) accepted.")
    return 0 if found and imported == found else 1


if __name__ == "__main__":
    raise SystemExit(main())
