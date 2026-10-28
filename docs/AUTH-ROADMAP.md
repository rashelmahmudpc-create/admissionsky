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

### ধাপ ৫: Forgot password ⬜
- [ ] প্রথমে Descope Magic Link (`otp-m`), ব্যর্থ হলে Firebase link
- [ ] Magic link → নিজেদের `/reset` পাতা → নতুন password
- [ ] Firebase এ Custom action URL
- [ ] চেপে রাখা error (যেমন `USER_DISABLED`) log এ

### ধাপ ৬: চেনা device এ ৩০ দিন OTP লাগবে না ⬜
- [ ] OTP যাচাই/login সফল হলে device ৩০ দিন "চেনা" (signed cookie + server তালিকা)
- [ ] চেনা device এ সঠিক password → OTP ছাড়া login; নতুন device এ OTP
- [ ] আগে কিছু বানানো থাকলে শুধু ঘাটতি পূরণ

### ধাপ ৭: নতুন ফ্রি provider খোঁজা ⬜
- [ ] নিজের domain লাগে না এমন ফ্রি email/OTP সেবা খোঁজা
- [ ] গতি আর Inbox এ যায় কিনা test; ভালোগুলোই যোগ

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
