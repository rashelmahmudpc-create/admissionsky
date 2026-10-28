# Cloudflare Worker inventory — 2026-10-19

Audit item BUG-006. The Cloudflare account runs 18 Workers while
`wrangler.toml` declares one, so drift is invisible: a Worker can be deployed,
left running and forgotten with nothing in source control to notice it.

This document is the register the audit asked for. It records what can be
established from source control and marks the rest as unowned, which is the
actionable part — an unowned Worker cannot be reviewed, updated or retired
with confidence.

## Method

Worker names were cross-referenced against this repository
(`*.toml`, `*.json`, `*.yml`, `*.mjs`, excluding `node_modules` and the built
`worker-bundle.mjs`). No Cloudflare API token is available to this workspace,
so the live account could not be queried; the list below is the audit's
inventory and the traceability column is measured, not assumed.

## Register

| Worker | In source control | Notes |
|---|---|---|
| `admission-gk` | yes | `wrangler.toml` — the production AI/API worker |
| `admission-gk-staging` | yes | `wrangler.staging.toml` |
| `admission-voice` | referenced | `voice-worker.js` exists; no `wrangler.toml` entry |
| `admission-hub-ai` | no | unowned |
| `admission-hub-ai-proxy` | no | unowned |
| `admission-hub-vault` | no | unowned |
| `admission-notify` | no | unowned; `notification-worker.js` exists unbound |
| `agent-hq` | no | unowned |
| `agent-hq-bot` | no | unowned |
| `ah-admin` | no | unowned |
| `ah-public` | no | unowned |
| `ahai-watchman` | no | unowned |
| `email-worker` | no | unowned; `email-gateway/` exists in-repo |
| `gk-temp-fetcher` | no | unowned — name suggests temporary |
| `sky-control` | no | unowned |
| `sky-xfer` | no | unowned |
| `study-pal` | no | unowned |
| `zayanday-vault` | no | unowned |

3 of 18 are traceable to this repository. The remaining 15 appear nowhere in
source control on this machine — only in conversation history, which is not a
deployment record.

## Why this matters

An unowned Worker is an unmonitored attack surface with its own secrets and
bindings. `gk-temp-fetcher` and `zayanday-vault` read as temporary or personal
and are the strongest retirement candidates, but that is inference from a
name, not evidence of disuse.

## Recommended next steps (owner decision — not done here)

1. Query the account for the 18 Workers with their routes, secrets and last
   deploy, so "unowned" becomes "confirmed active" or "confirmed idle".
2. Retire `gk-temp-fetcher`, `zayanday-vault` and any other Worker that step 1
   shows as idle and unreferenced.
3. Bring the survivors under source control, or record them here with an owner
   and a purpose, so the next drift is detectable.

Steps 1-2 change live account state and need a Cloudflare API token plus the
owner's explicit go-ahead. Nothing was retired or modified while writing this.
