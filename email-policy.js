/* Email policy shared by the Worker and the client bundle.
 *
 * Owner order (2026-10-16): a throwaway inbox (temporary-mail services such as
 * temp-mail, yopmail, mailinator) must be stopped at the email field, the OTP
 * is never sent to one. Disposable domains change constantly, so the list below
 * is a starting denylist, not a proof: it blocks the services a student can
 * reach in one tap today. It is one source of truth, imported by the server
 * guard and exported to the browser through the auth bridge so the client hint
 * and the server refusal can never disagree.
 *
 * Deliberately NOT a "only gmail/yahoo/icloud" allowlist. The owner's words were
 * "leave out the ones we do not have", and a closed allowlist would reject a
 * real student's college or work address (a school domain, a university domain)
 * which is exactly the audience this product serves. A denylist of disposable
 * providers blocks the abuse without locking out a genuine address.
 */

// Suffix match, so a subdomain of any entry is also refused.
const DISPOSABLE_DOMAINS = Object.freeze([
  // Dedicated temporary-mail services.
  'temp-mail.org', 'tempmail.com', 'tempmail.net', 'tempmail.dev', 'tempmailo.com',
  'tempmail.plus', 'temp-mail.io', 'tempmailaddress.com', '10minutemail.com',
  '10minutemail.net', '10minutemail.org', '10minemail.com', '20minutemail.com',
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.de',
  'sharklasers.com', 'grr.la', 'guerrillamailblock.com', 'spam4.me',
  'mailinator.com', 'mailinator.net', 'mailinator2.com', 'notmailinator.com',
  'yopmail.com', 'yopmail.fr', 'yopmail.net', 'cool.fr.nf', 'jetable.org',
  'trashmail.com', 'trashmail.net', 'trashmail.org', 'trashmail.de', 'trash-mail.com',
  'throwawaymail.com', 'throwaway.email', 'getnada.com', 'nada.email',
  'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'mailcatch.com',
  'mytemp.email', 'moakt.com', 'tempr.email', 'discard.email', 'discardmail.com',
  'fakeinbox.com', 'fakemail.net', 'mail-temporaire.fr', 'emailondeck.com',
  'mohmal.com', 'mohmal.im', 'luxusmail.org', 'emailfake.com', 'crazymailing.com',
  'generator.email', 'tempinbox.com', 'tempinbox.co', 'spamgourmet.com',
  'mailmetrash.com', 'mailsac.com', 'inboxkitten.com', 'harakirimail.com',
  'mailforspam.com', 'tempmailer.com', 'tempmailer.de', 'tempemail.net',
  'burnermail.io', 'anonaddy.com', '33mail.com', 'mailpoof.com',
  'smailpro.com', 'vomoto.com', 'eyepaste.com', '1secmail.com', '1secmail.net',
  '1secmail.org', '1secmail.ru', 'tuta.io', 'tempmail.email', 'tempmailbox.net',
  // Mailbox providers whose signup needs no verification, so they are used the
  // same way as a throwaway inbox.
  'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'internet.ru',
]);

// The domain part, lowercased, without the leading "@". Empty for a malformed
// address, which the format check rejects separately.
export function emailDomain(email) {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at < 0 || at === value.length - 1) return '';
  return value.slice(at + 1).replace(/\.+$/, '');
}

// Owner order 2026-10-18 (final): ONLY these five mailbox domains may sign up or
// receive any code/link. Exact match: no subdomains, no school/college/edu, no
// temp mail. Every other domain is refused at the field AND by the Worker.
export const ALLOWED_EMAIL_DOMAINS = Object.freeze(['gmail.com', 'yahoo.com', 'icloud.com', 'hotmail.com', 'outlook.com']);

export function isAllowedEmailDomain(email) {
  const domain = emailDomain(email);
  return Boolean(domain) && ALLOWED_EMAIL_DOMAINS.includes(domain);
}

// True when the address must be refused: any well-formed address outside the
// five allowed domains (the old denylist is kept only as documentation).
export function isDisposableEmail(email) {
  const domain = emailDomain(email);
  if (!domain) return false;
  return !ALLOWED_EMAIL_DOMAINS.includes(domain);
}

// The message the student sees. Official, calm, and it names the way forward
// rather than only refusing, a real address is always welcome.
export const DISPOSABLE_EMAIL_MESSAGE =
  'এই ইমেইলে কোড পাঠানো সম্ভব না। শুধু Gmail, Yahoo, iCloud, Hotmail বা Outlook ইমেইল ব্যবহার করো।';

export const DISPOSABLE_DOMAINS_LIST = DISPOSABLE_DOMAINS;
