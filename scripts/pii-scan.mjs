/* Build-time PII gate for public assets (audit BUG-008).
 *
 * sky-replies.json and mcq_final.json are served from the Pages root with no
 * authentication, so once a phone number or email reaches one of them it is
 * public forever, a later rollback cannot un-publish what a crawler already
 * archived. The header of sky-replies.json already promises phone/email were
 * stripped from the Drive source; nothing enforced that promise. This does.
 *
 * Scans the public data files for Bangladeshi phone numbers and email
 * addresses. Exits non-zero on a hit so cf-pages.yml fails the deploy.
 *
 * Usage: node scripts/pii-scan.mjs [files...]   (defaults to the two data files)
 */
import { readFileSync } from 'node:fs';

/* Public files that ship to the Pages root. Add new data files here as they
 * appear, so a fresh data drop cannot bypass the gate. */
const DEFAULT_TARGETS = ['sky-replies.json', 'mcq_final.json'];

/* 01XXXXXXXXX / +8801XXXXXXXXX. Anchored on digit boundaries so a 13-digit
 * roll number inside a question is not mistaken for a phone number. */
const PHONE = /(?<![0-9])(?:\+?880|0)1[3-9][0-9]{8}(?![0-9])/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/* Placeholders the data pipeline itself uses; they are not personal data. */
const ALLOW = new Set([
  'example@example.com',
  'user@example.com',
  'noreply@admissionhub.pages.dev',
]);

const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TARGETS;
let failures = 0;

for (const file of targets) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    console.error(`pii-scan: ${file} is missing, the deploy would ship without it`);
    failures++;
    continue;
  }
  const phones = [...new Set(text.match(PHONE) || [])];
  const emails = [...new Set((text.match(EMAIL) || []).filter((e) => !ALLOW.has(e.toLowerCase())))];
  if (phones.length || emails.length) {
    failures++;
    console.error(`pii-scan: ${file} contains personal data`);
    if (phones.length) console.error(`  phones: ${phones.slice(0, 5).join(', ')}`);
    if (emails.length) console.error(`  emails: ${emails.slice(0, 5).join(', ')}`);
  } else {
    console.log(`pii-scan: ${file} clean`);
  }
}

if (failures) {
  console.error('pii-scan: refusing to publish personal data in a public asset');
  process.exit(1);
}
