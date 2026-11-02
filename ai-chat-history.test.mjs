// Regression 2026-10-15: the 2nd chat question failed ("উত্তরটা আসেনি") because the
// UI sent earlier model turns as role 'ai', which the gateway rejected with 400.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* F2.1: Sky's stylesheet was extracted to sky-chat.css. A CSS assertion must
   read both files — the rule it guards is unchanged, only its home is. */
const skyCss = () => readFileSync('sky-chat.css', 'utf8');
import { validateChatReq } from './ai-agent.js';

const q1 = { role: 'user', content: 'নিউটনের ১ম সূত্র কী?' };
test('a follow-up carrying an ai-role answer is accepted as assistant', () => {
  const v = validateChatReq({ messages: [q1, { role: 'ai', content: 'জড়তার সূত্র।' }, { role: 'user', content: '২য় সূত্র?' }] });
  assert.equal(v.ok, true);
  assert.deepEqual(v.messages.map(m => m.role), ['user', 'assistant', 'user']);
});
test('an empty (failed) earlier answer is skipped, not fatal', () => {
  const v = validateChatReq({ messages: [q1, { role: 'assistant', content: '' }, { role: 'user', content: 'আবার' }] });
  assert.equal(v.ok, true);
});
test('a long earlier answer is clipped and old history trimmed to budget', () => {
  const long = 'ক'.repeat(9000);
  const msgs = [];
  for (let i = 0; i < 6; i++) { msgs.push({ role: 'user', content: 'প্রশ্ন ' + i }); msgs.push({ role: 'assistant', content: long }); }
  msgs.push({ role: 'user', content: 'শেষ প্রশ্ন' });
  const v = validateChatReq({ messages: msgs });
  assert.equal(v.ok, true);
  assert.equal(v.messages[v.messages.length - 1].content, 'শেষ প্রশ্ন');
});
test('a single over-long user message is still rejected', () => {
  assert.equal(validateChatReq({ messages: [{ role: 'user', content: 'ক'.repeat(4001) }] }).code, 'message_too_long');
});
test('the UI maps stored ai turns to assistant and drops failed ones', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  assert.match(UI, /role: m\.role === 'user' \? 'user' : 'assistant'/);
  assert.match(UI, /!m\.pending && !m\.error/);
});

/* Regression 2026-10-15 (owner voice note): two UI faults seen on iPhone PWA.
   (1) A guest who was not signed in got the generic "উত্তরটা আসেনি" instead of
       being told to log in. (2) The bottom safe-area inset was added twice - by
       the fixed shell and again by .dock - so a band of --bg (near-white) was
       painted below the composer and the composer sat too high. */
test('a 401 shows the full login explanation, not the generic failure', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  assert.match(UI, /needLoginLong:/);
  assert.match(UI, /res\.status === 401/);
  assert.match(UI, /holder\.errorKind = 'login'/);
});
test('the login explanation is multi-line and renders as paragraphs', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  assert.match(UI, /\[\s*'স্কাই উত্তর দিতে পারেনি[\s\S]*?\.join\(/);
  assert.match(UI, /m\.errorKind === 'login'/);
});
test('no bottom save-area gap survives anywhere in the shell', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  const uses = (UI + skyCss()).match(/safe-area-inset-bottom/g) || [];
  assert.equal(uses.length, 0,
    'owner ordered the composer flush at the very bottom, like ChatGPT and WhatsApp');
});

/* Regression 2026-10-15 (owner voice note: "এগুলা একটাও হয় নাই, আরও উপরে উঠে
   গেছে, ভিতরে এখনো সাদা"). The earlier attempt failed because it missed the
   real cause. phase1-upgrade.js owns the app's theme through
   'admission_theme_v1' and writes <html data-theme>, and it ships a global
   input,textarea,select{background:var(--glass-strong)!important} rule. That
   variable is near-white at :root and only becomes dark under
   [data-theme="midnight-academic"]. AhAppearance.apply() REMOVES data-theme
   whenever its own key - 'ah-appearance', default light - says light, and the
   chat called apply() on open, so phase1's dark override stopped matching and
   the composer and drawer search box were painted rgba(255,255,255,.88). The
   chat also consulted AhAppearance first, which only ever says "light" for
   phase1's dark theme. */
test('phase1 is the authority on the app theme, not AhAppearance', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  const fn = UI.match(/function appResolved\(\)[\s\S]*?\n  \}/)[0];
  const code = fn.replace(/\/\*[\s\S]*?\*\//g, ''); // drop the explanatory comment
  assert.ok(code.indexOf("getAttribute('data-theme')") < code.indexOf('window.AhAppearance'),
    'data-theme must be read before AhAppearance, which mislabels phase1 dark as light');
  assert.match(fn, /midnight-academic/);
  assert.match(fn, /admission_theme_v1/, "phase1's stored pick must be consulted");
});
test('opening the chat cannot wipe phase1 data-theme', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  assert.match(UI, /function syncAppChrome\(\)/);
  assert.match(UI, /window\.applyTheme/,
    "phase1's pick must be re-asserted after AhAppearance.apply() removes data-theme");
  const bare = UI.match(/window\.AhAppearance\.apply\(\)/g) || [];
  assert.equal(bare.length, 1,
    'only syncAppChrome may call AhAppearance.apply(); every other call site must re-assert phase1');
});
test('the composer and drawer search beat phase1 global !important rule', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  assert.match(skyCss(), /#app\.sky \.comp textarea\{[^}]*background:transparent!important/,
    'phase1 sets background on every textarea with !important');
  assert.match(skyCss(), /#app\.sky \.srch input\{[^}]*background:transparent!important/);
});
test('the composer sits flush at the very bottom, with no save-area gap', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  const dock = skyCss().match(/#app\.sky \.dock\{[^}]*\}/)[0];
  assert.ok(!/env\(safe-area-inset-bottom/.test(dock),
    'owner asked for no save area under the composer, like ChatGPT');
});
test('the drawer clears the notch in a PWA', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  assert.match(skyCss(), /#app\.sky \.drawer\{[^}]*padding:calc\(16px \+ env\(safe-area-inset-top/,
    'the fixed shell ignores body padding, so the drawer must add the top inset itself');
});
test('the chat theme buttons move phase1 too', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  assert.match(UI, /window\.setTheme\(t === 'dark' \? 'midnight-academic' : 'emerald-glass'\)/,
    'a tap that only moved AhAppearance left the app and the chat disagreeing');
});
test('a theme switch is repainted without a custom event', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  assert.match(UI, /new MutationObserver\(paintTheme\)/,
    'phase1.setTheme rewrites data-theme and fires no event, so watch the attribute');
});
test('the composer follows the visual viewport when the keyboard opens', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  assert.match(UI, /vv\.height/, 'shell must be sized to the visible height');
  assert.match(UI, /window\.innerHeight - vv\.height - vv\.offsetTop/,
    'keyboard height is innerHeight minus the visible viewport');
});
test('closing the chat clears the keyboard-fit inline geometry', () => {
  const UI = readFileSync('ai-agent-chat.js', 'utf8');
  const clears = UI.match(/a\.style\.height = a\.style\.top = a\.style\.bottom = a\.style\.paddingBottom = ''/g) || [];
  assert.equal(clears.length, 3,
    'every close path must drop the inline size, or the shell stays shrunk');
});
