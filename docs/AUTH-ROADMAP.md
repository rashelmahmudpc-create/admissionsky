# AdmissionSky Auth Roadmap

এজেন্ট প্রতি session এ এই ফাইল পড়বে, প্রথম ⬜ বা 🟡 ধাপ থেকে কাজ শুরু করবে, আর শেষে চিহ্ন বদলাবে।
চিহ্নের মানে: ⬜ বাকি · 🟡 চলছে · ✅ শেষ

## 🤖 নিয়ম (সংক্ষেপে)
- আগের ✅ ধাপ শুধু এক লাইনে যাচাই; চালু code দেখতে Cloudflare থেকে `admission-gk` এর দরকারি অংশ grep; log দেখতে Worker telemetry।
- পড়া/খোঁজা/test/branch/commit/PR এ অনুমতি লাগবে না। **production deploy বা merge এর আগে মালিকের "হ্যাঁ" লাগবে।**
- প্রতিটা ধাপ আলাদা PR; আগে `admission-gk-staging` এ test।
- উত্তর সহজ বাংলায়, সংক্ষেপে।

## 📍 কোথায় কী আছে
| জিনিস | ঠিকানা বা নাম |
|---|---|
| GitHub repo | `rashelmahmudpc-create/admission-hub-demo` |
| Frontend | `account-access.js` |
| Backend auth | `auth-native/worker/public-auth-handler.mjs`, `auth-native/providers/firebase-auth.mjs` |
| Cloudflare account | `abb783e456e51a5d338419de93d5e576` |
| Worker | `admission-gk` (staging: `admission-gk-staging`, config `wrangler.staging.toml`, deploy `.github/workflows/deploy-staging.yml`) |
| Site | `admissionsky.pages.dev` → `admission-gk` |
| Firebase project | `admissionsky-997d2` |
| OTP ক্রম/quota | `VERIFICATION_ORCHESTRATOR_CONFIG` (Descope: `otp-l` = OTP, `otp-m` = Magic Link) |
| Email Gateway | `EmailGatewayCoordinator` (Durable Object) |
| মূল API | `/api/auth/v1/signup`, `/email-ownership/start`, `/email-ownership/verify`, `/password-reset` |
| Bot আটকানো | `TURNSTILE_SECRET_KEY` |
| OTP log / alert | `observability/otp-delivery-log.mjs` (`otp_delivery`, `otp_request`), `observability/otp-alert.mjs` (Telegram) |

## ⚠️ যা জানা আছে
- Signup করলেই Firebase এ account তৈরি হয়, OTP যাচাইয়ের আগেই।
- Forgot password এ শুধু Firebase link; Descope যুক্ত নেই।
- OTP পাঠাতে server এর ~৪ সেকেন্ড; provider এর নাম আর সময় এখন log এ আসে (PR #104)।
- Live OTP তে Brevo (`otp-a`, priority 10) বাদ পড়ে Logto আগে গেছে — quota বা availability check; ধাপ ৪ এ দেখতে হবে।
- Temp mail আটকানো আর অনুমোদিত domain তালিকা ঠিক আছে — হাত দেবে না।
- Worker Free এর ৬৪ variable সীমায় আছে — নতুন var যোগ করা যাবে না (secret বা code default ব্যবহার করো)।
- `admission-gk-staging` এ একটাও secret নেই (provider key, TG_BOT_TOKEN কিছুই না) — staging এ আসল OTP বা Telegram alert test করা যায় না, শুধু unit test।
- `wrangler.staging.toml` এ `AI_STATE` Durable Object binding নেই (production এ আছে) — staging test এ খেয়াল রাখো।
- OTP challenge আর ownership table (`auth_verification_challenges`, `auth_email_ownership_links`) এ `user_id` → `auth_users` FOREIGN KEY আছে — account ছাড়া (ভুয়া userId দিয়ে) OTP পাঠানো যাবে না। ধাপ ১ এর নকশা `docs/AUTH-STEP1-PLAN.md` এ।
- Sandbox এ `npm ci` চালাবে না (memory শেষ হয়ে আটকে যায়); bundle বড় (~১.৫ MB) হলে branch এ CI দিয়ে build করাও।

---

## 🧭 ধাপসমূহ

### ধাপ ০: সব কিছু দেখতে পাওয়া ✅
- [x] ✅ `wrangler.toml` এ log স্থায়ীভাবে চালু — `[observability] enabled = true` (PR #101), staging আর production দুটোতেই deploy হয়ে log আসা যাচাই করা হয়েছে
- [x] ✅ প্রতিটা OTP আর email এর জন্য log: provider এর নাম, কত সময় লাগল, ফল কী — `otp_delivery` / `otp_request` (PR #104)। Live যাচাই ১৮ অক্টোবর 15:30 UTC: Logto (`otp-h`), accepted, 6711 ms, rank 1
- [x] ✅ কোনো provider ব্যর্থ হলে বা ৩০ সেকেন্ডের বেশি দেরি হলে Telegram এ alert — `observability/otp-alert.mjs` (PR #106), production এ চালু; সফল OTP তে alert যায়নি (ঠিক আছে), ব্যর্থতার alert unit test দিয়ে প্রমাণিত

### ধাপ ১: OTP যাচাইয়ের পরে account তৈরি 🟡
- [ ] Signup ক্রম: নাম → জন্ম তারিখ → স্কুল/কলেজ → email → password; শুধু সাময়িকভাবে রাখা (১০ মিনিট, DO বা KV)
- [ ] OTP সঠিক হলে তবেই Firebase account → সাথে সাথে login → dashboard
- [ ] মাঝপথে ছেড়ে দেওয়া signup নিজে থেকে মুছে যাবে

### A1.5 ③: গার্ড স্বাস্থ্য + ১৫ মিনিটের চেক 🟡 → ✅ (কোড)
- [x] `.github/workflows/guard-health.yml` — প্রতি ১৫ মিনিটে main-এর ৮টা গার্ডের সর্বশেষ run দেখে, একটা লাল হলে Telegram-এ খবর; সব সবুজ হলে চুপ থাকে (AU-OB-03)
- [x] নিজের secret জোড়া (`GUARD_TELEGRAM_*`) আগে, generic পরে; OTP বট থেকে পাঠানো নিষিদ্ধ (AdmissionHubVerifyBot নাম দেখে আটকায়)
- [ ] staging-এ secret সরিয়ে অ্যালার্ট আসে কিনা যাচাই (লাইভ যাচাই বাকি)

### ধাপ ২: Bot আর অপব্যবহার আটকানো ⬜
- [ ] একটা device থেকে দিনে সর্বোচ্চ ৫টা OTP (signed cookie + fingerprint + IP বা /64 + ASN)
- [ ] Turnstile: signup আর OTP এর প্রতিটা request এ server নিজে token যাচাই; token ছাড়া বাতিল
- [ ] Cloudflare: Bot Fight Mode, আর OTP/signup পথে WAF rate limiting rule
- [ ] ডেটা সেন্টার/VPS ASN থেকে OTP request আটকানো বা কঠিন challenge
- [ ] Honeypot, অস্বাভাবিক দ্রুত form, headless browser চিহ্ন
- [ ] প্রতিটা স্তর test করে প্রমাণ রাখা

### ধাপ ৩: OTP পাঠানোর সময় student যা দেখবে ⬜
- [ ] সাধারণ loading; provider গ্রহণ করলে তবেই OTP বক্স
- [ ] ব্যর্থ হলে পরিষ্কার message আর "আবার চেষ্টা"
- [ ] সুন্দর countdown (গোল progress বা mm:ss)
- [ ] OTP দেওয়ার ২–৩ সেকেন্ডে dashboard

### ধাপ ৪: Provider এর ক্রম আর দ্রুত fallback ⬜
- [ ] সবার আগে: Brevo, AgentMail
- [ ] এরপর বাকিগুলো আগের ক্রমে
- [ ] একদম শেষে: spam এ যায় বা কম কাজ করে (যেমন Mailjet)
- [ ] সবার শেষে: Firebase link
- [ ] চলতে চলতে স্বাস্থ্য দেখে ধীর provider পিছনে সরানো
- [ ] ৫–৮ সেকেন্ডে সাড়া না দিলে পরেরটা; একই OTP দুইবার যাবে না

### ধাপ ৫: Forgot password 🟡 (৩১ অক্টোবর ২০২৬)
- [x] ✅ চেপে রাখা error (`USER_DISABLED` / `EMAIL_NOT_FOUND`) log এ — `reset_request` ইভেন্ট, শুধু reason code, কখনো ঠিকানা নয়; বাতিল হলে Telegram অ্যালার্ট (প্রতি কারণে ১৫ মিনিটে একবার)
- [ ] ⬜ নিজেদের `/reset` পাতা (password সেট করার স্ক্রিন) — **ইচ্ছাকৃতভাবে বাদ, নিরাপত্তার কারণে**: Firebase-এর Web API key দিয়ে link পাঠানো যায়, কিন্তু `oobCode` কোনো দিন ফেরত আসে না — যাচাই করা যায় শুধু Firebase-এর নিজের action page থেকে, `accounts:resetPassword`-এ। প্রমাণ ছাড়া ঠিকানা + নতুন password নেয় এমন endpoint মানে যে কেউ ছাত্রের ঠিকানা জানলে তার password বদলে দিতে পারবে। তাই password সেট হয় Firebase-এর নিজের পাতাতেই।
- [ ] ⬜ রিসেটের পর পুরনো সেশন বাতিল — **ইচ্ছাকৃতভাবে বাদ**: যে endpoint প্রমাণ ছাড়া শুধু সেশন বাতিল করে, সেটা দিয়ে যে কেউ ছাত্রের ঠিকানা জেনে তাকে যখন খুশি log out করে দিতে পারবে। Firebase password বদলালে তার নিজের refresh token নিজেই বাতিল করে; বাকিটা উপরের পাতার সাথে একসাথে আসবে।
- [ ] ⬜ প্রথমে Descope Magic Link (`otp-m`), ব্যর্থ হলে Firebase link — **ইচ্ছাকৃতভাবে বাদ**: `otp-m`-এর লাইভ ডেলিভারি কখনো মাপা হয়নি (`liveDeliveryVerified: false`), আর তার redirect একটাই — `?magic=1`, যা এখন email-ownership-এ বাঁধা। মাপা Firebase link-এর সামনে অমাপা provider বসালে ছাত্র আটকে যেতে পারে।
- [ ] ⬜ Magic link → নিজেদের `/reset` পাতা → নতুন password (উপরের দুইটার উপর নির্ভরশীল)
- [ ] ⬜ Firebase এ Custom action URL — **ইচ্ছাকৃতভাবে বাদ**: এতে Firebase Console-এ হাত দিতে হয়, আর password বদলানোর কাজটা Firebase-এর নিজের পাতাতেই থাকে।

### ধাপ ৬: চেনা device এ ৩০ দিন OTP লাগবে না ⬜
- [ ] OTP যাচাই/login সফল হলে device ৩০ দিন "চেনা" (signed cookie + server তালিকা)
- [ ] চেনা device এ সঠিক password → OTP ছাড়া login; নতুন device এ OTP
- [ ] আগে কিছু বানানো থাকলে শুধু ঘাটতি পূরণ

### ধাপ ৭: নতুন ফ্রি provider খোঁজা 🟡 (৩১ অক্টোবর ২০২৬)
- [x] ✅ নিজের domain লাগে না এমন ফ্রি email/OTP সেবা — নতুন কিছু কেনার দরকার পড়েনি: **Authgear (`otp-y`) আগেই chain-এ ছিল**, শুধু ৩৮-এ পিছনে পড়ে ছিল। কোনো key ছাড়াই চলে (public endpoint কোডে), তাই এটাই একমাত্র slot যেটা এই বক্স থেকে সরাসরি যাচাই করা যায়
- [x] ✅ গতি আর Inbox এ যায় কিনা মাপা — **স্যারের নিজের mailbox-এ দুটো provider পাশাপাশি**: Firebase-এর reset link **Spam**-এ, Authgear-এর কোড **Inbox**-এ। লাইভ round trip: send → Inbox **৫–৭ সেকেন্ড**, ভুল কোড false, সঠিক কোড true (temp mailbox দিয়ে প্রমাণ করা)
- [x] ✅ ভালোটা যোগ করা — `otp-y` ৩৮ → **১১**। Brevo (১০) এখনো সামনে, কারণ ওটাই আসল ছাত্রের inbox-এ যাচাই করা slot; Authgear দ্বিতীয়। **ছাত্র আটকানোর ঝুঁকি নেই** — Authgear খারাপ দিনে failover আগের মতোই Brevo-তে যায়
- [x] ✅ **বাইস-নিয়ম অটুট** — Gmail: Brevo > Authgear > Logto। Yahoo/iCloud: **Logto > Appwrite > Apps Script > AgentMail > Brevo > Authgear** (আগের ক্রম হুবহু)। Authgear-এ bias নেই, তাই সে কখনো Logto/Appwrite-এর আগে যেতে পারে না — নতুন টেস্ট সেটা পাহারা দেয়
- [ ] ⬜ Inbox-এ গেল না Spam-এ — এটা **শুধু মালিকের mailbox দেখে** বলা যায়; এই বক্সের IP-তে Cloudflare Turnstile পাস হয় না (error 600010), তাই ভিতরের endpoint দিয়ে placement যাচাই করা অসম্ভব। temp mailbox-এ Spam ফোল্ডারই নেই
- [ ] ⬜ বাকি ২০টা অমাপা slot একবার করে চালিয়ে দেখা — আজ শুধু প্রমাণিত provider-গুলোই সাজানো হলো; বাকিগুলো inert ও পিছনে, কোনোটা বন্ধ করা হয়নি

### ধাপ ৮: পুরো audit আর কাজ শেষ ⬜
- [ ] পুরো ধারা test: signup → OTP → dashboard, login, ৩০ দিন, forgot password, bot
- [ ] অব্যবহৃত/দুই নামের secret মুছে ফেলা (যেমন `BREVO_KEY` আর `BREVO_API_KEY`)
- [ ] প্রতিদিন নিজে একটা OTP পাঠিয়ে দেখা, ব্যর্থ হলে alert
- [ ] Deploy শুধু GitHub Actions দিয়ে, staging test এর পরে

---

## 📝 শেষ অবস্থা
- **শেষ session:** ২০ অক্টোবর ২০২৬ (৮ম) — শুধু পড়া ও পরিকল্পনা, code বা deploy হয়নি। বিস্তারিত: `AGENT_RESUME/2026-10-20-auth-a1-prep.md`
  1. `main` এ pending signup এর ফাইল (`pending-signup*.mjs`) আর test (`pending-signup.test.mjs`, `pending-signup-wire.test.mjs`) আছে; handler এ `p.` ticket ধারা যুক্ত। অর্থাৎ `AUTH-STEP1-PLAN.md` এর করণীয় ১–৪ এর code আছে, কিন্তু opt-in।
  2. নতুন ধারা production এ কার্যত বন্ধ (F-01): `/signup` (L739) এ `X-AH-Signup-Flow: pending-v1` লাগে, কিন্তু frontend `api()` (`account-access.js` L1458) এটা পাঠায় না। তাই এখনো আগে Firebase account।
  3. সিদ্ধান্ত: L739 এর শর্ত পুরো বাদ না দিয়ে `emailOwnershipRequested(env, url) && ...` — সুইচ বন্ধ থাকলে `/email-ownership/start` (L1250) বন্ধ, তখন pending signup শুরু করলে ছাত্র আটকাবে।
  4. `main` এ `apply-pending-signup-wire-20261018.yml` রয়ে গেছে — A8 এ সরাতে হবে।
- **যাচাই বাকি:** production `admission-gk` এ `VERIFICATION_AUTH_ACTIVATION` চালু কিনা (Cloudflare)।
- **পরের কাজ:** ধাপ ১ (ব্লুপ্রিন্ট A1) — branch `auth/A1-AU-UX-02-pending-signup-default`, রাত ১১–১২টা: PR ① handler শর্ত + একই উত্তর (AU-SEC-06), PR ② frontend `/signup` এ হেডার, PR ③ test + CI bundle; তারপর staging → মালিকের "হ্যাঁ" → merge।

## 📝 অবস্থা হালনাগাদ — ৩০ অক্টোবর ২০২৬ (AU-SEC-05, CORS-এর বাকি অংশ)

- **A1.5 ② এখন শেষ।** চারটা ফাইলে হাতে লেখা allowlist বাকি ছিল; তিনটাই একই ফাঁদ বহন করছিল:
  `gk-agent-worker.js`, `voice-worker.js`, `notification-worker.js`।
- **ফাঁদটা কী ছিল:** `([a-z0-9-]+\.)?` যেকোনো subdomain গ্রহণ করত, তাই
  `evil.admissionsky.pages.dev` (যে নাম মালিকের নয়) অ্যাপের নিজের origin হিসেবে পাস করত
  আর `Access-Control-Allow-Origin` + credentials পেত। ২২ অক্টোবরের D-5 সিদ্ধান্তে preview
  subdomain বাদ পড়েছিল, কিন্তু কপিগুলো পিছিয়ে ছিল।
- **লাইভ কখনো খোলা ছিল না** — request path handler দিয়ে যায়, সে `cors-policy.mjs` ব্যবহার করে।
  ফাঁদটা পরের refactor-এর জন্য অপেক্ষা করছিল।
- **ফিক্স:** তিনটা ফাইল এখন `cors-policy.mjs`-এর `allowedOrigin()` ডাকে; নিয়ম আর দুই জায়গায় থাকবে না।
  `auth-native/core/auth-engine.mjs` আগেই তাই করত।
- **সঙ্গে যা লাগল:** `voice-worker.js` আর `notification-worker.js` এক-ফাইল হিসেবে deploy হয়,
  তাই import কাজ করবে কিনা যাচাই করা হলো — `wrangler deploy --dry-run` চালিয়ে দেখা গেল wrangler
  নিজেই `cors-policy.mjs` upload-এ ঢুকিয়ে দেয়, তাই workflow বদলানোর দরকার নেই। ভবিষ্যতে কেউ
  `--no-bundle` দিলে যেন নীরবে না ভাঙে, সেই assertion টেস্টে রাখা হলো।
- **টেস্ট:** নতুন `cors-drift.test.mjs` (৩টা) — খারাপ host reject হয়, আর কোনো ফাইল হাতে নিয়ম
  লিখলে আটকে যায়। `p20` ও `ai-audit-fixes`-এর পুরোনো assertion (যা subdomain গ্রহণ করাকেই
  সঠিক বলত) উল্টে দেওয়া হলো। `p22`-র harness এখন shared policy ইনজেক্ট করে।
- **প্রমাণ:** পুরো suite ২৬১৫ টেস্ট · ২৬১০ পাস · ০ ফেল · ৫ skip; worker bundle ও sw-manifest সোর্সের সাথে মিলছে।
- **লাইভ deploy বাকি** — মালিকের "হ্যাঁ" পেলে `deploy-pages-worker.yml`, `voice-worker-deploy.yml`
  ও `notify-worker-deploy.yml` চালাতে হবে।
