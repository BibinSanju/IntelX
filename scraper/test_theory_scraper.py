import unittest
from unittest.mock import patch

from theory_scraper import (
    JAVATPOINT_SOURCES,
    GeeksForGeeksScraper,
    InterviewBitScraper,
    JavaTPointMCQScraper,
    JavaTPointScraper,
    TheorySource,
    fetch_theory_questions,
)


class TheoryScraperTests(unittest.TestCase):
    def test_javatpoint_normalizes_answer_to_markdown(self):
        html = """
        <main><h3 class="h3">1. What is phishing?</h3>
        <p>Phishing uses <strong>deceptive messages</strong>.</p>
        <ul><li>Email</li><li>SMS</li></ul><h3 class="h3">Next</h3></main>
        """
        items = JavaTPointScraper("Cyber Security").parse(html, "https://example.test/security")
        self.assertEqual(items[0]["title"], "What is phishing?")
        self.assertIn("deceptive messages", items[0]["raw_text"])
        self.assertEqual(items[0]["source_metadata"]["content_type"], "theory")

    def test_interviewbit_section_parser_preserves_category(self):
        html = """
        <section><h3>What is normalization?</h3>
        <div class="answer-content"><p>Normalization reduces redundancy.</p></div></section>
        """
        items = InterviewBitScraper("DBMS").parse(html, "https://example.test/dbms")
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["tags"], ["DBMS", "Theory"])
        self.assertTrue(items[0]["external_id"].startswith("theory:"))

    def test_geeksforgeeks_article_parser(self):
        html = """
        <article><h2>What is cloud elasticity?</h2>
        <p>Elasticity adjusts resources as demand changes.</p>
        <h2>Summary</h2></article>
        """
        items = GeeksForGeeksScraper("Cloud Computing").parse(html, "https://example.test/cloud")
        self.assertEqual(len(items), 1)
        self.assertIn("Elasticity adjusts resources", items[0]["raw_text"])

    def test_javatpoint_mcq_parser_retains_options_and_answer(self):
        html = """
        <main>
          <p>1) Which SQL command reads rows?</p>
          <p>a) SELECT</p><p>b) DROP</p>
          <div><p><strong>Answer: a) SELECT</strong></p></div>
          <p>2) What does DDL define?</p><p>Database structures.</p>
        </main>
        """
        items = JavaTPointMCQScraper("SQL").parse(html, "https://example.test/sql-mcq")
        self.assertEqual(len(items), 2)
        self.assertIn("SELECT", items[0]["raw_text"])
        self.assertEqual(items[0]["source_metadata"]["content_kind"], "quiz")

    def test_javatpoint_catalog_covers_requested_subjects(self):
        categories = {source.scraper.category for source in JAVATPOINT_SOURCES}
        expected = {
            "DBMS", "SQL", "Oracle", "MongoDB", "Operating Systems",
            "Computer Networks", "Cyber Security", "Cloud Computing",
            "Machine Learning", "Artificial Intelligence", "Data Science",
            "HTML", "CSS", "JavaScript", "React", "Angular",
            "Web Development", "Android and Mobile Development",
            "Software Testing", "DevOps", "Docker", "Kubernetes", "Jenkins",
        }
        self.assertTrue(expected.issubset(categories))
        self.assertTrue(any(source.scraper.content_kind == "quiz" for source in JAVATPOINT_SOURCES))

    def test_connection_failure_benches_same_host_for_the_run(self):
        first = TheorySource(JavaTPointScraper("DBMS"), ("https://unavailable.test/dbms",))
        second = TheorySource(JavaTPointScraper("SQL"), ("https://unavailable.test/sql",))
        unavailable: set[str] = set()
        with patch.object(first.scraper, "fetch_page", side_effect=__import__("requests").ConnectionError("dns")) as fetch:
            self.assertEqual(first.scrape(unavailable), [])
            self.assertIn("unavailable.test", unavailable)
            self.assertEqual(second.scrape(unavailable), [])
            self.assertEqual(fetch.call_count, 1)

    def test_zero_limit_does_not_fetch_sources(self):
        self.assertEqual(fetch_theory_questions(0), [])


if __name__ == "__main__":
    unittest.main()
