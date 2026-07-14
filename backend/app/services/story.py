from __future__ import annotations

import hashlib
import html
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit, urlunsplit

import httpx
from bs4 import BeautifulSoup


@dataclass(slots=True)
class StoryProgram:
    title: str
    url: str
    source_key: str
    list_text: str


class StoryPlusCrawler:
    DATE_RE = re.compile(
        r"(?:(?P<year>20\d{2})\s*(?:년|[./-])\s*)?"
        r"(?P<month>\d{1,2})\s*(?:월|[./-])\s*"
        r"(?P<day>\d{1,2})\s*(?:일|\.)?"
    )
    TIME_RE = re.compile(r"(?P<hour>\d{1,2})\s*[:：]\s*(?P<minute>\d{2})")
    DETAIL_HINT_RE = re.compile(r"(EpMng010PD\.do|gate\.do|GATE_CODE)", re.I)
    DETAIL_PATH_RE = re.compile(r"(/(?:user/)?Ep/EpMng010PD\.do[^'\"\s)]*|/gate\.do[^'\"\s)]*)", re.I)

    def __init__(
        self,
        *,
        session_cookie: str = "",
        verify_ssl: bool = False,
        target_year: int | None = None,
    ):
        self.session_cookie = session_cookie.strip()
        self.verify_ssl = verify_ssl
        self.target_year = target_year or datetime.now().year

    async def fetch_school_events(
        self, url: str, *, pages: int = 1, limit: int = 50
    ) -> list[dict]:
        events: list[dict] = []
        seen: set[str] = set()
        async with self._client() as client:
            for page in range(1, max(1, pages) + 1):
                response = await client.get(self._list_url(url, page))
                if self._requires_login(response):
                    return events
                response.raise_for_status()
                programs = self.parse_list(response.text, str(response.url))
                for program in programs:
                    if program.source_key in seen:
                        continue
                    seen.add(program.source_key)
                    event = self._event_from_text(program, program.list_text)
                    try:
                        detail_response = await client.get(program.url)
                        if not self._requires_login(detail_response):
                            detail_response.raise_for_status()
                            event = self.parse_detail(
                                detail_response.text, program, str(detail_response.url)
                            )
                    except httpx.HTTPError:
                        pass
                    if not self._is_target_year_event(event):
                        continue
                    events.append(event)
                    if len(events) >= limit:
                        return events
        return events

    def parse_list(self, html_text: str, source_url: str) -> list[StoryProgram]:
        soup = BeautifulSoup(html_text, "html.parser")
        programs: list[StoryProgram] = []
        seen: set[str] = set()
        for link in soup.select("a[href], a[onclick]"):
            detail_url = self._detail_url_from_link(link, source_url)
            if not detail_url:
                continue
            container = self._program_container(link)
            list_text = self._text_with_lines(container)
            title = self._title_from_link(link, list_text)
            if not title:
                continue
            source_key = self._source_key(title, detail_url)
            if source_key in seen:
                continue
            seen.add(source_key)
            programs.append(
                StoryProgram(
                    title=title,
                    url=detail_url,
                    source_key=source_key,
                    list_text=list_text,
                )
            )
        return programs

    def parse_detail(self, html_text: str, program: StoryProgram, detail_url: str) -> dict:
        soup = BeautifulSoup(html_text, "html.parser")
        content = self._main_content(soup)
        detail_text = self._text_with_lines(content) or program.list_text
        title = self._title_from_detail(content) or program.title
        return self._event_from_text(
            StoryProgram(
                title=title,
                url=self._public_url(detail_url),
                source_key=program.source_key,
                list_text=detail_text,
            ),
            detail_text,
        )

    def _client(self) -> httpx.AsyncClient:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 KMU-Smart-Scheduler/0.1 "
                "(compatible; storyplus crawler)"
            )
        }
        if self.session_cookie:
            headers["Cookie"] = self.session_cookie
        return httpx.AsyncClient(
            timeout=20,
            follow_redirects=True,
            verify=self.verify_ssl,
            trust_env=False,
            headers=headers,
        )

    def _list_url(self, url: str, page: int) -> str:
        if page <= 1:
            return url
        parts = urlsplit(url)
        query = parse_qs(parts.query, keep_blank_values=True)
        query["pageIndex"] = [str(page)]
        query["page"] = [str(page)]
        return urlunsplit(
            (parts.scheme, parts.netloc, parts.path, urlencode(query, doseq=True), parts.fragment)
        )

    def _requires_login(self, response: httpx.Response) -> bool:
        path = response.url.path.lower()
        text = response.text[:4000]
        return (
            path.endswith("/main.do")
            or "login_form.do" in str(response.url)
            or "sso.kmu.ac.kr" in str(response.url)
            or "로그인" in text and "EpMng010L" not in text
        )

    def _detail_url_from_link(self, link, source_url: str) -> str:
        attrs = [link.get("href") or "", link.get("onclick") or ""]
        for raw in attrs:
            value = html.unescape(raw).strip()
            if not self.DETAIL_HINT_RE.search(value):
                continue
            match = self.DETAIL_PATH_RE.search(value)
            if match:
                return self._public_url(urljoin(source_url, match.group(1)))
            if value and not value.lower().startswith("javascript:"):
                return self._public_url(urljoin(source_url, value))
        quoted = re.findall(r"['\"]([^'\"]+)['\"]", " ".join(attrs))
        for value in quoted:
            if value.startswith("EPP"):
                return self._public_url(urljoin(source_url, f"/gate.do?GATE_CODE={value}"))
        return ""

    def _program_container(self, link):
        for name in ("tr", "li", "article"):
            parent = link.find_parent(name)
            if parent:
                return parent
        parent = link.find_parent(
            attrs={"class": re.compile(r"(program|list|card|item|result)", re.I)}
        )
        return parent or link.parent or link

    def _main_content(self, soup: BeautifulSoup):
        return (
            soup.select_one("#content")
            or soup.select_one(".content")
            or soup.select_one(".sub_cont")
            or soup.select_one(".program_view")
            or soup.select_one("body")
            or soup
        )

    def _title_from_link(self, link, list_text: str) -> str:
        title = self._clean(link.get("title") or link.get_text(" ", strip=True))
        if title and not title.lower().startswith("javascript"):
            return title[:250]
        for line in list_text.splitlines():
            cleaned = self._clean(line)
            if cleaned and not re.search(r"(신청|운영|기간|장소|상태|모집)", cleaned):
                return cleaned[:250]
        return ""

    def _title_from_detail(self, node) -> str:
        for selector in ("h1", "h2", "h3", ".tit", ".title", "th"):
            found = node.select_one(selector)
            title = self._clean(found.get_text(" ", strip=True)) if found else ""
            if title:
                return title[:250]
        return ""

    def _event_from_text(self, program: StoryProgram, text: str) -> dict:
        starts_at, ends_at = self._extract_event_range(text)
        apply_deadline = self._extract_apply_deadline(text)
        category = self._category_from_text(f"{program.title}\n{text}")
        detail_url = self._public_url(program.url)
        summary = self._readable_summary(text or program.title)
        return {
            "title": program.title[:250],
            "summary": summary,
            "starts_at": starts_at,
            "ends_at": ends_at,
            "apply_deadline": apply_deadline,
            "category": category,
            "department": self._extract_department(text)[:100] or "Story+",
            "location": self._extract_location(text)[:150] or "계명대학교",
            "interests": self._interests_from_text(f"{program.title}\n{text}"),
            "url": detail_url,
            "apply_url": detail_url,
            "source_key": program.source_key,
        }

    def _text_with_lines(self, node) -> str:
        if not node:
            return ""
        lines: list[str] = []
        for block in node.select("h1, h2, h3, p, li, tr, dl, div"):
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

    def _readable_summary(self, text: str) -> str:
        lines: list[str] = []
        for raw in text.splitlines():
            line = self._clean(raw)
            if line and line not in lines:
                lines.append(line)
        return "\n".join(lines)[:1200]

    def _extract_event_range(self, text: str) -> tuple[datetime, datetime]:
        snippet = self._keyword_snippet(
            text, ("운영기간", "교육기간", "행사일", "활동기간", "일시")
        )
        dates = self._dates(snippet or text)
        start_date = dates[0] if dates else date(self.target_year, 1, 1)
        end_date = dates[1] if len(dates) > 1 else start_date
        times = list(self.TIME_RE.finditer(snippet or text))
        start_time = self._time_from_match(times[0]) if times else time(9, 0)
        end_time = self._time_from_match(times[1]) if len(times) > 1 else None
        starts_at = datetime.combine(start_date, start_time)
        ends_at = datetime.combine(end_date, end_time) if end_time else starts_at + timedelta(hours=2)
        if ends_at <= starts_at:
            ends_at = starts_at + timedelta(hours=2)
        return starts_at, ends_at

    def _extract_apply_deadline(self, text: str) -> datetime | None:
        snippet = self._apply_deadline_snippet(text)
        if not snippet:
            return None
        dates = self._dates(snippet)
        if not dates:
            return None
        times = list(self.TIME_RE.finditer(snippet))
        deadline_time = self._time_from_match(times[-1]) if times else time(23, 59, 59)
        return datetime.combine(dates[-1], deadline_time)

    def _apply_deadline_snippet(self, text: str) -> str:
        lines = text.splitlines()
        snippets = []
        start_pattern = re.compile(r"(신청|접수|모집)")
        stop_pattern = re.compile(r"(운영기간|교육기간|행사일|활동기간|장소|운영부서|담당부서)")
        for index, line in enumerate(lines):
            if not start_pattern.search(line):
                continue
            window = []
            for next_line in lines[index : index + 6]:
                if window and stop_pattern.search(next_line):
                    break
                window.append(next_line)
            snippets.append(" ".join(window))
        return " ".join(snippets[:4])

    def _keyword_snippet(self, text: str, keywords: tuple[str, ...]) -> str:
        lines = text.splitlines()
        snippets = []
        pattern = re.compile("|".join(map(re.escape, keywords)))
        for index, line in enumerate(lines):
            if pattern.search(line):
                snippets.append(" ".join(lines[index : index + 6]))
        return " ".join(snippets[:4])

    def _dates(self, text: str) -> list[date]:
        dates: list[date] = []
        for match in self.DATE_RE.finditer(text):
            year = int(match.group("year") or self.target_year)
            try:
                value = date(year, int(match.group("month")), int(match.group("day")))
            except ValueError:
                continue
            if value not in dates:
                dates.append(value)
        return dates

    def _time_from_match(self, match: re.Match) -> time:
        hour = max(0, min(23, int(match.group("hour"))))
        minute = max(0, min(59, int(match.group("minute"))))
        return time(hour, minute)

    def _extract_location(self, text: str) -> str:
        return self._value_after_label(text, ("장소", "교육장", "운영장소", "강의실"))

    def _extract_department(self, text: str) -> str:
        return self._value_after_label(text, ("운영부서", "주관", "담당부서", "문의"))

    def _value_after_label(self, text: str, labels: tuple[str, ...]) -> str:
        pattern = "|".join(map(re.escape, labels))
        for line in text.splitlines():
            if not re.search(pattern, line):
                continue
            value = re.sub(rf"^.*?(?:{pattern})\s*[:：]?\s*", "", line)
            value = re.split(r"\s+(?:신청|운영|교육|문의|상태|대상)\s*[:：]?", value, maxsplit=1)[0]
            cleaned = self._clean(value)
            if cleaned:
                return cleaned
        return ""

    def _category_from_text(self, text: str) -> str:
        if "공모전" in text:
            return "공모전"
        if "특강" in text or "세미나" in text or "강연" in text:
            return "특강"
        if "교육" in text or "강좌" in text or "워크숍" in text:
            return "교육"
        return "비교과"

    def _interests_from_text(self, text: str) -> str:
        mapping = {
            "AI": "ai",
            "인공지능": "ai",
            "클라우드": "ai",
            "백엔드": "major",
            "프론트엔드": "major",
            "소프트웨어": "major",
            "개발": "major",
            "프로그래밍": "major",
            "데이터": "major",
            "보안": "major",
            "취업": "career",
            "채용": "career",
            "인턴": "career",
            "직무": "career",
            "면접": "career",
            "자소서": "career",
            "포트폴리오": "career",
            "공모전": "contest",
            "창업": "startup",
            "문화": "culture",
            "글로벌": "global",
            "교육": "education",
            "학습": "education",
            "강좌": "education",
            "워크숍": "education",
        }
        tags = [tag for keyword, tag in mapping.items() if keyword in text]
        return ",".join(dict.fromkeys(tags))

    def _is_target_year_event(self, event: dict) -> bool:
        values = [event.get("starts_at"), event.get("ends_at"), event.get("apply_deadline")]
        return any(isinstance(value, datetime) and value.year == self.target_year for value in values)

    def _source_key(self, title: str, detail_url: str) -> str:
        parts = urlsplit(detail_url)
        query = parse_qs(parts.query)
        for key in ("GATE_CODE", "PRM_SEQ", "PRM_CD", "EP_SEQ", "PROGRAM_SEQ", "seq"):
            value = query.get(key) or query.get(key.lower())
            if value and value[0]:
                return f"story:{value[0]}"
        digest = hashlib.sha256((title + detail_url).encode()).hexdigest()[:32]
        return f"story:{digest}"

    def _public_url(self, url: str) -> str:
        return urljoin("https://story.kmu.ac.kr", url or "")

    def _clean(self, value: str) -> str:
        return re.sub(r"\s+", " ", (value or "").replace("\xa0", " ")).strip()
