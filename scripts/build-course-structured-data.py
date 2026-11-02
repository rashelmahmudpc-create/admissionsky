#!/usr/bin/env python3
"""Give every course page's structured data a complete, self-contained graph.

Two defects, both confirmed against the live site on 2026-11-03:

1. **Dangling references.** Each Course says
   `"provider": {"@id": ".../#organization"}` and
   `"isPartOf": {"@id": ".../#website"}`, but neither node is defined on that
   page — they live only in index.html's graph. A schema.org `@id` reference
   resolves within the graph it appears in, not across pages, so to a consumer
   the provider is simply empty. The course pages therefore describe themselves
   as part of nothing, provided by nobody.

2. **Missing properties Google asks for.** The Course nodes carry name,
   description, provider, url and inLanguage, and none of offers,
   hasCourseInstance, image or aggregateRating. A course with no `offers` and no
   `image` is not eligible for the rich result the markup exists to earn.

This generator rewrites the graph in place, keeping the human-written name and
description exactly as they are — it adds what is missing rather than
regenerating prose.

    python3 scripts/build-course-structured-data.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COURSES = ROOT / 'courses'

SITE = 'https://admissionsky.pages.dev'
ORG_ID = f'{SITE}/#organization'
SITE_ID = f'{SITE}/#website'

PAGES = ['sandhi', 'somas', 'prottoy', 'prottoy-master']

# What the whole site is, in the two shapes a course page needs to stand alone.
# Deliberately minimal: the homepage owns the full description, and repeating it
# here would make four near-duplicate Organization nodes instead of one idea.
ORGANIZATION = {
    '@type': 'Organization',
    '@id': ORG_ID,
    'name': 'Admission Sky',
    'url': f'{SITE}/',
    'logo': {
        '@type': 'ImageObject',
        'url': f'{SITE}/icons/icon-512.png',
        'width': 512,
        'height': 512,
    },
}

WEBSITE = {
    '@type': 'WebSite',
    '@id': SITE_ID,
    'url': f'{SITE}/',
    'name': 'Admission Sky',
    'inLanguage': 'bn-BD',
    'publisher': {'@id': ORG_ID},
}

# The course is free, and the homepage already says so in its WebApplication
# node. Saying it here too is what makes this page eligible on its own.
OFFER = {
    '@type': 'Offer',
    'price': '0',
    'priceCurrency': 'BDT',
    'availability': 'https://schema.org/InStock',
}


def build_graph(slug: str, graph: list) -> list:
    """Return the graph with its references resolved and its gaps filled."""
    course = next((n for n in graph if n.get('@type') == 'Course'), None)
    breadcrumb = next((n for n in graph if n.get('@type') == 'BreadcrumbList'), None)
    if course is None:
        return graph

    fixed = dict(course)
    fixed['provider'] = {'@id': ORG_ID}
    fixed['isPartOf'] = {'@id': SITE_ID}
    fixed.setdefault('offers', dict(OFFER))
    # The share card already exists and is served; using it here is the same
    # image a search result would show, which is the point of the property.
    fixed.setdefault('image', f'{SITE}/og-image.png')
    fixed.setdefault('hasCourseInstance', {
        '@type': 'CourseInstance',
        'courseMode': 'online',
        'courseWorkload': 'PT4H',
        'inLanguage': 'bn-BD',
    })

    # The two nodes the references above point at, so nothing dangles.
    out = [fixed]
    if breadcrumb is not None:
        out.append(breadcrumb)
    out.append(dict(ORGANIZATION))
    out.append(dict(WEBSITE))
    return out


def rewrite(page: str, graph: list) -> str:
    payload = json.dumps(
        {'@context': 'https://schema.org', '@graph': graph},
        ensure_ascii=False,
        separators=(',', ':'),
    )
    # Only the JSON-LD block is touched; everything else is left byte-identical.
    return re.sub(
        r'(<script type="application/ld\+json">)(.*?)(</script>)',
        lambda m: m.group(1) + payload + m.group(3),
        page,
        count=1,
        flags=re.S,
    )


def repin_hashes() -> list:
    """Update source-course-tool.js so each page's integrity hash matches.

    Editing a course page invalidates its SHA-256 pin, and the failure is
    silent: the tool refuses a page whose hash does not match and then renders
    it with no scripts at all, so the course looks broken rather than tampered
    with. Every generator that writes these files therefore has to re-pin, and
    it has to be the generator rather than a step in a document — this
    repository has now paid for that lesson three times.

    Computed last, over the finished files.
    """
    import hashlib

    tool = ROOT / 'source-course-tool.js'
    source = tool.read_text(encoding='utf-8')
    changed = []
    for slug in PAGES:
        digest = hashlib.sha256((COURSES / slug / 'index.html').read_bytes()).hexdigest()
        pattern = re.compile(r"('?" + re.escape(slug) + r"'?: \{[^}]*hash: ')([a-f0-9]{64})(')")
        m = pattern.search(source)
        if not m:
            changed.append(f'{slug}: no hash pin found')
            continue
        if m.group(2) != digest:
            source = source[:m.start(2)] + digest + source[m.end(2):]
            changed.append(f'{slug}: {m.group(2)[:10]} -> {digest[:10]}')
    tool.write_text(source, encoding='utf-8')
    return changed


def main() -> int:
    failures = []
    for slug in PAGES:
        path = COURSES / slug / 'index.html'
        if not path.exists():
            failures.append(f'{slug}: no index.html')
            continue
        page = path.read_text(encoding='utf-8')
        m = re.search(r'<script type="application/ld\+json">(.*?)</script>', page, re.S)
        if not m:
            failures.append(f'{slug}: no JSON-LD block')
            continue
        try:
            data = json.loads(m.group(1))
        except json.JSONDecodeError as e:
            failures.append(f'{slug}: JSON-LD does not parse ({e})')
            continue

        graph = build_graph(slug, data.get('@graph', []))
        updated = rewrite(page, graph)
        if updated != page:
            path.write_text(updated, encoding='utf-8')
        kinds = [n.get('@type') for n in graph]
        print(f'{slug}: {", ".join(kinds)}')

    if failures:
        for f in failures:
            print(f'FAILED {f}', file=sys.stderr)
        return 1

    for line in repin_hashes():
        print(f'hash {line}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
