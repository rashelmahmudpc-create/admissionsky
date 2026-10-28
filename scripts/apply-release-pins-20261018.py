#!/usr/bin/env python3
"""Align release pins in tests + canary workflow (2026-10-18). Idempotent."""
import glob, re, sys
from pathlib import Path

changed = []

def edit(path, fn):
    p = Path(path)
    old = p.read_text(encoding='utf-8')
    new = fn(old)
    if new != old:
        p.write_text(new, encoding='utf-8')
        changed.append(path)
    return new

def need(cond, msg):
    if not cond:
        sys.exit('apply-release-pins: ' + msg)

# 1. every *.test.mjs: sw cache pin
for f in sorted(glob.glob('**/*.test.mjs', recursive=True)):
    if 'node_modules' in f:
        continue
    edit(f, lambda t: t.replace('v350-notes-screen-v2', 'v364-sky-goal'))

# 2. agent pin + dedicated account-access.js version
LINE = "const UI_JS_VERSION = '20261018-logout-otp-v1';"
def welcome(t):
    t = re.sub(r'agent-f1-ui-skyv3(?!\d)', 'agent-f1-ui-skyv13', t)
    if LINE not in t:
        t, n = re.subn(r"^(const UI_VERSION = '[^']*';)$", r"\1\n" + LINE, t, count=1, flags=re.M)
        need(n == 1, 'UI_VERSION anchor missing')
    return t.replace('account-access.js?v=${UI_VERSION}', 'account-access.js?v=${UI_JS_VERSION}')
for f in ('code-native-welcome-v1.test.mjs', 'interactive-native-personal-v1.test.mjs'):
    t = edit(f, welcome)
    need(LINE in t and 'skyv3' not in t and 'account-access.js?v=${UI_VERSION}' not in t, f + ' not aligned')

# 3. canary activation pins
CANARY = '.github/workflows/telegram-auth-canary-activate.yml'
PINS = [
    ('account-access.js?v=20261015-safearea1', 'account-access.js?v=20261018-logout-otp-v1'),
    ('account-access.css?v=20261015-safearea1', 'account-access.css?v=20261018-allowlist-v1'),
    ('agent-f1-ui-p06chat', 'agent-f1-ui-skyv13'),
    ('dash2f17-v3frame', 'dash2f18-chrome'),
    ('v335-lock-20261016', 'v364-sky-goal'),
]
def canary(t):
    for a, b in PINS:
        t = t.replace(a, b)
    return t
t = edit(CANARY, canary)
need(not any(a in t for a, _ in PINS), 'canary pins not aligned')

# 4. native-auth-protection test 13: Telegram login pending flag
NAP = 'native-auth-protection.test.mjs'
FLAG_ASSERT = "  assert.match(client, /const TELEGRAM_LOGIN_FLAG = 'ah-telegram-login-pending'/);"
def nap(t):
    t = t.replace("assert.equal(storageCalls.length, 8, 'only the six OAuth boolean flag accesses plus the two Firebase pending-mark calls are permitted');",
                  "assert.equal(storageCalls.length, 11, 'only the six OAuth boolean flag accesses, the three Telegram login-pending flag accesses, and the two Firebase pending-mark calls are permitted');")
    t = t.replace("/^(?:(?:OAUTH_REDIRECT_FLAG|GOOGLE_REDIRECT_FLAG),\\s*'1'|pendingKey,\\s*'\"true\"')$/",
                  "/^(?:(?:OAUTH_REDIRECT_FLAG|GOOGLE_REDIRECT_FLAG|TELEGRAM_LOGIN_FLAG),\\s*'1'|pendingKey,\\s*'\"true\"')$/")
    t = t.replace(": /^(?:OAUTH_REDIRECT_FLAG|GOOGLE_REDIRECT_FLAG|pendingKey)$/;",
                  ": /^(?:OAUTH_REDIRECT_FLAG|GOOGLE_REDIRECT_FLAG|TELEGRAM_LOGIN_FLAG|pendingKey)$/;")
    if FLAG_ASSERT not in t:
        anchor = "  assert.match(client, /const GOOGLE_REDIRECT_FLAG = 'ah-google-redirect'/);"
        need(anchor in t, 'GOOGLE_REDIRECT_FLAG anchor missing')
        t = t.replace(anchor, anchor + '\n' + FLAG_ASSERT, 1)
    return t
t = edit(NAP, nap)
need('storageCalls.length, 11' in t and t.count('TELEGRAM_LOGIN_FLAG') == 3, 'test 13 not aligned')

print('changed:', ', '.join(sorted(set(changed))) or 'none')
