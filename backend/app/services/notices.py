import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup

from app.core.config import settings

logger = logging.getLogger(__name__)
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}
CATEGORY_KEYWORDS = {
    "학사": ("학사", "수강", "등록", "휴학", "복학", "졸업", "성적", "학점", "교환학생"),
    "장학": ("장학", "학자금", "근로학생"),
    "취업": ("취업", "채용", "인턴", "현장실습", "진로"),
    "행사": ("행사", "축제", "특강", "포럼", "세미나", "학술", "대회", "공모전", "교육", "프로그램"),
}


def _text(value) -> str:
    return " ".join(value.get_text(" ", strip=True).split()) if value else ""


def _category(title: str, department: str) -> str:
    value = f"{title} {department}"
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(keyword in value for keyword in keywords):
            return category
    return "기타"


def _with_token(url: str) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["hasToken"] = "1"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


class NoticeService:
    _list_cache: dict[str, tuple[datetime, list[dict]]] = {}
    _detail_cache: dict[str, tuple[datetime, dict]] = {}
    _lock = asyncio.Lock()

    def parse_list(self, html: str, base_url: str) -> list[dict]:
        soup = BeautifulSoup(html, "html.parser")
        table = next((table for table in soup.select("table") if "제목" in _text(table) and "작성일" in _text(table)), None)
        if not table:
            raise ValueError("공지 목록 테이블을 찾지 못했습니다.")
        notices = []
        now = datetime.now().date()
        for row in table.select("tbody tr, tr"):
            cells = row.select("td")
            if len(cells) < 4:
                continue
            link = row.select_one('a[href*="parm_bod_uid"]')
            if not link:
                continue
            href = urljoin(base_url, link.get("href", ""))
            id_match = re.search(r"parm_bod_uid=(\d+)", href)
            if not id_match:
                continue
            date_text = _text(cells[3])
            try:
                written = datetime.strptime(date_text, "%y-%m-%d").date()
                iso_date = written.isoformat()
            except ValueError:
                written = None
                iso_date = date_text
            icon_text = " ".join(img.get("alt", "") for img in row.select("img"))
            number = _text(cells[0])
            title = _text(link)
            department = _text(cells[2])
            notices.append({
                "id": id_match.group(1),
                "title": title,
                "date": iso_date,
                "department": department,
                "category": _category(title, department),
                "url": _with_token(href),
                "isImportant": "공지" in icon_text or not number.isdigit(),
                "isNew": "새" in icon_text or bool(written and now - written <= timedelta(days=7)),
            })
        if not notices:
            raise ValueError("공지 목록에서 유효한 게시글을 찾지 못했습니다.")
        return notices

    def parse_detail(self, html: str, source_url: str, notice_id: str) -> dict:
        soup = BeautifulSoup(html, "html.parser")
        view = soup.select_one(".bbs_view")
        if not view:
            raise ValueError("공지 상세 내용을 찾지 못했습니다.")
        subject = view.select_one(".bbs_info .subject dd")
        metadata = {}
        for dl in view.select(".bbs_info dl"):
            for term in dl.select("dt"):
                value = term.find_next_sibling("dd")
                if value:
                    metadata[_text(term)] = _text(value)
        title = _text(subject)
        department = metadata.get("작성자", "")
        date_value = metadata.get("일시", "")
        content_node = view.select_one(".bbs_con")
        content = content_node.get_text("\n", strip=True) if content_node else ""
        content = "\n".join(line.strip() for line in content.splitlines() if line.strip())[:50000]
        attachments = []
        for link in view.select('.bbs_info .file a[href*="com_download"]'):
            name = _text(link)
            href = urljoin(source_url, link.get("href", ""))
            if name and href and not any(item["url"] == href for item in attachments):
                attachments.append({"name": name, "url": href})
        return {
            "id": notice_id,
            "title": title,
            "date": date_value[:10],
            "department": department,
            "category": _category(title, department),
            "content": content,
            "attachments": attachments,
            "url": _with_token(source_url),
            "contact": metadata.get("연락처", ""),
            "email": metadata.get("이메일", ""),
        }

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers=HEADERS) as client:
                response = await client.request(method, url, **kwargs)
                response.raise_for_status()
                return response
        except httpx.ConnectError as error:
            if "CERTIFICATE_VERIFY_FAILED" not in str(error):
                raise
            logger.warning("KMU notice TLS verification failed; retrying only this request without verification")
            async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers=HEADERS, verify=False) as client:
                response = await client.request(method, url, **kwargs)
                response.raise_for_status()
                return response

    async def _fetch_notices(self) -> list[dict]:
        response = await self._request("GET", settings.kmu_notice_url)
        response.encoding = "utf-8"
        pages = [response.text]
        soup = BeautifulSoup(response.text, "html.parser")
        page_links = {}
        for link in soup.select("a[href]"):
            label = _text(link)
            if label.isdigit():
                page_links[int(label)] = urljoin(str(response.url), link.get("href", ""))
        for page_number in range(2, max(2, settings.kmu_notice_pages + 1)):
            page_url = page_links.get(page_number)
            if not page_url:
                break
            page_response = await self._request("GET", page_url)
            page_response.encoding = "utf-8"
            pages.append(page_response.text)
        unique = {}
        for html in pages:
            for notice in self.parse_list(html, str(response.url)):
                unique.setdefault(notice["id"], notice)
        rows = list(unique.values())
        rows.sort(key=lambda row: (not row["isImportant"], row["date"]), reverse=False)
        important = sorted((row for row in rows if row["isImportant"]), key=lambda row: row["date"], reverse=True)
        regular = sorted((row for row in rows if not row["isImportant"]), key=lambda row: row["date"], reverse=True)
        logger.info("notice crawl pages=%s notices=%s", len(pages), len(rows))
        return important + regular

    async def list(self, query: str = "", category: str = "전체", page: int = 1, limit: int = 20, force: bool = False) -> dict:
        async with self._lock:
            cached = self._list_cache.get("")
            fresh = cached and datetime.now(timezone.utc) - cached[0] < timedelta(seconds=settings.kmu_notice_cache_seconds)
            if force or not fresh:
                self._list_cache[""] = (datetime.now(timezone.utc), await self._fetch_notices())
            fetched_at, rows = self._list_cache[""]
        keyword = query.strip().casefold()
        if keyword:
            rows = [
                row for row in rows
                if keyword in " ".join((
                    row.get("title", ""),
                    row.get("department", ""),
                    row.get("category", ""),
                    self._detail_cache.get(row["id"], (None, {}))[1].get("content", ""),
                )).casefold()
            ]
        filtered = rows if category == "전체" else [row for row in rows if row["category"] == category]
        start = (page - 1) * limit
        return {
            "items": filtered[start:start + limit],
            "page": page,
            "limit": limit,
            "total": len(filtered),
            "hasMore": start + limit < len(filtered),
            "fetchedAt": fetched_at.isoformat(),
        }

    async def detail(self, notice_id: str, force: bool = False) -> dict:
        cached = self._detail_cache.get(notice_id)
        fresh = cached and datetime.now(timezone.utc) - cached[0] < timedelta(seconds=settings.kmu_notice_cache_seconds)
        if fresh and not force:
            return cached[1]
        source_url = f"{settings.kmu_notice_url}&cmd=2&parm_bod_uid={notice_id}"
        source_url = _with_token(source_url)
        response = await self._request("GET", source_url)
        response.encoding = "utf-8"
        result = self.parse_detail(response.text, str(response.url), notice_id)
        self._detail_cache[notice_id] = (datetime.now(timezone.utc), result)
        return result

    async def refresh(self) -> dict:
        self._list_cache.clear()
        self._detail_cache.clear()
        return await self.list(force=True)


notice_service = NoticeService()
