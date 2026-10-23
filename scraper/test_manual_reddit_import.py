import json
import tempfile
import unittest
from pathlib import Path

from manual_reddit_import import extract_manual_questions, load_questions


class ManualRedditImportTests(unittest.TestCase):
    def setUp(self):
        self.post = {
            "id": "manual123",
            "subreddit": "developersIndia",
            "title": "Graph question asked in an interview",
            "selftext": "The interviewer asked me to return the shortest path through a weighted graph and explain the time complexity.",
            "permalink": "/r/developersIndia/comments/manual123/example/",
            "author": "must-not-be-retained",
            "score": 12,
            "num_comments": 4,
        }

    def test_imports_manual_template_without_author(self):
        questions = extract_manual_questions({
            "post": self.post,
            "comments": [{"body": "Use Dijkstra for non-negative weights.", "score": 5}],
        })
        self.assertEqual(len(questions), 1)
        self.assertEqual(questions[0]["external_id"], "reddit:manual123")
        self.assertNotIn("must-not-be-retained", json.dumps(questions[0]))
        self.assertIn("Use Dijkstra", questions[0]["raw_text"])

    def test_imports_standard_thread_payload_and_ranks_comments(self):
        payload = [
            {"data": {"children": [{"kind": "t3", "data": self.post}]}},
            {"data": {"children": [
                {"kind": "t1", "data": {"body": "Lower", "score": 1}},
                {"kind": "t1", "data": {"body": "Higher", "score": 8}},
            ]}},
        ]
        questions = extract_manual_questions(payload)
        self.assertEqual(len(questions), 1)
        self.assertLess(questions[0]["raw_text"].index("Higher"), questions[0]["raw_text"].index("Lower"))

    def test_loads_utf8_json_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "reddit.json"
            path.write_text(json.dumps({"post": self.post, "comments": []}), encoding="utf-8")
            self.assertEqual(len(load_questions(path)), 1)


if __name__ == "__main__":
    unittest.main()
