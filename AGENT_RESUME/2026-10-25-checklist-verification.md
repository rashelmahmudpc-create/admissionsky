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
2. **চ৩ — ভুল পাসওয়ার্ডে "আর কতবার" বার্তা নেই।** সার্ভার `attemptsRemaining` জানে
   (`password-guard.mjs`), কিন্তু লগইন রেসপন্সে সেটা যায় না (`public-auth-handler.mjs:1039`),
   ক্লায়েন্টেও (`account-access.js`) ওই ফিল্ড পড়া হয় না। ছাত্র এখন শুধু **ব্লক হওয়ার পরে** বার্তা পায়।
3. **গার্ড চালু করা বাকি (activation)।** `SHADOW_GUARD_ACTIVATION` সেট না থাকায় ডিফল্ট **observe** —
   পাসওয়ার্ড গার্ড কেবল গুনছে, আটকাচ্ছে না। `enforce` করলে ছাত্র আটকানোর ঝুঁকি তৈরি হয়,
   তাই আপনার **হ্যাঁ** ছাড়া করব না (আপনার নিয়ম ২)।
4. **জ৪ — রিপো এখনো পাবলিক।** `gh api .../admissionsky` → `private: false`, `visibility: public`।
   (GitHub Pages অংশটা ইতিমধ্যেই বন্ধ, উপরের টেবিল দেখুন।)
5. **গ৬ — Firebase web key রিভিউ।** রিপো পাবলিক থাকায় যে-কেউ `AIza…` web key পড়তে পারে।
   Web key পাবলিক হওয়াই স্বাভাবিক, কিন্তু Firebase Console-এ **API restrictions** না থাকলে
   অন্য সাইট থেকে কোটা খরচ হতে পারে — এটা Console-এ চোখে দেখে নিশ্চিত হতে হবে, কোড দিয়ে বোঝা যায় না।

## ৩. নতুন সমস্যা — আজকের অটো-ডিপ্লয় চালু হয়নি

- রান `40215708666` — `Deploy Pages UI + Worker (manual)`, `event: push`, `headSha: fdcf014`,
  **`conclusion: startup_failure`**, `jobs: []` (কোনো জবই শুরু হয়নি)।
- একই পুশে বাকি গার্ডগুলো (Bundle Guard, Account Retirement, Email Gateway) **success** →
  Actions নিজে বন্ধ নয়, সমস্যা এই একটা ওয়ার্কফ্লোতেই।
- ওয়ার্কফ্লো ফাইলটা শেষ সফল রানের (`451c9a0`, ২৪ অক্টো) পর **বদলায়নি** (`git diff` খালি),
  তাই "ফাইল এডিটে ভাঙা" নয় — কারণ আলাদা করে দেখতে হবে।
- লাইভ `sw.js` এখনো HEAD-এর `v364-sky-goal`, অর্থাৎ শেল মিলে যাচ্ছে; তবে `sky-ai/`-এর
  আজকের বদল সত্যিই ডিপ্লয় হয়েছে কিনা এটা প্রমাণ করে না। **সন্দেহ হলে ধরে নিন ডিপ্লয় হয়নি।**

## ৪. যাচাই করা যায়নি (অনুমান করব না)

- চালু Worker-এর সংখ্যা (১২টা), Actions মিনিটের হিসাব — এই সেশনে Cloudflare/GitHub billing
  ক্রেডেনশিয়াল নেই।
- খ৪ (Logto/Appwrite OTP দেরি), খ৭ (allowlist + turnstile), গ৪ (ডুপ্লিকেট credential),
  ঘ১/ঘ২ (অডিট রিপো, OpenHands ব্যাকআপ), ঙ৩ (aitolla root) — এগুলোর কোনো লাইভ প্রমাণ
  এই সেশনে পাওয়া যায়নি, তাই "শেষ" ধরা হয়নি।

---

## পরের ধাপ (ক্রম অনুযায়ী)

1. `startup_failure`-এর কারণ ঠিক করা — নাহলে `main`-এ মার্জ হলেও লাইভে যাবে না।
2. `/about` + `/contact` পেজ (canonical, description, OG, JSON-LD সহ) — ঙ২।
3. ভুল পাসওয়ার্ডে "আর N বার" বার্তা — চ৩ (সার্ভার + ক্লায়েন্ট, দুটোই লাগবে)।
4. আপনার হ্যাঁ এলে: `SHADOW_GUARD_ACTIVATION=enforce`, রিপো private করা (জ৪)।
