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
- **Blocked on purpose — `/api/ai/status`: it must NOT move yet.** Status is a
  report about which AI engine and keys are available, and those keys are
  secrets on `admission-gk`. sky-ai has no `GEMINI_KEYS`/`GROQ_API_KEY`, so it
  would answer `providers: all false`, an empty chain and a default daily cap —
  a confidently wrong dashboard reading. Moving it is only honest after the keys
  (or the chat path that uses them) live in sky-ai.
- **F0.3–F0.8 — Todo.**
- **Next:** deploy this branch's worker, add the `SKY_FLAGS` KV binding, then continue
  F0.1 step 4 — move the remaining `/api/ai/*` routes into sky-ai one at a time, `/api/ai/chat` last.

## Work log (append at the bottom)
- 2026-10-25 · F0.1 step 4d · `POST /api/ai/recall` moved to sky-ai with the
  AI_STATE cross-script binding + `/health` dependency report + deploy assertion;
  42 sky-ai/routing tests and 78 AI/recall tests green · PR (this branch) ·
  next: `/api/ai/status` waits for the provider keys to live in sky-ai — the same
  prerequisite step 4h now checks at runtime.
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
