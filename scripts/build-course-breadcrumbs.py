#!/usr/bin/env python3
"""Add a crawlable breadcrumb to every course landing page.

Each course page links to exactly one URL: its own canonical. There is no way
back to the homepage, no link to a sibling course, no navigation of any kind.
A crawler that arrives on one of these pages is at a dead end — it cannot tell
the page is part of a larger site, and it cannot reach the rest of it. Three of
the four pages have a sidebar full of section links, but those are `<a>` tags
with no `href` (they are JS click targets), so they count for nothing.

Meanwhile every course page's structured data claims a BreadcrumbList:
"Admission Sky › সন্ধি". The claim is in the markup; the links are not. This
makes the claim true.

The breadcrumb goes in the header, next to the brand — the one place on these
pages a reader already looks for "where am I". It is plain markup, so it works
with and without JavaScript.

    python3 scripts/build-course-breadcrumbs.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COURSES = ROOT / 'courses'

MARK_START = '<!-- seo:breadcrumb:start -->'
MARK_END = '<!-- seo:breadcrumb:end -->'

# The label each page shows for itself, and the order a reader moves through
# them. Slugs match the directories under courses/.
PAGES = [
    ('sandhi', 'সন্ধি'),
    ('somas', 'সমাস'),
    ('prottoy', 'প্রত্যয়'),
    ('prottoy-master', 'প্রত্যয় • Master'),
]



# Inline so the breadcrumb needs no stylesheet change on four different pages,
# each with its own CSS. Small, self-contained, and it reads the same CSS
# variables the pages already define, so it inherits their dark/light theme.
BREADCRUMB_CSS = (
    '<style>'
    '.seo-breadcrumb{display:flex;flex-wrap:wrap;align-items:center;gap:8px;'
    'padding:8px 18px;font-size:13.5px;font-weight:600;'
    'color:var(--muted,#8b93a7);border-bottom:1px solid var(--line,rgba(128,128,128,.18))}'
    '.seo-breadcrumb a{color:var(--brand,#4f46e5);text-decoration:none}'
    '.seo-breadcrumb a:hover{text-decoration:underline}'
    '.seo-breadcrumb-current{color:var(--ink,inherit);font-weight:700}'
    '.seo-breadcrumb-siblings{display:flex;flex-wrap:wrap;gap:10px;margin-inline-start:auto}'
    '@media(max-width:640px){.seo-breadcrumb{font-size:12.5px;gap:6px}'
    '.seo-breadcrumb-siblings{margin-inline-start:0;width:100%}}'
    '.seo-sitelinks{display:flex;flex-wrap:wrap;gap:10px;padding:8px 18px;font-size:13px;'
    'border-bottom:1px solid var(--line,rgba(128,128,128,.18))}'
    '.seo-sitelinks a{color:var(--muted,#8b93a7);text-decoration:none}'
    '.seo-sitelinks a:hover{color:var(--brand,#4f46e5);text-decoration:underline}'
    '</style>'
)

def breadcrumb(current_slug: str, current_label: str) -> str:
    """Homepage › this course, plus the rest of the site.

    Measured 2026-11-03: a course page linked home, to its three siblings, and to
    nothing else — no question bank, no about, no contact. A student who landed
    on a course from a search had no path to the 3000 questions, which are the
    other half of what the site offers, and a crawler saw the course section as
    a closed set.

    The sibling list is capped: a page that lists every section reads as a
    directory rather than a page. The courses are the closest relatives, so they
    stay; the rest go in one line below."""
    others = [(s, label) for s, label in PAGES if s != current_slug]
    links = ''.join(
        f'<a href="/courses/{slug}/">{label}</a>'
        for slug, label in others
    )
    return (
        f'{MARK_START}\n'
        f'{BREADCRUMB_CSS}\n'
        f'<nav class="seo-breadcrumb" aria-label="ব্রেডক্রাম্ব">\n'
        f'<a href="/">Admission Sky</a>\n'
        f'<span aria-hidden="true">›</span>\n'
        f'<span class="seo-breadcrumb-current">{current_label}</span>\n'
        f'<span class="seo-breadcrumb-siblings">{links}</span>\n'
        f'</nav>\n'
        f'<nav class="seo-sitelinks" aria-label="সাইট">'
        f'<a href="/question-bank/">প্রশ্নব্যাংক</a>'
        f'<a href="/about.html">আমাদের সম্পর্কে</a>'
        f'<a href="/contact.html">যোগাযোগ</a>'
        f'<a href="/privacy.html">গোপনীয়তা</a>'
        f'</nav>\n'
        f'{MARK_END}'
    )


def inject(page: str, block: str) -> tuple[str, str]:
    """Put the block after the header, or replace an existing one."""
    if MARK_START in page and MARK_END in page:
        start = page.index(MARK_START)
        end = page.index(MARK_END) + len(MARK_END)
        return page[:start] + block + page[end:], 'replaced'

    # Two header shapes in this repo: the three static course pages close a
    # `<header>`, and prottoy-master uses a `<div class="topbar">` instead.
    # Anchoring on both is not tidiness — a generator that silently skips one
    # page is how the page it skips stays broken, which is the failure this
    # whole change is about.
    m = re.search(r'</header>', page)
    if m:
        return page[:m.end()] + '\n' + block + page[m.end():], 'inserted'
    m = re.search(r'<div class="topbar">[\s\S]*?</div>\s*\n', page)
    if m:
        return page[:m.end()] + block + '\n' + page[m.end():], 'inserted'
    return page, 'no-anchor'


def repin_hashes() -> list:
    """Update source-course-tool.js so each page's integrity hash matches.

    The tool refuses to run a course whose recorded SHA-256 does not match, and
    it fails QUIETLY: the course still renders, but with no scripts, so every
    interactive part is gone and the page looks merely broken rather than
    tampered with. Editing a course page without re-pinning is therefore not a
    small mistake — it disables the course.

    This generator edits all four pages, so it must re-pin all four. Doing it
    here rather than by hand is the point: the previous change to these pages
    (the Admission Sky rename) left every hash stale, and 21 tests in
    source-course-lessons were the only thing that noticed.
    """
    import hashlib

    tool = ROOT / 'source-course-tool.js'
    source = tool.read_text(encoding='utf-8')
    updated = []
    for slug, _ in PAGES:
        path = COURSES / slug / 'index.html'
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        pattern = re.compile(r"('?" + re.escape(slug) + r"'?: \{[^}]*hash: ')([a-f0-9]{64})(')")
        m = pattern.search(source)
        if not m:
            updated.append(f'{slug}: no hash pin found')
            continue
        if m.group(2) != digest:
            source = source[:m.start(2)] + digest + source[m.end(2):]
            updated.append(f'{slug}: {m.group(2)[:10]} -> {digest[:10]}')
    tool.write_text(source, encoding='utf-8')
    return updated


def main() -> int:
    failures = []
    for slug, label in PAGES:
        path = COURSES / slug / 'index.html'
        if not path.exists():
            failures.append(f'{slug}: no index.html')
            continue
        page = path.read_text(encoding='utf-8')
        updated, action = inject(page, breadcrumb(slug, label))
        if action == 'no-anchor':
            failures.append(f'{slug}: no header to anchor to')
            continue
        if updated != page:
            path.write_text(updated, encoding='utf-8')
        print(f'{slug}: {action}')

    if failures:
        for f in failures:
            print(f'FAILED {f}', file=sys.stderr)
        return 1

    # Always last: the hashes must be computed over the finished files.
    for line in repin_hashes():
        print(f'hash {line}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
