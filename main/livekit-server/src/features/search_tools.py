"""
Web Search tool for Cheeko AI Assistant.
Prefers Firecrawl search when configured, with DDGS and HTML fallback.
"""

import asyncio
import logging
import os
import re
import warnings
from html import unescape

import aiohttp
from livekit.agents import RunContext, function_tool

logger = logging.getLogger("search_tools")

TAVILY_SEARCH_URL = "https://api.tavily.com/search"
FIRECRAWL_SEARCH_URL = "https://api.firecrawl.dev/v2/search"


def _get_tavily_api_key() -> str:
    """Resolve Tavily API key from environment."""
    return os.getenv("TAVILY_API_KEY", "").strip()


def _build_tavily_payload(query: str) -> dict:
    """Build a Tavily search request tuned for current-info lookups."""
    query_lower = query.lower()
    is_news_like = any(
        token in query_lower
        for token in ["latest", "today", "current", "currently", "right now", "news", "score", "scores", "match", "ipl"]
    )

    payload = {
        "query": query,
        "search_depth": "basic",
        "max_results": 3,
        "include_answer": False,
        "include_raw_content": False,
        "include_images": False,
        "include_favicon": False,
        "include_usage": True,
        "topic": "news" if is_news_like else "general",
    }

    if is_news_like:
        payload["time_range"] = "day"

    return payload


def _format_tavily_results(items: list[dict]) -> list[str]:
    """Format Tavily results into short tool output blocks."""
    formatted: list[str] = []

    for item in items[:3]:
        title = (item.get("title") or "").strip()
        content = (item.get("content") or "").strip()
        url = (item.get("url") or "").strip()
        score = item.get("score")

        if not title and not content and not url:
            continue

        snippet = re.sub(r"\s+", " ", content)[:280].strip() if content else "No snippet available."
        score_line = f"\nScore: {score:.2f}" if isinstance(score, (int, float)) else ""

        formatted.append(
            f"Title: {title or 'Untitled'}\n"
            f"Snippet: {snippet}\n"
            f"URL: {url or 'No URL available.'}{score_line}"
        )

    return formatted


async def _search_with_tavily(query: str) -> list[str]:
    """Search using Tavily's official search API."""
    api_key = _get_tavily_api_key()
    if not api_key:
        logger.info("[WEB-SEARCH] TAVILY_API_KEY not set, skipping Tavily")
        return []

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    timeout = aiohttp.ClientTimeout(total=20)
    payload = _build_tavily_payload(query)

    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        async with session.post(TAVILY_SEARCH_URL, json=payload) as response:
            response.raise_for_status()
            data = await response.json()

    results = _format_tavily_results(data.get("results", []))
    if results:
        logger.info(f"[WEB-SEARCH] Tavily returned {len(results)} results")
    else:
        logger.warning("[WEB-SEARCH] Tavily returned no usable results")
    return results


def _get_firecrawl_api_key() -> str:
    """Resolve Firecrawl API key from environment."""
    return os.getenv("FIRECRAWL_API_KEY", "").strip() or os.getenv("FIRECRAWL_API_TOKEN", "").strip()


def _build_firecrawl_payload(query: str) -> dict:
    """Build Firecrawl search payload with light recency hints for live queries."""
    payload = {
        "query": query,
        "limit": 3,
        "sources": ["web"],
        "timeout": 15000,
        "scrapeOptions": {
            "formats": ["markdown"],
            "onlyMainContent": True,
        },
    }

    query_lower = query.lower()
    if any(token in query_lower for token in ["latest", "today", "current", "currently", "right now", "live"]):
        payload["tbs"] = "sbd:1,qdr:d"

    return payload


def _format_firecrawl_results(items: list[dict]) -> list[str]:
    """Format Firecrawl results into short tool output blocks."""
    formatted: list[str] = []

    for item in items[:3]:
        title = (item.get("title") or "").strip()
        description = (item.get("description") or "").strip()
        url = (item.get("url") or "").strip()
        markdown = (item.get("markdown") or "").strip()

        summary = description
        if not summary and markdown:
            summary = re.sub(r"\s+", " ", markdown)
            summary = summary[:280].strip()

        if not title and not summary and not url:
            continue

        formatted.append(
            f"Title: {title or 'Untitled'}\n"
            f"Snippet: {summary or 'No snippet available.'}\n"
            f"URL: {url or 'No URL available.'}"
        )

    return formatted


async def _search_with_firecrawl(query: str) -> list[str]:
    """Search using Firecrawl's official search API."""
    api_key = _get_firecrawl_api_key()
    if not api_key:
        logger.info("[WEB-SEARCH] FIRECRAWL_API_KEY not set, skipping Firecrawl")
        return []

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    timeout = aiohttp.ClientTimeout(total=20)
    payload = _build_firecrawl_payload(query)

    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        async with session.post(FIRECRAWL_SEARCH_URL, json=payload) as response:
            response.raise_for_status()
            data = await response.json()

    items = []
    if isinstance(data.get("data"), dict):
        items = data.get("data", {}).get("web", [])
    elif isinstance(data.get("data"), list):
        items = data.get("data", [])

    results = _format_firecrawl_results(items)
    if results:
        logger.info(f"[WEB-SEARCH] Firecrawl returned {len(results)} results")
    else:
        logger.warning("[WEB-SEARCH] Firecrawl returned no usable results")
    return results


def _extract_html_results(html: str) -> list[str]:
    """Extract up to three title/snippet pairs from DuckDuckGo HTML."""
    results: list[str] = []

    patterns = [
        r'<a[^>]*class="[^"]*result__a[^"]*"[^>]*>(?P<title>.*?)</a>.*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>)(?P<body>.*?)</(?:a|div)>',
        r'<a[^>]*class="[^"]*result-link[^"]*"[^>]*>(?P<title>.*?)</a>.*?<td[^>]*class="result-snippet"[^>]*>(?P<body>.*?)</td>',
    ]

    for pattern in patterns:
        for match in re.finditer(pattern, html, flags=re.IGNORECASE | re.DOTALL):
            title = re.sub(r"<.*?>", "", match.group("title"))
            body = re.sub(r"<.*?>", "", match.group("body"))
            title = unescape(re.sub(r"\s+", " ", title)).strip()
            body = unescape(re.sub(r"\s+", " ", body)).strip()

            if title:
                results.append(
                    f"Title: {title}\nSnippet: {body or 'No snippet available.'}"
                )

            if len(results) >= 3:
                return results

    return results


def _search_with_ddgs_sync(query: str) -> list[str]:
    """Run DDGS synchronously so we can call it in a thread."""
    warnings.filterwarnings(
        "ignore",
        message=r"This package \(`duckduckgo_search`\) has been renamed to `ddgs`!",
        category=RuntimeWarning,
    )
    from duckduckgo_search import DDGS

    backends = ["html", "lite", "auto"]
    for backend in backends:
        try:
            with DDGS() as ddgs:
                search_results = ddgs.text(
                    query,
                    region="wt-wt",
                    safesearch="moderate",
                    backend=backend,
                    max_results=3,
                )
                if search_results:
                    logger.info(f"🔍 [WEB-SEARCH] DDGS returned {len(search_results)} results via backend={backend}")
                    return [
                        f"Title: {item.get('title')}\nSnippet: {item.get('body') or 'No snippet available.'}"
                        for item in search_results[:3]
                    ]
        except Exception as exc:
            logger.warning(f"🔍 [WEB-SEARCH] DDGS backend={backend} failed: {exc}")

    return []


async def _search_with_ddgs(query: str) -> list[str]:
    """Search with DDGS in a worker thread."""
    return await asyncio.to_thread(_search_with_ddgs_sync, query)


async def _search_with_html_fallback(query: str) -> list[str]:
    """Fallback search against DuckDuckGo's HTML endpoint."""
    url = "https://html.duckduckgo.com/html/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept-Encoding": "gzip, deflate",
    }
    timeout = aiohttp.ClientTimeout(total=15)

    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        async with session.post(url, data={"q": query}) as response:
            response.raise_for_status()
            html = await response.text()
            return _extract_html_results(html)


@function_tool
async def search_web(context: RunContext, query: str) -> str:
    """
    Search the web for real-time or current information.

    Use this tool whenever the user asks for weather, current events, recent sports
    scores, up-to-date facts, or anything else that may have changed recently.

    Args:
        query: The search query to look up on the internet.

    Returns:
        A concise summary of the top results to help answer the user.
    """
    logger.info(f"🔍 [WEB-SEARCH] Tool called with query: '{query}'")

    try:
        results = await _search_with_tavily(query)
        if not results:
            results = await _search_with_firecrawl(query)
        if not results:
            results = await _search_with_ddgs(query)
        if not results:
            logger.info("🔍 [WEB-SEARCH] DDGS returned no results, trying HTML fallback")
            results = await _search_with_html_fallback(query)

        if not results:
            logger.warning(f"🔍 [WEB-SEARCH] No results found for query: '{query}'")
            return "No recent search results found."

        combined_results = "\n\n".join(results)
        logger.info("🔍 [WEB-SEARCH] Search completed successfully")
        return combined_results

    except Exception as e:
        logger.error(f"❌ [WEB-SEARCH] Error performing search: {e}")
        return f"Sorry, I ran into an issue while searching the web for {query}."
