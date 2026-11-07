"""Gera news.json para o portal de notícias da TV a partir de RSS públicos (g1 / ge).

Roda no GitHub Actions (pages.yml) a cada 30 min. Os feeds não liberam CORS, então o
navegador/TV não consegue ler o RSS direto; aqui o servidor lê e publica um JSON junto do player.

Uso:  python tools/build_news.py caminho/para/news.json
Só biblioteca padrão. Exibe título, linha fina, foto e fonte (sem o texto da matéria).
"""
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

FEEDS = [
    # category: usada no slide "newsPortal" (campo "feed") para filtrar
    {"url": "https://g1.globo.com/rss/g1/sp/vale-do-paraiba-regiao/", "source": "g1 Vale", "category": "local"},
    {"url": "https://ge.globo.com/rss/ge/futebol/", "source": "ge", "category": "esportes"},
    {"url": "https://g1.globo.com/rss/g1/", "source": "g1", "category": "brasil"},
]
PER_FEED = 15
NS = {"media": "http://search.yahoo.com/mrss/", "atom": "http://www.w3.org/2005/Atom"}
UA = "Mozilla/5.0 (TV Clinica news builder)"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def text(el):
    return html.unescape((el.text or "").strip()) if el is not None else ""


def image_of(item):
    m = item.find("media:content", NS)
    if m is not None and m.get("url"):
        return m.get("url")
    desc = item.findtext("description") or ""
    found = re.search(r'<img[^>]+src="([^"]+)"', desc)
    return found.group(1) if found else ""


def iso(date_str):
    try:
        d = parsedate_to_datetime(date_str)
        if d.tzinfo is None:  # "-0000" vira data sem fuso; o g1/ge publica em UTC
            d = d.replace(tzinfo=timezone.utc)
        return d.astimezone(timezone.utc).isoformat()
    except Exception:
        return ""


def read_feed(feed):
    root = ET.fromstring(fetch(feed["url"]))
    out = []
    for item in root.iter("item"):
        title = text(item.find("title"))
        if not title:
            continue
        out.append({
            "title": title,
            "subtitle": text(item.find("atom:subtitle", NS)),
            "image": image_of(item),
            "source": feed["source"],
            "category": feed["category"],
            "link": text(item.find("link")),
            "date": iso(item.findtext("pubDate") or ""),
        })
        if len(out) >= PER_FEED:
            break
    return out


def main(dest):
    lists, errors = [], []
    for feed in FEEDS:
        try:
            lists.append(read_feed(feed))
        except Exception as e:  # um feed fora do ar não derruba os outros
            errors.append(f"{feed['url']}: {e}")
            lists.append([])
    # intercala os feeds (local, esporte, geral, local...) para variar o portal
    items = [x for group in zip(*[l + [None] * (PER_FEED - len(l)) for l in lists]) for x in group if x]
    data = {"updated": datetime.now(timezone.utc).isoformat(), "items": items}
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"{len(items)} manchetes -> {dest}")
    for e in errors:
        print("AVISO", e)
    if not items:
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "news.json")
