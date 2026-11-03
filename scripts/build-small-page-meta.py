#!/usr/bin/env python3
"""Give the four small pages a description and a share card.

Measured on the live site 2026-11-03:

* `privacy.html` and `data-deletion.html` have no `<meta name="description">` at
  all, so a search result for either shows whatever text the crawler decides to
  lift — usually a sentence from the middle of the policy.
* None of the four (about, contact, privacy, data-deletion) has any Open Graph
  or Twitter tag. Every other page on the site does, so a shared link to these
  four renders as a bare URL while the course pages render a card.

Both are small, and both are the kind of thing that stays wrong because nobody
looks at these pages. The values are per-page constants rather than generated
prose: the descriptions are editorial, and inventing them from the page body
would produce a sentence nobody chose.

    python3 scripts/build-small-page-meta.py
"""
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://admissionsky.pages.dev'
OG_IMAGE = f'{SITE}/og-image.png'

# (file, url path, description). Written by hand on purpose — see the docstring.
PAGES = [
    ('about.html', '/about.html',
     'Admission Sky কী, কারা বানিয়েছে এবং শিক্ষার্থীদের জন্য কী কী সুবিধা আছে — '
     'বাংলাদেশের ভর্তি প্রস্তুতির অ্যাডাপটিভ প্ল্যাটফর্ম সম্পর্কে জানুন।'),
    ('contact.html', '/contact.html',
     'Admission Sky-এর সাথে যোগাযোগ করুন — সহায়তা, মতামত বা অভিযোগের জন্য '
     'ইমেইল ও যোগাযোগের মাধ্যম।'),
    ('privacy.html', '/privacy.html',
     'Admission Sky কী তথ্য সংগ্রহ করে, কেন করে, কত দিন রাখে এবং শিক্ষার্থীর '
     'অধিকার কী — সম্পূর্ণ গোপনীয়তা নীতি বাংলায়।'),
    ('data-deletion.html', '/data-deletion.html',
     'Admission Sky থেকে নিজের অ্যাকাউন্ট ও পড়ার তথ্য মুছে ফেলার নিয়ম, '
     'পদ্ধতি ও সময়সীমা — ডেটা মুছে ফেলার নির্দেশিকা।'),
]


# The type each page should declare, and the one thing that page is for. Google
# documents AboutPage, ContactPage and WebPage for exactly these four.
PAGE_TYPES = {
    'about.html': 'AboutPage',
    'contact.html': 'ContactPage',
    'privacy.html': 'WebPage',
    'data-deletion.html': 'WebPage',
}

SITE = 'https://admissionsky.pages.dev'


def structured_data(file: str, title: str, description: str, url: str) -> str:
    """A small, self-contained graph for a page that had none.

    Measured 2026-11-03: these four were the only pages on the site without
    structured data — the homepage, the courses and the 15 question-bank pages
    all carry it. A page with no graph is a page a search engine has to guess
    about, and the two nodes below are what let it say who published the page
    rather than only what the page says.

    Organization and WebSite are inlined rather than referenced, because a
    schema.org `@id` resolves inside its own graph — the course pages were fixed
    for exactly this, and repeating the mistake here would be the same defect in
    a new file.
    """
    page_id = f'{SITE}{url}#page'
    graph = [
        {
            '@type': PAGE_TYPES.get(file, 'WebPage'),
            '@id': page_id,
            'name': title,
            'description': description,
            'url': f'{SITE}{url}',
            'inLanguage': 'bn-BD',
            'isPartOf': {'@id': f'{SITE}/#website'},
            'about': {'@id': f'{SITE}/#organization'},
        },
        {
            '@type': 'Organization',
            '@id': f'{SITE}/#organization',
            'name': 'Admission Sky',
            'url': f'{SITE}/',
            'logo': {
                '@type': 'ImageObject',
                'url': f'{SITE}/icons/icon-512.png',
                'width': 512,
                'height': 512,
            },
        },
        {
            '@type': 'WebSite',
            '@id': f'{SITE}/#website',
            'url': f'{SITE}/',
            'name': 'Admission Sky',
            'inLanguage': 'bn-BD',
            'publisher': {'@id': f'{SITE}/#organization'},
        },
        {
            '@type': 'BreadcrumbList',
            '@id': f'{SITE}{url}#breadcrumb',
            'itemListElement': [
                {'@type': 'ListItem', 'position': 1, 'name': 'Admission Sky', 'item': f'{SITE}/'},
                {'@type': 'ListItem', 'position': 2, 'name': title, 'item': f'{SITE}{url}'},
            ],
        },
    ]
    return ('<script type="application/ld+json">'
            + json.dumps({'@context': 'https://schema.org', '@graph': graph}, ensure_ascii=False)
            + '</script>')


# Every small page ends with this. Measured 2026-11-03: privacy.html linked only
# to data-deletion.html and data-deletion.html linked to nothing at all, while
# both sit in the sitemap — a crawler is invited to a page it cannot leave, and a
# student reading the privacy policy has no way back to the app.
SITE_FOOTER = (
    '<footer class="site-links"><nav aria-label="সাইট">'
    '<a href="/">হোম</a> · '
    '<a href="/courses/sandhi/">কোর্স</a> · '
    '<a href="/question-bank/">প্রশ্নব্যাংক</a> · '
    '<a href="/about.html">আমাদের সম্পর্কে</a> · '
    '<a href="/contact.html">যোগাযোগ</a> · '
    '<a href="/privacy.html">গোপনীয়তা</a> · '
    '<a href="/data-deletion.html">ডেটা মুছে ফেলা</a>'
    '</nav></footer>'
)

MARK_START = '<!-- seo:meta:start -->'
MARK_END = '<!-- seo:meta:end -->'


def block(file: str, title: str, description: str, url: str) -> str:
    def meta(attr, key, value):
        return f'<meta {attr}="{key}" content="{html.escape(value, quote=True)}">'

    lines = [MARK_START]
    lines.append(meta('name', 'description', description))
    lines.append(meta('property', 'og:type', 'website'))
    lines.append(meta('property', 'og:site_name', 'Admission Sky'))
    lines.append(meta('property', 'og:locale', 'bn_BD'))
    lines.append(meta('property', 'og:title', title))
    lines.append(meta('property', 'og:description', description))
    lines.append(meta('property', 'og:url', f'{SITE}{url}'))
    lines.append(meta('property', 'og:image', OG_IMAGE))
    lines.append(meta('name', 'twitter:card', 'summary_large_image'))
    lines.append(meta('name', 'twitter:title', title))
    lines.append(meta('name', 'twitter:description', description))
    lines.append(meta('name', 'twitter:image', OG_IMAGE))
    lines.append(structured_data(file, title, description, url))
    lines.append(MARK_END)
    return '\n'.join(lines)


FOOTER_START = '<!-- seo:footer:start -->'
FOOTER_END = '<!-- seo:footer:end -->'
FOOTER_CSS = (
    '<style>.site-links{margin-top:30px;padding-top:14px;border-top:1px solid #e3e6e4;'
    'font-size:13.5px;color:#6b7370}.site-links a{color:#0f6b4f;text-decoration:none}'
    '.site-links a:hover{text-decoration:underline}</style>'
)


def apply(page: str, file: str, title: str, description: str, url: str) -> tuple:
    """Replace an existing block, or add the missing tags in place."""
    fresh = block(file, title, description, url)
    if MARK_START in page and MARK_END in page:
        start = page.index(MARK_START)
        end = page.index(MARK_END) + len(MARK_END)
        page = page[:start] + fresh + page[end:]
        action = 'replaced'
    else:
        # Remove any pre-existing description so it is not duplicated, then
        # insert the whole block right after <title>.
        cleaned = re.sub(r'<meta name="description"[^>]*>', '', page, count=1)
        m = re.search(r'</title>', cleaned)
        if not m:
            return page, 'no-title'
        page = cleaned[:m.end()] + '\n' + fresh + cleaned[m.end():]
        action = 'inserted'

    # The footer goes at the end of the BODY, so it is a separate injection from
    # the head block above.
    footer = f'{FOOTER_START}\n{FOOTER_CSS}\n{SITE_FOOTER}\n{FOOTER_END}'
    if FOOTER_START in page and FOOTER_END in page:
        start = page.index(FOOTER_START)
        end = page.index(FOOTER_END) + len(FOOTER_END)
        page = page[:start] + footer + page[end:]
    else:
        at = page.rfind('</body>')
        if at == -1:
            return page, 'no-body'
        page = page[:at] + footer + '\n' + page[at:]

    return page, action


def title_of(page: str) -> str:
    m = re.search(r'<title>([^<]*)</title>', page)
    return html.unescape(m.group(1)).strip() if m else ''


def main() -> int:
    failures = []
    for name, url, description in PAGES:
        path = ROOT / name
        if not path.exists():
            failures.append(f'{name}: missing')
            continue
        page = path.read_text(encoding='utf-8')
        title = title_of(page)
        if not title:
            failures.append(f'{name}: no <title> to reuse')
            continue
        updated, action = apply(page, name, title, description, url)
        if action == 'no-title':
            failures.append(f'{name}: no </title> to anchor to')
            continue
        if updated != page:
            path.write_text(updated, encoding='utf-8')
        print(f'{name}: {action}')

    if failures:
        for f in failures:
            print(f'FAILED {f}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
