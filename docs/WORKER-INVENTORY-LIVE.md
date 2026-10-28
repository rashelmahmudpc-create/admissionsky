# 🧾 লাইভ Worker ইনভেন্টরি — ২৪-১০-২০২৬

সূত্র: সরাসরি Cloudflare API (`/accounts/{id}/workers/scripts`), গ্লোবাল কী + ইমেইল দিয়ে।
Account: `abb783e456e51a5d338419de93d5e576` (Rashelzayan213@icloud.com's Account)

মোট Worker: **22**  |  wrangler-এ নাম আছে: **3**

| Worker | Route | workers.dev | Cron | শেষ পরিবর্তন | Secret সংখ্যা |
|---|---|---|---|---|---|
| `admission-auth` | 0 | চালু | 0 | 2026-10-24 | 3 |
| `admission-gk` | 0 | চালু | 0 | 2026-10-24 | 41 |
| `admission-gk-staging` | 0 | চালু | 0 | 2026-10-23 | 0 |
| `admission-hub-ai` | 0 | চালু | 0 | 2026-09-02 | 9 |
| `admission-hub-ai-proxy` | 0 | চালু | 0 | 2026-09-02 | 3 |
| `admission-hub-vault` | 0 | চালু | 0 | 2026-09-08 | 50 |
| `admission-notify` | 0 | চালু | 0 | 2026-08-30 | 4 |
| `admission-voice` | 0 | চালু | 0 | 2026-10-21 | 2 |
| `agent-hq` | 0 | চালু | 0 | 2026-09-09 | 5 |
| `agent-hq-bot` | 0 | চালু | 0 | 2026-09-09 | 9 |
| `ah-admin` | 0 | চালু | 0 | 2026-09-04 | 5 |
| `ah-public` | 0 | চালু | 0 | 2026-09-01 | 9 |
| `ahai-watchman` | 0 | বন্ধ | 0 | 2026-09-03 | 0 |
| `email-worker` | 0 | বন্ধ | 0 | 2026-09-08 | 0 |
| `gk-temp-fetcher` | 0 | চালু | 0 | 2026-09-02 | 0 |
| `mail-vault` | 0 | চালু | 0 | 2026-10-24 | 0 |
| `otp-tester` | 0 | চালু | 0 | 2026-10-22 | 0 |
| `sky-ai` | 0 | চালু | 0 | 2026-10-23 | 0 |
| `sky-control` | 0 | চালু | 0 | 2026-10-24 | 6 |
| `sky-xfer` | 0 | চালু | 0 | 2026-10-18 | 0 |
| `study-pal` | 0 | চালু | 0 | 2026-10-06 | 0 |
| `zayanday-vault` | 0 | চালু | 0 | 2026-09-14 | 56 |

## 🔍 কোনটা সোর্সে ট্রেসেবল

**wrangler ফাইলে নাম আছে:** `AI_STATE`, `AUTH_AUTHORITY`, `EMAIL_COORDINATOR`, `VOICE_AGENT`, `admission-gk`, `admission-gk-staging`, `inflowsky-tg-relay`, `keydrop`, `sky-ai`

**সোর্সে নেই (unenowned/retireable):**
- `admission-auth` — শেষ পরিবর্তন 2026-10-24
- `admission-hub-ai` — শেষ পরিবর্তন 2026-09-02
- `admission-hub-ai-proxy` — শেষ পরিবর্তন 2026-09-02
- `admission-hub-vault` — শেষ পরিবর্তন 2026-09-08
- `admission-notify` — শেষ পরিবর্তন 2026-08-30
- `admission-voice` — শেষ পরিবর্তন 2026-10-21
- `agent-hq` — শেষ পরিবর্তন 2026-09-09
- `agent-hq-bot` — শেষ পরিবর্তন 2026-09-09
- `ah-admin` — শেষ পরিবর্তন 2026-09-04
- `ah-public` — শেষ পরিবর্তন 2026-09-01
- `ahai-watchman` — শেষ পরিবর্তন 2026-09-03
- `email-worker` — শেষ পরিবর্তন 2026-09-08
- `gk-temp-fetcher` — শেষ পরিবর্তন 2026-09-02
- `mail-vault` — শেষ পরিবর্তন 2026-10-24
- `otp-tester` — শেষ পরিবর্তন 2026-10-22
- `sky-control` — শেষ পরিবর্তন 2026-10-24
- `sky-xfer` — শেষ পরিবর্তন 2026-10-18
- `study-pal` — শেষ পরিবর্তন 2026-10-06
- `zayanday-vault` — শেষ পরিবর্তন 2026-09-14

## 🔑 Secret নাম (শুধু নাম, কোনো মান নয়)

⚠️ মান কখনো আনা হয়নি — শুধু কী কী নামে সেট করা আছে।

**admission-auth** (3)
- `ADMIN_TOKEN`, `FIREBASE_WEB_API_KEY`, `TURNSTILE_SECRET_KEY`

**admission-gk** (41)
- `ADMIN_TOKEN`, `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`, `ASK_API_KEY`, `AUTH_HMAC_SECRET`, `BREVO_API_KEY`, `BREVO_FROM_ADDRESS`, `BREVO_FROM_NAME`, `BROWSER_USE_API_KEYS`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_API_KEY`, `DEADSIMPLEEMAIL_API_KEY`, `DEADSIMPLEEMAIL_INBOX_ID`, `EMAIL_GATEWAY_CONFIG`, `EMAIL_PROVIDER_ACTIVATION`, `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `GEMINI_KEYS`, `GMAIL_SMTP_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MAILERSEND_API_KEY`, `MAILERSEND_FROM_ADDRESS`, `MAILERSEND_FROM_NAME`, `MAILJET_API_BASE`, `OTP_B_PROVIDER_APPS_SCRIPT_URL`, `OTP_B_PROVIDER_SHARED_SECRET`, `OTP_IDP`, `OTP_RAW`, `R2_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_SECRET_KEY`, `TAVILY_API_KEY`, `TG_BOT_TOKEN`, `TG_CHAT_ID`, `TURNSTILE_SECRET_KEY`

**admission-hub-ai** (9)
- `CEREBRAS_API_KEY`, `DEEPINFRA_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `HUGGINGFACE_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`, `TAVILY_API_KEY`, `TOGETHER_API_KEY`

**admission-hub-ai-proxy** (3)
- `BROWSER_USE_API_KEY`, `BROWSER_USE_API_KEYS`, `TURNSTILE_SECRET_KEY`

**admission-hub-vault** (50)
- `APPS_SYNC_RECOVERY_CODE`, `BRIGHTDATA_API_KEY`, `BROWSERLESS_API_KEY`, `BROWSER_USE_KEYS_JSON`, `CEREBRAS_API_KEY`, `CF_ACCOUNT_EMAIL`, `CF_ACCOUNT_ID`, `CF_API_TOKEN_1`, `CF_API_TOKEN_2`, `CF_GLOBAL_API_KEY`, `CF_R2_ACCESS_KEY_ID_1`, `CF_R2_ACCESS_KEY_ID_2`, `CF_R2_S3_ENDPOINT`, `CF_R2_SECRET_ACCESS_KEY_1`, `CF_R2_SECRET_ACCESS_KEY_2`, `DEEPINFRA_API_KEY`, `DEEPSEEK_API_KEY`, `ELEVENLABS_API_KEY`, `FIRECRAWL_API_KEY`, `GEMINI_API_KEY`, `GITHUB_PAT_FULL_ACCESS`, `GNEWS_API_KEY`, `GOOGLE_DRIVE_CLIENT_ID_1`, `GOOGLE_DRIVE_CLIENT_ID_2`, `GOOGLE_DRIVE_CLIENT_SECRET_1`, `GOOGLE_DRIVE_REFRESH_TOKEN_1`, `GROQ_API_KEY`, `HUGGINGFACE_TOKEN`, `JINA_READER_API_KEY`, `MISTRAL_API_KEY`, `NPM_TOKEN`, `NVIDIA_API_KEY`, `OLLAMA_API_KEY`, `OPENROUTER_API_KEY`, `PINECONE_API_KEY`, `SAMBANOVA_API_KEY`, `SCRAPINGBEE_API_KEY`, `SERPER_API_KEY`, `SSH_PUBLIC_KEY_TERMIUS`, `SUPABASE_ANON_KEY`, `SUPABASE_PROJECT_REF`, `SUPABASE_SERVICE_KEY`, `TAVILY_API_KEY`, `TELEGRAM_BOT_TOKEN_ADMIHUB_BACKUP`, `TELEGRAM_BOT_TOKEN_MYADMIHUBDEMO`, `TELEGRAM_PRIVATE_CHANNEL_LINK`, `TOGETHER_API_KEY`, `VAULT_ACCESS_TOKEN`, `WEBCONTAINER_CLIENT_ID`, `XAI_GROK_API_KEY`

**admission-notify** (4)
- `TG_BOT_TOKEN`, `TG_CHAT_ID`, `VAPID_PRIV`, `VAPID_PUB`

**admission-voice** (2)
- `CARTESIA_API_KEY`, `ELEVENLABS_API_KEY`

**agent-hq** (5)
- `GEMINI_API_KEY`, `GROQ_API_KEY`, `HUGGINGFACE_TOKEN`, `OPENROUTER_API_KEY`, `PORTAL_ACCESS_TOKEN`

**agent-hq-bot** (9)
- `BOT_TOKEN`, `GEMINI_KEY`, `GROQ_KEY`, `MISTRAL_KEY`, `OWNER_CHAT`, `RUN_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_URL`, `TAVILY_KEY`

**ah-admin** (5)
- `ADMIN_BOOTSTRAP_TOKEN`, `ADMIN_CF_ACCOUNT`, `ADMIN_CF_TOKEN`, `ADMIN_GH_TOKEN`, `TG_BOT_TOKEN`

**ah-public** (9)
- `ADMIN_TOKEN`, `GEMINI_KEYS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MAIL_FROM`, `MAIL_HOOK`, `MAIL_HOOK_SECRET`, `RESEND_KEY`, `RESEND_KEY_2`

**sky-control** (6)
- `ADMIN_PASSWORD_HASH`, `CF_ACTIONS_TOKEN`, `CF_API_TOKEN`, `GITHUB_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

**zayanday-vault** (56)
- `ADMINHUB_BOT_API`, `BRIGHTDATA_API_KEY`, `BROWSERLESS_API_KEY`, `BROWSER_USE_KEY_1`, `BROWSER_USE_KEY_10`, `BROWSER_USE_KEY_11`, `BROWSER_USE_KEY_2`, `BROWSER_USE_KEY_3`, `BROWSER_USE_KEY_4`, `BROWSER_USE_KEY_5`, `BROWSER_USE_KEY_6`, `BROWSER_USE_KEY_7`, `BROWSER_USE_KEY_8`, `BROWSER_USE_KEY_9`, `CEREBRAS_API_KEY`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_EMAIL`, `CF_GLOBAL_API_KEY`, `CF_R2_ACCESS_KEY_ID`, `CF_R2_SECRET_ACCESS_KEY`, `DEEPINFRA_API_KEY`, `DEEPSEEK_API_KEY`, `E2B_WEB_CONTAINER_KEY`, `ELEVENLABS_API_KEY`, `FIRECRAWL_API_KEY`, `GEMINI_API_KEY`, `GITHUB_PAT`, `GNEWS_API_KEY`, `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_ID_1`, `GOOGLE_DRIVE_CLIENT_SECRET_1`, `GOOGLE_DRIVE_REFRESH_TOKEN_1`, `GROK_XAI_KEY`, `GROQ_API_KEY`, `HUGGINGFACE_API_KEY`, `JINA_READER_API_KEY`, `MISTRAL_API_KEY`, `MISTRAL_API_KEY_2`, `NPM_TOKEN`, `NVIDIA_API_KEY`, `OLLAMA_API_KEY`, `OPENROUTER_API_KEY`, `R2_ACCESS_KEY_ID_OLD`, `R2_ENDPOINT`, `R2_SECRET_ACCESS_KEY_OLD`, `SAMBANOVA_API_KEY`, `SCRAPINGBEE_API_KEY`, `SERPER_API_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_RECOVERY_CODE`, `SUPABASE_SERVICE_KEY`, `TAVILY_API_KEY`, `TELEGRAM_BOT_ADMINHUDE_DEMO`, `TELEGRAM_PRIVATE_CHANNEL`, `TOGETHER_AI_KEY`


## ⚠️ পতনযোগ্য প্রার্থী

- `gk-temp-fetcher` — ৯-০২ তারিখ থেকে বদলায়নি, সোর্সে নেই, কোনো secret নেই
- `zayanday-vault` — সোর্সে নেই, ৫৯টা secret ধরে আছে — গুছিয়ে সরানো দরকার
- `sky-ai` — নাম `admission-hub-demo/sky-ai`-এর সাথে মেলে তবে মোছার আগে যাচাই দরকার
- `ahai-watchman` — workers.dev বন্ধ, সোর্সে নেই
- `email-worker` — workers.dev বন্ধ, সোর্সে নেই

## 📡 লাইভ যাচাই — workers.dev (২৪-১০-২০২৬)

subdomain: admissionhub। HTTP কোড = Worker সত্যিই সাড়া দেয় কি না।

| Worker | HTTP | মানে |
|---|---|---|
| `admission-auth` | 404 | চলছে না |
| `admission-gk` | 403 | চালু, নিষিদ্ধ |
| `admission-gk-staging` | 403 | চালু, নিষিদ্ধ |
| `admission-hub-ai` | 404 | চলছে না |
| `admission-hub-ai-proxy` | 404 | চলছে না |
| `admission-hub-vault` | 401 | চালু, তালা দেওয়া |
| `admission-notify` | 403 | চালু, নিষিদ্ধ |
| `admission-voice` | 404 | চলছে না |
| `agent-hq` | 200 | চালু, উত্তর দিচ্ছে |
| `agent-hq-bot` | 200 | চালু, উত্তর দিচ্ছে |
| `ah-admin` | 200 | চালু, উত্তর দিচ্ছে |
| `ah-public` | 401 | চালু, তালা দেওয়া |
| `ahai-watchman` | 404 | চলছে না |
| `email-worker` | 404 | চলছে না |
| `gk-temp-fetcher` | 200 | চালু, উত্তর দিচ্ছে |
| `mail-vault` | 200 | চালু, উত্তর দিচ্ছে |
| `otp-tester` | 200 | চালু, উত্তর দিচ্ছে |
| `sky-ai` | 404 | চলছে না |
| `sky-control` | 200 | চালু, উত্তর দিচ্ছে |
| `sky-xfer` | 404 | চলছে না |
| `study-pal` | 200 | চালু, উত্তর দিচ্ছে |
| `zayanday-vault` | 404 | চলছে না |

## 🛡️ মুছার নিরাপদ ক্রম

1. প্রতিটা Worker-এর কোড locale নামিয়ে backup।
2. পুরনো CF গ্লোবাল কী আর GitHub PAT rotate — vault Worker-এ কপি বসে আছে।
3. তারপর 404/অপ্রয়োজনীয়গুলো delete; 200 যারা আগে যাচাই।

> owner-এর লিখিত অনুমতি ছাড়া কোনো Worker মোছা/বন্ধ করা হয়নি।
