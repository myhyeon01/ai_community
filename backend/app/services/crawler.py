from __future__ import annotations

import base64
import hashlib
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup


@dataclass(slots=True)
class KMUBoardPost:
    title: str
    url: str
    source_key: str
    posted_at: date | None
    writer: str
    category_param: str
    has_category: bool


class KMUCrawler:
    """Crawler for KMU notice boards.

    The KMU board renders list rows as table HTML and detail pages under
    `cmd=2&parm_bod_uid=...`. Parsing stays selector-based so the logic maps
    cleanly to the site's current markup.
    """

    EVENT_KEYWORDS = (
        "축제",
        "특강",
        "초청강연",
        "비교과",
        "공모전",
        "세미나",
        "교육",
        "강좌",
        "워크숍",
        "프로그램",
        "모집",
        "대외활동",
        "홍보단",
        "서포터즈",
        "공모",
        "전시",
        "특별전",
        "캠프",
        "청년",
    )
    CATEGORY_PARAM_NAMES = (
        "srchBgpUid",
        "bgp_uid",
        "category",
        "categoryId",
        "cat",
        "parm_bgp_uid",
    )
    EMPTY_CATEGORY_VALUES = {"", "-1", "0", "all", "ALL", "전체"}
    DATE_RE = re.compile(
        r"(?:(?P<year>20\d{2})\s*(?:년|[./-])\s*)?"
        r"(?P<month>\d{1,2})\s*(?:월|[./-])\s*"
        r"(?P<day>\d{1,2})\s*(?:일|\.)?"
    )
    DAY_RANGE_RE = re.compile(r"[~\-–]\s*(?P<day>\d{1,2})\s*(?:일|\.)?")
    TIME_RE = re.compile(r"(?P<hour>\d{1,2})\s*[:：]\s*(?P<minute>\d{2})")
    KOREAN_TIME_RE = re.compile(
        r"(?P<ampm>오전|오후)?\s*(?P<hour>\d{1,2})\s*시(?:\s*(?P<minute>\d{1,2})\s*분)?"
    )

    def __init__(
        self,
        *,
        verify_ssl: bool = False,
        target_year: int | None = None,
        image_ocr: bool = True,
        ocr_timeout: int = 45,
    ):
        self.verify_ssl = verify_ssl
        self.target_year = target_year or datetime.now().year
        self.image_ocr = image_ocr
        self.ocr_timeout = ocr_timeout

    async def fetch_items(self, url: str):
        """Backward-compatible lightweight link fetcher."""
        async with self._client() as client:
            response = await client.get(url)
            response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        items = []
        for link in soup.select("a[href]"):
            title = self._clean(link.get_text(" ", strip=True))
            href = link.get("href", "")
            if title and href:
                items.append(
                    {
                        "title": title,
                        "url": urljoin(str(response.url), href),
                        "source_key": hashlib.sha256(
                            (title + href).encode()
                        ).hexdigest()[:40],
                    }
                )
        return items

    async def fetch_school_events(
        self, url: str, *, pages: int = 1, limit: int = 50
    ) -> list[dict]:
        events: list[dict] = []
        seen: set[str] = set()
        async with self._client() as client:
            for page in range(1, max(1, pages) + 1):
                response = await client.get(self._list_url(url, page))
                response.raise_for_status()
                posts = self.parse_list(response.text, str(response.url))
                for post in posts:
                    if post.source_key in seen:
                        continue
                    seen.add(post.source_key)
                    if not self.should_include_post(post):
                        continue
                    try:
                        detail_response = await client.get(self._detail_url(post.url))
                        detail_response.raise_for_status()
                        event = self.parse_detail(
                            detail_response.text, post, str(detail_response.url)
                        )
                    except httpx.HTTPError:
                        event = self._event_from_post(post, self._detail_url(post.url))
                    events.append(event)
                    if len(events) >= limit:
                        return events
        return events

    def parse_list(self, html: str, source_url: str) -> list[KMUBoardPost]:
        soup = BeautifulSoup(html, "html.parser")
        source_category = self._category_param(source_url)
        source_has_category = self._is_real_category(source_category)
        posts: list[KMUBoardPost] = []
        for row in soup.select("table tbody tr"):
            link = row.select_one('td.subject a[href*="parm_bod_uid"]')
            if not link:
                continue
            href = link.get("href") or ""
            detail_url = urljoin(source_url, href)
            title = self._clean(link.get("title") or link.get_text(" ", strip=True))
            if not title:
                continue
            category_param = self._category_param(detail_url) or source_category
            uid = self._query_value(detail_url, "parm_bod_uid")
            mnu_uid = self._mnu_uid(detail_url) or self._mnu_uid(source_url)
            source_key = f"kmu:{mnu_uid}:{uid}" if uid else self._source_key(title, detail_url)
            posts.append(
                KMUBoardPost(
                    title=title,
                    url=detail_url,
                    source_key=source_key,
                    posted_at=self._parse_posted_date(
                        self._cell_text(row, "td.date")
                    ),
                    writer=self._cell_text(row, "td.writer"),
                    category_param=category_param,
                    has_category=source_has_category
                    or self._is_real_category(category_param),
                )
            )
        return posts

    def should_include_post(self, post: KMUBoardPost) -> bool:
        if not self._is_target_year_post(post):
            return False
        if post.has_category:
            return True
        return any(keyword in post.title for keyword in self.EVENT_KEYWORDS)

    def _is_target_year_post(self, post: KMUBoardPost) -> bool:
        return bool(post.posted_at and post.posted_at.year == self.target_year)

    def parse_detail(self, html: str, post: KMUBoardPost, detail_url: str) -> dict:
        soup = BeautifulSoup(html, "html.parser")
        view = soup.select_one(".bbs_view")
        if not view:
            return self._event_from_post(post, detail_url)

        info = view.select_one(".bbs_info")
        content_node = view.select_one(".bbs_con")
        content_text = self._text_with_lines(content_node) if content_node else ""
        text_deadline = self._extract_apply_deadline(content_text, post.posted_at)
        image_text = (
            self._extract_image_text(content_node, detail_url)
            if not content_text or not text_deadline
            else ""
        )
        detail_text = "\n".join(text for text in (content_text, image_text) if text)
        title = self._field_value(info, "제목") or post.title
        writer = self._field_value(info, "작성자") or post.writer
        starts_at, ends_at = self._extract_event_range(detail_text, post.posted_at)
        apply_deadline = text_deadline or self._extract_apply_deadline(
            detail_text, post.posted_at
        )
        location = self._extract_location(detail_text)
        combined = f"{title}\n{detail_text}"
        category = self._category_from_text(combined)
        public_detail_url = self._detail_url(detail_url)
        apply_url = self._extract_apply_url(content_node, public_detail_url)

        return {
            "title": title[:250],
            "summary": self._readable_summary(detail_text or post.title),
            "starts_at": starts_at,
            "ends_at": ends_at,
            "apply_deadline": apply_deadline,
            "category": category,
            "department": writer[:100] if writer else "계명대학교",
            "location": location[:150] if location else "계명대학교",
            "interests": self._interests_from_text(combined),
            "url": public_detail_url,
            "apply_url": apply_url or public_detail_url,
            "source_key": post.source_key,
        }

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=20,
            follow_redirects=True,
            verify=self.verify_ssl,
            trust_env=False,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 KMU-Smart-Scheduler/0.1 "
                    "(compatible; event crawler)"
                )
            },
        )

    def _list_url(self, url: str, page: int) -> str:
        return self._set_query(
            url, {"cmd": "1", "mnu_uid": self._mnu_uid(url), "pageNo": str(page)}
        )

    def _detail_url(self, url: str) -> str:
        return self._set_query(
            url, {"cmd": "2", "hasToken": "1", "mnu_uid": self._mnu_uid(url)}
        )

    def _set_query(self, url: str, updates: dict[str, str]) -> str:
        parts = urlsplit(url)
        query = parse_qs(parts.query, keep_blank_values=True)
        for key, value in updates.items():
            query[key] = [value]
        path = parts.path or "/uni/main/page.jsp"
        return urlunsplit(
            (
                parts.scheme or "https",
                parts.netloc or "www.kmu.ac.kr",
                path,
                urlencode(query, doseq=True),
                parts.fragment,
            )
        )

    def _source_key(self, title: str, url: str) -> str:
        return hashlib.sha256((title + url).encode()).hexdigest()[:40]

    def _query_value(self, url: str, key: str) -> str:
        values = parse_qs(urlsplit(url).query, keep_blank_values=True).get(key)
        return values[0].strip() if values else ""

    def _mnu_uid(self, url: str) -> str:
        return self._query_value(url, "mnu_uid") or "143"

    def _category_param(self, url: str) -> str:
        for name in self.CATEGORY_PARAM_NAMES:
            value = self._query_value(url, name)
            if value:
                return value
        return ""

    def _is_real_category(self, value: str) -> bool:
        return bool(value) and value not in self.EMPTY_CATEGORY_VALUES

    def _cell_text(self, row, selector: str) -> str:
        node = row.select_one(selector)
        return self._clean(node.get_text(" ", strip=True)) if node else ""

    def _field_value(self, info, label: str) -> str:
        if not info:
            return ""
        for dl in info.select("dl"):
            children = [child for child in dl.children if getattr(child, "name", None)]
            for index, child in enumerate(children):
                if child.name != "dt":
                    continue
                if self._clean(child.get_text(" ", strip=True)) != label:
                    continue
                for sibling in children[index + 1 :]:
                    if sibling.name == "dd":
                        return self._clean(sibling.get_text(" ", strip=True))
                    if sibling.name == "dt":
                        break
        return ""

    def _text_with_lines(self, node) -> str:
        if not node:
            return ""
        lines: list[str] = []
        for block in node.select("p, li, tr"):
            text = self._clean(block.get_text(" ", strip=True))
            if text and text not in lines:
                lines.append(text)
        if not lines:
            lines = [
                self._clean(line)
                for line in node.get_text("\n", strip=True).splitlines()
                if self._clean(line)
            ]
        return "\n".join(lines)

    def _extract_image_text(self, node, detail_url: str = "") -> str:
        if not self.image_ocr or not node:
            return ""
        lines: list[str] = []
        for image in node.select("img[src]")[:2]:
            src = (image.get("src") or "").strip()
            if src.startswith("data:image/"):
                text = self._ocr_data_image(src)
            else:
                text = self._ocr_remote_image(urljoin(detail_url, src))
            for line in text.splitlines():
                cleaned = self._clean(line)
                if cleaned and cleaned not in lines:
                    lines.append(cleaned)
        return "\n".join(lines)

    def _ocr_data_image(self, src: str) -> str:
        match = re.match(r"data:image/(?P<ext>[a-zA-Z0-9.+-]+);base64,(?P<data>.+)", src)
        if not match:
            return ""
        script = self._ocr_script_path()
        if not script.exists():
            return ""
        ext = match.group("ext").split("+", 1)[0].lower()
        suffix = f".{ext if ext in {'jpg', 'jpeg', 'png', 'webp'} else 'png'}"
        temp_path = ""
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as image_file:
                temp_path = image_file.name
                image_file.write(base64.b64decode(match.group("data"), validate=False))
            result = subprocess.run(
                ["node", str(script), temp_path],
                cwd=str(script.parent.parent),
                capture_output=True,
                text=True,
                timeout=self.ocr_timeout,
                check=False,
            )
        except (OSError, ValueError, subprocess.SubprocessError):
            return ""
        finally:
            if temp_path:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass
        if result.returncode != 0:
            return ""
        return result.stdout

    def _ocr_remote_image(self, url: str) -> str:
        if not url:
            return ""
        script = self._ocr_script_path()
        if not script.exists():
            return ""
        temp_path = ""
        try:
            with httpx.Client(
                timeout=20,
                follow_redirects=True,
                verify=self.verify_ssl,
                trust_env=False,
                headers={"User-Agent": "Mozilla/5.0 KMU-Smart-Scheduler/0.1"},
            ) as client:
                response = client.get(url)
                response.raise_for_status()
                suffix = Path(urlsplit(str(response.url)).path).suffix or ".png"
                with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as image_file:
                    temp_path = image_file.name
                    image_file.write(response.content)
            result = subprocess.run(
                ["node", str(script), temp_path],
                cwd=str(script.parent.parent),
                capture_output=True,
                text=True,
                timeout=self.ocr_timeout,
                check=False,
            )
        except (OSError, ValueError, subprocess.SubprocessError, httpx.HTTPError):
            return ""
        finally:
            if temp_path:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass
        if result.returncode != 0:
            return ""
        return result.stdout

    def _ocr_script_path(self) -> Path:
        return Path(__file__).resolve().parents[3] / "web" / "scripts" / "ocr-image.mjs"

    def _extract_apply_url(self, node, detail_url: str) -> str:
        if not node:
            return ""
        for link in node.select("a[href]"):
            href = (link.get("href") or "").strip()
            if not href or href.startswith("#") or href.lower().startswith("javascript:"):
                continue
            text = self._clean(link.get_text(" ", strip=True))
            absolute = urljoin(detail_url, href)
            if re.search(r"(신청|접수|지원|바로가기|참가|등록)", text):
                return absolute
        for link in node.select("a[href]"):
            href = (link.get("href") or "").strip()
            absolute = urljoin(detail_url, href)
            if "kmu.ac.kr/uni/main/page.jsp" not in absolute:
                return absolute
        return ""

    def _clean(self, value: str) -> str:
        return re.sub(r"\s+", " ", (value or "").replace("\xa0", " ")).strip()

    def _readable_summary(self, text: str) -> str:
        lines: list[str] = []
        for raw in text.splitlines():
            line = re.sub(r"[☞☜]+", " ", raw)
            line = self._clean(line)
            if not line or line == "신청 바로가기":
                continue
            line = re.sub(r"\s+([①-⑳])", r"\n\1", line)
            line = re.sub(r"\s+(\d+\))", r"\n\1", line)
            line = re.sub(r"\s+([가나다라마바사아자차카타파하]\s*\.)", r"\n\1", line)
            line = re.sub(r"\s+(※)", r"\n\1", line)
            for part in line.splitlines():
                cleaned = self._clean(part)
                if cleaned and cleaned not in lines:
                    lines.append(cleaned)
        return "\n".join(lines)[:1200]

    def _parse_posted_date(self, value: str) -> date | None:
        match = re.search(r"(?P<yy>\d{2})-(?P<month>\d{1,2})-(?P<day>\d{1,2})", value)
        if not match:
            return None
        yy = int(match.group("yy"))
        year = 2000 + yy if yy < 70 else 1900 + yy
        return date(year, int(match.group("month")), int(match.group("day")))

    def _event_from_post(self, post: KMUBoardPost, url: str | None = None) -> dict:
        day = post.posted_at or datetime.utcnow().date()
        starts_at = datetime.combine(day, time(9, 0))
        ends_at = starts_at + timedelta(hours=1)
        public_url = self._detail_url(url or post.url)
        return {
            "title": post.title[:250],
            "summary": post.title,
            "starts_at": starts_at,
            "ends_at": ends_at,
            "apply_deadline": None,
            "category": self._category_from_text(post.title),
            "department": post.writer[:100] if post.writer else "계명대학교",
            "location": "계명대학교",
            "interests": self._interests_from_text(post.title),
            "url": public_url,
            "apply_url": public_url,
            "source_key": post.source_key,
        }

    def _extract_event_range(
        self, text: str, posted_at: date | None
    ) -> tuple[datetime, datetime]:
        base_year = (posted_at or datetime.utcnow().date()).year
        search_text = self._date_search_text(text)
        start_date, end_date = self._extract_dates(search_text, base_year)
        found_event_date = start_date is not None
        if not start_date:
            start_date = posted_at or datetime.utcnow().date()
        if not end_date:
            end_date = start_date
        start_time, end_time = (
            self._extract_times(search_text or text) if found_event_date else (None, None)
        )
        starts_at = datetime.combine(start_date, start_time or time(9, 0))
        if end_time:
            ends_at = datetime.combine(end_date, end_time)
        else:
            ends_at = starts_at + timedelta(hours=2)
        if ends_at <= starts_at:
            ends_at = starts_at + timedelta(hours=2)
        return starts_at, ends_at

    def _extract_apply_deadline(
        self, text: str, posted_at: date | None
    ) -> datetime | None:
        base_year = (posted_at or datetime.utcnow().date()).year
        lines = text.splitlines()
        snippets = []
        deadline_label = re.compile(
            r"((신청|접수|모집)\s*(기간|마감|기한|일시)|((원서|서류)\s*)제출\s*(기간|마감|기한|일시)?)"
        )
        for index, line in enumerate(lines):
            if deadline_label.search(line):
                if self.DATE_RE.search(line):
                    snippets.append(line)
                else:
                    snippets.append(" ".join(lines[index : index + 6]))
        if not snippets:
            return None
        snippet = " ".join(snippets[:3])
        date_matches = list(self.DATE_RE.finditer(snippet))
        deadline_date = None
        for match in reversed(date_matches):
            deadline_date = self._date_from_match(match, base_year)
            if deadline_date:
                break
        if not deadline_date:
            return None
        time_values = self._time_values(snippet)
        deadline_time = time_values[-1] if time_values else time(23, 59, 59)
        return datetime.combine(deadline_date, deadline_time)

    def _date_search_text(self, text: str) -> str:
        lines = [
            line
            for line in text.splitlines()
            if re.search(r"(일시|일자|날짜|기간|일정|교육일|운영일|행사일|시간)", line)
        ]
        return " ".join(lines[:5]) or self._clean(text)[:1500]

    def _extract_dates(
        self, text: str, base_year: int
    ) -> tuple[date | None, date | None]:
        first = None
        start = None
        for match in self.DATE_RE.finditer(text):
            start = self._date_from_match(match, base_year)
            if start:
                first = match
                break
        if not first or not start:
            return None, None
        tail = text[first.end() : first.end() + 120]
        for second in self.DATE_RE.finditer(tail):
            end = self._date_from_match(second, start.year)
            if end:
                return start, end
        day_only = self.DAY_RANGE_RE.search(tail)
        if day_only:
            try:
                return start, date(start.year, start.month, int(day_only.group("day")))
            except ValueError:
                return start, start
        return start, start

    def _date_from_match(self, match: re.Match, base_year: int) -> date | None:
        year = int(match.group("year") or base_year)
        try:
            return date(year, int(match.group("month")), int(match.group("day")))
        except ValueError:
            return None

    def _extract_times(self, text: str) -> tuple[time | None, time | None]:
        values = self._time_values(text)
        if not values:
            return None, None
        first = values[0]
        second = values[1] if len(values) > 1 else None
        return first, second

    def _time_values(self, text: str) -> list[time]:
        values: list[tuple[int, time]] = []
        for match in self.TIME_RE.finditer(text):
            values.append((match.start(), self._time_from_match(match)))
        for match in self.KOREAN_TIME_RE.finditer(text):
            values.append((match.start(), self._time_from_korean_match(match)))
        return [value for _, value in sorted(values, key=lambda item: item[0])]

    def _time_from_match(self, match: re.Match) -> time:
        hour = max(0, min(23, int(match.group("hour"))))
        minute = max(0, min(59, int(match.group("minute"))))
        return time(hour, minute)

    def _time_from_korean_match(self, match: re.Match) -> time:
        hour = int(match.group("hour"))
        if match.group("ampm") == "오후" and hour < 12:
            hour += 12
        if match.group("ampm") == "오전" and hour == 12:
            hour = 0
        minute = int(match.group("minute") or 0)
        return time(max(0, min(23, hour)), max(0, min(59, minute)))

    def _extract_location(self, text: str) -> str:
        for line in text.splitlines():
            if not re.search(r"(장소|교육장|행사장|강의실)", line):
                continue
            value = re.sub(r"^.*?(?:장소|교육장|행사장|강의실)\s*[:：]?\s*", "", line)
            value = re.split(
                r"\s+(?:날짜|일시|시간|대상|문의|신청|접수|모집)\s*[:：]?",
                value,
                maxsplit=1,
            )[0]
            cleaned = self._clean(value)
            if cleaned:
                return cleaned
        return ""

    def _category_from_text(self, text: str) -> str:
        if "축제" in text:
            return "축제"
        if "공모전" in text:
            return "공모전"
        if "비교과" in text:
            return "비교과"
        if "전시" in text or "특별전" in text:
            return "문화"
        if (
            "교육" in text
            or "강좌" in text
            or "워크숍" in text
            or "프로그램" in text
        ):
            return "교육"
        if "초청강연" in text or "특강" in text or "세미나" in text:
            return "특강"
        return "event"

    def _interests_from_text(self, text: str) -> str:
        mapping = {
            "AI": "ai",
            "인공지능": "ai",
            "취업": "career",
            "직무": "career",
            "공모전": "contest",
            "공모": "contest",
            "대외활동": "contest",
            "서포터즈": "contest",
            "홍보단": "contest",
            "창업": "startup",
            "문화": "culture",
            "축제": "culture",
            "전시": "culture",
            "특별전": "culture",
            "봉사": "volunteer",
            "글로벌": "global",
            "교환학생": "global",
            "교육": "education",
            "학습": "education",
            "강좌": "education",
            "워크숍": "education",
            "프로그램": "education",
        }
        tags = [tag for keyword, tag in mapping.items() if keyword in text]
        return ",".join(dict.fromkeys(tags))
