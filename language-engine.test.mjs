/* T7b — Live app-wide language switching.

   Owner report: choosing English in Preferences left the account and profile
   flows in Bengali. Only `ai-agent-chat.js` listened for `ah:lang`; every other
   module writes Bengali inline, and there is no `data-bn` markup to switch in
   the dynamically rendered views.

   The fix is a central engine (`language-engine.js`) that owns the Bengali →
   English table and rewrites rendered text nodes plus the placeholder /
   aria-label / title attributes, re-running on `ah:lang` and on DOM insertion.

   These tests cover the behaviour that matters: text actually switches, late
   markup is covered, unknown copy degrades to Bengali rather than showing
   something wrong, and switching back restores the exact original. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const ENGINE = readFileSync(new URL('./language-engine.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const AUTH = readFileSync(new URL('./account-access.js', import.meta.url), 'utf8');
const PROFILE = readFileSync(new URL('./profile-ui.js', import.meta.url), 'utf8');

async function setup({ lang = 'en', body = '' } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, {
    url: 'https://admissionhub.pages.dev/',
    runScripts: 'dangerously',
    pretendToBeVisual: true
  });
  const { window } = dom;
  if (lang) window.localStorage.setItem('ahLang', lang);
  await new Promise((resolve) => {
    if (window.document.readyState === 'complete') return resolve();
    window.addEventListener('load', resolve, { once: true });
  });
  window.eval(ENGINE);
  return dom;
}

const text = (dom) => dom.window.document.body.textContent.replace(/\s+/g, ' ').trim();

test('English switches rendered text that no module translates itself', async () => {
  const dom = await setup({ body: '<p>আগের account-এ Google যুক্ত করো</p> <button>পরে করব</button>' });
  assert.equal(text(dom), 'Link Google to your existing account Later');
});

test('placeholder, aria-label and title are translated too', async () => {
  const dom = await setup({
    body: '<input placeholder="তোমার Email" aria-label="Password দেখুন" title="বন্ধ করুন">'
  });
  const el = dom.window.document.querySelector('input');
  assert.equal(el.getAttribute('placeholder'), 'Your email');
  assert.equal(el.getAttribute('aria-label'), 'Show password');
  assert.equal(el.getAttribute('title'), 'Close');
});

test('the original Bengali is preserved on the node for attributes', async () => {
  const dom = await setup({ body: '<input placeholder="তোমার Email">' });
  const el = dom.window.document.querySelector('input');
  assert.equal(el.getAttribute('ah-orig-placeholder'), 'তোমার Email');
});

test('switching back to Bengali restores the exact original text', async () => {
  const dom = await setup({ body: '<p>পরে করব</p>' });
  assert.equal(text(dom), 'Later');
  dom.window.AhLanguage.get; // engine is installed
  dom.window.localStorage.setItem('ahLang', 'bn');
  dom.window.dispatchEvent(new dom.window.CustomEvent('ah:lang', { detail: { lang: 'bn' } }));
  assert.equal(text(dom), 'পরে করব');
});

test('late-rendered markup is translated as it is inserted', async () => {
  const dom = await setup();
  const p = dom.window.document.createElement('p');
  p.textContent = 'সব ঠিক আছে! 🎉';
  dom.window.document.body.append(p);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(text(dom), 'All set! 🎉');
});

test('unknown copy degrades to Bengali instead of inventing English', async () => {
  const dom = await setup({ body: '<p>এই বাক্যটি অভিধানে নেই</p>' });
  assert.equal(text(dom), 'এই বাক্যটি অভিধানে নেই');
});

test('script and style content is never rewritten', async () => {
  const dom = await setup({ body: '<script>var a = "পরে করব";</script><style>/* পরে করব */</style>' });
  assert.match(dom.window.document.querySelector('script').textContent, /পরে করব/);
});

test('the engine only touches text and the three display attributes', async () => {
  const dom = await setup({ body: '<input value="পরে করব" data-x="পরে করব" name="পরে করব">' });
  const el = dom.window.document.querySelector('input');
  assert.equal(el.value, 'পরে করব', 'an input value is user data, not copy');
  assert.equal(el.getAttribute('data-x'), 'পরে করব');
  assert.equal(el.getAttribute('name'), 'পরে করব');
});

test('the engine is loaded before account-access.js so first paint is translated', () => {
  const engineAt = HTML.indexOf('language-engine.js');
  const authAt = HTML.indexOf('account-access.js');
  assert.ok(engineAt > 0 && authAt > 0);
  assert.ok(engineAt < authAt, 'a later load would leave the auth shell untranslated on open');
});

test('the table covers every string the account and profile UI render today', () => {
  // Every Bengali string these modules render must have an English entry,
  // otherwise the reported bug is only partly fixed.
  const nfc = (v) => v.normalize('NFC');
  const table = nfc(ENGINE);
  // Counts are handled by the engine's rule layer instead of a fixed key.
  const ruled = (s) => /[0-9০-৯]/.test(s);
  const collect = (source) => {
    const seen = new Set();
    // The scan runs over raw source, so a ternary whose two branches are both
    // Bengali literals can appear as one pseudo-string. Those contain the
    // operator itself; real copy never does.
    const add = (v) => {
      const t = v.replace(/\s+/g, ' ').trim();
      if (!t || !/[\u0980-\u09FF]/.test(t)) return;
      if (t.includes("' : ") || t.includes('" : ')) return;
      seen.add(nfc(t));
    };
    for (const m of source.matchAll(/>([^<>{}]*[\u0980-\u09FF][^<>{}]*)</g)) add(m[1]);
    for (const m of source.matchAll(/(?:placeholder|aria-label)="([^"]*[\u0980-\u09FF][^"]*)"/g)) add(m[1]);
    // Copy held in plain JS literals — e.g. a settings row's `label:` or a
    // toast — is never inside markup, so the tag scan above cannot see it.
    // Two shapes are excluded because a fixed key cannot own them:
    //   • attribute values (data-bn / data-en), which AhI18n renders
    //   • `+`-concatenated fragments, whose runtime value is the whole join
    //     and is covered by the engine's rule layer instead
    const body = source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of body.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)) {
      const value = m[1] ?? m[2] ?? '';
      if (!/[\u0980-\u09FF]/.test(value)) continue;
      const before = body.slice(0, m.index).replace(/\s+$/, '');
      if (before.endsWith('=')) continue;
      const after = body.slice(m.index + m[0].length).replace(/^\s+/, '');
      if (before.endsWith('+') || after.startsWith('+')) continue;
      // Markup inside the literal becomes separate text nodes at runtime, so
      // each run of text is its own key — not the literal as a whole.
      for (const piece of value.split(/<[^>]*>/)) add(piece);
    }
    return [...seen].filter((s) => s && !table.includes(`'${s}'`) && !ruled(s));
  };
  assert.deepEqual(collect(AUTH), [], 'account-flow strings would stay Bengali in English mode');
  assert.deepEqual(collect(PROFILE), [], 'profile strings would stay Bengali in English mode');
});

test('counts inside a rendered sentence still translate', async () => {
  // Resend timers, passkey totals and the multi-device logout notice embed a
  // live number, so no fixed table key can match them.
  const dom = await setup({ body: '<p>নিরাপত্তার জন্য ৪৫ সেকেন্ড পর আবার পাঠাতে পারবেন।</p>' });
  assert.equal(text(dom), 'For your security you can resend in 45 seconds.');
});

test('the password-guard hint translates once the remaining count is baked in', async () => {
  // চ৩: the login form warns how many wrong passwords are left before the pair
  // is paused. One fixed sentence around one number, so it is a rule, not a key.
  const dom = await setup({ body: '<p>Email বা Password সঠিক নয়। আর ২ বার ভুল হলে কিছুক্ষণের জন্য বন্ধ হবে।</p>' });
  assert.equal(text(dom), 'Email or password is incorrect. 2 more wrong tries and this will pause for a while.');
});
