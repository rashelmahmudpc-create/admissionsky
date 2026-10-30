# Sky AI — Agent Handoff Status (READ FIRST)

Source of truth: Notion "Sky AI v1.0" → main page section **"🚦 এজেন্ট হ্যান্ডঅফ বোর্ড"**
(https://app.notion.com/p/3fe578b86589812da119f975cdf1881a). This file mirrors it.

## Rules for every agent (mandatory)
1. **Before starting:** read the Notion handoff board, the task status in
   Notion page 07, this file, and the task doc `docs/sky-blueprint/<task>.md`.
   Verify against real files / live URLs. Never redo a step marked ✅ or 🟡-done.
2. **After every finished step (immediately, before reporting):**
   - update "Current status" below and on the Notion board,
   - add one line to the work log: `date time · task ID · what · commit/PR · next step`,
   - mark the task in Notion 07 (🟡 Doing / ✅ Done; tick the checkbox only when fully Done).
3. **Out of time (Study Lock 23:00–23:59 Dhaka):** still write
   "🟡 Doing — where I stopped, which branch/PR".
4. **Mismatch:** repo / live URL wins over Notion. Fix Notion first, log it as a correction.

## Current status (2026-10-21 23:20 Dhaka)
- Phase: **F0 — Doing**
- **F0.1 / DV-01 — Doing.** Steps 1–3 ✅: `sky-ai/` Worker live
  (https://sky-ai.admissionhub.workers.dev/health), `sky-ai-deploy.yml`,
  `SKY_AI` service binding in admission-gk forwarding only `GET /api/ai/sky-health`.
  **Left: step 4** — move `/api/ai/*` routes one by one behind a flag, `/api/ai/chat` last
  (provider secrets must be added to sky-ai by the owner). See `F0.1-DV-01.md`.
- **F0.2 / DV-02 — Doing.** ✅ `sky-ai/flags.mjs` (+tests), `GET /api/ai/sky-flags` in sky-ai,
  ✅ **2026-10-24: admission-gk now answers the route** (`public-worker.js`, forwarded with the
  uid via `SKY_AI_IDENTITY_ROUTES`; a guest keeps the all-off defaults). Live check the same
  night showed the public URL answering 404 before this change. All defaults OFF.
  **Left:** deploy `admission-gk`, create the `SKY_FLAGS` KV namespace + binding on sky-ai
  (override needs it; without it the defaults apply), then use a flag for real routing.
- **F0.1 step 4d ✅ (2026-10-25): `POST /api/ai/recall` moved into sky-ai.**
  Bound the shared `AI_STATE` Durable Object cross-script (`script_name =
  "admission-gk"`) so recall reads the SAME memory store. `/health` now reports
  that binding (`deps.aiState`), and the app deploy fails if it is not `ok` —
  because a missing binding degrades recall to "nothing yet" instead of erroring.
  `sky-ai-route.mjs` gained `SKY_AI_POST_IDENTITY_ROUTES`; rollback is removing
  the one entry. Deploy order: `deploy-pages-worker.yml` now deploys sky-ai
  before admission-gk.
- **F0.1 step 4e ✅ (2026-10-25): `/api/ai/instructions` moved (GET/POST/DELETE).**
  First moved route that WRITES. The write is safe to repeat (same note, only the
  saved-at stamp moves), the verification rules stay in `sky-instructions.mjs`
  and are imported, not copied, so a refusal is identical on both sides. The
  forwarder is now method-aware (`SKY_AI_BODY_IDENTITY_ROUTES`), and
  `public-worker.js` reads the body AFTER forwarding — reading it first would
  have left the fallback with nothing and a failed save would have cleared the
  note.
- **F0.1 step 4f ✅ (2026-10-25): `/api/ai/memory/clear` moved (POST).**
  First moved route that DESTROYS data. Safe to hedge only because deleting is
  idempotent; a lost answer costs one harmless retry, never a half-cleared
  account. `clearAiEverything()` in `ai-agent.js` is now the single definition of
  what "forget" covers — the four KV keys that used to be deleted inline in
  `public-worker.js` moved into it, so the two callers cannot drift.
- **F0.1 step 4g ✅ (2026-10-25): `/api/ai/actions/propose` + `/api/ai/actions/confirm` moved (POST).**
  The write/execute layer. `proposeAction()` / `confirmAction()` moved out of
  `public-worker.js` into `ai-actions.mjs`, and both sides now run the same code —
  a copy would have let the two sides disagree about single-use or ownership.
  **The kill switch is now honoured across the hop:** sky-ai has no
  `USE_WRITE_ACTIONS`, so admission-gk forwards only while its own switch says
  enabled; otherwise the layer could be resurrected by a forward. A retry after a
  lost answer cannot double-apply anything, because the proposal is consumed
  before the write.
- **F0.1 step 4h ✅ (2026-10-25): `/api/ai/chat` + `/api/ai` moved (POST) — the last route.**
  The model call. Unlike every earlier step this one needs CREDENTIALS, not just
  code, so it is built to move itself the moment they exist:
  - `sky-ai/chat.mjs` compares the provider names admission-gk says it can reach
    (`x-sky-need-providers`) with its OWN readiness and returns null if one is
    missing — so a room with a partial key set can never answer with a weaker free
    model and no error anywhere. Null → 404 → admission-gk answers as today.
  - Daily cap + model overrides cross the hop, so the two rooms cannot answer
    differently for the same request.
  - **One request id per chat** (`x-sky-req-id`) reaches the quota counter from
    both sides, so a retried chat replays the first decision instead of spending a
    second message from the student's daily allowance.
  - `/health` now reports `providers: [...]` (names only), and the deploy prints
    whether chat is live in sky-ai or still on the fallback. Both are correct; it
    must simply never be silent.
  - **To complete 4h the provider keys must reach sky-ai** (`GEMINI_KEYS`,
    `GROQ_API_KEY`, …). Until then chat is served by admission-gk exactly as
    before — same code, same answer, one extra header check.
- **F0.1 step 4i ✅ (2026-10-25): `/api/ai/status` moved (GET) — the split is complete.**
  This one was blocked for a day because a status served from a room without the
  provider keys would have reported `providers: all false` and an empty chain — a
  confidently wrong dashboard. Step 4h proved the keys are visible from sky-ai;
  only then does this route become honest.
  - **The redaction did NOT move.** The owner-only fields are hidden by
    `redactAiStatus()` in `public-worker.js`, applied to the forwarded answer and
    the local one through the same function, because `ADMIN_TOKEN` — the owner's
    proof — exists only there. A copy of the field list on the far side would be
    free to drift, and BUG-002 already showed how that ends: six more names had to
    be added to the list after the fact.
  - The provider-parity check moved into `sky-ai/parity.mjs`, now shared by chat
    and status, and the daily cap + model overrides cross the hop so a report
    describes the deployment that really exists.
  - The deploy now asks the public endpoint the question a stranger would — does a
    caller without the owner token get `providers`, `chain`, `limits`, `tools`? —
    and goes red if it does.
- **F0.1 step 4j ✅ (2026-10-25): the credential question, answered by measurement.**
  The keys are already in ONE place — KV `secret:AI_KEYS` (a JSON blob) plus
  `secret:<NAME>` fallbacks — and *both* Workers bind that same KV namespace, so
  moving them is not a copy job. The real risk was narrower: a provider secret that
  exists only as an env var on admission-gk is invisible here, and chat then falls
  back silently.
  - `/health` now reports `parity: { ok, needed }`, computed by the SAME function
    the routing gate uses (`missingProviders`), so the report cannot disagree with
    what chat would really do.
  - `gk-agent-worker.js` sends `x-sky-need-providers` on the sky-health probe
    (names only, never a key), so the comparison can happen at all.
  - The deploy reads `parity.ok`: green notice = every provider admission-gk can
    reach is reachable here; warning = a mismatch, with the fix named (put the key
    in KV `secret:AI_KEYS` so both rooms read it). Reported, not failed — the
    fallback keeps students working and the fix is a credential, not code.
  - **Ordering lesson (first deploy of 4j):** the step ran BEFORE `Deploy Worker`
    and reported "no parity field" on a healthy deploy, because it asked the
    PREVIOUS admission-gk whether the NEW sky-ai matched — the header it needs is
    produced by the deployment being measured. Moved after `Deploy Worker`, and the
    report now distinguishes three outcomes (ok / mismatch / unknown) instead of
    lumping "could not compare" in with "does not match".
- **F0.1 step 4k ✅ (2026-10-25): the parity check found a real gap, and closed it.**
  The first honest reading of 4j was `parity: { ok: false, needed: [..., "cloudflare"] }`
  — admission-gk could reach Cloudflare Workers AI and sky-ai could not, so chat had
  been quietly answered by the fallback all along. Not an outage; simply not moved.
  - `ai-key-sync.mjs` copies any credential that exists only in admission-gk's
    environment into KV `secret:AI_KEYS`, where both rooms read it. It runs off the
    request path (`ctx.waitUntil`), once per isolate, merges only MISSING names,
    never overwrites a rotated KV value, refuses to touch an unparseable blob, and
    logs names — never values. Tests cover each of those refusals, plus the
    property that matters: after a sync, the other room computes the same
    readiness from the same namespace.
- **F0.1 step 4l ✅ (2026-10-27): the store was observed first, and it named the bug.**
  The deploy after 4k reported the **opposite** of what it intended: sky-ai's
  provider list came back *empty* and parity wanted *more* names, not fewer. The
  sync is the only writer of `secret:AI_KEYS`, and its logic is additive, so the
  change cannot explain the result — which means the write may have damaged the
  blob, or the blob was already damaged and the sync merely exposed it. Guessing
  between those two costs the same in credentials as getting it wrong.
  - The automatic sync is now **off unless `AI_KEY_SYNC=on`**; `force` still
    works, so the module and its tests stay honest.
  - `/health.aiKeys` reports the **shape** of `secret:AI_KEYS` —
    `{present, count, providers, reason}` with `reason` in
    `no-kv | absent | read-failed | unparseable | not-an-object`. Never a value,
    never a length, never a prefix. That distinguishes "one credential is missing"
    from "the whole file is gone", which need different fixes.
  - The deploy prints that shape as `Sky AI key file` and warns when the blob is
    absent or unreadable, so the answer arrives with the deploy rather than in a
    session that has no Cloudflare credentials.
  - **Observed (deploy 40553147983):** `Sky AI key file {"present":true,"count":3,
    "providers":["CLOUDFLARE_ACCOUNT_ID","CLOUDFLARE_AI_API_KEY","GEMINI_KEYS"]}` and
    `Sky AI parity ok ["cloudflare","gemini"]`. The file exists, and both rooms read
    the same names — what 4k set out to achieve is true.
  - **What went wrong, now provable from the code:** that file holds exactly the
    names admission-gk carries in its *own environment*. The six KV-only names
    (cerebras, cohere, groq, mistral, openrouter, vercel) are gone. The sync's read
    came back empty, and the old code treated an empty read as `{}` — so its merge
    was correct and its input was not, and it wrote env-only names over a file that
    held eight. From inside a Worker a KV miss and a missing key look identical.
  - Fixed in the same change: `syncProviderKeysToKv` now refuses to write unless it
    read a NON-EMPTY object — `skipped: 'no-blob'` for a miss, `empty-blob` /
    `not-an-object` / `unreadable` for a bad file, `would-shrink` as a final guard —
    and it never creates the file; `ai-key-set.yml` (owner-authorised) does that.
    Six new tests hold those refusals, including the exact accident: eight names in,
    none lost. The automatic pass stays **off**: parity is ok, so it has nothing
    left to add.
  - The six lost names can only be re-entered from the provider dashboards. Chat
    does not need them: it is answered by `cloudflare` and `gemini`, and the
    fallback to admission-gk is untouched.
  - **Lesson:** a write to a shared credential store is not an experiment to run
    twice. Observe the store first, state the fix from what is observed.
- **Superseded — `/api/ai/status` blocking note.** Status is a
  report about which AI engine and keys are available, and those keys are
  secrets on `admission-gk`. sky-ai has no `GEMINI_KEYS`/`GROQ_API_KEY`, so it
  would answer `providers: all false`, an empty chain and a default daily cap —
  a confidently wrong dashboard reading. Moving it is only honest after the keys
  (or the chat path that uses them) live in sky-ai.
- **F0.3–F0.8 — Todo.**
- **Next:** deploy this branch's worker, add the `SKY_FLAGS` KV binding, then continue
  F0.1 step 4 — move the remaining `/api/ai/*` routes into sky-ai one at a time, `/api/ai/chat` last.

## Work log (append at the bottom)
- 2026-10-27 · F0.1 step 4l, outcome · deploy 40553147983 printed the file's shape:
  3 names, and `parity ok [cloudflare, gemini]` — both rooms read the same keys, so
  4k's goal holds. The 3 names are exactly admission-gk's env names, which is the
  proof: the sync's read came back empty and it wrote env-only names over a file of
  eight. Now it refuses to write unless it read a non-empty object, and never
  creates the file · 16 key-sync tests + 77 AI/routing/wiring tests green, both
  bundle guards clean · next: the four kept PRs, then F0.2 `SKY_FLAGS`.
  reports the shape of KV `secret:AI_KEYS` (present/count/providers/reason, never a
  value) and the deploy prints it as `Sky AI key file` · 13 key-sync tests + 116
  sky-ai/routing/binding tests green · shell guard now also runs on `ai-agent.js`,
  `ai-key-sync*` and `sky-ai/**` so these suites cannot be skipped again · next:
  read the shape from a deploy, restore whatever is missing, only then re-arm.
- 2026-10-25 · F0.1 step 4d · `POST /api/ai/recall` moved to sky-ai with the
  AI_STATE cross-script binding + `/health` dependency report + deploy assertion;
  42 sky-ai/routing tests and 78 AI/recall tests green · PR (this branch) ·
  **All /api/ai/* routes now live in sky-ai.** Remaining F0.1 follow-ups are not
  route moves: F0.2's `SKY_FLAGS` KV binding, and deciding which credentials sky-ai
  should own outright now that it serves every route.
- 2026-10-25 · F0.1 step 4e · `/api/ai/instructions` (GET/POST/DELETE) moved;
  method-aware forwarder + body-read-order test · 52 sky-ai tests green.
- 2026-10-25 · F0.1 step 4f · `/api/ai/memory/clear` moved; "forget" now defined
  once in `clearAiEverything()` · 62 sky-ai tests, 76 AI tests green ·
  `/api/ai/status` held back (no provider keys in sky-ai).
- 2026-10-25 · F0.1 step 4g · `actions/propose|confirm` moved; handlers extracted
  to `ai-actions.mjs` so both sides run one copy; kill switch gated at the call
  site · 73 sky-ai tests, 88 AI/action tests green · next: `/api/ai/chat`.
- 2026-10-25 · deploy · Two blockers found while publishing 4g, both outside the code.
  1. `Study Lock Timer` failure mode: when the lock engages it also sets the repo's
     allowed-actions list to empty, so any workflow using a third-party action
     (`cloudflare/wrangler-action`) fails as `startup_failure` — the deploy dies
     before a job exists, with no annotation to say why. Guards using only
     `actions/*` keep passing, which makes it look like nothing is wrong. Restoring
     "Allow all actions" is what unwedges it.
  2. Added **Verify the deployed sky-ai build is this commit**: the existing
     `aiState=ok` check proves the binding works, not that this commit is live. The
     run now compares the repo's `SKY_AI_VERSION` with the version the Worker
     reports, so a stale or no-op upload goes red instead of looking successful.
- 2026-10-19 · — · Blueprint v1.0 created (Notion).
- 2026-10-20 (approx.) · F0.1 steps 1–3 + F0.2 flags.mjs · merged to main, sky-ai deployed · (Notion not updated at the time).
- 2026-10-21 23:20 · handoff system · Notion board + pages 07/09 updated, this file added · next: F0.1 step 4a.
- 2026-10-24 23:2x · F0.2 · `GET /api/ai/sky-flags` was 404 on the public host: sky-ai has served it
  since F0.2, admission-gk had no handler. Added the handler (`forwardWithIdentity`, guest keeps
  all-off defaults), listed the route in `SKY_AI_IDENTITY_ROUTES`, +2 pins, worker bundle rebuilt,
  sky-ai suites 24/24 · `4b467b3` on `cline/yc69z6y0` · next: deploy (worker creds absent in that
  session) + `SKY_FLAGS` KV binding.
- 2026-10-30 22:5x · **live check of the daily-audit commit `80cc083`** (SEC-002/004, CI-001,
  CF-001; run `41090270212`, jobs pages + worker green). Verified from outside, not from the diff:
  - **SEC-002 ✅ dead on both Pages projects.** `admissionhub.pages.dev` and
    `admissionsky.pages.dev` both answer **404 (9 B)** for `/auth-worker-bundle.mjs` and
    `/worker-bundle.mjs`; the home page still answers 200. The new
    `bundle-asset-coverage` guard is **non-vacuous** — deleting the rsync exclude fails it with
    `auth-worker-bundle.mjs (would be served as a public asset)`.
  - **SEC-004 ✅ live.** `Deploy sky-ai` ran in `41090270212` (`/api/ai/prefs` → 200, no
    `Access-Control-Allow-Origin` at all). sky-ai's own host stays 404 (`workers_dev = false`
    since `f4a3b1e`) — that 404 is by design, not a regression.
  - **CI-001 ✅** the live GitHub copy of `visual-guard.yml` is `permissions: contents: read`;
    the write scope exists only inside the `save-baseline` job. It is the only workflow in the
    repo that combines `pull_request` with `contents: write`.
  - **CF-001 ⚠️ unproven live.** `cloudflare-drift.yml` has **zero runs** — the cron is
    `17 6 * * *`, so the first run is 2026-10-31 06:17Z, and a dispatch from this session's token
    is 403. Offline half passes (`cloudflare-drift.test.mjs` 6/6). Needs one green scheduled run
    before it can be called working.
  - **SEC-003 ❌ still dead — the green run hides it.** Step "Bind the alert-proxy signing secret
    (SEC-003)" **succeeded only because it exits 0 by design**, and its log says
    `##[warning]ALERT_PROXY_SECRET is not set, so POST /api/report-error is still rejected 403
    and browser errors never reach Telegram`. Live probe agrees: `POST /api/report-error` → 403.
    Adding the repository secret is an owner action; until then the alert channel is off.
  - **`Guards Health (15 min)` ⚠️ does not hold 15 minutes.** Cron is `*/15 * * * *`, but the real
    runs today were 04:37Z and 11:02Z only (yesterday: 23:54Z) — GitHub throttles high-frequency
    schedules, so a red guard can page the owner hours late. Either accept the ~6h worst case or
    drive the check from an external minuter.
  - Bumped `SKY_AI_VERSION` 4l → **`4m-no-cors`** in the same session: SEC-004 changed shipped
    sky-ai behaviour without bumping it, so "Verify the deployed sky-ai build is this commit" was
    a no-op for that change. **Rule: every sky-ai behaviour change bumps `SKY_AI_VERSION`**, in
    the same commit as the change.
  - next: owner adds `ALERT_PROXY_SECRET`; watch the first `cloudflare-drift` scheduled run; then
    F0.2 `SKY_FLAGS` KV binding (live `GET /api/ai/sky-flags` still reports
    `{"flags":{},"source":"gk-fallback"}`).
