"""Deterministic HTML-to-Markdown normalization for scraper output.

The LLM pipeline should never receive a page's scripts, styles, or navigation
markup.  This module keeps the problem structure that matters (headings,
lists, code, and tables) while using BeautifulSoup as the only HTML parser.
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup, NavigableString, Tag


_BLOCK_TAGS = {
    "article", "aside", "blockquote", "div", "footer", "header", "main",
    "nav", "p", "section",
}


def _render(node: object, list_depth: int = 0) -> str:
    if isinstance(node, NavigableString):
        return str(node)
    if not isinstance(node, Tag):
        return ""

    name = node.name.lower()
    if name in {"script", "style", "noscript", "svg", "canvas", "template"}:
        return ""
    if name == "br":
        return "\n"
    if name == "pre":
        code = node.get_text("", strip=False).strip("\n")
        return f"\n```\n{code}\n```\n"
    if name == "code":
        return f"`{node.get_text('', strip=False).strip()}`"
    if name in {"ul", "ol"}:
        return "\n" + "".join(_render(child, list_depth + 1) for child in node.children) + "\n"
    if name == "li":
        body = "".join(_render(child, list_depth) for child in node.children).strip()
        prefix = "  " * max(0, list_depth - 1) + "- "
        return f"{prefix}{body}\n"
    if name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
        level = int(name[1])
        body = "".join(_render(child, list_depth) for child in node.children).strip()
        return f"\n{'#' * level} {body}\n"
    if name == "tr":
        cells = [cell.get_text(" ", strip=True) for cell in node.find_all(["th", "td"], recursive=False)]
        return (" | ".join(cells) + "\n") if cells else ""
    if name in {"th", "td"}:
        return node.get_text(" ", strip=True)

    body = "".join(_render(child, list_depth) for child in node.children)
    if name in _BLOCK_TAGS:
        return f"\n{body.strip()}\n"
    return body


def html_to_markdown(raw_html: str | None) -> str:
    """Convert scraped HTML into compact, readable Markdown-like text."""
    if not raw_html:
        return ""

    soup = BeautifulSoup(raw_html, "html.parser")
    rendered = _render(soup)

    # Normalize noisy page whitespace without changing fenced sample/code lines.
    output: list[str] = []
    in_fence = False
    for line in rendered.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if line.strip() == "```":
            in_fence = not in_fence
            output.append("```")
        elif in_fence:
            output.append(line.rstrip())
        else:
            output.append(re.sub(r"[ \t\f\v]+", " ", line).strip())

    normalized = "\n".join(output)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()

