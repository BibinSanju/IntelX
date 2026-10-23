"""Scrape theory interview questions and queue them through the feeder API.

Unlike the legacy version, this module never writes directly to PostgreSQL.
Every item follows the same BeautifulSoup -> Markdown -> /api/ingest pipeline
as coding questions, while marking the content as theory for backend routing.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
from dataclasses import dataclass
from datetime import date
from typing import Dict, List, Sequence
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup, Tag
from dotenv import load_dotenv

from content_normalizer import html_to_markdown


class BaseScraper:
    def __init__(self, source_name: str, category: str, content_kind: str = "interview"):
        self.source_name = source_name
        self.category = category
        self.content_kind = content_kind
        self.headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
            )
        }

    def fetch_page(self, url: str) -> str:
        response = requests.get(url, headers=self.headers, timeout=15)
        response.raise_for_status()
        return response.text

    def parse(self, html: str, url: str) -> List[Dict]:
        raise NotImplementedError

    def scrape(self, url: str, unavailable_hosts: set[str] | None = None) -> List[Dict]:
        host = urlparse(url).netloc.lower()
        if unavailable_hosts is not None and host in unavailable_hosts:
            return []
        print(f"Scraping {url} via {self.source_name}...")
        try:
            return self.parse(self.fetch_page(url), url)
        except requests.ConnectionError as exc:
            if unavailable_hosts is not None:
                unavailable_hosts.add(host)
            print(f"Failed to connect to {host}; remaining pages on this host will be skipped: {exc}")
            return []
        except requests.RequestException as exc:
            print(f"Failed to fetch {url}: {exc}")
            return []

    def item(self, question: str, answer_html: str, url: str) -> Dict | None:
        question = " ".join(question.split()).lstrip("0123456789.) ").strip()
        answer = html_to_markdown(answer_html)
        if not question or not answer:
            return None
        fingerprint = hashlib.sha256(f"{url}|{question}".encode("utf-8")).hexdigest()[:20]
        return {
            "title": question[:200],
            "raw_text": (
                f"# {question}\n\n"
                f"## Interview question\n{question}\n\n"
                f"## Source reference material\n{answer}"
            )[:50_000],
            "source": self.source_name,
            "source_url": url,
            "external_id": f"theory:{fingerprint}",
            "tags": [self.category, "Theory"],
            "hints": [],
            "source_metadata": {
                "provider": self.source_name.lower().replace(" ", "-"),
                "category": self.category,
                "content_type": "theory",
                "content_kind": self.content_kind,
                "original_title": question[:500],
            },
        }


def _siblings_until_heading(start: Tag) -> str:
    fragments: list[str] = []
    sibling = start.find_next_sibling()
    while sibling and getattr(sibling, "name", None) not in {"h2", "h3", "h4"}:
        fragments.append(str(sibling))
        sibling = sibling.find_next_sibling()
    return "\n".join(fragments)


class JavaTPointScraper(BaseScraper):
    QUESTION_PREFIX = re.compile(
        r"^(?:\d+\s*[).:-]\s*)?(?:what|why|how|when|where|which|who|can|is|are|do|does|"
        r"explain|define|describe|differentiate|difference|compare|list|name|state|tell)\b",
        re.I,
    )

    def __init__(self, category: str, content_kind: str = "interview"):
        super().__init__("JavaTPoint", category, content_kind)

    def parse(self, html: str, url: str) -> List[Dict]:
        soup = BeautifulSoup(html, "html.parser")
        results: List[Dict] = []
        seen: set[str] = set()
        for heading in soup.select("h2.h2, h3.h3, article h2, article h3, main h2, main h3"):
            question = heading.get_text(" ", strip=True)
            if "?" not in question and not self.QUESTION_PREFIX.match(question):
                continue
            item = self.item(question, _siblings_until_heading(heading), url)
            if item:
                if item["external_id"] not in seen:
                    results.append(item)
                    seen.add(item["external_id"])
        return results


class JavaTPointMCQScraper(BaseScraper):
    """Extract numbered JavaTpoint quiz/MCQ blocks as theory evidence."""

    NUMBERED_QUESTION = re.compile(r"^\s*\d+\s*[).:-]\s*(.{5,500})$", re.S)

    def __init__(self, category: str):
        super().__init__("JavaTPoint", category, "quiz")

    def parse(self, html: str, url: str) -> List[Dict]:
        soup = BeautifulSoup(html, "html.parser")
        results: List[Dict] = []
        seen: set[str] = set()
        for node in soup.select("article p, main p, .testanswer p, .pq p, article h3, main h3"):
            question_text = node.get_text(" ", strip=True)
            match = self.NUMBERED_QUESTION.match(question_text)
            if not match:
                continue

            fragments = [str(node)]
            sibling = node.find_next_sibling()
            while sibling and len(fragments) < 20:
                sibling_text = sibling.get_text(" ", strip=True) if isinstance(sibling, Tag) else ""
                if self.NUMBERED_QUESTION.match(sibling_text):
                    break
                if getattr(sibling, "name", None) in {"h2", "h3"} and sibling_text:
                    break
                fragments.append(str(sibling))
                sibling = sibling.find_next_sibling()

            item = self.item(match.group(1), "\n".join(fragments), url)
            if item and item["external_id"] not in seen:
                results.append(item)
                seen.add(item["external_id"])
        return results


class InterviewBitScraper(BaseScraper):
    def __init__(self, category: str):
        super().__init__("InterviewBit", category)

    def parse(self, html: str, url: str) -> List[Dict]:
        soup = BeautifulSoup(html, "html.parser")
        results: List[Dict] = []
        seen: set[str] = set()

        for section in soup.find_all("section"):
            heading = section.find(["h2", "h3", "h4"])
            answer = section.find("div", class_=lambda value: value and "answer" in str(value).lower())
            answer = answer or section.find("article")
            if heading and answer:
                item = self.item(heading.get_text(" ", strip=True), str(answer), url)
                if item and item["external_id"] not in seen:
                    results.append(item)
                    seen.add(item["external_id"])

        if not results:
            for heading in soup.select("main h2, main h3, article h2, article h3"):
                question = heading.get_text(" ", strip=True)
                if "?" not in question and not question.lower().startswith(
                    ("what", "why", "how", "explain", "define", "differentiate", "list")
                ):
                    continue
                item = self.item(question, _siblings_until_heading(heading), url)
                if item and item["external_id"] not in seen:
                    results.append(item)
                    seen.add(item["external_id"])
        return results


class GeeksForGeeksScraper(BaseScraper):
    def __init__(self, category: str):
        super().__init__("GeeksForGeeks", category)

    def parse(self, html: str, url: str) -> List[Dict]:
        soup = BeautifulSoup(html, "html.parser")
        content = soup.select_one("article") or soup.select_one(".article--viewer_content") or soup.select_one(".text")
        if not content:
            return []

        results: List[Dict] = []
        for heading in content.find_all(["h2", "h3", "h4"]):
            question = heading.get_text(" ", strip=True)
            if "?" not in question and not question.lower().lstrip("0123456789. ").startswith(
                ("what", "why", "how", "explain", "define", "differentiate", "list")
            ):
                continue
            item = self.item(question, _siblings_until_heading(heading), url)
            if item:
                results.append(item)
        return results


@dataclass(frozen=True)
class TheorySource:
    scraper: BaseScraper
    urls: tuple[str, ...]

    def scrape(self, unavailable_hosts: set[str]) -> List[Dict]:
        for url in self.urls:
            if urlparse(url).netloc.lower() in unavailable_hosts:
                continue
            batch = self.scraper.scrape(url, unavailable_hosts)
            if batch:
                return batch
        return []


def _javatpoint_interview(category: str, *slugs: str) -> TheorySource:
    return TheorySource(
        JavaTPointScraper(category),
        tuple(f"https://www.javatpoint.com/{slug}" for slug in slugs),
    )


def _javatpoint_quiz(category: str, slug: str) -> TheorySource:
    return TheorySource(
        JavaTPointMCQScraper(category),
        (f"https://www.javatpoint.com/{slug}",),
    )


# JavaTpoint is deliberately a registry of bounded question pages rather than a
# site-wide crawler. Alternative slugs are tried only when a topic has used
# multiple historical URL forms.
JAVATPOINT_SOURCES: list[TheorySource] = [
    # Databases
    _javatpoint_interview("DBMS", "dbms-interview-questions"),
    _javatpoint_interview("SQL", "sql-interview-questions"),
    _javatpoint_interview("Oracle", "oracle-interview-questions"),
    _javatpoint_interview("MongoDB", "mongodb-interview-questions"),
    # Core computer science
    _javatpoint_interview("Operating Systems", "operating-system-interview-questions"),
    _javatpoint_interview("Computer Networks", "computer-network-interview-questions", "networking-interview-questions"),
    _javatpoint_interview("Cyber Security", "cyber-security-interview-questions"),
    _javatpoint_interview("Cloud Computing", "cloud-computing-interview-questions"),
    # AI and data
    _javatpoint_interview("Machine Learning", "machine-learning-interview-questions"),
    _javatpoint_interview("Artificial Intelligence", "artificial-intelligence-interview-questions"),
    _javatpoint_interview("Data Science", "data-science-interview-questions"),
    # Web development
    _javatpoint_interview("HTML", "html-interview-questions"),
    _javatpoint_interview("CSS", "css-interview-questions"),
    _javatpoint_interview("JavaScript", "javascript-interview-questions", "es6-interview-questions"),
    _javatpoint_interview("React", "react-interview-questions", "reactjs-interview-questions"),
    _javatpoint_interview("Angular", "angular-interview-questions", "angularjs-interview-questions"),
    _javatpoint_interview("Web Development", "web-developer-interview-questions", "web-development-interview-questions"),
    # Mobile
    _javatpoint_interview("Android and Mobile Development", "android-interview-questions", "mobile-app-development-interview-questions"),
    # Testing
    _javatpoint_interview("Software Testing", "qa-interview-questions", "software-testing-interview-questions"),
    _javatpoint_interview("Manual Testing", "manual-testing-interview-questions"),
    _javatpoint_interview("Automation Testing", "automation-testing-interview-questions"),
    _javatpoint_interview("Selenium", "selenium-interview-questions"),
    _javatpoint_interview("TestNG", "testng-interview-questions"),
    # DevOps and related tools
    _javatpoint_interview("DevOps", "devops-interview-questions"),
    _javatpoint_interview("Git", "git-interview-questions"),
    _javatpoint_interview("Docker", "docker-interview-questions"),
    _javatpoint_interview("Kubernetes", "kubernetes-interview-questions"),
    _javatpoint_interview("Jenkins", "jenkins-interview-questions"),
    _javatpoint_interview("Ansible", "ansible-interview-questions"),
    _javatpoint_interview("Terraform", "terraform-interview-questions"),
    # Question/quiz pages. Explanations and visible examples are retained as
    # source evidence; ordinary tutorial prose is not ingested as a question.
    _javatpoint_quiz("DBMS", "dbms-mcq"),
    _javatpoint_quiz("SQL", "sql-mcq"),
    _javatpoint_quiz("Operating Systems", "operating-system-mcq"),
    _javatpoint_quiz("Computer Networks", "computer-network-mcq"),
    _javatpoint_quiz("Cyber Security", "cyber-security-mcq"),
    _javatpoint_quiz("Cloud Computing", "cloud-computing-mcq"),
    _javatpoint_quiz("Machine Learning", "machine-learning-mcq"),
    _javatpoint_quiz("Artificial Intelligence", "artificial-intelligence-mcq"),
    _javatpoint_quiz("HTML", "html-mcq"),
    _javatpoint_quiz("CSS", "css-mcq"),
    _javatpoint_quiz("JavaScript", "javascript-mcq"),
    _javatpoint_quiz("Android and Mobile Development", "android-mcq"),
    _javatpoint_quiz("Software Testing", "software-testing-mcq"),
    _javatpoint_quiz("DevOps", "devops-mcq"),
]

OTHER_THEORY_SOURCES: list[TheorySource] = [
    TheorySource(InterviewBitScraper("Cyber Security"), ("https://www.interviewbit.com/cyber-security-interview-questions/",)),
    TheorySource(InterviewBitScraper("DBMS"), ("https://www.interviewbit.com/dbms-interview-questions/",)),
    TheorySource(InterviewBitScraper("System Design"), ("https://www.interviewbit.com/system-design-interview-questions/",)),
    TheorySource(InterviewBitScraper("Machine Learning"), ("https://www.interviewbit.com/machine-learning-interview-questions/",)),
    TheorySource(InterviewBitScraper("Computer Networks"), ("https://www.interviewbit.com/networking-interview-questions/",)),
    TheorySource(GeeksForGeeksScraper("Cloud Computing"), ("https://www.geeksforgeeks.org/cloud-computing-interview-questions/",)),
    TheorySource(InterviewBitScraper("Operating Systems"), ("https://www.interviewbit.com/operating-system-interview-questions/",)),
]

THEORY_SOURCES: list[TheorySource] = [*JAVATPOINT_SOURCES, *OTHER_THEORY_SOURCES]


def _provider_balanced_order(sources: Sequence[TheorySource], daily_offset: int) -> List[TheorySource]:
    groups: dict[str, list[TheorySource]] = {}
    for source in sources:
        groups.setdefault(source.scraper.source_name, []).append(source)

    rotated: list[list[TheorySource]] = []
    for provider, group in groups.items():
        offset = (daily_offset + sum(ord(char) for char in provider)) % len(group)
        rotated.append(group[offset:] + group[:offset])

    ordered: list[TheorySource] = []
    for index in range(max((len(group) for group in rotated), default=0)):
        for group in rotated:
            if index < len(group):
                ordered.append(group[index])
    return ordered


def fetch_theory_questions(limit: int = 8) -> List[Dict]:
    """Return a daily rotating, provider- and topic-balanced theory batch."""
    if limit <= 0:
        return []

    daily_offset = date.today().toordinal()
    source_order = _provider_balanced_order(THEORY_SOURCES, daily_offset)
    target_batches = min(len(THEORY_SOURCES), max(1, min(limit, 12)))
    unavailable_hosts: set[str] = set()
    batches: list[list[Dict]] = []
    for source in source_order:
        if all(urlparse(url).netloc.lower() in unavailable_hosts for url in source.urls):
            continue
        batch = source.scrape(unavailable_hosts)
        print(f"Extracted {len(batch)} {source.scraper.category} questions from {source.scraper.source_name}.")
        if batch:
            batches.append(batch)
        if len(batches) >= target_batches:
            break

    selected: list[Dict] = []
    round_index = 0
    while len(selected) < max(0, limit):
        made_progress = False
        for batch in batches:
            if not batch or round_index >= len(batch):
                continue
            selected.append(batch[(daily_offset + round_index) % len(batch)])
            made_progress = True
            if len(selected) >= limit:
                break
        if not made_progress:
            break
        round_index += 1
    return selected


def ingest_theory_question(question: Dict, api_base: str) -> bool:
    try:
        response = requests.post(f"{api_base}/api/ingest", json={
            "raw_text": question["raw_text"],
            "source": question["source"],
            "tags": question["tags"],
            "hints": question["hints"],
            "source_url": question["source_url"],
            "external_id": question["external_id"],
            "source_metadata": question["source_metadata"],
        }, timeout=15)
        if response.status_code in {200, 201}:
            print(f"Queued theory question '{question['title']}' -> {response.json().get('questionId')}")
            return True
        print(f"Ingestion failed for '{question['title']}': HTTP {response.status_code} {response.text}")
    except requests.RequestException as exc:
        print(f"Feeder API unavailable for '{question['title']}': {exc}")
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape theory interview pages into the staged AI pipeline.")
    parser.add_argument("limit", nargs="?", type=int, default=8, help="Total source-balanced questions to queue")
    args = parser.parse_args()

    env_path = os.path.join(os.path.dirname(__file__), "..", "backend", ".env")
    load_dotenv(env_path)
    api_base = os.getenv("FEEDER_API_URL", "http://localhost:3000").rstrip("/")
    questions = fetch_theory_questions(args.limit)
    accepted = sum(1 for question in questions if ingest_theory_question(question, api_base))
    print(f"Theory feeder complete: {accepted}/{len(questions)} accepted for background processing.")


if __name__ == "__main__":
    main()
