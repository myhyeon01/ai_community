import hashlib
import re
import time
from datetime import date

import httpx
from bs4 import BeautifulSoup


ACADEMIC_URL = "https://www.kmu.ac.kr/uni/main/page.jsp?mnu_uid=3373"
DATE_RANGE = re.compile(r"(?P<sm>\d{1,2})-(?P<sd>\d{1,2})(?:\s*[~～-]\s*(?:(?P<em>\d{1,2})-)?(?P<ed>\d{1,2}))?")
ORIGINAL_DAY = re.compile(r"\[(\d{1,2})\.\s*(\d{1,2})\.?\]")
_CACHE: dict[int, tuple[float, list[dict]]] = {}
CACHE_SECONDS = 10 * 60


def classify_event(title: str) -> str:
    if "보강" in title:
        return "makeup"
    if "시험" in title:
        return "exam"
    if "수강" in title:
        return "registration"
    if "개강" in title or "개시일" in title:
        return "semester"
    if "방학" in title or "종강" in title:
        return "vacation"
    if "휴업" in title or "공휴일" in title or "휴강" in title:
        return "holiday"
    if "학위" in title or "졸업" in title:
        return "graduation"
    if "복학" in title or "재입학" in title or "휴학" in title:
        return "application"
    return "academic"


def parse_calendar_html(html: str, year: int) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    events: list[dict] = []
    seen: set[str] = set()

    for row in soup.select("tr"):
        cells = [" ".join(cell.get_text(" ", strip=True).split()) for cell in row.select("th, td")]
        if len(cells) < 2:
            continue
        match = DATE_RANGE.search(cells[0])
        if not match:
            continue
        title = " ".join(cells[1:]).strip()
        if not title:
            continue
        sm, sd = int(match["sm"]), int(match["sd"])
        em = int(match["em"] or sm)
        ed = int(match["ed"] or sd)
        start_year = year if sm >= 3 else year + 1
        end_year = start_year + (1 if em < sm else 0)
        try:
            start = date(start_year, sm, sd)
            end = date(end_year, em, ed)
        except ValueError:
            continue

        applied_weekday = None
        original = ORIGINAL_DAY.search(title)
        if "보강" in title and original:
            original_month, original_day = map(int, original.groups())
            original_year = year if original_month >= 3 else year + 1
            applied_weekday = date(original_year, original_month, original_day).weekday()

        key = hashlib.sha256(f"{start}|{end}|{title}".encode()).hexdigest()[:40]
        if key in seen:
            continue
        seen.add(key)
        events.append(
            {
                "title": title,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "event_type": classify_event(title),
                "applied_weekday": applied_weekday,
                "source_url": ACADEMIC_URL,
                "source_key": key,
            }
        )
    return sorted(events, key=lambda item: (item["start_date"], item["title"]))


class AcademicCalendarCrawler:
    async def _request(self, params: dict | None = None) -> httpx.Response:
        request_options = {
            "params": params,
            "headers": {"User-Agent": "KMU-Smart-Scheduler/0.1 (+student project)"},
        }
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                response = await client.get(ACADEMIC_URL, **request_options)
                response.raise_for_status()
                return response
        except httpx.ConnectError as error:
            if "CERTIFICATE_VERIFY_FAILED" not in str(error):
                raise
            async with httpx.AsyncClient(
                timeout=20,
                follow_redirects=True,
                verify=False,
            ) as client:
                response = await client.get(ACADEMIC_URL, **request_options)
                response.raise_for_status()
                return response

    async def available_years(self) -> list[int]:
        response = await self._request()
        soup = BeautifulSoup(response.text, "html.parser")
        years = []
        for option in soup.select('select[name="parm_doc_year"] option'):
            value = option.get("value", "")
            if str(value).isdigit():
                years.append(int(value))
        return sorted(set(years), reverse=True)

    async def fetch(self, year: int, force: bool = False) -> list[dict]:
        cached = _CACHE.get(year)
        if not force and cached and time.time() - cached[0] < CACHE_SECONDS:
            return cached[1]
        response = await self._request(
            {"mnu_uid": "3373", "parm_doc_year": str(year)}
        )
        events = parse_calendar_html(response.text, year)
        if not events:
            raise ValueError("계명대학교 학사일정 표를 찾지 못했습니다.")
        _CACHE[year] = (time.time(), events)
        return events
