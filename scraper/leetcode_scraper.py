import requests
import json
import time
from content_normalizer import html_to_markdown

class LeetCodeScraper:
    def __init__(self):
        self.url = "https://leetcode.com/graphql"
        self.headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0"
        }

    def fetch_problem_list(self, limit=50, skip=0):
        query = """
        query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
          problemsetQuestionList: questionList(
            categorySlug: $categorySlug
            limit: $limit
            skip: $skip
            filters: $filters
          ) {
            total: totalNum
            questions: data {
              difficulty
              frontendQuestionId: questionFrontendId
              paidOnly: isPaidOnly
              title
              titleSlug
              topicTags {
                name
              }
            }
          }
        }
        """
        variables = {
            "categorySlug": "",
            "skip": skip,
            "limit": limit,
            "filters": {}
        }
        
        response = requests.post(self.url, json={"query": query, "variables": variables}, headers=self.headers)
        if response.status_code == 200:
            return response.json().get("data", {}).get("problemsetQuestionList", {}).get("questions", [])
        else:
            print(f"Error fetching problem list: {response.status_code}")
        return []

    def fetch_problem_details(self, title_slug):
        query = """
        query questionData($titleSlug: String!) {
          question(titleSlug: $titleSlug) {
            questionFrontendId
            title
            titleSlug
            content
            isPaidOnly
            difficulty
            hints
            topicTags {
              name
              slug
            }
          }
        }
        """
        variables = {"titleSlug": title_slug}
        response = requests.post(self.url, json={"query": query, "variables": variables}, headers=self.headers)
        if response.status_code == 200:
            return response.json().get("data", {}).get("question", {})
        else:
            print(f"Error fetching problem details for {title_slug}: {response.status_code}")
        return {}

    def fetch_questions(self, limit=10):
        """
        Fetch question details and normalize the page HTML with BeautifulSoup.
        """
        problems = self.fetch_problem_list(limit=limit)
        results = []
        for p in problems:
            # Skip paid-only problems
            if p.get("paidOnly"):
                continue
            
            title_slug = p.get("titleSlug")
            details = self.fetch_problem_details(title_slug)
            
            # Format the output as requested by the plan
            tags = [tag.get("name") for tag in p.get("topicTags", [])]
            
            raw_html = details.get("content") or ""
            markdown_content = html_to_markdown(raw_html)
            results.append({
                "title": p.get("title"),
                "titleSlug": title_slug,
                "difficulty": p.get("difficulty"),
                "tags": tags,
                "hints": details.get("hints", []),
                "external_id": details.get("questionFrontendId") or p.get("frontendQuestionId"),
                "source_url": f"https://leetcode.com/problems/{title_slug}/",
                # markdown_content is the canonical downstream representation.
                # html_content remains for older seed scripts during migration.
                "markdown_content": markdown_content,
                "raw_text": markdown_content,
                "html_content": raw_html
            })
            
            # small delay to prevent rate limiting
            time.sleep(0.5)
            
        return results

if __name__ == "__main__":
    scraper = LeetCodeScraper()
    print("Fetching 2 questions from LeetCode to test...")
    questions = scraper.fetch_questions(limit=2)
    for q in questions:
        print(f"Title: {q['title']}")
        print(f"Difficulty: {q['difficulty']}")
        print(f"Tags: {q['tags']}")
        content_len = len(q['markdown_content']) if q.get('markdown_content') else 0
        print(f"Content Length: {content_len} chars")
        if content_len > 0:
            print(f"Normalized Markdown:\n{q['markdown_content']}")
        print("-" * 50)
