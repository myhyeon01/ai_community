import hashlib
import httpx
from bs4 import BeautifulSoup

class KMUCrawler:
    async def fetch_items(self, url: str):
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client: response=await client.get(url); response.raise_for_status()
        soup=BeautifulSoup(response.text,"html.parser"); items=[]
        for link in soup.select("a"):
            title=" ".join(link.get_text(" ",strip=True).split()); href=link.get("href")
            if title and href: items.append({"title":title,"url":str(response.url.join(href)),"source_key":hashlib.sha256((title+href).encode()).hexdigest()[:40]})
        return items

