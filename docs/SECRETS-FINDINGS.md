# BUG-005 — duplicate and dead secret names (findings only)

Audit item BUG-005. No secret was created, renamed or deleted. This records
what could be established read-only so the owner can decide.

## Evidence (from the 2026-10-19 token-health report)

- GitHub token `AUTOMATION_GITHUB_API` — valid.
- GitHub name `github_api` — invalid.
- Cloudflare `AUTOMATION_CLOUDFLARE_API_KEY_NEW` — valid.
- Cloudflare `AUTOMATION_CLOUDFLARE_API_KEY` — also valid.
- Cloudflare `NEWCLOUDFLARE_API` — also valid.
- Telegram `AUTOMATION_TELEGRAM_TOKEN` — missing; the bot path resolves no
  token.

Three Cloudflare names are valid for one purpose, one GitHub name is dead, and
the Telegram token is absent.

## Measured this session

None of the five names appears anywhere in source control:

- `admission-hub-demo` — 0 references across `*.mjs`, `*.js`, `*.py`, `*.yml`,
  `*.toml`.
- `openhands-for-inflowsky` — 0 references outside this audit's own handoff
  document.

So the duplicates are referenced by nothing that ships. That makes them safe
candidates for consolidation, but it does **not** make them safe to delete
unilaterally: the names carry the `AUTOMATION_*` prefix, which points at the
automation secret store rather than a repository secret, and that store is
live infrastructure.

## Why the Telegram gap matters

`AUTOMATION_TELEGRAM_TOKEN` being absent means the alert path depends on
`telegram_send.py`'s fallback resolution instead of a bound secret. A fallback
chain that silently succeeds is the failure mode to avoid: alerting appears
healthy while nothing is delivered. Setting the token explicitly, or asserting
its absence at startup, would make that failure loud.

## Recommended (owner decision — not done here)

1. Confirm the three Cloudflare names resolve to the same account/scope.
2. Keep one, remove the other two — after confirming nothing reads them.
3. Delete the invalid `github_api` entry.
4. Set `AUTOMATION_TELEGRAM_TOKEN`, or make its absence fail loudly.

Every step touches live credentials, so all four need the owner's explicit
go-ahead.
