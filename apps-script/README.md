# Free email OTP via Google Apps Script

`apps-script/Code.gs` is a Google Apps Script web app that mails Admission Sky
verification codes. It is the free tier of the generic backup channel: consumer
Gmail allows **100 recipients/day** and Google Workspace allows **1,500**. No
payment method is required and nothing is billed.

It is wired into `otp-b` (see `createConfiguredVerificationProviders`), so the
orchestrator sees an ordinary OTP provider and rotates to it once `otp-a` (Brevo,
free tier ~300/day) reports its declared quota exhausted. `otp-a` and `otp-b`
together cover a single day across both free tiers; with neither configured the
chain falls through to `otp-c`/Telegram.

## 1. Create the script

1. Open <https://script.google.com> and create a standalone project.
2. Replace the default `Code.gs` with the contents of `apps-script/Code.gs`.
3. Generate a shared secret of at least 32 characters, e.g.
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
4. Project Settings > Script Properties, add:
   | Property | Value |
   | --- | --- |
   | `SHARED_SECRET` | the secret from step 3 |
   | `DAILY_LIMIT` | `100` (or `1500` on Workspace) |

`DAILY_LIMIT` is only the number the Worker budgets against; Google enforces the
real quota through `MailApp.getRemainingDailyQuota()`.

## 2. Deploy the web app

Deploy > New deployment > Web app:

- **Execute as:** Me
- **Who has access:** Anyone

"Anyone" is required: the Worker calls the endpoint anonymously. Access is still
gated by the HMAC signature and the timestamp/nonce checks, so the URL alone
grants nothing.

Copy the `/exec` URL (`https://script.google.com/macros/s/.../exec`).

## 3. Install the Worker secrets

```sh
npx wrangler secret put OTP_B_PROVIDER_APPS_SCRIPT_URL   # the /exec URL
npx wrangler secret put OTP_B_PROVIDER_SHARED_SECRET     # same secret as SHARED_SECRET
```

`OTP_B_DAILY_QUOTA` is an optional non-secret var (defaults to the value the
script reports). The provider fails closed until both secrets are present, so a
half-finished setup never advertises a channel it cannot deliver.

## 4. Verify

```sh
curl "https://admission-gk.admissionhub.workers.dev/api/auth/v1/config" | jq '.auth.methods.backup'
```

Expect `available: true` and `availabilityCode: "READY"`. While the secrets are
missing it returns `LIVE_E2E_PENDING` and the UI keeps the button hidden.

Then request a real code through the account panel and confirm the branded email
arrives. Check <https://script.google.com/home/executions> for the log.

## How requests are authenticated

`Code.gs` rejects anything that is not a fresh, correctly signed call:

- **HMAC-SHA256** over `action\ntimestamp\nnonce\ndestination\ncode`, base64url
  encoded without padding. The Worker signs in
  `AppsScriptOtpVerificationProvider.#call`; the canonical field order is duplicated
  in both places and must stay in sync.
- **Clock skew** of at most 300 seconds.
- **Single-use nonce** (18 random bytes) cached for 10 minutes, so a captured
  request cannot be replayed.

`GET ?action=health|quota` and `POST` (send) are the only entry points. The send
path validates the recipient and the 6-digit code before touching `MailApp`.

## Limits and caveats

- **100 recipients/day** on consumer Gmail, reset 24 hours after the first send
  of the window — not at midnight. `quotaSnapshot_()` derives `resetAt` from the
  stored first-request stamp so the Worker can budget correctly.
- Quotas are **per Google account**, shared with anything else that account sends.
- Mail goes out **from the personal Gmail address** that owns the script. It is
  not a branded sending domain, so deliverability and professional appearance are
  both weaker than a real provider. `EMAIL_FROM_ADDRESS` does **not** affect this
  script — it is read only by the `email-gateway` providers. To send from a
  branded address, activate a gateway provider instead of this script.
- Google documents these quotas as being for testing and subject to change
  without notice, so keep a paid gateway provider in mind as the growth path.

## Choosing the sending account

The script has **no hardcoded sender**: `MailApp.sendEmail` always sends as the
account that owns the deployment. Changing accounts therefore needs no code
change — deploy `Code.gs` from the new account and update the two Worker secrets.
`Script Properties` are per project, so a fresh deployment needs its own
`SHARED_SECRET` and `DAILY_LIMIT`.

Prefer an account with real sending history. A brand-new Gmail mailbox has no
reputation, and verification codes sent from it are likely to land in spam until
it builds one. If the new account is unavoidable, send a handful of messages a
day at first rather than the full 100.

Stacking several Gmail accounts to multiply the daily quota is **not supported
today**: only `otp-b` has an Apps Script adapter, while the remaining slots are
bridge-only. Adding more accounts would need the same adapter wired into those
slots first.
