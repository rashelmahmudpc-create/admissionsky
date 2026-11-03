#!/usr/bin/env python3
"""Publish the question bank as crawlable pages.

The bank holds 3000 questions across 14 topics, served publicly from
`/api/content` with no login — but only to JavaScript. The site is hash-routed
(`#question-bank/topic/top-001`), so a search engine sees one page for all 3000
questions and indexes none of them. A student searching "প্রতিনিধিত্বশীল
গণতন্ত্রের প্রাণ কী" — a question this site owns and answers — cannot find it.

This generates one static page per topic, with the questions and answers in the
markup. Those pages are what a search engine can read, and they link to each
other and back to the site.

Two decisions worth naming:

* **Only the questions, never the student's state.** The bank's own screens show
  bookmarks, attempts and mistakes, which are per-student and read from local
  storage. None of that is here — these pages are the public half of the data,
  the same half `/api/content` already serves to anyone.

* **Fetched live, not committed.** The content changes from the owner's console
  (`/api/cloud/publish`), not from a commit, so a snapshot checked into the repo
  would be stale the moment he edits a topic. The generator reads the live API
  at build time and writes the pages into `dist/`, where they are published but
  never committed — which is also why the repo's own tests do not depend on
  them.

    python3 scripts/build-question-bank-pages.py [--dist dist]
"""
import argparse
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = 'https://admissionsky.pages.dev'
API = f'{SITE}/api/content'
UA = {'User-Agent': 'Mozilla/5.0 (compatible; AdmissionSkyBuild)'}

# How many questions a topic page shows inline. A page carrying all 320 is 121 KB
# of markup for one topic; 60 is enough for a crawler to understand the page and
# enough for a student to land on it and start. The rest stay in the app.
MAX_QUESTIONS = 60


def fetch_content() -> dict:
    request = urllib.request.Request(API, headers=UA)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


# Every generated page ends with this, so the question bank is part of the site
# rather than an island. Measured 2026-11-03: a topic page linked to the hub and
# to its 13 siblings and to nothing else — no course, no about, no contact — and
# the hub linked only to its own topics. A crawler entering the bank could not
# leave it.
SITE_FOOTER = (
    '<footer class="site-links">'
    '<nav aria-label="সাইট">'
    '<a href="/">হোম</a> · '
    '<a href="/courses/sandhi/">সন্ধি</a> · '
    '<a href="/courses/somas/">সমাস</a> · '
    '<a href="/courses/prottoy/">প্রত্যয়</a> · '
    '<a href="/courses/prottoy-master/">প্রত্যয় Master</a> · '
    '<a href="/about.html">আমাদের সম্পর্কে</a> · '
    '<a href="/contact.html">যোগাযোগ</a> · '
    '<a href="/privacy.html">গোপনীয়তা</a> · '
    '<a href="/data-deletion.html">ডেটা মুছে ফেলা</a>'
    '</nav>'
    '</footer>'
)

def esc(value) -> str:
    return html.escape(str(value if value is not None else ''), quote=True)


def slug_of(topic_id: str, name: str) -> str:
    """A readable, stable URL segment.

    The topic id is what the app routes on, so it leads: the URL keeps working
    if the topic is renamed, and two topics with the same name cannot collide.
    """
    ascii_name = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return f'{topic_id}-{ascii_name}' if ascii_name else topic_id


def page_for(topic: dict, subject: dict, questions: list, all_topics: list) -> str:
    name = topic.get('name') or topic.get('id') or 'Topic'
    subject_name = subject.get('name') or 'প্রশ্নব্যাংক'
    shown = questions[:MAX_QUESTIONS]

    title = f'{name} — প্রশ্ন ও উত্তর | Admission Sky'
    description = (
        f'{name} টপিকের {len(questions)}টি ভর্তি পরীক্ষার প্রশ্ন, উত্তর ও ব্যাখ্যাসহ। '
        f'{subject_name} — বিশ্ববিদ্যালয়, মেডিকেল ও গুচ্ছ ভর্তি প্রস্তুতির জন্য।'
    )[:300]

    others = ''.join(
        f'<li><a href="/question-bank/{esc(slug_of(t.get("id") or "", t.get("name") or ""))}/">'
        f'{esc(t.get("name") or t.get("id"))}</a></li>'
        for t in all_topics if t.get('id') != topic.get('id')
    )

    items = []
    for index, q in enumerate(shown, 1):
        options = q.get('options') or []
        answer_index = q.get('answer', q.get('answerIndex'))
        try:
            answer_index = int(answer_index)
        except (TypeError, ValueError):
            answer_index = -1
        answer = options[answer_index] if 0 <= answer_index < len(options) else ''
        option_items = ''.join(
            f'<li{" class=\"correct\"" if i == answer_index else ""}>{esc(o)}</li>'
            for i, o in enumerate(options)
        )
        explanation = q.get('explanation') or ''
        items.append(
            '<article class="q">'
            f'<h3>{index}. {esc(q.get("question"))}</h3>'
            f'<ol type="A">{option_items}</ol>'
            + (f'<p class="a"><strong>উত্তর:</strong> {esc(answer)}</p>' if answer else '')
            + (f'<p class="e">{esc(explanation)}</p>' if explanation else '')
            + '</article>'
        )

    more = ''
    if len(questions) > len(shown):
        more = (f'<p class="more">আরও {len(questions) - len(shown)}টি প্রশ্ন অ্যাপে — '
                f'<a href="/#question-bank/topic/{esc(topic.get("id"))}">প্রশ্নব্যাংকে খুলুন</a>।</p>')

    return f'''<!DOCTYPE html>
<html lang="bn" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="{SITE}/question-bank/{esc(slug_of(topic.get('id') or '', name))}/">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Admission Sky">
<meta property="og:locale" content="bn_BD">
<meta property="og:title" content="{esc(name)} — প্রশ্ন ও উত্তর">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{SITE}/question-bank/{esc(slug_of(topic.get('id') or '', name))}/">
<meta property="og:image" content="{SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(name)} — প্রশ্ন ও উত্তর">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{SITE}/og-image.png">
<script type="application/ld+json">{json.dumps({
    "@context": "https://schema.org",
    "@graph": [
        {
            "@type": "FAQPage",
            "@id": f"{SITE}/question-bank/{slug_of(topic.get('id') or '', name)}/#faq",
            "name": f"{name} — প্রশ্ন ও উত্তর",
            "inLanguage": "bn-BD",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": q.get("question") or "",
                    "acceptedAnswer": {
                        "@type": "Answer",
                        "text": (q.get("options") or [""])[int(q.get("answer", 0))]
                        if (q.get("options") or []) and str(q.get("answer", 0)).lstrip("-").isdigit()
                        else "",
                    },
                }
                for q in shown[:20] if q.get("question")
            ],
        },
        {
            "@type": "BreadcrumbList",
            "@id": f"{SITE}/question-bank/{slug_of(topic.get('id') or '', name)}/#breadcrumb",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Admission Sky", "item": f"{SITE}/"},
                {"@type": "ListItem", "position": 2, "name": "প্রশ্নব্যাংক", "item": f"{SITE}/question-bank/"},
                {"@type": "ListItem", "position": 3, "name": name,
                 "item": f"{SITE}/question-bank/{slug_of(topic.get('id') or '', name)}/"},
            ],
        },
    ],
}, ensure_ascii=False)}</script>
<style>
body{{margin:0;padding:20px 18px 60px;max-width:760px;margin-inline:auto;background:#faf9f6;color:#1a1d1b;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans Bengali",sans-serif;line-height:1.7}}
a{{color:#0f6b4f}}
nav{{font-size:13.5px;color:#6b7370;margin-bottom:14px}}
h1{{font-size:22px;margin:6px 0 4px}}
h2{{font-size:17px;margin-top:28px}}
.q{{border:1px solid #e3e6e4;border-radius:12px;padding:14px 16px;margin:12px 0;background:#fff}}
.q h3{{font-size:15.5px;margin:0 0 8px}}
.q ol{{margin:0 0 8px;padding-inline-start:22px}}
.q li{{margin:2px 0}}
.q li.correct{{font-weight:700;color:#0f6b4f}}
.a{{margin:0;font-size:14.5px}}
.e{{margin:6px 0 0;font-size:14px;color:#4b5350}}
.more{{font-size:14px;color:#6b7370}}
.others{{font-size:14px}}
.site-links{{margin-top:34px;padding-top:16px;border-top:1px solid #e3e6e4;font-size:13.5px;color:#6b7370}}
</style>
</head>
<body>
<nav><a href="/">Admission Sky</a> › <a href="/question-bank/">প্রশ্নব্যাংক</a> › {esc(name)}</nav>
<h1>{esc(name)}</h1>
<p>{esc(subject_name)} • {len(questions)}টি প্রশ্ন{'' if len(questions) <= len(shown) else f' (প্রথম {len(shown)}টি দেখানো হচ্ছে)'}</p>
{''.join(items)}
{more}
<h2>অন্য টপিকগুলো</h2>
<ul class="others">{others}</ul>
<!-- The hash link is deliberate here: it opens the interactive app, not the
     hub page. The breadcrumb above links to /question-bank/ instead, because a
     crawler cannot follow a fragment. -->
<p class="more"><a href="/#question-bank">পুরো প্রশ্নব্যাংক অ্যাপে খুলুন</a> — নিজের অগ্রগতি, ভুলের খাতা ও মডেল টেস্টসহ।</p>
{SITE_FOOTER}
</body>
</html>
'''


def index_page(subjects: list, topics: list, counts: dict) -> str:
    """A hub page, so the topic pages are not orphans."""
    by_subject = {}
    for topic in topics:
        by_subject.setdefault(topic.get('subjectId'), []).append(topic)

    sections = []
    for subject in subjects:
        group = by_subject.get(subject.get('id')) or []
        if not group:
            continue
        links = ''.join(
            f'<li><a href="/question-bank/{esc(slug_of(t.get("id") or "", t.get("name") or ""))}/">'
            f'{esc(t.get("name") or t.get("id"))}</a> '
            f'<span class="c">({counts.get(t.get("id"), 0)}টি প্রশ্ন)</span></li>'
            for t in group
        )
        sections.append(f'<h2>{esc(subject.get("name"))}</h2><ul>{links}</ul>')

    total = sum(counts.values())
    title = 'প্রশ্নব্যাংক — ভর্তি পরীক্ষার প্রশ্ন ও উত্তর | Admission Sky'
    description = (f'{total}টি ভর্তি পরীক্ষার প্রশ্ন, উত্তরসহ — বিষয় ও টপিক অনুযায়ী সাজানো। '
                   f'বিশ্ববিদ্যালয়, মেডিকেল ও গুচ্ছ ভর্তি প্রস্তুতির জন্য।')

    return f'''<!DOCTYPE html>
<html lang="bn" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="{SITE}/question-bank/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Admission Sky">
<meta property="og:locale" content="bn_BD">
<meta property="og:title" content="প্রশ্নব্যাংক — ভর্তি পরীক্ষার প্রশ্ন ও উত্তর">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{SITE}/question-bank/">
<meta property="og:image" content="{SITE}/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="প্রশ্নব্যাংক — ভর্তি পরীক্ষার প্রশ্ন ও উত্তর">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{SITE}/og-image.png">
<script type="application/ld+json">{json.dumps({
    "@context": "https://schema.org",
    "@graph": [
        {
            "@type": "CollectionPage",
            "@id": f"{SITE}/question-bank/#collection",
            "name": "প্রশ্নব্যাংক",
            "inLanguage": "bn-BD",
            "isPartOf": {"@id": f"{SITE}/#website"},
        },
        {
            "@type": "BreadcrumbList",
            "@id": f"{SITE}/question-bank/#breadcrumb",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Admission Sky", "item": f"{SITE}/"},
                {"@type": "ListItem", "position": 2, "name": "প্রশ্নব্যাংক", "item": f"{SITE}/question-bank/"},
            ],
        },
        {
            "@type": "WebSite",
            "@id": f"{SITE}/#website",
            "url": f"{SITE}/",
            "name": "Admission Sky",
            "inLanguage": "bn-BD",
        },
    ],
}, ensure_ascii=False)}</script>
<style>
body{{margin:0;padding:20px 18px 60px;max-width:760px;margin-inline:auto;background:#faf9f6;color:#1a1d1b;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans Bengali",sans-serif;line-height:1.7}}
a{{color:#0f6b4f}}
nav{{font-size:13.5px;color:#6b7370;margin-bottom:14px}}
h1{{font-size:23px;margin:6px 0 4px}}
h2{{font-size:17px;margin-top:26px}}
ul{{padding-inline-start:20px}}
li{{margin:4px 0}}
.c{{color:#6b7370;font-size:13px}}
.site-links{{margin-top:34px;padding-top:16px;border-top:1px solid #e3e6e4;font-size:13.5px;color:#6b7370}}
</style>
</head>
<body>
<nav><a href="/">Admission Sky</a> › প্রশ্নব্যাংক</nav>
<h1>প্রশ্নব্যাংক</h1>
<p>{total}টি প্রশ্ন, বিষয় ও টপিক অনুযায়ী সাজানো — উত্তরসহ।</p>
{''.join(sections)}
<p><a href="/#question-bank">পুরো প্রশ্নব্যাংক অ্যাপে খুলুন</a> — নিজের অগ্রগতি, ভুলের খাতা ও মডেল টেস্টসহ।</p>
{SITE_FOOTER}
</body>
</html>
'''



def update_sitemap(dist: Path, topics: list, counts: dict, updated_at) -> None:
    """Add the question-bank URLs to the sitemap the build is about to publish.

    The committed `sitemap.xml` lists the pages that exist in the repository.
    These pages do not exist until this script runs, so they cannot be in that
    file — and a sitemap that omits 15 pages is the same problem as the stale
    dates it was just fixed for: a crawler that is not told about a page is a
    crawler that may not find it.

    The dates come from the content's own timestamp rather than today's, because
    today's would claim all fifteen changed on every deploy, whether or not the
    owner touched a single topic.
    """
    import datetime

    path = dist / 'sitemap.xml'
    if not path.exists():
        return
    existing = path.read_text(encoding='utf-8')
    if '/question-bank/' in existing:
        return  # already merged; this script is safe to run twice

    stamp = datetime.datetime.fromtimestamp(
        (updated_at or 0) / 1000, datetime.timezone.utc
    ).strftime('%Y-%m-%d') if updated_at else datetime.date.today().isoformat()

    entries = [
        '  <url>',
        f'    <loc>{SITE}/question-bank/</loc>',
        f'    <lastmod>{stamp}</lastmod>',
        '    <changefreq>weekly</changefreq>',
        '    <priority>0.7</priority>',
        '  </url>',
    ]
    for topic in topics:
        slug = slug_of(topic.get('id') or '', topic.get('name') or '')
        if not slug:
            continue
        entries += [
            '  <url>',
            f'    <loc>{SITE}/question-bank/{slug}/</loc>',
            f'    <lastmod>{stamp}</lastmod>',
            '    <changefreq>monthly</changefreq>',
            '    <priority>0.6</priority>',
            '  </url>',
        ]

    merged = existing.replace('</urlset>', '\n'.join(entries) + '\n</urlset>')
    path.write_text(merged, encoding='utf-8')

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dist', default='dist', help='where to write the pages')
    parser.add_argument('--content', help='read a local JSON file instead of the API (for tests)')
    args = parser.parse_args()

    if args.content:
        content = json.loads(Path(args.content).read_text(encoding='utf-8'))
    else:
        try:
            content = fetch_content()
        except Exception as error:  # noqa: BLE001
            # A content outage must not fail the deploy: the rest of the site is
            # fine and the question pages simply keep whatever is already live.
            print(f'content unavailable ({error}); skipping question-bank pages', file=sys.stderr)
            return 0

    subjects = content.get('subjects') or []
    topics = content.get('topics') or []
    questions = content.get('questions') or []
    if not topics or not questions:
        print('content has no topics or questions; skipping', file=sys.stderr)
        return 0

    by_topic = {}
    for q in questions:
        by_topic.setdefault(q.get('topicId'), []).append(q)
    subject_by_id = {s.get('id'): s for s in subjects}
    counts = {t.get('id'): len(by_topic.get(t.get('id')) or []) for t in topics}

    out = Path(args.dist) / 'question-bank'
    out.mkdir(parents=True, exist_ok=True)

    (out / 'index.html').write_text(index_page(subjects, topics, counts), encoding='utf-8')
    written = 1
    for topic in topics:
        slug = slug_of(topic.get('id') or '', topic.get('name') or '')
        if not slug:
            continue
        folder = out / slug
        folder.mkdir(parents=True, exist_ok=True)
        page = page_for(topic, subject_by_id.get(topic.get('subjectId'), {}),
                        by_topic.get(topic.get('id')) or [], topics)
        (folder / 'index.html').write_text(page, encoding='utf-8')
        written += 1

    update_sitemap(Path(args.dist), topics, counts, content.get('at'))
    print(f'question bank: {written} pages, {sum(counts.values())} questions')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
