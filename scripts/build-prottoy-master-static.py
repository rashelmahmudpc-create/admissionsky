#!/usr/bin/env python3
"""Render the static SEO shell for courses/prottoy-master/index.html.

The page builds every screen in JavaScript, so a crawler that does not run JS
receives 144 characters: the title, the burger button and the brand line. The
sibling course pages are static HTML and serve 23k-49k characters of the same
kind of content, so this one page is invisible to search while the others rank.

The fix is not to rewrite the page — the JS version is the product. It is to put
the same content in the served HTML as well, inside `#view`, which `render()`
overwrites the moment it runs. A reader with JS sees exactly what they saw
before; a crawler without it sees the course.

The content is GENERATED from the page's own data, never typed by hand: a
hand-copied summary goes stale the next time a lesson is edited, and this repo
has already paid for that lesson twice (the sitemap dates, the course hashes).

    python3 scripts/build-prottoy-master-static.py
"""
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / 'courses' / 'prottoy-master' / 'index.html'

MARK_START = '<!-- seo:static:start -->'
MARK_END = '<!-- seo:static:end -->'


def extract(page: str, name: str, start: int = 0):
    """Return the source text of a top-level `G.<name> = ...;` literal."""
    m = re.search(rf'^G\.{name}\s*=\s*([\[{{])', page[start:], re.M)
    if not m:
        return None
    i = start + m.end() - 1
    depth = 0
    for j in range(i, len(page)):
        if page[j] in '[{':
            depth += 1
        elif page[j] in ']}':
            depth -= 1
            if depth == 0:
                return page[i:j + 1]
    return None


def strings_of(literal: str):
    """Every single-quoted string in a JS literal, in order."""
    return [s.replace("\\'", "'") for s in re.findall(r"'((?:[^'\\]|\\.)*)'", literal or '')]


def esc(value: str) -> str:
    return html.escape(str(value), quote=True)


def build() -> str:
    page = PAGE.read_text(encoding='utf-8')

    meta_block = extract(page, 'meta') or '{}'
    def meta(key):
        m = re.search(rf"{key}\s*:\s*'((?:[^'\\]|\\.)*)'", meta_block)
        return m.group(1) if m else ''

    title = meta('title')
    subject = meta('subject')

    overview = strings_of(extract(page, 'overview'))
    objectives = strings_of(extract(page, 'objectives'))
    why = strings_of(extract(page, 'why'))
    lessons = re.findall(r"no:\s*(\d+),\s*title:\s*'((?:[^'\\]|\\.)*)'", page)

    # Each lesson also carries a one-line summary; take it from the same block.
    subs = re.findall(r"no:\s*\d+,\s*title:\s*'(?:[^'\\]|\\.)*',\s*\n\s*sub:\s*'((?:[^'\\]|\\.)*)'", page)
    if len(subs) != len(lessons):
        subs = [''] * len(lessons)

    parts = [MARK_START]
    parts.append('<div class="seo-static">')
    parts.append(
        f'<h1>{esc(title)} — Visual Admission Master Guide</h1>'
    )
    parts.append(
        f'<p>{esc(subject)} • ইন্টার্যাকটিভ ভিজ্যুয়াল গাইড: প্রতিটি নিয়মের সচিত্র ব্যাখ্যা, '
        f'ট্র্যাপ অ্যালার্ট, প্র্যাকটিস ও MCQ সহ ভর্তি পরীক্ষার প্রস্তুতি।</p>'
    )

    if overview:
        parts.append('<h2>এই গাইড সম্পর্কে</h2>')
        for para in overview:
            parts.append(f'<p>{esc(para)}</p>')

    if objectives:
        parts.append('<h2>এই গাইড থেকে যা শিখবেন</h2>')
        parts.append('<ul>')
        for item in objectives:
            parts.append(f'<li>{esc(item)}</li>')
        parts.append('</ul>')

    if why:
        parts.append('<h2>ভর্তি পরীক্ষায় প্রত্যয় কেন গুরুত্বপূর্ণ</h2>')
        parts.append('<ul>')
        for item in why:
            parts.append(f'<li>{esc(item)}</li>')
        parts.append('</ul>')

    if lessons:
        parts.append('<h2>পাঠের তালিকা</h2>')
        parts.append('<ol>')
        for (no, lesson_title), sub in zip(lessons, subs):
            line = f'<strong>{esc(lesson_title)}</strong>'
            if sub:
                line += f' — {esc(sub)}'
            parts.append(f'<li>{line}</li>')
        parts.append('</ol>')

    parts.append('</div>')
    parts.append(MARK_END)
    return '\n'.join(parts)


def main() -> int:
    page = PAGE.read_text(encoding='utf-8')
    block = build()

    if MARK_START in page and MARK_END in page:
        start = page.index(MARK_START)
        end = page.index(MARK_END) + len(MARK_END)
        updated = page[:start] + block + page[end:]
        action = 'replaced'
    else:
        anchor = '<main id="main"><div id="view">'
        if anchor not in page:
            print('anchor not found: <main id="main"><div id="view">', file=sys.stderr)
            return 1
        updated = page.replace(anchor, anchor + '\n' + block + '\n', 1)
        action = 'inserted'

    if updated == page:
        print('no change')
        return 0
    PAGE.write_text(updated, encoding='utf-8')
    print(f'{action}: {len(block)} bytes of static content')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
