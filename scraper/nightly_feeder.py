import os
import sys
import time
import requests
import json
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# Load env variables from backend
env_path = os.path.join(os.path.dirname(__file__), '..', 'backend', '.env')
load_dotenv(env_path)

API_BASE = os.getenv('FEEDER_API_URL', 'http://localhost:3000')
DATABASE_URL = os.getenv('DIRECT_URL') or os.getenv('DATABASE_URL')

def clean_html(raw_html: str) -> str:
    """Strips excessive tags and normalizes text for prompt ingestion."""
    if not raw_html:
        return ""
    soup = BeautifulSoup(raw_html, 'html.parser')
    return soup.get_text(separator='\n').strip()

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
        title
        content
        difficulty
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
                content = det_res.json().get("data", {}).get("question", {}).get("content", "")
                plain_desc = clean_html(content)
                questions.append({
                    "title": q.get("title"),
                    "difficulty": q.get("difficulty"),
                    "tags": [t["name"] for t in q.get("topicTags", [])],
                    "raw_text": f"Problem Title: {q.get('title')}\nDifficulty: {q.get('difficulty')}\n\nDescription:\n{plain_desc}"
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
        "source": "Nightly_Scraper"
    }
    try:
        res = requests.post(url, json=payload, timeout=10)
        if res.status_code in [200, 201]:
            data = res.json()
            print(f"✅ Ingested '{question_data['title']}' -> StagedQuestion ID: {data.get('questionId')}")
            return True
        else:
            print(f"⚠️ Ingestion endpoint returned {res.status_code} for '{question_data['title']}': {res.text}")
            return False
    except requests.exceptions.ConnectionError:
        print(f"⚠️ Feeder API at {API_BASE} not reachable. Falling back to direct DB stage...")
        return False

def fallback_db_ingest(question_data):
    """Direct DB insertion fallback if backend API server is offline."""
    if not DATABASE_URL:
        print("❌ DATABASE_URL not set. Cannot fallback to direct DB.")
        return False
    try:
        import psycopg2
        import uuid
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        
        q_id = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO staged_questions (id, raw_text, source, status, created_at, updated_at)
            VALUES (%s, %s, %s, %s, NOW(), NOW())
            """,
            (q_id, question_data["raw_text"], "Nightly_Scraper", "PENDING_AI")
        )
        conn.commit()
        cur.close()
        conn.close()
        print(f"📦 Staged '{question_data['title']}' directly in DB as {q_id} (PENDING_AI)")
        return True
    except Exception as e:
        print(f"❌ Direct DB staging failed: {e}")
        return False

def run_nightly_feeder(limit=5):
    print("🌙 --- Starting Nightly Problem Feeder Scraper ---")
    questions = fetch_leetcode_recent_questions(limit=limit)
    print(f"📊 Found {len(questions)} eligible questions.")
    
    success_count = 0
    for q in questions:
        if ingest_to_pipeline(q) or fallback_db_ingest(q):
            success_count += 1
            
    print(f"🏁 Nightly Feeder Run Complete: {success_count}/{len(questions)} staged successfully.")

if __name__ == "__main__":
    limit_arg = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    run_nightly_feeder(limit=limit_arg)
