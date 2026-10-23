import os
import sys
import time
import requests
import json
from dotenv import load_dotenv
from content_normalizer import html_to_markdown
from theory_scraper import fetch_theory_questions
from reddit_scraper import fetch_reddit_questions

# Load env variables from backend
env_path = os.path.join(os.path.dirname(__file__), '..', 'backend', '.env')
load_dotenv(env_path)

API_BASE = os.getenv('FEEDER_API_URL', 'http://localhost:3000')

def clean_html(raw_html: str) -> str:
    """Normalize page HTML into structured Markdown for prompt ingestion."""
    return html_to_markdown(raw_html)

def fetch_leetcode_recent_questions(limit=10):
    """Fetches recent interview problems from LeetCode public GraphQL."""
    url = "https://leetcode.com/graphql"
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
    }
    
    list_query = """
    query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
      problemsetQuestionList: questionList(
        categorySlug: $categorySlug
        limit: $limit
        skip: $skip
        filters: $filters
      ) {
        questions: data {
          frontendQuestionId: questionFrontendId
          paidOnly: isPaidOnly
          title
          titleSlug
          difficulty
          topicTags { name }
        }
      }
    }
    """
    
    detail_query = """
    query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionFrontendId
        title
        titleSlug
        content
        difficulty
        hints
        topicTags { name slug }
      }
    }
    """
    
    print(f"📡 Fetching latest {limit} questions from LeetCode...")
    try:
        res = requests.post(url, json={"query": list_query, "variables": {"categorySlug": "", "skip": 0, "limit": limit, "filters": {}}}, headers=headers, timeout=10)
        if res.status_code != 200:
            print(f"❌ Failed to fetch question list: HTTP {res.status_code}")
            return []
        
        raw_list = res.json().get("data", {}).get("problemsetQuestionList", {}).get("questions", [])
        questions = []
        
        for q in raw_list:
            if q.get("paidOnly"):
                continue
            slug = q.get("titleSlug")
            det_res = requests.post(url, json={"query": detail_query, "variables": {"titleSlug": slug}}, headers=headers, timeout=10)
            if det_res.status_code == 200:
                details = det_res.json().get("data", {}).get("question", {}) or {}
                content = details.get("content", "")
                plain_desc = clean_html(content)
                detail_tags = [t.get("name") for t in details.get("topicTags", []) if t.get("name")]
                questions.append({
                    "title": q.get("title"),
                    "title_slug": slug,
                    "external_id": details.get("questionFrontendId") or q.get("frontendQuestionId"),
                    "difficulty": q.get("difficulty"),
                    "tags": detail_tags or [t["name"] for t in q.get("topicTags", [])],
                    "hints": details.get("hints", []),
                    "source_url": f"https://leetcode.com/problems/{slug}/",
                    "raw_text": f"Problem Title: {q.get('title')}\nDifficulty: {q.get('difficulty')}\n\nDescription:\n{plain_desc}",
                    "source": "LeetCode",
                    "source_metadata": {
                        "provider": "leetcode",
                        "content_type": "programming",
                        "titleSlug": slug,
                        "difficulty": q.get("difficulty"),
                    },
                })
            time.sleep(0.5)
            
        return questions
    except Exception as e:
        print(f"❌ Error scraping LeetCode: {e}")
        return []

def ingest_to_pipeline(question_data):
    """Sends a question to the backend ingestion endpoint."""
    url = f"{API_BASE}/api/ingest"
    payload = {
        "raw_text": question_data["raw_text"],
        "source": question_data.get("source", "Nightly_Scraper"),
        "tags": question_data.get("tags", []),
        "hints": question_data.get("hints", []),
        "source_url": question_data.get("source_url"),
        "external_id": (
            question_data.get("external_id")
            if str(question_data.get("external_id", "")).startswith(("leetcode:", "theory:", "reddit:"))
            else f"leetcode:{question_data.get('external_id')}" if question_data.get("external_id") else None
        ),
        "source_metadata": question_data.get("source_metadata") or {
            "provider": "leetcode",
            "content_type": "programming",
            "titleSlug": question_data.get("title_slug"),
            "difficulty": question_data.get("difficulty")
        },
    }
    try:
        res = requests.post(url, json=payload, timeout=10)
        if res.status_code in [200, 201]:
            data = res.json()
            print(f"✅ Queued '{question_data['title']}' -> StagedQuestion ID: {data.get('questionId')}")
            return True
        else:
            print(f"⚠️ Ingestion endpoint returned {res.status_code} for '{question_data['title']}': {res.text}")
            return False
    except requests.exceptions.RequestException as exc:
        print(f"⚠️ Feeder API at {API_BASE} not reachable: {exc}")
        return False

def run_nightly_feeder(limit=5, theory_limit=8, reddit_limit=4):
    print("🌙 --- Starting Nightly Problem Feeder Scraper ---")
    coding_questions = fetch_leetcode_recent_questions(limit=limit)
    theory_questions = fetch_theory_questions(limit=theory_limit)
    reddit_questions = fetch_reddit_questions(limit=reddit_limit)
    questions = [*coding_questions, *theory_questions, *reddit_questions]
    print(
        f"📊 Found {len(coding_questions)} coding, {len(theory_questions)} theory, "
        f"and {len(reddit_questions)} Reddit questions."
    )
    
    success_count = 0
    for q in questions:
        if ingest_to_pipeline(q):
            success_count += 1
            
    print(f"🏁 Nightly Feeder Run Complete: {success_count}/{len(questions)} accepted for background processing.")

if __name__ == "__main__":
    limit_arg = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    theory_limit_arg = int(sys.argv[2]) if len(sys.argv) > 2 else 8
    reddit_limit_arg = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    run_nightly_feeder(limit=limit_arg, theory_limit=theory_limit_arg, reddit_limit=reddit_limit_arg)
