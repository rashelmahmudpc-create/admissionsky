# F-04 — moving auth out of `admission-gk` into its own Worker

Owner decision D-4 (2026-10-22): auth gets its own Worker. This is the design for
that move. Nothing here is implemented yet.

## Why

Today one script, `admission-gk` (`worker-bundle.mjs`), holds the student app,
the AI gateway, the OTP chain **and** the whole auth surface
(`/api/auth/v1/*` from `auth-native/worker/public-auth-handler.mjs`).

- A bad deploy of the app takes login down with it, and a bad auth deploy takes
  the app down. Neither has to be true.
- Auth-only secrets (Firebase, Turnstile, the mail provider keys, the HMAC
  secret) sit in the same script that serves AI traffic.
- One request budget for everything: a burst of AI calls and a student trying to
  sign in compete for the same Worker limits.

## Non-goals

- No change for the student. Same URLs, same cookies, same screens.
- No new paid service. Workers Free allows a second script at no cost.
- No database move in phase 1.

## The two facts that shape everything

1. **The session cookie is `SameSite=Strict`** (`public-auth-handler.mjs:69`).
   A separate hostname such as `admission-auth.workers.dev` would mean the
   browser never sends it. So the public origin must stay
   `https://admissionsky.pages.dev/api/auth/v1/*` and the split has to happen
   *behind* that URL, not in front of it.
2. **`AUTH_AUTHORITY` owns real student data.** `AdmissionAuthAuthority` keeps
   its SQLite tables (challenges, sessions, student directory) inside Durable
   Object storage. A DO instance is addressed by (script, class, id), so simply
   declaring the same class in a new script would give every student a **blank**
   authority — every session invalid, every pending OTP lost.

## Target shape

```
browser
  └─ admissionsky.pages.dev/api/auth/v1/*      (same origin, same cookie)
       └─ _worker.js on Pages                  (already proxies to the Worker)
            └─ admission-gk                   (public entry, unchanged URL)
                 └─ service binding AUTH_WORKER
                      └─ admission-auth        (new: auth logic only)
                           └─ script_name binding AUTH_AUTHORITY
                                └─ AdmissionAuthAuthority   (STAYS in admission-gk)
```

The Durable Object deliberately stays where it is: its storage is the data. Moving
the class to another script is a separate migration with its own plan, and it is
not needed for F-04 to pay off.

## Phases

**Phase 1 — stand up the script, route nothing.**
Build `admission-auth` from the same sources (`auth-native/**`), with its own
`wrangler.auth.toml` and a `fetch` entry that serves exactly the handler's
routes. Deploy it to `workers.dev` only. Verify with the existing auth test suite
plus a live `/api/auth/v1/config` call against the new script. Nothing points at
it, so nothing can break.

**Phase 2 — move the traffic, keep a switch.**
Give `admission-gk` the `AUTH_WORKER` service binding and a var
`AUTH_ROUTE: local | service`. In `service` mode the public route forwards to
`admission-auth`; on any transport error it falls back to the in-process handler
that is still there. Flip with a var change and the automatic deploy, and watch
signup, login, OTP, Google return and the Telegram webhook.

**Phase 3 — the new script gets the front's configuration.** *(runs before the
flip; the order below was wrong until it was checked against the code)*

`/config` reports a provider as available only when it is configured in the
script that answers the request. Forwarding before this phase would have shown
every student a login page where every method reads "unavailable" — and the
smoke test would still have passed on `ok:true`. So:

  * non-secret configuration moves into `wrangler.auth.toml`: the Firebase
    continue URL, the Google/passkey/verification activation flags, and the
    `GK_KV`/`PUB_KV` bindings the human-check store needs;
  * the secrets the front actually reads are bound by the auth deploy workflow
    from the same sources the app deploy uses;
  * the mail and OTP-provider keys deliberately do **not** move: delivery runs
    inside `AdmissionAuthAuthority`, which stays declared by `admission-gk`, so it
    keeps reading that script's environment;
  * `AUTH_HMAC_SECRET` and the Telegram bot tokens cannot be copied at all —
    Cloudflare secrets are write-only — so the one route that derives a secret
    from them (the inbound Telegram webhook) stays in process until they are
    re-issued for this script. That exception is `AUTH_ROUTE_LOCAL_PATHS`.

The auth smoke test now asserts `"available":true`, not just `"ok":true`: that is
the field that proves the cross-script authority answered.

**Phase 3b — measured, not guessed.** The Email Gateway deploy inventories the
secret names bound to `admission-gk` (run 40115355932), which turns this from a
guess into a list. What is actually there:

| name | on `admission-gk` | on `admission-auth` | effect of the gap |
|---|---|---|---|
| `AUTH_HMAC_SECRET` | present | absent | only the Telegram derivation routes; handled below |
| `TG_BOT_TOKEN`, `TG_CHAT_ID` | present | bound by the auth deploy | none |
| `TELEGRAM_AUTH_BOT_TOKEN` | **absent** | absent | none — `telegramLoginBotToken` already falls back to `TG_BOT_TOKEN` |
| `TELEGRAM_AUTH_WEBHOOK_SECRET` | **absent** | absent | none — the webhook secret is derived from `AUTH_HMAC_SECRET` anyway |
| `CANARY_EMAILS` | **absent** | absent | none — the decoy path is inactive on both scripts |
| `SHADOW_GUARD_ACTIVATION` | unset | unset | none — both resolve to the default OBSERVE mode |

So the honest position is much smaller than this document first claimed: **nothing
was degraded.** The earlier note that the decoy path and the shadow guard would be
"inactive on the new script" was wrong — they are inactive on the old one too, and
identically.

What genuinely cannot move is `AUTH_HMAC_SECRET`: a Cloudflare secret is
write-only, and re-issuing it changes every derived Telegram address and orphans
the accounts that sign in that way. It gates exactly two routes (`telegram/login`
and `telegram/webhook`), plus `/config`, which reports the whole environment and
so must be answered where that environment is complete. Those three stay in
process (`AUTH_ROUTE_LOCAL_PATHS`).

Closing 3b for real means routing the last two derivations through the authority
the way the login-email check already is. That is a code change, not a dashboard
step — the earlier claim that the owner had to re-issue values was wrong, because
the only value needed is one that must not change.

**Phase 2 and 3 are live** (2026-10-24): `AUTH_ROUTE = "service"`, and the app
deploy smoke-tests forwarded routes and fails unless the answers carry
`X-AH-Auth-Front: admission-auth`, so the split cannot be dead while the checks
are green. No students were on the platform at the time, which is why the flip
was made the same day.

Measured live, not assumed (app deploy run 40112401065):

| probe | answer | who answered | client address |
|---|---|---|---|
| `GET /api/auth/v1/session` | 401 | `admission-auth` | present |
| `GET /api/auth/v1/account` | 401 | `admission-auth` | present |
| `OPTIONS /api/auth/v1/session` | 204 | `admission-auth` | present |

The last column matters most: rate limits, the shadow guard and risk scoring are
keyed on the caller's address, and if the service-binding hop had dropped it,
every student would have shared one bucket and started blocking each other —
a quieter failure than an outage. `X-AH-Client-Addr` now reports it on every
deploy, and the app deploy fails if it ever reads `absent`.

One probe is deliberately *not* in that list: the public profile. It consumes a
rate slot per caller, and a deploy probe that spends the anonymous quota every
merge eventually fails for reasons unrelated to the split.

**Phase 4 — retire the local path.** Partly done: the app deploy now deploys
`admission-auth` before itself and shares the `admission-auth-deploy` concurrency
group with the auth workflow, so the entry never points at a stale auth and the
two uploads cannot collide.

What cannot be deleted yet is the in-process handler. `AUTH_ROUTE_LOCAL_PATHS`
needs it for `/config` and the Telegram routes, and those cannot move until phase
3b re-issues their secrets. So retirement is gated on 3b, not on time.

## Rollback

Every phase is reversible with a var flip or a redeploy of the previous bundle.
Phase 2 is the only one that touches live traffic, and its fallback is the code
already running today.

## Risks

| Risk | Handling |
|---|---|
| DO storage reset | Do not move the DO. Bind it cross-script. |
| Cookie / CORS breakage | Keep the public origin; the browser never learns a second host. |
| Double deploy forgetting one script | The deploy workflow publishes auth first, then the app. |
| Secret drift between scripts | Phase 3 sets the new copy before removing the old one. |
| Workers Free limits | Two scripts, each with its own daily request allowance — a small win, not a cost. |

## Open questions for the owner

1. Phase 3 order: can the auth secrets be re-set on a second script without
   touching the existing ones? (Yes, but it means typing the same keys twice —
   the deploy workflow can do it from the same GitHub secrets, no manual step.)
2. Do we want the teacher/student directory routes to follow auth later, or stay
   on `admission-gk`?
