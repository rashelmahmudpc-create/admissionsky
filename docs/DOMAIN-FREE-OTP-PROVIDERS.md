# Domain-free OTP providers

Which mailers can carry a login OTP when the owner does **not** own a custom domain.

## Why this matters

The email OTP slots (`otp-a`/`otp-b`/`otp-e`/`otp-f`/`otp-g`) are the ones that actually deliver login
codes. They are configured in `VERIFICATION_ORCHESTRATOR_CONFIG` in `wrangler.toml` and
built by `createConfiguredVerificationProviders` in
`auth-native/verification/providers.mjs`.

The eight-provider gateway under `email-gateway/` is a **separate** subsystem. Nothing in
the OTP path imports it, and `EMAIL_PROVIDER_ACTIVATION` is not set, so enabling a
gateway provider changes nothing about login. Do not confuse the two when planning work.

## Verified provider policy

Checked against official provider documentation, September 2026.

| Provider | Custom domain required | Sender verification | Free tier |
|---|---|---|---|
| **Brevo** | No | Confirm link to a single address | 300/day |
| **Mailjet** | **Yes in practice** | Confirm link accepted, but freemail sender stays DKIM/SPF Error | 200/day, 6,000/month |
| **SMTP2GO** | No | Confirm link to a single address | free plan caps at 5 senders; **Gmail excluded** by DMARC |
| **Elastic Email** | No | Single sender | 100/day |
| **Resend** | **Yes** | DNS record on the domain | 3,000/month, 100/day |
| **MailerSend** | No on the trial domain | Ships a signed trial domain | 500/month, 100/day |
| **Mailtrap** | **Yes** | Domain DNS | 4,000/month |
| **EmailOctopus** | — | — | no one-to-one transactional API; permanently ineligible for OTP |
| **Courier** | — | — | routes through another provider |

A Gmail sender address is the practical choice here: it needs no domain, but it carries
Gmail's DMARC record. That is why SMTP2GO rejects it. Brevo accepts it and delivers from a freemail address; Mailjet accepts it but never reaches delivered.

## Active slots

The **priority** column is the live order from `VERIFICATION_ORCHESTRATOR_CONFIG`. A4 ③ / D-3
(owner order 2026-10-31, option "ক") put the six senders whose delivery has actually been
measured at 10–35, so the first slot a student reaches always delivers. The remaining 20 slots
are **not disabled** — they keep their rows, quotas and circuits at priority 38, behind all six
and ahead of the locked last-resort pair. Failover is therefore unchanged; only the first choice
is.

| Priority | Slot | Provider | Daily cap | Notes |
|---|---|---|---|---|
| 10 | `otp-a` | Brevo | 300 | primary |
| 15 | `otp-h` | Logto | 1500 | mails and checks its own code; lands in Yahoo within seconds |
| 20 | `otp-i` | Appwrite | 1000 | mails its own code; the slot that reaches iCloud/Yahoo/Outlook |
| 25 | `otp-b` | Google Apps Script (Gmail) | 100 | needs the full 20s timeout; cold start measured at ~11s |
| 30 | `otp-e` | AgentMail | 100 | needs neither a domain nor a from-address |
| 35 | `otp-f` | MailerSend | 16 | sends from MailerSend's own verified trial domain |
| 38 | `otp-d` | Resend | 100 | needs a verified domain; owner-only until one exists |
| 38 | `otp-j`…`otp-za` | Ory, Hanko, Descope, pool mailers, hosted IdPs | varies | unproven for student delivery; reachable only after the six |
| 39 | `otp-g` | Dead Simple Email | 165 | **last resort**: inbox lives on a shared domain, so Gmail filters it to spam |
| 45 | `otp-c` | Mailjet | 200 | **last resort** (locked pair with `otp-g`): enabled by owner order, but a freemail sender never reaches delivered |
| 50 | `telegram` | Telegram bot | 172,800 | unchanged |

`otp-g` and `otp-c` are the owner-locked last-resort pair (instruction of 2026-10-14): both must
stay enabled, and no reliable mailer may sit behind them. That is why the unproven group stops at
38 rather than moving further back.

## Senders that reach arbitrary recipients without a custom domain

Most no-domain senders only deliver to the account owner, which makes them useless for
student OTPs. Measured by reading the receiving mailbox and its authentication headers:

| Sender | Cross-recipient | Evidence |
|---|---|---|
| AgentMail | works | recipient inbox received it |
| Dead Simple Email | spam | `delivered` to Gmail's servers, but the recipient found it in spam (shared `box*.deadsimple.email` domain, no sender reputation) |
| MailerSend trial domain | works | received with `spf=pass`, `dkim=pass`, `dmarc=pass` |
| Resend `onboarding@resend.dev` | owner only | acceptable, never delivered off-account |
| Elastic Email | fails | recipient MTA refused: `DKIM authentication didn't pass` |
| Mailtrap demo domain | owner only | API returns 403 for other recipients |
| Courier | fails | accepted 202, then `status: UNMAPPED`, no provider bound |
| Mailjet | fails | API returns `success`, Mailjet logs `Status: "sent"`, but no `delivered` event and the recipient never receives it |

## Why Mailjet cannot carry a freemail sender here

Mailjet validates the sender's own domain, so a `gmail.com` or `icloud.com` sender needs DNS
records on a zone the owner does not control. Validation ends in `DKIMStatus: Error` /
`SPFStatus: Error` and Mailjet reports `Status: "sent"` without ever reaching `delivered`.
MailerSend and AgentMail avoid this by sending from their own domain, which is why they are the
no-domain senders we rely on. Mailjet would need a domain the owner controls.



Total reachable email OTP capacity: **750/day** across the five no-domain senders
(`otp-a` Brevo, `otp-b` Apps Script, `otp-e` AgentMail, `otp-f` MailerSend, `otp-g`
Dead Simple Email), plus whatever Gmail accepts from `otp-b`. `otp-g` is the last
resort: its shared inbox domain lands in spam, so it only carries traffic once the
trusted senders above are exhausted. `otp-c` and `otp-d` stay dormant until their
senders are verified.

## Mailjet is disabled

`otp-c` is disabled in the orchestrator config. Mailjet signs with the sender's own domain, and
the account only holds freemail senders (`gmail.com`, `icloud.com`), so every validation ends in
`DKIMStatus: Error` / `SPFStatus: Error`. Sends still answer `Status: "success"` and Mailjet logs
`sent`, but the message never reaches `delivered` and the recipient never receives it, verified
against two independent senders. The slot becomes usable only if a domain the owner controls is
added to Mailjet.

## Checking a slot without reading a secret

`GET /api/auth/v1/config` reports `methods.backup.availabilityCode`. `READY` means at
least one OTP provider passed its sender check. Provider identities and per-slot state
stay server-side — they are deliberately never exposed to the client.

`GET /api/auth/v1/admin/verification/status` exposes per-slot state to an operator. It
requires the `X-AH-Admin-Token` header to match the `ADMIN_TOKEN` Worker secret and
returns 403 otherwise.
