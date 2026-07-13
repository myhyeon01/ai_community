import hashlib
import logging
import re
import ssl
from datetime import date, datetime, timezone
import certifi
import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger("uvicorn.error")
WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]

def _is_certificate_verification_error(error: Exception) -> bool:
    current: BaseException | None = error
    while current:
        if "CERTIFICATE_VERIFY_FAILED" in str(current):
            return True
        current = current.__cause__ or current.__context__
    return False

def _verified_ssl_context() -> ssl.SSLContext:
    return ssl.create_default_context(cafile=certifi.where())

def _kmu_fallback_ssl_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context

def _event_type(title: str) -> str:
    if "보강" in title: return "보강일"
    if "시험" in title: return "시험"
    if "방학" in title: return "방학"
    if "휴업" in title: return "휴업일"
    if "공휴일" in title or re.search(r"추석.*연휴|설날", title) or title in {"신정", "부활절"}: return "공휴일"
    return "기타"

def _weekday(value: date | None) -> str | None:
    return WEEKDAYS[value.weekday()] if value else None

def _original_date(title: str, year: int) -> date | None:
    match = re.search(r"\[(\d{1,2})\.\s*(\d{1,2})\.\]", title)
    return date(year, int(match.group(1)), int(match.group(2))) if match else None

def _applied_weekday(title: str) -> str | None:
    match = re.search(r"([월화수목금토일])요일(?:\s*수업|\s*시간표|.*수업\s*진행)", title)
    return match.group(1) if match else None

class KMUCrawler:
    async def fetch_items(self, url: str):
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client: response=await client.get(url); response.raise_for_status()
        soup=BeautifulSoup(response.text,"html.parser"); items=[]
        for link in soup.select("a"):
            title=" ".join(link.get_text(" ",strip=True).split()); href=link.get("href")
            if title and href: items.append({"title":title,"url":str(response.url.join(href)),"source_key":hashlib.sha256((title+href).encode()).hexdigest()[:40]})
        return items

    def parse_academic_calendar(self, html: str):
        soup = BeautifulSoup(html, "html.parser")
        heading = next((" ".join(tag.get_text(" ", strip=True).split()) for tag in soup.select("h1,h2,h3,h4,h5,h6") if re.search(r"20\d{2}년\s*학사일정", tag.get_text())), "")
        year_match = re.search(r"(20\d{2})년\s*학사일정", heading)
        if not year_match: raise ValueError("페이지 제목에서 학사일정 연도를 찾지 못했습니다.")
        year = int(year_match.group(1)); rows = []
        for table in soup.select("table"):
            for tr in table.select("tr"):
                cells = tr.select("td")
                if len(cells) < 2: continue
                date_text = " ".join(cells[0].get_text(" ", strip=True).split())
                title = " ".join(cells[1].get_text(" ", strip=True).split())
                match = re.fullmatch(r"(\d{2})-(\d{2})(?:\s*~\s*(\d{2})-(\d{2}))?", date_text)
                if not match or not title: continue
                start = date(year, int(match.group(1)), int(match.group(2)))
                end = date(year, int(match.group(3) or match.group(1)), int(match.group(4) or match.group(2)))
                kind = _event_type(title); original = _original_date(title, year) if kind == "보강일" else None
                rows.append({"id": f"kmu-{start}-{end}-{title}", "date": date_text, "title": title, "start_date": start, "end_date": end, "event_type": kind, "original_date": original, "changed_date": start if original else None, "applied_weekday": _applied_weekday(title)})
        unique = list({(row["start_date"], row["end_date"], row["title"]): row for row in rows}.values())
        makeup = {row["original_date"]: row for row in unique if row["original_date"] and row["changed_date"]}
        for row in unique:
            if row["event_type"] in {"공휴일", "휴업일"}:
                relation = makeup.get(row["start_date"]); row["original_date"] = row["start_date"]
                row["changed_date"] = relation["changed_date"] if relation else None
                row["schedule_type"] = "보강" if relation else "휴강"
            else: row["schedule_type"] = "보강" if row["original_date"] else None
            row["original_weekday"] = _weekday(row["original_date"])
            row["changed_weekday"] = _weekday(row["changed_date"])
        if not unique: raise ValueError("학사일정 표에서 유효한 일정을 찾지 못했습니다.")
        return {"year": year, "fetched_at": datetime.now(timezone.utc).isoformat(), "schedules": unique, "stats": {"response_length": len(html), "table_count": len(soup.select('table')), "row_count": len(soup.select('table tr')), "schedule_count": len(unique)}}

    async def fetch_academic_calendar(self, url: str):
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"}
        status = None
        response_length = 0
        schedule_count = 0
        try:
            try:
                async with httpx.AsyncClient(timeout=15, follow_redirects=True, verify=_verified_ssl_context(), headers=headers) as client:
                    response = await client.get(url)
                    response.raise_for_status()
            except httpx.ConnectError as tls_error:
                logger.warning(
                    "academic calendar TLS request failed url=%s exception_class=%s exception=%s",
                    url,
                    f"{type(tls_error).__module__}.{type(tls_error).__name__}",
                    tls_error,
                )
                if not _is_certificate_verification_error(tls_error):
                    raise
                logger.warning("academic calendar retrying with request-scoped TLS exception url=%s", url)
                async with httpx.AsyncClient(timeout=15, follow_redirects=True, verify=_kmu_fallback_ssl_context(), headers=headers) as client:
                    response = await client.get(url)
                    response.raise_for_status()
            status = response.status_code
            response_length = len(response.text)
            result = self.parse_academic_calendar(response.text)
            schedule_count = result["stats"]["schedule_count"]
            logger.info("academic calendar url=%s status=%s length=%s tables=%s rows=%s schedules=%s", url, status, response_length, result["stats"]["table_count"], result["stats"]["row_count"], schedule_count)
            return result
        except Exception as error:
            if isinstance(error, httpx.HTTPStatusError):
                status = error.response.status_code
                response_length = len(error.response.content)
            logger.exception(
                "academic calendar crawl failed url=%s status=%s length=%s schedules=%s exception_class=%s exception=%s",
                url,
                status,
                response_length,
                schedule_count,
                f"{type(error).__module__}.{type(error).__name__}",
                error,
            )
            raise

