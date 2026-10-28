/* AdmissionSky, get_app_features (owner 2026-10-17).
 *
 * Sky's live feature list. The permanent memory (prompt-registry.js) carries only
 * the stable core; everything that changes lives here. The server attaches this
 * list ONLY when the question is about the app, so normal questions pay nothing.
 *
 * Live update without a deploy: put JSON {"version":"…","items":[{"name":"…","what":"…"}]}
 * in PUB_KV under 'sky:app-features'. Invalid or missing JSON falls back to the
 * built-in list below. No I/O at import time.
 */
export const APP_FEATURES_KV_KEY = 'sky:app-features';
export const APP_FEATURES_VERSION = '2026-10-17';
export const APP_FEATURES = Object.freeze([
  Object.freeze({ name: 'কোর্স', what: 'ভিজ্যুয়াল বাংলা ব্যাকরণ কোর্স, সন্ধি, সমাস, প্রত্যয়; নিয়ম, উদাহরণ, ফাঁদ ও রিভিশন' }),
  Object.freeze({ name: 'প্রশ্নব্যাংক ও MCQ', what: 'বিষয়ভিত্তিক MCQ অনুশীলন, ব্যাখ্যাসহ' }),
  Object.freeze({ name: 'মক টেস্ট ও ফলাফল বিশ্লেষণ', what: 'মক পরীক্ষা, টপিকভিত্তিক নির্ভুলতা, দুর্বল টপিক ও অগ্রগতির ধারা' }),
  Object.freeze({ name: 'শব্দভান্ডার ফ্ল্যাশকার্ড', what: 'Vocabulary কার্ডে শেখা ও রিভিশন' }),
  Object.freeze({ name: 'Sky AI', what: 'প্রশ্নের ব্যাখ্যা, কুইজ, রিভিশন পরিকল্পনা, ভুল বিশ্লেষণ ও ছবির প্রশ্ন; প্রতিদিন নির্দিষ্ট সংখ্যক প্রশ্ন' }),
  Object.freeze({ name: 'প্রোফাইল ও অগ্রগতি', what: 'লক্ষ্য, স্তর (SSC/HSC/Admission), পরীক্ষার ইতিহাস ও অগ্রগতি' }),
  Object.freeze({ name: 'নোটিফিকেশন ও রিমাইন্ডার', what: 'পড়ার রিমাইন্ডার ও গুরুত্বপূর্ণ আপডেট' }),
  Object.freeze({ name: 'নিরাপদ লগইন', what: 'Email, Google, Facebook, Telegram ও Passkey দিয়ে লগইন' })
]);

const RE_APP = /(admission\s*sky|অ্যাডমিশন\s*স্কাই|অ্যাপ|এপস|\bapps?\b|ফিচার|\bfeatures?\b|এই সাইট|ওয়েবসাইট|\bwebsite\b|প্ল্যাটফর্ম|\bplatform\b)/i;

/** True when the student is asking about AdmissionSky itself. */
export function isAppFeatureQuestion(text) {
  return RE_APP.test(String(text || '').slice(0, 600));
}

const clean = (s, max) => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);

/** Validate a KV override. Returns {version, items} or null. */
export function parseAppFeatures(raw) {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { return null; } }
  if (!v || typeof v !== 'object' || !Array.isArray(v.items)) return null;
  const items = [];
  for (const it of v.items.slice(0, 40)) {
    const name = clean(it && it.name, 80), what = clean(it && it.what, 240);
    if (name && what) items.push({ name, what });
  }
  if (!items.length) return null;
  return { version: clean(v.version, 40) || 'kv', items };
}

/** Read the live list (KV override, 400 ms cap) or fall back to the built-in one. */
export async function loadAppFeatures(kv) {
  if (kv && typeof kv.get === 'function') {
    try {
      const raw = await Promise.race([kv.get(APP_FEATURES_KV_KEY), new Promise((r) => setTimeout(() => r(null), 400))]);
      const parsed = parseAppFeatures(raw);
      if (parsed) return parsed;
    } catch (_) { /* fall back */ }
  }
  return { version: APP_FEATURES_VERSION, items: APP_FEATURES.slice() };
}

/** The block appended to the system prompt. */
export function renderAppFeatures(data) {
  const d = data && Array.isArray(data.items) && data.items.length ? data : { version: APP_FEATURES_VERSION, items: APP_FEATURES };
  return ['APP FEATURES (live, ' + clean(d.version, 40) + '), the only source of truth for AdmissionSky features:']
    .concat(d.items.map((it) => '- ' + clean(it.name, 80) + ': ' + clean(it.what, 240)))
    .concat(['Mention only what helps the student now; never add a feature that is not listed.'])
    .join('\n');
}
