#!/usr/bin/env python3
"""Realign OTP daily caps with each provider's FREE-plan allowance (owner 2026-10-22).

Idempotent: running twice is a no-op. Touches wrangler.toml and the two tests
that pin those caps. Never deploys.
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

NOTE = (
    "# Quota realignment (owner order 2026-10-22): every cap now fits the provider's\n"
    "# published FREE-plan monthly allowance divided by 30, so no slot runs dry mid-month.\n"
    "# otp-h Logto 5000 -> 1500 (free plan 50K MAU a month).\n"
    "# otp-i Appwrite 300 -> 1000 (free plan 75K MAU; per-IP abuse limit is the real ceiling).\n"
    "# otp-f MailerSend 100 -> 16 (free plan 500/month, 100/day).\n"
    "# otp-g Dead Simple 150 -> 165 (free plan 5,000/month).\n"
    "# otp-l + otp-m share one Descope project: 150 + 100 = 250/day (~7,500 MAU/month).\n"
)

EDITS = {
    "wrangler.toml": [
        ('{"id":"otp-h","enabled":true,"priority":15,"dailyQuota":5000', '{"id":"otp-h","enabled":true,"priority":15,"dailyQuota":1500', 1),
        ('{"id":"otp-i","enabled":true,"priority":38,"dailyQuota":300', '{"id":"otp-i","enabled":true,"priority":38,"dailyQuota":1000', 1),
        ('{"id":"otp-l","enabled":true,"priority":38,"dailyQuota":1000', '{"id":"otp-l","enabled":true,"priority":38,"dailyQuota":150', 1),
        ('{"id":"otp-m","enabled":true,"priority":38,"dailyQuota":1000', '{"id":"otp-m","enabled":true,"priority":38,"dailyQuota":100', 1),
        ('{"id":"otp-f","enabled":true,"priority":38,"dailyQuota":100,', '{"id":"otp-f","enabled":true,"priority":38,"dailyQuota":16,', 1),
        ('{"id":"otp-g","enabled":true,"priority":39,"dailyQuota":150', '{"id":"otp-g","enabled":true,"priority":39,"dailyQuota":165', 1),
        ('OTP_F_DAILY_QUOTA = "100"', 'OTP_F_DAILY_QUOTA = "16"', 1),
        ('OTP_A_DAILY_QUOTA = "300"\n', NOTE + 'OTP_A_DAILY_QUOTA = "300"\n', 1),
    ],
    "native-auth-protection.test.mjs": [
        ('"id":"otp-f","enabled":true,"priority":38,"dailyQuota":100/', '"id":"otp-f","enabled":true,"priority":38,"dailyQuota":16/', 1),
        ('"id":"otp-g","enabled":true,"priority":39,"dailyQuota":150/', '"id":"otp-g","enabled":true,"priority":39,"dailyQuota":165/', 2),
        ('OTP_F_DAILY_QUOTA = "100"/', 'OTP_F_DAILY_QUOTA = "16"/', 1),
    ],
    "compact-auth-config.test.mjs": [
        ("assert.equal(p.declaredDailyQuota, 5000);", "assert.equal(p.declaredDailyQuota, 1500);", 1),
        ("E: 100, F: 100 }", "E: 100, F: 16 }", 1),
        (".dailyQuota, 150);", ".dailyQuota, 165);", 1),
        ("  // sending limit, so this is our own safety ceiling, not a provider cap.\n",
         "  // sending limit, so this is our own safety ceiling, not a provider cap.\n"
         "  // Lowered 5000 -> 1500 by owner order 2026-10-22 to fit the free plan's 50K MAU/month.\n", 1),
    ],
}

if "Quota realignment (owner order 2026-10-22)" in (ROOT / "wrangler.toml").read_text():
    print("already applied")
    sys.exit(0)

for name, edits in EDITS.items():
    path = ROOT / name
    text = path.read_text()
    for old, new, count in edits:
        found = text.count(old)
        if found != count:
            sys.exit(f"{name}: expected {count} x {old!r}, found {found}")
        text = text.replace(old, new)
    path.write_text(text)
    print("patched", name)
