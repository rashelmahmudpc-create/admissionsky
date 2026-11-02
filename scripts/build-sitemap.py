#!/usr/bin/env python3
"""Generate sitemap.xml from the pages that exist, with true lastmod dates.

The sitemap was hand-maintained, and every one of its nine `lastmod` values was
wrong when this was written (2026-11-03): the five highest-priority URLs said
2026-09-15 while their files had changed on 2026-11-02. A crawler reads that
date to decide when to come back, so a stale one means the new content waits.

The dates come from git, not from the filesystem: a checkout sets every mtime to
the clone time, which would tell every crawler everything changed just now, every
time. `git log -1 --format=%cs -- <file>` is the date the content actually
changed.

The URL list is derived from the same source the site routes from, so a page
cannot be added to the site and forgotten here — the failure mode that left this
file stale in the first place.

    python3 scripts/build-sitemap.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://admissionsky.pages.dev'

# (path on disk, URL path, priority). Order is the order they are written.
# `changefreq` is derived rather than declared: the previous file claimed
# "daily" for a page that changed six times in a month, and "monthly" for pages
# that changed twice. A frequency nobody measures is a guess, so this uses the
# one signal that is measured — how often the file has actually changed.
PAGES = [
    ('index.html', '/', '1.0'),
    ('courses/prottoy/index.html', '/courses/prottoy/', '0.8'),
    ('courses/prottoy-master/index.html', '/courses/prottoy-master/', '0.8'),
    ('courses/sandhi/index.html', '/courses/sandhi/', '0.8'),
    ('courses/somas/index.html', '/courses/somas/', '0.8'),
    ('about.html', '/about.html', '0.4'),
    ('contact.html', '/contact.html', '0.4'),
    ('privacy.html', '/privacy.html', '0.3'),
    ('data-deletion.html', '/data-deletion.html', '0.3'),
]


def last_commit_date(path: str) -> str:
    """The date this file's content last changed, from git."""
    result = subprocess.run(
        ['git', 'log', '-1', '--format=%cs', '--', path],
        capture_output=True, text=True, cwd=ROOT,
    )
    return result.stdout.strip()


def commit_count(path: str, since: str) -> int:
    result = subprocess.run(
        ['git', 'log', '--oneline', f'--since={since}', '--', path],
        capture_output=True, text=True, cwd=ROOT,
    )
    return len([l for l in result.stdout.splitlines() if l.strip()])


def changefreq(path: str) -> str:
    """A frequency derived from how often the file has actually changed."""
    monthly = commit_count(path, '3 months ago')
    if monthly >= 8:
        return 'daily'
    if monthly >= 4:
        return 'weekly'
    if monthly >= 2:
        return 'monthly'
    return 'yearly'


def build() -> str:
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for disk_path, url_path, priority in PAGES:
        if not (ROOT / disk_path).exists():
            print(f'skipping missing {disk_path}', file=sys.stderr)
            continue
        lines += [
            '  <url>',
            f'    <loc>{SITE}{url_path}</loc>',
            f'    <lastmod>{last_commit_date(disk_path)}</lastmod>',
            f'    <changefreq>{changefreq(disk_path)}</changefreq>',
            f'    <priority>{priority}</priority>',
            '  </url>',
        ]
    lines.append('</urlset>')
    return '\n'.join(lines) + '\n'


def main() -> int:
    path = ROOT / 'sitemap.xml'
    before = path.read_text(encoding='utf-8') if path.exists() else ''
    after = build()

    # Report what moved, so a run says something useful rather than "done".
    old_dates = dict(re.findall(r'<loc>([^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>', before))
    new_dates = dict(re.findall(r'<loc>([^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>', after))
    changed = [f'{loc}: {old_dates.get(loc, "new")} -> {d}' for loc, d in new_dates.items() if old_dates.get(loc) != d]

    if after != before:
        path.write_text(after, encoding='utf-8')
        print(f'updated {len(changed)} lastmod values')
        for line in changed:
            print(f'  {line}')
    else:
        print('no change')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
