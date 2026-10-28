#!/usr/bin/env python3
"""Wire the OTP_RAW pool mailers (otp-n..otp-u) into the Worker. Idempotent."""
import json, re

SLOTS = [('otp-n', 100), ('otp-o', 100), ('otp-q', 100), ('otp-r', 60), ('otp-s', 16), ('otp-t', 100), ('otp-u', 130)]
IDS = [i for i, _ in SLOTS]

def edit(path, fn):
    with open(path, encoding='utf-8') as fh:
        before = fh.read()
    after = fn(before)
    if after != before:
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(after)
        print('patched', path)

def providers(s):
    if 'pool-providers.mjs' in s:
        return s
    anchor = "import { deriveTelegramWebhookSecret, validTelegramWebhookSecret } from './telegram-security.mjs';"
    assert anchor in s, 'providers import anchor'
    s = s.replace(anchor, anchor + "\nimport { createPoolProviders } from './pool-providers.mjs';", 1)
    old = "  return [\n    brevoOtpA.configured ? brevoOtpA : bridgeOtpA,"
    assert old in s, 'providers return anchor'
    new = ("  // otp-n..otp-u: mailers whose keys all live in the single OTP_RAW secret\n"
           "  // (64-variable ceiling). A slot only gets a quota while its orchestrator row\n"
           "  // is enabled, so an unconfigured mailer stays inert. Appended after every\n"
           "  // existing slot, and only while OTP_RAW is bound.\n"
           "  const poolProviders = env.OTP_RAW ? createPoolProviders({\n"
           "    raw: env.OTP_RAW,\n"
           "    slotQuota: id => { const slot = slotFromConfig(env.VERIFICATION_ORCHESTRATOR_CONFIG, id); return slot ? slot.dailyQuota : ''; },\n"
           "    fetchImpl,\n"
           "    helpers: { boundedJson, httpFailure, otpEmailBody, appName: OTP_EMAIL_APP }\n"
           "  }) : [];\n"
           "  return [\n    brevoOtpA.configured ? brevoOtpA : bridgeOtpA,")
    s = s.replace(old, new, 1)
    tail = "      fetchImpl\n    })\n  ];\n}\n\nexport const __verificationProvidersTest"
    assert tail in s, 'providers tail anchor'
    s = s.replace(tail, "      fetchImpl\n    }),\n    ...poolProviders\n  ];\n}\n\nexport const __verificationProvidersTest", 1)
    return s

def config(s):
    if "'otp-n'" in s:
        return s
    anchor = "  whatsapp: Object.freeze({ channel: VERIFICATION_CHANNELS.WHATSAPP"
    assert anchor in s, 'config anchor'
    rows = ''.join("  '%s': Object.freeze({ channel: VERIFICATION_CHANNELS.OTP, verificationMode: VERIFICATION_MODES.LOCAL_CODE, priority: 38 }),\n" % i for i in IDS)
    return s.replace(anchor, '  // otp-n..otp-u: OTP_RAW pool mailers (pool-providers.mjs).\n' + rows + anchor, 1)

def log_names(s):
    if "'otp-n'" in s:
        return s
    old = "'otp-m': 'Descope-MagicLink', telegram: 'Telegram'"
    assert old in s, 'log anchor'
    return s.replace(old, "'otp-m': 'Descope-MagicLink', 'otp-n': 'Maileroo', 'otp-o': 'ElasticEmail',\n  'otp-q': 'Mailgun', 'otp-r': 'AlibabaDirectMail', 'otp-s': 'SparkPost', 'otp-t': 'Plunk',\n  'otp-u': 'Loops', telegram: 'Telegram'", 1)

def wrangler(s):
    if '"id":"otp-n"' in s:
        return s
    anchor = '{"id":"otp-g","enabled":true,"priority":39'
    assert s.count(anchor) == 1, 'wrangler anchor'
    rows = ''.join('{"id":"%s","enabled":true,"priority":38,"dailyQuota":%d,"timeoutMs":8000,"label":"secure backup"},' % r for r in SLOTS)
    s = s.replace(anchor, rows + anchor, 1)
    note = ("# otp-n..otp-u (owner 2026-10-22): Maileroo 100, Elastic Email 100, Mailgun 100,\n"
            "# Alibaba DirectMail 60, SparkPost 16, Plunk 100, Loops 130 per day (free plan / 30).\n"
            "# All keys live in ONE secret, OTP_RAW (any format; pool-providers.mjs parses it),\n"
            "# so the 64-variable ceiling is not crossed. Priority 38: after every branded\n"
            "# mailer, before the locked last-resort pair. A slot without keys stays inert.\n")
    s = s.replace('OTP_A_DAILY_QUOTA = ', note + 'OTP_A_DAILY_QUOTA = ', 1)
    m = re.search(r"VERIFICATION_ORCHESTRATOR_CONFIG = '(.*)'", s)
    json.loads(m.group(1))
    return s

def orchestrator_test(s):
    if "'otp-n': 8000" in s:
        return s
    old = "'otp-c': 8000, telegram: 20000"
    assert s.count(old) == 1, 'timeout guard anchor'
    add = ''.join("'%s': 8000, " % i for i in IDS)
    return s.replace(old, "'otp-c': 8000, " + add + "telegram: 20000", 1)

def providers_test(s):
    title = 'wrangler.toml enables otp-j and otp-k at 38'
    start = s.find(title)
    assert start >= 0, 'order guard title'
    head, body = s[:start], s[start:]
    if "'otp-n'" in body[:3000]:
        return s
    pattern = re.compile(r"('otp-m',)(\s*)('otp-g')")
    m = pattern.search(body)
    assert m and m.start() < 4000, 'order guard otp-m/otp-g anchor'
    sep = m.group(2)
    insert = m.group(1) + sep + (',' + sep).join("'%s'" % i for i in IDS) + ',' + sep + m.group(3)
    body = body[:m.start()] + insert + body[m.end():]
    return head + body

edit('auth-native/verification/providers.mjs', providers)
edit('auth-native/verification/config.mjs', config)
edit('observability/otp-delivery-log.mjs', log_names)
edit('wrangler.toml', wrangler)
edit('verification-orchestrator.test.mjs', orchestrator_test)
edit('verification-providers.test.mjs', providers_test)
