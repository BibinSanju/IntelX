import os
import unittest
from unittest.mock import patch

from reddit_scraper import RedditConfig, build_reddit_question, extract_top_comments


class RedditScraperTests(unittest.TestCase):
    def test_requires_explicit_api_approval(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(RedditConfig.from_env())

    def test_builds_anonymous_untrusted_evidence(self):
        post = {
            "id": "abc123",
            "subreddit": "leetcode",
            "title": "Question asked in my technical interview",
            "selftext": "I was asked to find the shortest path in a weighted graph and explain the complexity.",
            "permalink": "/r/leetcode/comments/abc123/example/",
            "score": 42,
            "num_comments": 5,
        }
        item = build_reddit_question(post, ["Dijkstra works when edge weights are non-negative."])
        self.assertIsNotNone(item)
        self.assertEqual(item["external_id"], "reddit:abc123")
        self.assertEqual(item["source_metadata"]["content_type"], "auto")
        self.assertNotIn("author", item["source_metadata"])
        self.assertIn("Community discussion excerpts", item["raw_text"])

    def test_filters_non_interview_and_unsafe_posts(self):
        ordinary = {
            "id": "ordinary",
            "subreddit": "leetcode",
            "title": "My weekly progress",
            "selftext": "I completed several exercises and wanted to share this update with everyone.",
            "permalink": "/r/leetcode/comments/ordinary/progress/",
        }
        self.assertIsNone(build_reddit_question(ordinary, []))
        ordinary.update({"title": "Interview question", "over_18": True})
        self.assertIsNone(build_reddit_question(ordinary, []))

    def test_extracts_highest_scoring_comments_without_deleted_content(self):
        payload = [{}, {"data": {"children": [
            {"data": {"score": 2, "body": "Second"}},
            {"data": {"score": 9, "body": "First"}},
            {"data": {"score": 99, "body": "[deleted]"}},
        ]}}]
        self.assertEqual(extract_top_comments(payload, 2), ["First", "Second"])


if __name__ == "__main__":
    unittest.main()
