# ২০২৬-১০-২৫ — চেকলিস্টের প্রতিটা লাইন যাচাই

**যাচাইয়ের সময়:** ২০২৬-১০-২৫ রাত ২৩:১৯–২৩:৫৯ (ঢাকা, Study Lock-এর ভেতরে)
**রিপো:** `rashelmahmudpc-create/admissionsky` — HEAD `fdcf014` (main)
**লাইভ:** https://admissionsky.pages.dev — HTTP 200
**নিয়ম:** Notion নয়, **লাইভ + রিপোই প্রমাণ**। যেটা যাচাই করা যায়নি সেটা আলাদা করে লেখা হয়েছে।

---

## ১. লাইভে যাচাই হয়েছে (প্রমাণ আছে)

| দাবি | প্রমাণ | ফল |
|---|---|---|
| লাইভ সাইট চালু | `curl /` → 200 | ✅ |
| canonical আছে | `/`-এ `<link rel="canonical" href="https://admissionsky.pages.dev/">` | ✅ |
| লাইভ শেল = রিপো | `/sw.js` → `BUILD_ID = 'v364-sky-goal'`, রিপোর `sw.js`-এও একই | ✅ |
| Sentry ব্রাউজার রিপোর্ট লাইভ | `/`-এ `sentry-report.js?v=sentry-v2`, ফাইলটা লাইভে সার্ভ হয় | ✅ |
| Sentry টেস্ট | `node --test sentry-report.test.mjs` → **২৪/২৪ পাস** | ✅ |
| Sentry কোড main-এ আছে | `cafe928`, `02a6739` — main-এর পূর্বপুরুষ, পুশ হয়ে গেছে | ✅ |
| পাসওয়ার্ড গার্ড কোড | `auth-native/core/password-guard.mjs`, টেস্ট **১৫/১৫ পাস** | ✅ |
| পাসওয়ার্ড গার্ড ওয়্যারড | `public-auth-handler.mjs:953–979, 1037–1055` (চেক → ব্লক → রেকর্ড → সফলে রিসেট) | ✅ |
| Shadow Guard কোড | `shadow-guard.mjs` + `canary-accounts.mjs`, টেস্ট **২৫/২৫ পাস** | ✅ |
| Shadow Guard ওয়্যারড | `public-auth-handler.mjs:12, 137, 943–1025` (observe/enforce/off) | ✅ |
| GitHub Pages বন্ধ | `gh api repos/.../pages` → 404, `has_pages: false` | ✅ |

**এর মানে:** চেকলিস্টে "বাকি" লেখা **খ৩ (Sentry), চ১–চ৭ (পাসওয়ার্ড গার্ড), ছ১–ছ৯ (Shadow Guard)** —
এই তিনটার **কোড ও টেস্ট আগেই শেষ এবং পুশ করা আছে**। শুধু নিচের দুটো কাজ বাকি।

## ২. সত্যিই বাকি (লাইভ বা রিপোতে নেই)

1. **ঙ২ — about আর contact পেজ নেই।** `/about` → 404, `/contact` → 404, রিপোতে `about*`/`contact*` ফাইল নেই। এটাই সবচেয়ে পরিষ্কার "করা বাকি" কাজ।
2. **চ৩ — ভুল পাসওয়ার্ডে "আর কতবার" বার্তা — এখন করা হয়েছে (এই কমিটে)।**
   সার্ভার (`public-auth-handler.mjs`) ভুল পাসওয়ার্ডে `attemptsRemaining` পাঠায়, ক্লায়েন্ট
   (`account-access.js`) সেটা দেখিয়ে লেখে "আর ২ বার ভুল হলে কিছুক্ষণের জন্য বন্ধ হবে।",
   আর ইংরেজি মোডে `language-engine.js`-এর `RULES` সেটাকে ইংরেজি করে।
  সঙ্গে: `?v=` + `BUILD_ID` → `v365-pw-guard-hint`, `sw.js` digest নতুন করে লেখা।
   টেস্ট: `language-engine.test.mjs` ১২/১২ (নতুন রুল-টেস্টসহ), `password-guard`/`shadow-guard`/
   `native-auth` ৯৭/৯৭, `account-retirement`+`code-native-welcome`+`profile-ui` ৬৭/৬৭,
   `check:worker-bundle` ও `check:auth-worker-bundle` — দুটোই ০।
   `fcm-global-contract.test.mjs`-এ ২টা ফেল আছে, কিন্তু সেটা **আগের থেকেই** (`/tmp/base` worktree-তে
   HEAD-এও একই ২টা ফেল), এই বদলের কারণে নয়।
   (**এখনো বাকি:** গার্ড ব্লক করা চালু করা, অর্থাৎ নিচের ৪ নম্বর।)
3. **গার্ড চালু করা বাকি (activation)।** `SHADOW_GUARD_ACTIVATION` সেট না থাকায় ডিফল্ট **observe** —
   পাসওয়ার্ড গার্ড কেবল গুনছে, আটকাচ্ছে না। `enforce` করলে ছাত্র আটকানোর ঝুঁকি তৈরি হয়,
   তাই আপনার **হ্যাঁ** ছাড়া করব না (আপনার নিয়ম ২)।
4. **জ৪ — রিপো এখনো পাবলিক।** `gh api .../admissionsky` → `private: false`, `visibility: public`।
   (GitHub Pages অংশটা ইতিমধ্যেই বন্ধ, উপরের টেবিল দেখুন।)
5. **গ৬ — Firebase web key রিভিউ।** রিপো পাবলিক থাকায় যে-কেউ `AIza…` web key পড়তে পারে।
   Web key পাবলিক হওয়াই স্বাভাবিক, কিন্তু Firebase Console-এ **API restrictions** না থাকলে
   অন্য সাইট থেকে কোটা খরচ হতে পারে — এটা Console-এ চোখে দেখে নিশ্চিত হতে হবে, কোড দিয়ে বোঝা যায় না।

## ৩. নতুন সমস্যা (সবচেয়ে বড়) — আজ কোনো ডিপ্লয়ই হতে পারেনি

**লক্ষণ:** `Deploy Pages UI + Worker (manual)` রান `40215708666` (push, `fdcf014`) আর
`40216187997` (push, `ad7d972`) — দুটোই **`startup_failure`**, `jobs: 0`, `started_at: null`।
একই পুশে Bundle Guard / Account Retirement / Email Gateway / Voice Agent Guard **success**,
তাই Actions বন্ধ নয় — শুধু `uses:` ব্যবহার করা ওয়ার্কফ্লোগুলোই মরে যাচ্ছে।

**আসল কারণ (GitHub-এর নিজের এরর মেসেজ, রান পেজ থেকে):**

> The action `cloudflare/wrangler-action@9acf94…` is not allowed in
> `rashelmahmudpc-create/admissionsky` because all actions must be from a repository owned by
> `rashelmahmudpc-create` or created by GitHub.

অর্থাৎ রিপোতে এখন **third-party action বন্ধ**। এটা `study-lock-timer.yml` নিজেই করে
(লক লাইনের ২ নম্বর ধারা: "blocks all `uses:` actions")। কিন্তু ওই টাইমার নিজেই
**২৪ তারিখের পর থেকে প্রতিবার ফেল করছে**, তাই লক খোলার কাজটাও হয় না:

- লেটেস্ট ৭টা `schedule` রানই `failure` (শেষ সফল `2026-10-24T15:50Z`, সেদিন ছিল
  আপনার একদিনের ছুটি → `ACT=all` পথ, তাই পাস করেছিল)।
- এরর (রান `40209784765`): `gh: You cannot have 'verified_allowed', 'github_owned_allowed',
  and 'patterns_allowed' all disabled at the same time. … set 'local_only' … (Conflict)`
  → `exit code 1`, তাই `allowed_actions=selected` সেট হয়েই আটকে থাকে = সব `uses:` ব্লক।
- আজ ২৩:০৩ / ২৩:২০ ঢাকার "খোলার" cron রানগুলো **চলেইনি** (`17:03Z`/`17:20Z` কোনো রান নেই),
  তাই ২৩:১৭-এ পুশ হওয়া কমিটও ডিপ্লয় হতে পারেনি।

**ঠিক করার লাইনটা (আপনার নিজের হাতে, কারণ Study Lock ফাইল আমি ছুঁব না):**
`study-lock-timer.yml`-এ `{"github_owned_allowed":false,"verified_allowed":false,"patterns_allowed":[]}`
এর জায়গায় GitHub-এর নিজের পরামর্শ অনুযায়ী
`{"allowed_actions":"local_only"}` (অথবা `github_owned_allowed: true`) বসালেই লক-পথ আর ফেল করবে না।
এরপর `npx wrangler` দিয়ে ডিপ্লয় করা যায় (ওটা `uses:` নয়, তাই ব্লকে পড়ে না) — কিন্তু
টাইমার ফাইল/সিক্রেট বদলানো আমার কাজ নয়, লক নিজেই তা নিষেধ করে।

**সংশ্লিষ্ট লক্ষণ:** লাইভ `sw.js` এখনো `v364-sky-goal`; `sky-ai/`-এর আজকের বদল সত্যিই
ডিপ্লয় হয়েছে কিনা প্রমাণ নেই। **সন্দেহ হলে ধরে নিন হয়নি।**

## ৪. যাচাই করা যায়নি (অনুমান করব না)

- চালু Worker-এর সংখ্যা (১২টা), Actions মিনিটের হিসাব — এই সেশনে Cloudflare/GitHub billing
  ক্রেডেনশিয়াল নেই।
- খ৪ (Logto/Appwrite OTP দেরি), খ৭ (allowlist + turnstile), গ৪ (ডুপ্লিকেট credential),
  ঘ১/ঘ২ (অডিট রিপো, OpenHands ব্যাকআপ), ঙ৩ (aitolla root) — এগুলোর কোনো লাইভ প্রমাণ
  এই সেশনে পাওয়া যায়নি, তাই "শেষ" ধরা হয়নি।

---

## পরের ধাপ (ক্রম অনুযায়ী)

1. **Study Lock টাইমারের ভাঙা লাইনটা আপনি ঠিক করুন** (উপরের এক লাইন) — নাহলে `main`-এ
   যা-ই মার্জ হোক, লাইভে কিছুই যাবে না। এটাই এখন ১৩টা কাজের আসল গেট।
2. `/about` + `/contact` পেজ (canonical, description, OG, JSON-LD সহ) — ঙ২।
3. ভুল পাসওয়ার্ডে "আর N বার" বার্তা — চ৩ (সার্ভার + ক্লায়েন্ট, দুটোই লাগবে)।
4. আপনার হ্যাঁ এলে: `SHADOW_GUARD_ACTIVATION=enforce`, রিপো private করা (জ৪)।

## ৫. খেয়াল রাখার বিষয়

- এই সেশনের মাঝে **আরেকটা এজেন্ট/প্রসেস `main`-এ পুশ করছে** (`ad7d972` — "real auth on write
  routes"), আমার HEAD `fdcf014` নয়। কাজের আগে `git fetch` করে নিন, নইলে পুরোনো কোডে কাজ হবে।
- রিপোতে ৩০+ ওয়ার্কফ্লো এখনো `cloudflare/wrangler-action` / `Infisical/secrets-action` ব্যবহার করে;
  লক যতক্ষণ third-party ব্লক করে, এগুলোর একটা-ও চলবে না (upstream-এ fail, app-এর দোষ নয়)।
