"""
Checks every external link in the chapters, pages, site data and README:
each must return 200 (a DOI that answers 403 to scripts is confirmed
through Crossref instead), and every link into one of the owner's slide
decks must point at an anchor that exists, with the slide's heading
printed so it can be compared with the link text. arXiv links are checked
at export.arxiv.org (title and first author printed).

    python3 scripts/check_links.py

Manual (network); not run in CI. opencompute.org answers 403 to curl's
default user agent, so a browser user agent is sent.
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
FILES = (
    list((ROOT / "content").rglob("*.mdx"))
    + list((ROOT / "src").rglob("*.tsx"))
    + list((ROOT / "src").rglob("*.ts"))
    + [ROOT / "README.md", ROOT / "reference/systolic.py", ROOT / "reference/pe.py", ROOT / "reference/torus.py", ROOT / "reference/lower.py"]
)
URL = re.compile(r"https?://[^\s\"'`)<>\]}]+")


def fetch(url: str) -> tuple[int, str]:
    out = subprocess.run(
        ["curl", "-sL", "-A", UA, "-o", "-", "-w", "\n%{http_code}", "--max-time", "40", url],
        capture_output=True,
    )
    body, _, code = out.stdout.decode("utf-8", "replace").rpartition("\n")
    return int(code or 0), body


def main() -> int:
    urls: dict[str, set[str]] = {}
    for f in FILES:
        if not f.exists():
            continue
        for u in URL.findall(f.read_text()):
            u = u.rstrip(".,;")
            if "localhost" in u or "${" in u or u.endswith("/blob/main/"):
                continue
            urls.setdefault(u, set()).add(str(f.relative_to(ROOT)))
    bad = 0
    pages: dict[str, str] = {}
    for u in sorted(urls):
        base, _, anchor = u.partition("#")
        if "arxiv.org/abs/" in u:
            aid = u.rsplit("/", 1)[1]
            code, body = fetch(f"https://export.arxiv.org/abs/{aid}")
            t = re.search(r'citation_title" content="([^"]+)"', body)
            a = re.search(r'citation_author" content="([^"]+)"', body)
            print(f"{code} arXiv {aid}: {html.unescape(t.group(1)) if t else '?'} ({a.group(1) if a else '?'})")
            bad += code != 200
            time.sleep(1)
            continue
        if base not in pages:
            code, body = fetch(base)
            pages[base] = body if code == 200 else ""
            if code != 200 and "doi.org/" in base:
                doi = base.split("doi.org/", 1)[1]
                c2, b2 = fetch(f"https://api.crossref.org/works/{doi}")
                title = json.loads(b2)["message"]["title"][0] if c2 == 200 else "?"
                print(f"{code} {base} (Crossref {c2}: {title})")
                bad += c2 != 200
                continue
            print(f"{code} {base}")
            bad += code != 200
        if anchor and "brendanjameslynskey.github.io" in base:
            body = pages[base]
            m = re.search(rf'id="{re.escape(anchor)}"[^>]*>(.{{0,1500}})', body, re.S)
            h = re.search(r"<h[12][^>]*>(.*?)</h[12]>", m.group(1), re.S) if m else None
            title = html.unescape(re.sub("<[^>]+>", "", h.group(1))).strip() if h else None
            print(f"    #{anchor}: {title or 'MISSING'}")
            bad += title is None
    print(f"{len(urls)} links, {bad} problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
