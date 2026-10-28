/* Admission Sky, the owner's bird-led signup and log-in flows, wired to the
 * real account backend.
 *
 * The two screens are the owner's own previews (signup-flow-preview-v2 and the
 * log-in flow). This file is the live version of them: same bird, same colour
 * fields, same step order, but every step that needs the server now calls the
 * real account API through window.AdmissionSkyBridge, which account-access.js
 * publishes. Nothing here talks to the network directly, and nothing here makes
 * a decision about whether an account is verified: the bridge owns all of that.
 *
 * Mapping (design screen -> real work):
 *   Signup  name -> DOB -> level/school/college -> email -> password -> verify
 *           POST /signup, then /profile/pending, then /email-ownership/start
 *           or /telegram/verification/start, then the matching /verify.
 *   Log in  email (+Google / Facebook / passkey) -> password -> verify -> done
 *           POST /login (or the provider path), then the verification choice
 *           when the account still needs it.
 *
 * If the bridge is missing (an older cached bundle) the flow refuses to open
 * rather than pretend a step succeeded.
 */
(() => {
'use strict';

const $ = id => document.getElementById(id);
const bn = n => String(n).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);
const norm = s => String(s)
  .replace(/[০-৯]/g, c => '০১২৩৪৫৬৭৮৯'.indexOf(c))
  .replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c))
  .replace(/\D/g, '');

/* The preview's palettes, unchanged. Each step recolours the whole screen. */
const SIGNUP_PAL = [
  ['#E6F0FF', '#2F6BFF', '#FF9F1C'], ['#F3E8FF', '#8B3DFF', '#FF4DA6'],
  ['#DDF8EE', '#00B386', '#FFC233'], ['#FFEDE3', '#FF5A36', '#FFB020'],
  ['#FFE8F1', '#E02D7B', '#7A3CFF'], ['#E8E6FF', '#5B3DF5', '#00C2FF'],
  ['#DFF6FF', '#0A8CFF', '#00D68F'], ['#FFF3D6', '#FF9F1C', '#2F6BFF']
];
const LOGIN_PAL = [
  ['#E6F0FF', '#2F6BFF', '#FF9F1C'], ['#FFE8F1', '#E02D7B', '#7A3CFF'],
  ['#E8E6FF', '#5B3DF5', '#00C2FF'], ['#DFF6FF', '#0A8CFF', '#00D68F'],
  ['#FFF3D6', '#FF9F1C', '#2F6BFF']
];
const SIGNUP_PROP = ['', 'cal', 'bok', 'mal', 'lck', 'lns', 'ear', ''];
const LOGIN_PROP = ['mal', 'lck', 'lns', 'ear', ''];
const MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Owner order 2026-10-16: a throwaway inbox is refused at the field. The Worker
// is the authority (it refuses POST /signup); this only moves the message to the
// field so the student is told before a round-trip. The list itself ships in
// email-policy-client.js, which email-policy.test.mjs pins to the server list.
const disposableEmail = () => (typeof window.ADMISSION_HUB_isDisposableEmail === 'function'
  ? window.ADMISSION_HUB_isDisposableEmail
  : () => false);
const disposableMessage = () => window.ADMISSION_HUB_DISPOSABLE_EMAIL_MESSAGE
  || 'এই ইমেইল সেবাটি দিয়ে অ্যাকাউন্ট খোলা যায় না, একটি স্থায়ী ইমেইল ব্যবহার করুন।';
const emailAcceptable = value => EMAIL_RE.test(value) && !disposableEmail()(value);

const SIGNUP_CTA = ['পরের ধাপ', 'পরের ধাপ', 'পরের ধাপ', 'পরের ধাপ', 'অ্যাকাউন্ট তৈরি করো', 'কোড পাঠাও', 'যাচাই করো', ''];
const LOGIN_CTA = ['পরের ধাপ', 'ঢুকে পড়ো', 'কোড পাঠাও', 'যাচাই করো', ''];
const SIGNUP_SAY = [
  () => 'আমি স্কাই। তোমার পুরো নামটা বলো?',
  () => 'জন্ম তারিখটা ঠিক করে নাও, তারপর এগোই।',
  () => 'এখন কোন স্তরে পড়ছ? স্কুলটা খুঁজে নাও।',
  () => 'তোমার ইমেইলটা দাও, এখানেই সব আসবে।',
  () => 'এবার পাসওয়ার্ড। আমি দেখব না!',
  () => 'কোডটা কোথায় পাঠাব? বেছে নাও।',
  () => state.method === 'telegram'
    ? 'টেলিগ্রামে কোড এসেছে। ঘরে ট্যাপ করে লিখে ফেলো!'
    : 'কোডটা তোমার ইমেইলে গেছে। ঘরে ট্যাপ করে লিখে ফেলো!',
  () => 'তোমার অ্যাকাউন্ট প্রস্তুত!'
];
const LOGIN_SAY = [
  () => 'ফিরে এসেছ! আমি স্কাই। তোমার ইমেইল কী?',
  () => 'এবার পাসওয়ার্ড বলো। আমি দেখব না!',
  () => 'অ্যাকাউন্টটা এখনো নিশ্চিত হয়নি। কীভাবে নিশ্চিত করবে?',
  () => state.method === 'telegram'
    ? 'টেলিগ্রামে কোড এসেছে। ঘরে ট্যাপ করে লিখে ফেলো!'
    : 'কোডটা তোমার ইমেইলে গেছে। ঘরে ট্যাপ করে লিখে ফেলো!',
  () => 'স্বাগতম ফিরে!'
];

const SIGNUP_BIRD = `<svg class="bsvg" viewBox="0 0 240 240"><defs>
<linearGradient id="sky-bgd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7FD4FF"/><stop offset="1" stop-color="#2F6BFF"/></linearGradient>
<linearGradient id="sky-wgd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4C8DFF"/><stop offset="1" stop-color="#2450D8"/></linearGradient>
<linearGradient id="sky-bkd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFC233"/><stop offset="1" stop-color="#FF8A00"/></linearGradient></defs>
<ellipse class="shd" cx="120" cy="226" rx="56" ry="8" fill="rgba(11,27,58,.18)"/>
<g class="body">
<g class="tail"><path d="M104 188q-20 20-34 26 20 4 34-6z" fill="#2450D8"/><path d="M120 192q-6 24-16 34 22-6 28-30z" fill="#3A74F5"/><path d="M136 188q16 20 32 26-22 2-34-8z" fill="#2450D8"/></g>
<g class="feet"><path d="M98 196v20M86 216h24M142 196v20M130 216h24" stroke="#FF9A00" stroke-width="6" stroke-linecap="round" fill="none"/></g>
<ellipse cx="120" cy="136" rx="74" ry="68" fill="url(#sky-bgd)"/>
<ellipse cx="96" cy="100" rx="30" ry="18" fill="#fff" opacity=".22" transform="rotate(-24 96 100)"/>
<ellipse cx="120" cy="158" rx="46" ry="40" fill="#F4FAFF"/>
<g class="tuft"><path d="M110 70q-8-22 6-30 0 14 6 24z" fill="#4C8DFF"/><path d="M122 68q4-24 20-26-6 12-8 26z" fill="#3A74F5"/></g>
<g class="head">
<circle class="chk" cx="70" cy="136" r="12" fill="#FF8FB1"/><circle class="chk" cx="170" cy="136" r="12" fill="#FF8FB1"/>
<g class="eyesN">
<g class="eyel"><ellipse cx="88" cy="116" rx="17" ry="19" fill="#fff"/><g class="pup"><circle cx="88" cy="118" r="11" fill="#14224A"/><circle cx="84" cy="112" r="4.2" fill="#fff"/><circle cx="93" cy="123" r="2" fill="#fff" opacity=".8"/></g></g>
<g class="eyer"><ellipse cx="152" cy="116" rx="17" ry="19" fill="#fff"/><g class="pup"><circle cx="152" cy="118" r="11" fill="#14224A"/><circle cx="148" cy="112" r="4.2" fill="#fff"/><circle cx="157" cy="123" r="2" fill="#fff" opacity=".8"/></g></g>
<path class="brow brw1" d="M74 92q14-9 28-2" fill="none" stroke="#1E3A8A" stroke-width="4.5" stroke-linecap="round"/><path class="brow brw2" d="M138 90q14-7 28 2" fill="none" stroke="#1E3A8A" stroke-width="4.5" stroke-linecap="round"/></g>
<g class="eyesH" fill="none" stroke="#14224A" stroke-width="5.5" stroke-linecap="round"><path d="M72 122q16-24 32 0"/><path d="M136 122q16-24 32 0"/></g>
<g class="beak"><path d="M107 132q13-6 26 0 0 6-13 14-13-8-13-14z" fill="url(#sky-bkd)"/><g class="jawg"><path class="jaw" d="M111 143q9 14 18 0z" fill="#E8780A"/></g><ellipse class="tng" cx="120" cy="150" rx="6" ry="4" fill="#FF8FB1"/></g>
<g class="cap" transform="rotate(-6 120 52)"><path d="M120 34l62 22-62 22-62-22z" fill="#1B2A5E"/><path d="M82 64v14c0 11 76 11 76 0V64" fill="#27397F"/><g class="tas"><path d="M182 56v34" stroke="#FFB020" stroke-width="3.5" stroke-linecap="round"/><circle cx="182" cy="94" r="6" fill="#FFB020"/></g><path d="M120 46l3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1z" fill="#FFB020"/></g></g>
<g class="wl"><path d="M58 128q-34 8-30 46 26 2 44-22z" fill="url(#sky-wgd)"/></g><g class="wr"><path d="M182 128q34 8 30 46-26 2-44-22z" fill="url(#sky-wgd)"/></g>
<g class="pr cal"><rect x="176" y="150" width="46" height="44" rx="8" fill="#fff"/><rect x="176" y="150" width="46" height="14" rx="8" fill="#FF4DA6"/><g fill="#8B3DFF"><circle cx="188" cy="174" r="3"/><circle cx="199" cy="174" r="3"/><circle cx="210" cy="174" r="3"/><circle cx="188" cy="185" r="3"/><circle cx="199" cy="185" r="3"/></g></g>
<g class="pr bok"><rect x="172" y="164" width="52" height="34" rx="6" fill="#FF9F1C"/><rect x="177" y="169" width="42" height="24" rx="4" fill="#fff"/><path d="M198 169v24" stroke="#FFD08A" stroke-width="2.5"/></g>
<g class="pr mal"><rect x="172" y="160" width="54" height="38" rx="7" fill="#fff"/><path d="m175 165 24 18 24-18" fill="none" stroke="#FF6B3D" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></g>
<g class="pr lck"><rect x="176" y="168" width="44" height="32" rx="8" fill="#E02D7B"/><path d="M184 168v-10a14 14 0 0 1 28 0v10" fill="none" stroke="#E02D7B" stroke-width="6" stroke-linecap="round"/><circle cx="198" cy="183" r="5" fill="#fff"/></g>
<g class="pr lns"><circle cx="198" cy="170" r="16" fill="rgba(255,255,255,.6)" stroke="#5B3DF5" stroke-width="6"/><path d="m210 182 14 14" stroke="#5B3DF5" stroke-width="7" stroke-linecap="round"/></g>
<g class="pr ear" fill="none" stroke="#0A8CFF" stroke-width="5" stroke-linecap="round"><path d="M196 96q14 16 0 32"/><path d="M210 84q26 28 0 56"/></g>
</g></svg>`;

const BACK = `<button class="back hide" id="sky-back" type="button" aria-label="পেছনে"><svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg></button>`;

const OTP_BOXES = `<div class="otp hint1" id="sky-otp">${
  Array.from({ length: 6 }, (_, k) => `<div class="od"><input inputmode="numeric" maxlength="6" enterkeyhint="done" aria-label="${k + 1}"${k === 0 ? ' autocomplete="one-time-code"' : ''}></div>`).join('')
}</div><div class="hint" id="sky-ot-h"></div><div class="tmr"><u id="sky-tmu"></u></div><div class="rs"><span id="sky-rs-t"></span><button id="sky-rs-b" type="button" disabled>আবার পাঠাও</button></div>`;

const METHOD_CARDS = `<button class="mc sel" data-m="email" type="button"><span class="ic"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 8 8 6 8-6"/></svg></span><span><b>ইমেইল</b><small id="sky-mm">কোড যাবে তোমার ইমেইলে</small></span><i class="rd"></i></button><button class="mc" data-m="telegram" type="button" hidden style="display:none"><span class="ic"><svg viewBox="0 0 24 24"><path d="m21 4-3 15-6-4-3 3v-5L20 6 7 12 3 10Z"/></svg></span><span><b>টেলিগ্রাম</b><small>অফিসিয়াল বটে কোড আসবে</small></span><i class="rd"></i></button>`;

// Shown only when every OTP provider is out of quota and the Worker has sent a
// Firebase link instead. The link sets Firebase's own verified flag, so there is
// no code to type: offering the OTP box here would strand the student on a form
// that can never be filled.
const LINK_PANEL = `<div class="lk" id="sky-lk"><div class="lki" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 8 8 6 8-6"/></svg><i><svg viewBox="0 0 24 24"><path d="m6 12 4 4 8-9"/></svg></i></div><b>ইমেইলে লিংক পাঠানো হয়েছে</b><p id="sky-lk-p">লিংকে ট্যাপ করে এখানে ফিরে এসো।</p><button class="lnk" id="sky-lk-c" type="button">লিংক খুলেছি, যাচাই করো</button></div>`;

const DONE_PANEL = `<div class="dn" id="sky-dn"><h2 id="sky-dn-h"></h2><p>তোমার অ্যাকাউন্ট প্রস্তুত</p><div class="ld"><u></u></div></div>`;
const SIGNUP_SCREENS = [
  `<div class="scr" id="sky-s0"><label class="fl" id="sky-f-name"><svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg><input id="sky-in-name" type="text" placeholder=" " autocomplete="name" enterkeyhint="done" maxlength="60"><span class="lb">তোমার পুরো নাম</span><button class="cl" type="button" data-c="sky-in-name" aria-label="মুছুন"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></label><div class="hint">যে নামে সনদ ও পরিচয় থাকবে সেটাই লেখো</div></div>`,
  `<div class="scr" id="sky-s1"><div class="wheel"><i class="hl"></i><div class="col" id="sky-c-d"></div><div class="col" id="sky-c-m"></div><div class="col" id="sky-c-y"></div></div><div class="age" id="sky-age"></div></div>`,
  `<div class="scr" id="sky-s2"><div class="lbl">তুমি এখন কোন স্তরে?</div><div class="chips" id="sky-lv"><button class="chip" data-v="SSC" type="button">SSC</button><button class="chip" data-v="HSC" type="button">HSC</button><button class="chip" data-v="ডিপ্লোমা" type="button">ডিপ্লোমা</button><button class="chip" data-v="আলিম" type="button">আলিম</button><button class="chip" data-v="অন্যান্য" type="button">অন্যান্য</button></div>
<div id="sky-sf" style="display:none"><div class="sp"></div><label class="fl" id="sky-f-sch"><svg class="ic" viewBox="0 0 24 24"><path d="M3 10 12 5l9 5-9 5-9-5Z"/><path d="M7 12.5V17c3 2 7 2 10 0v-4.5"/></svg><input id="sky-in-sch" type="text" placeholder=" " autocomplete="off" enterkeyhint="done"><span class="lb">স্কুলের নাম খোঁজো</span></label><div class="sug" id="sky-sg-sch"></div>
<div id="sky-cwrap"><div class="sp"></div><label class="fl" id="sky-f-col"><svg class="ic" viewBox="0 0 24 24"><path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/></svg><input id="sky-in-col" type="text" placeholder=" " autocomplete="off" enterkeyhint="done"><span class="lb">কলেজের নাম খোঁজো</span></label><div class="sug" id="sky-sg-col"></div><button class="skip" id="sky-skipc" type="button">এখনো কলেজে ভর্তি হইনি</button></div></div></div>`,
  `<div class="scr" id="sky-s3"><label class="fl" id="sky-f-em"><svg class="ic" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 8 8 6 8-6"/></svg><input id="sky-in-em" type="email" inputmode="email" placeholder=" " autocomplete="email" autocapitalize="off" spellcheck="false" enterkeyhint="done"><span class="lb">তোমার ইমেইল</span><button class="cl" type="button" data-c="sky-in-em" aria-label="মুছুন"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></label><div class="chips"><button class="chip" data-d="gmail.com" type="button">@gmail.com</button><button class="chip" data-d="yahoo.com" type="button">@yahoo.com</button></div><div class="hint" id="sky-em-h"></div></div>`,
  `<div class="scr" id="sky-s4"><label class="fl pwf" id="sky-f-pw"><svg class="ic" viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><input id="sky-in-pw" type="password" placeholder=" " autocomplete="new-password" enterkeyhint="done"><span class="lb">পাসওয়ার্ড (কমপক্ষে ৮ অক্ষর)</span><button class="eye" data-t="sky-in-pw" type="button" aria-label="দেখাও"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></label><div class="meter" id="sky-mt"><i></i><i></i><i></i><i></i></div>
<div class="sp"></div><label class="fl pwf" id="sky-f-pw2"><svg class="ic" viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z"/><path d="m9 12 2 2 4-4"/></svg><input id="sky-in-pw2" type="password" placeholder=" " autocomplete="new-password" enterkeyhint="done"><span class="lb">পাসওয়ার্ড আবার লেখো</span></label><div class="hint" id="sky-pw-h"></div></div>`,
  `<div class="scr" id="sky-s5">${METHOD_CARDS}</div>`,
  `<div class="scr" id="sky-s6">${OTP_BOXES}${LINK_PANEL}</div>`,
  `<div class="scr" id="sky-s7">${DONE_PANEL}</div>`
];

const LOGIN_SCREENS = [
  `<div class="scr" id="sky-l0"><label class="fl" id="sky-lf-em"><svg class="ic" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 8 8 6 8-6"/></svg><input id="sky-lin-em" type="email" inputmode="email" placeholder=" " autocomplete="email" autocapitalize="off" spellcheck="false" enterkeyhint="done"><span class="lb">তোমার ইমেইল</span><button class="cl" type="button" data-c="sky-lin-em" aria-label="মুছুন"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></label><div class="chips"><button class="chip" data-d="gmail.com" type="button">@gmail.com</button><button class="chip" data-d="yahoo.com" type="button">@yahoo.com</button></div><div class="hint" id="sky-lem-h"></div>
<div class="or"><span>অথবা</span></div>
<div class="tiles"><button class="tile" id="sky-b-google" type="button"><svg viewBox="0 0 24 24"><path fill="#4285F4" d="M23 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.4Z"/><path fill="#34A853" d="M12 23.5c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3A11.5 11.5 0 0 0 12 23.5Z"/><path fill="#FBBC05" d="M5.6 14.2a6.9 6.9 0 0 1 0-4.4v-3H1.8a11.5 11.5 0 0 0 0 10.4l3.8-3Z"/><path fill="#EA4335" d="M12 5.4c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.5 11.5 0 0 0 1.8 6.8l3.8 3C6.5 7.4 9 5.4 12 5.4Z"/></svg><span>Google</span></button><button class="tile" id="sky-b-fb" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#29A9EB"/><path fill="#fff" d="M5.4 11.8l11.6-4.5c.5-.2 1 .1.8.9l-2 9.3c-.1.6-.5.8-1.1.5l-3-2.2-1.4 1.4c-.2.2-.3.3-.6.3l.2-3.1 5.6-5.1c.2-.2 0-.3-.4-.1l-6.9 4.4-3-.9c-.6-.2-.6-.6.2-.9z"/></svg><span>Telegram</span></button><button class="tile pk" id="sky-b-pass" type="button"><svg viewBox="0 0 24 24"><path d="M12 11v2.5c0 2.4-.9 4.6-2.6 6.3M16 12.5c0 3-.9 5.6-2.6 7.7M8 12.5V11a4 4 0 0 1 8 0M5 12.5V11a7 7 0 0 1 14 0v1.5c0 1.2-.1 2.4-.4 3.5M5 16c.5-1 .8-2.2.8-3.5"/></svg><span>ফিঙ্গারপ্রিন্ট</span></button></div>
<button class="lnk" id="sky-b-signup" type="button">নতুন? সাইন আপ করো</button></div>`,
  `<div class="scr" id="sky-l1"><label class="fl pwf" id="sky-lf-pw"><svg class="ic" viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><input id="sky-lin-pw" type="password" placeholder=" " autocomplete="current-password" enterkeyhint="done"><span class="lb">পাসওয়ার্ড</span><button class="eye" data-t="sky-lin-pw" type="button" aria-label="দেখাও"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></label><div class="hint" id="sky-lpw-h"></div><button class="lnk" id="sky-b-forgot" type="button">পাসওয়ার্ড ভুলে গেছ?</button></div>`,
  `<div class="scr" id="sky-l2">${METHOD_CARDS}</div>`,
  `<div class="scr" id="sky-l3">${OTP_BOXES}${LINK_PANEL}</div>`,
  `<div class="scr" id="sky-l4">${DONE_PANEL}</div>`
];

const CARD = `<main class="app" id="sky-app">${BACK}
<section class="petwrap"><div class="bird" id="sky-bird" data-m="" data-p="">${SIGNUP_BIRD}</div>
<div class="bubble" id="sky-bubble"><span id="sky-say"></span></div></section>
<section class="stage" id="sky-stage"></section>
<footer class="foot"><button class="cta" id="sky-cta" type="button" disabled><span id="sky-cta-t">পরের ধাপ</span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button></footer>
<div class="cf" id="sky-cf"></div></main>`;

/* ---------------------------------------------------------------- helpers */
const bridge = () => window.AdmissionSkyBridge || null;
const within = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => {
  const error = new Error('সংযোগ খুব ধীর, আবার চেষ্টা করো।');
  error.userMessage = error.message;
  reject(error);
}, ms))]);
const host = () => document.getElementById('ah-sky-flow');
const accountPage = () => document.getElementById('ah-account-page');

const state = {
  mode: '', i: 0, busy: false, last: 0,
  name: '', d: 15, m: 5, y: 2006, level: '', school: '', college: '', skipC: false,
  email: '', pw: '', pw2: '', method: 'email',
  schools: [], colleges: [], inst: { school: null, college: null },
  caps: null, resend: 45, resendTimer: null, link: false
};

let tT = 0, mT = 0, hovT = 0, idleT = 0, nameDone = false;

const pal = n => {
  const table = state.mode === 'login' ? LOGIN_PAL : SIGNUP_PAL;
  const c = table[Math.min(n, table.length - 1)] || table[0];
  const root = host();
  if (!root) return;
  root.style.setProperty('--t', c[0]);
  root.style.setProperty('--p', c[1]);
  root.style.setProperty('--q', c[2]);
  // Keep the page behind the design the same blended colour, so the strips above
  // and below the phone surface never show an unrelated white.
  if (accountPage()) accountPage().style.setProperty('--ah-sky-blend', c[0]);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', c[0]);
};

/* ---- bird ---- */
const mood = m => { const b = $('sky-bird'); if (b) b.dataset.m = m || ''; };
const look = (x, y) => { const b = $('sky-bird'); if (b) { b.style.setProperty('--lx', x + 'px'); b.style.setProperty('--ly', y + 'px'); } };
const kick = (c, ms) => { const b = $('sky-bird'); if (!b) return; b.classList.remove(c); void b.offsetWidth; b.classList.add(c); setTimeout(() => b.classList.remove(c), ms || 700); };
const talk = t => {
  const b = $('sky-bird'), say = $('sky-say');
  if (!b || !say) return;
  clearInterval(tT); say.textContent = '';
  let k = 0; b.classList.add('talk');
  tT = setInterval(() => { k++; say.textContent = t.slice(0, k); if (k >= t.length) { clearInterval(tT); b.classList.remove('talk'); } }, 28);
};
const mimic = () => { const b = $('sky-bird'); if (!b) return; b.classList.add('talk'); clearTimeout(mT); mT = setTimeout(() => b.classList.remove('talk'), 240); };
const fly = r => { const b = $('sky-bird'); if (!b) return; b.classList.remove('flyin', 'flyinr'); void b.offsetWidth; b.classList.add(r ? 'flyinr' : 'flyin', 'flying'); setTimeout(() => b.classList.remove('flyin', 'flyinr', 'flying'), 1250); };
const hover = () => { const b = $('sky-bird'); if (!b) return; b.classList.remove('hov'); void b.offsetWidth; b.classList.add('hov', 'flying'); setTimeout(() => b.classList.remove('hov', 'flying'), 2250); };
const wake = () => { clearInterval(hovT); hovT = setInterval(() => { const a = document.activeElement; if (state.i < state.last && !state.busy && !(a && a.tagName === 'INPUT')) hover(); }, 9500); };
const eyes = n => { const b = $('sky-bird'); if (b) b.style.setProperty('--eye', (1 + Math.min(n, 12) * .014).toFixed(3)); };

const first = () => (state.name.trim().split(/\s+/)[0] || 'বন্ধু');

/* ---- screen control ---- */
const screens = () => [...host().querySelectorAll('.scr')];
const cta = () => $('sky-cta');
const ctaTable = () => (state.mode === 'login' ? LOGIN_CTA : SIGNUP_CTA);
const propTable = () => (state.mode === 'login' ? LOGIN_PROP : SIGNUP_PROP);
const sayTable = () => (state.mode === 'login' ? LOGIN_SAY : SIGNUP_SAY);
const lastScreen = () => (state.mode === 'login' ? 4 : 7);

const refresh = () => {
  const i = state.i;
  let ok = false;
  if (state.mode === 'login') {
    if (i === 0) ok = emailAcceptable(state.email);
    else if (i === 1) ok = state.pw.length > 0;
    else if (i === 2) ok = true;
    else if (i === 3) ok = state.link ? true : otpBoxes().every(x => x.value);
  } else {
    if (i === 0) ok = state.name.trim().length >= 2;
    else if (i === 1) ok = true;
    else if (i === 2) ok = !!state.level && !!state.school && (state.level === 'SSC' || state.skipC || !!state.college);
    else if (i === 3) ok = emailAcceptable(state.email);
    else if (i === 4) ok = state.pw.length >= 8 && state.pw === state.pw2;
    else if (i === 5) ok = true;
    else if (i === 6) ok = state.link ? true : otpBoxes().every(x => x.value);
  }
  const button = cta();
  if (!button) return;
  button.disabled = !ok || state.busy;
  button.classList.toggle('ready', ok && !state.busy);
};

const otpBoxes = () => [...($('sky-otp') ? $('sky-otp').querySelectorAll('input') : [])];

const go = n => {
  const prev = state.i;
  state.i = n;
  hideKb();
  pal(n);
  screens().forEach((el, k) => { el.classList.toggle('on', k === n); el.classList.toggle('l', k < n); });
  const label = $('sky-cta-t');
  if (label) label.textContent = (n === 6 && state.link) || (n === 3 && state.mode === 'login' && state.link) ? 'যাচাই করো' : (ctaTable()[n] || '');
  const button = cta();
  if (button) button.classList.toggle('hide', n === lastScreen());
  const back = $('sky-back');
  if (back) {
    // Owner (2026-10-15): "many places have no back button, and back does not
    // work". Show it on EVERY step except the final done screen, so a student
    // can always step back -- the first step returns to the welcome.
    back.classList.toggle('hide', n === lastScreen());
  }
  const b = $('sky-bird');
  if (b) b.dataset.p = propTable()[Math.min(n, propTable().length - 1)];
  mood(''); look(0, 0); eyes(0); fly(n < prev);
  const say = sayTable()[Math.min(n, sayTable().length - 1)];
  if (say) talk(say());
  refresh();
  if (state.mode === 'login') {
    if (n === 2) setMethodCopy();
    if (n === 3) startOtp();
  } else {
    if (n === 5) setMethodCopy();
    if (n === 6) startOtp();
    if (n === 7) celebrate();
  }
};

const setMethodCopy = () => {
  const node = $('sky-mm');
  if (node) node.textContent = state.email ? `কোড যাবে ${state.email}` : 'কোড যাবে তোমার ইমেইলে';
};

const hideKb = () => { const a = document.activeElement; if (a && a.tagName === 'INPUT') a.blur(); };

/* ---- verification challenge (real backend) ---- */
const startOtp = () => {
  fill([]);
  state.link = false;
  const otp = $('sky-otp');
  if (otp) otp.className = 'otp hint1';
  const hint = $('sky-ot-h');
  if (hint) { hint.className = 'hint'; hint.textContent = ''; }
  showLink();
  beginChallenge();
  startResendCountdown(state.resend);
};

const beginChallenge = async () => {
  const api = bridge();
  if (!api) return fail('Account সেবা পাওয়া যাচ্ছে না, পেজটি একবার refresh করো।');
  setBusy(true);
  try {
    const result = await within(state.method === 'telegram' ? api.startTelegram() : api.startEmail(), 60000);
    if (!result) throw new Error('start-failed');
    // The email method can come back with a link instead of a code when every
    // OTP provider is spent. Switch the panel rather than leaving a code box.
    state.link = state.method === 'email' && result.link === true;
    showLink();
    state.resend = Number(result.resendAfter || 45);
    refresh();
    const label = $('sky-cta-t');
    if (label && state.link) label.textContent = 'যাচাই করো';
    const hint = $('sky-ot-h');
    if (hint) {
      hint.className = 'hint ok';
      hint.textContent = state.link ? ''
        : state.method === 'telegram'
        ? 'টেলিগ্রামের অফিসিয়াল বটে ৬ সংখ্যার কোড এসেছে'
        : (result.emailMasked ? `কোড পাঠানো হয়েছে ${result.emailMasked}` : 'কোড তোমার ইমেইলে পাঠানো হয়েছে');
    }
    startResendCountdown(state.resend);
  } catch (error) {
    fail(api.friendly ? api.friendly(error) : 'কোড পাঠানো যায়নি, আবার চেষ্টা করো।');
  } finally { setBusy(false); }
};

const startResendCountdown = seconds => {
  const rb = $('sky-rs-b'), rt = $('sky-rs-t'), u = $('sky-tmu');
  if (!rb || !rt) return;
  let t = Math.max(1, Math.ceil(seconds || 45));
  clearInterval(state.resendTimer);
  rb.disabled = true;
  rt.textContent = `আবার পাঠানো যাবে ${bn(t)} সেকেন্ড পর `;
  if (u) { u.style.transition = 'none'; u.style.transform = 'scaleX(1)'; requestAnimationFrame(() => requestAnimationFrame(() => { u.style.transition = `transform ${t}s linear`; u.style.transform = 'scaleX(0)'; })); }
  state.resendTimer = setInterval(() => {
    t--;
    if (t <= 0) { clearInterval(state.resendTimer); rt.textContent = 'কোড পাওনি? '; rb.disabled = false; }
    else rt.textContent = `আবার পাঠানো যাবে ${bn(t)} সেকেন্ড পর `;
  }, 1000);
};

// The Worker sends a Firebase link only after every OTP provider is spent. Swap
// the code box out and never leave a form the student cannot fill.
const showLink = () => {
  const lk = $('sky-lk'), otp = $('sky-otp'), tmr = document.querySelector('#ah-sky-flow .tmr'), rs = document.querySelector('#ah-sky-flow .rs');
  const link = Boolean(state.link);
  if (lk) lk.classList.toggle('on', link);
  if (otp) otp.style.display = link ? 'none' : '';
  if (tmr) tmr.style.display = link ? 'none' : '';
  if (rs) rs.style.display = link ? 'none' : '';
  const p = $('sky-lk-p');
  if (p && state.email) p.textContent = `লিংক পাঠানো হয়েছে ${state.email}-এ। Inbox বা Spam-এ দেখে ট্যাপ করো, তারপর নিচের বোতাম চাপো।`;
};

const checkLink = async () => {
  const api = bridge();
  if (!api || state.busy) return;
  setBusy(true);
  try {
    const ok = api.checkEmail ? await api.checkEmail() : false;
    if (ok) {
      mood('happy'); kick('hop');
      const lk = $('sky-lk');
      if (lk) lk.classList.add('ok');
      api.finish();
      go(lastScreen());
      return;
    }
    fail('এখনো যাচাই হয়নি, ইমেইলের লিংকে ট্যাপ করে আবার চেষ্টা করো।');
  } catch (error) {
    fail(api.friendly ? api.friendly(error) : 'যাচাই করা যায়নি, আবার চেষ্টা করো।');
  } finally { setBusy(false); }
};

const fill = arr => {
  const boxes = otpBoxes();
  const cells = [...($('sky-otp') ? $('sky-otp').querySelectorAll('.od') : [])];
  boxes.forEach((o, j) => { o.value = arr[j] || ''; if (cells[j]) cells[j].classList.toggle('f', !!o.value); });
};

const verifyCode = async () => {
  const code = otpBoxes().map(o => o.value).join('');
  if (code.length < 6 || state.busy) return;
  const api = bridge();
  if (!api) return fail('Account সেবা পাওয়া যাচ্ছে না, পেজটি একবার refresh করো।');
  setBusy(true);
  const otp = $('sky-otp');
  try {
    if (state.method === 'telegram') await api.verifyTelegram(code);
    else await api.verifyEmail(code);
    if (otp) { otp.classList.add('ok'); [...otp.querySelectorAll('.od')].forEach((e, k) => e.style.setProperty('--k', k)); }
    mood('happy'); kick('hop');
    const hint = $('sky-ot-h');
    if (hint) { hint.className = 'hint ok'; hint.textContent = 'যাচাই সফল হয়েছে!'; }
    setTimeout(() => { api.finish(); go(lastScreen()); }, 900);
  } catch (error) {
    if (otp) { otp.classList.remove('bad'); void otp.offsetWidth; otp.classList.add('bad'); }
    mood('sad'); kick('shake');
    const hint = $('sky-ot-h');
    if (hint) { hint.className = 'hint err'; hint.textContent = api.friendly ? api.friendly(error) : 'কোডটা মেলেনি, আবার চেষ্টা করো'; }
    setTimeout(() => { if (otp) otp.classList.remove('bad'); mood(''); fill([]); refresh(); }, 900);
  } finally { setBusy(false); }
};

const fail = text => {
  const hint = (host() && host().querySelector('.scr.on .hint')) || $('sky-ot-h');
  if (hint) { hint.className = 'hint err'; hint.textContent = text; }
  mood('sad'); kick('shake');
  setTimeout(() => mood(''), 1200);
};

const setBusy = busy => {
  state.busy = Boolean(busy);
  const button = cta();
  if (button) button.setAttribute('aria-busy', state.busy ? 'true' : 'false');
  host().querySelectorAll('button').forEach(el => {
    if (el.id === 'sky-cta') return;
    if (state.busy) { if (!el.disabled) { el.dataset.skyBusy = '1'; el.disabled = true; } }
    else if (el.dataset.skyBusy === '1') { el.disabled = false; delete el.dataset.skyBusy; }
  });
  // setBusy(false) must re-gate the CTA: refresh() may have run while busy was
  // still true, which disables it and leaves it stuck after the request ends.
  refresh();
};

/* ---- next / back ---- */
const next = async () => {
  const button = cta();
  if (!button || button.disabled || state.busy) return;
  hideKb();
  if (state.mode === 'login') {
    if (state.i === 0) return go(1);
    if (state.i === 1) return doLogin();
    if (state.i === 2) return go(3);
    if (state.i === 3) return state.link ? checkLink() : verifyCode();
    return;
  }
  if (state.i === 4) return submitSignup();
  if (state.i === 5) return go(6);
  if (state.i === 6) return state.link ? checkLink() : verifyCode();
  go(state.i + 1);
};

const back = () => {
  // Owner (2026-10-15): back must work on every step. On the first step it
  // leaves the flow for the welcome screen; elsewhere it steps one screen back.
  if (state.i === 0) {
    const api = bridge();
    if (api && api.welcome) api.welcome();
    else if (api) api.conceal();
    return;
  }
  go(state.i - 1);
};

const submitSignup = async () => {
  const api = bridge();
  if (!api) return fail('Account সেবা পাওয়া যাচ্ছে না, পেজটি একবার refresh করো।');
  setBusy(true);
  const button = cta();
  if (button) button.classList.add('busy');
  try {
    const result = await within(api.signup(state.email, state.pw, {
      fullName: state.name.trim().replace(/\s+/g, ' '),
      dob: dobValue(),
      school: state.inst.school,
      higherInstitution: state.inst.college
    }), 30000);
    // The server decides which verification routes are live for this account.
    const options = result && result.verification && result.verification.options;
    if (options && options.telegram && options.telegram.available === false && state.method === 'telegram') {
      state.method = 'email';
      markMethod();
    }
    if (button) button.classList.remove('busy');
    setBusy(false);
    go(5);
  } catch (error) {
    if (button) button.classList.remove('busy');
    setBusy(false);
    if (error && error.code === 'EMAIL_ALREADY_IN_USE') {
      const existing = state.email;
      go(3);
      setTimeout(() => {
        const hint = $('sky-em-h');
        if (!hint) return;
        hint.className = 'hint err';
        hint.textContent = 'এই ইমেইলে আগে থেকেই অ্যাকাউন্ট আছে। ';
        const link = document.createElement('button');
        link.type = 'button';
        link.textContent = 'সাইন ইন করো →';
        link.style.cssText = 'border:0;background:none;color:var(--p);font-weight:700;padding:0;text-decoration:underline';
        link.addEventListener('click', () => open('login', { email: existing }));
        hint.append(link);
      }, 60);
      talk('এই ইমেইলে আগে থেকেই অ্যাকাউন্ট আছে!');
      mood('sad'); kick('shake');
      setTimeout(() => mood(''), 1200);
      return;
    }
    fail(api.friendly ? api.friendly(error) : 'অ্যাকাউন্ট তৈরি করা যায়নি, আবার চেষ্টা করো।');
  }
};

const doLogin = async () => {
  const api = bridge();
  if (!api) return fail('Account সেবা পাওয়া যাচ্ছে না, পেজটি একবার refresh করো।');
  setBusy(true);
  const button = cta();
  if (button) button.classList.add('busy');
  try {
    const result = await within(api.login(state.email, state.pw), 30000);
    if (button) button.classList.remove('busy');
    setBusy(false);
    if (result && result.authenticated === true) {
      api.finish();
      return go(4);
    }
    // The account is real but still needs one verification step.
    const options = result && result.verification && result.verification.options;
    if (options && options.telegram && options.telegram.available === false) {
      state.method = 'email';
      markMethod();
    }
    go(2);
  } catch (error) {
    if (button) button.classList.remove('busy');
    setBusy(false);
    const hint = $('sky-lpw-h');
    if (hint) { hint.className = 'hint err'; hint.textContent = api.friendly ? api.friendly(error) : 'ঢোকা যায়নি, আবার চেষ্টা করো।'; }
    mood('sad'); kick('shake');
    const field = $('sky-lf-pw');
    if (field) field.classList.add('bad');
    setTimeout(() => { mood(''); if (field) field.classList.remove('bad'); }, 1200);
  }
};

/* ---- password helpers ---- */
const strength = p => { let s = 0; if (p.length >= 8) s++; if (/\d/.test(p)) s++; if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++; if (/[^\w]/.test(p) || p.length >= 12) s++; return p ? Math.max(1, s) : 0; };

const passwordCheck = () => {
  const pw = $('sky-in-pw'), pw2 = $('sky-in-pw2');
  state.pw = pw.value; state.pw2 = pw2.value;
  const s = strength(state.pw);
  const meter = $('sky-mt');
  if (meter) meter.className = 'meter' + (s ? ' s' + s : '');
  const match = state.pw2 && state.pw === state.pw2;
  const f2 = $('sky-f-pw2');
  if (f2) { f2.classList.toggle('good', !!match && state.pw.length >= 8); f2.classList.toggle('bad', !!state.pw2 && !match); }
  const hint = $('sky-pw-h');
  if (hint) hint.textContent = state.pw.length && state.pw.length < 8 ? `আরও ${bn(8 - state.pw.length)} অক্ষর লাগবে`
    : (state.pw2 && !match ? 'দুটো পাসওয়ার্ড মিলছে না' : (match ? 'দারুণ, মিলে গেছে!' : ''));
  if (match && state.pw.length >= 8) { mood('happy'); setTimeout(() => { if (document.activeElement === pw2) mood('cover'); }, 900); }
  kick('peck', 250);
  refresh();
};

/* ---- date of birth wheel ---- */
const YEARS = [];
for (let y = 2012; y >= 1990; y--) YEARS.push(y);
const dim = () => new Date(state.y, state.m + 1, 0).getDate();

const ageLabel = () => {
  const node = $('sky-age');
  if (!node) return;
  const n = new Date(), b = new Date(state.y, state.m, state.d);
  let a = n.getFullYear() - b.getFullYear();
  if (n < new Date(n.getFullYear(), state.m, state.d)) a--;
  node.textContent = `${bn(state.d)} ${MONTHS[state.m]} ${bn(state.y)} · বয়স ${bn(a)} বছর`;
};

const buildWheel = (el, items, sel, onPick) => {
  el.innerHTML = '<div class="pad"></div>' + items.map(t => `<div class="it">${t}</div>`).join('') + '<div class="pad"></div>';
  const its = [...el.querySelectorAll('.it')];
  let tm, last = -1;
  const mark = k => its.forEach((e, j) => e.classList.toggle('sel', j === k));
  el.scrollTop = sel * 44; mark(sel);
  el.addEventListener('scroll', () => {
    const k = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / 44)));
    if (k !== last) { last = k; mark(k); kick('peck', 250); mood('wow'); look(0, -4); }
    clearTimeout(tm);
    tm = setTimeout(() => { onPick(k); mood(''); look(0, 0); }, 140);
  });
  return { set: k => el.scrollTo({ top: k * 44, behavior: 'smooth' }) };
};

const dobValue = () => `${state.y}-${String(state.m + 1).padStart(2, '0')}-${String(state.d).padStart(2, '0')}`;

const setupDob = () => {
  const cd = $('sky-c-d'), cm = $('sky-c-m'), cy = $('sky-c-y');
  if (!cd || !cm || !cy) return;
  const wd = buildWheel(cd, Array.from({ length: 31 }, (_, k) => bn(k + 1)), state.d - 1, k => { state.d = Math.min(k + 1, dim()); if (k + 1 > dim()) wd.set(state.d - 1); ageLabel(); refresh(); });
  buildWheel(cm, MONTHS, state.m, k => { state.m = k; if (state.d > dim()) { state.d = dim(); wd.set(state.d - 1); } ageLabel(); refresh(); });
  buildWheel(cy, YEARS.map(bn), YEARS.indexOf(state.y), k => { state.y = YEARS[k]; if (state.d > dim()) { state.d = dim(); wd.set(state.d - 1); } ageLabel(); refresh(); });
  ageLabel();
};

/* ---- institution search (real catalog) ---- */
const normalText = v => String(v || '').normalize('NFKC').toLocaleLowerCase('bn-BD').replace(/[’‘`´]/g, "'").replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

const matchInstitutions = (query, kind) => {
  const list = kind === 'school' ? state.schools : state.colleges;
  const q = normalText(query);
  if (!q) return [];
  return list.filter(item => normalText(item.name).includes(q)).slice(0, 5);
};

const wireInstitution = (kind, inputId, boxId) => {
  const input = $(inputId), box = $(boxId);
  if (!input || !box) return;
  const render = () => {
    const q = input.value.trim();
    state.inst[kind] = null;
    refresh();
    if (q.length < 2) { box.classList.remove('show'); box.innerHTML = ''; return; }
    const matches = matchInstitutions(q, kind);
    box.innerHTML = matches.map(item => `<button type="button" data-n="${item.name}">${item.name}</button>`).join('')
      + `<button type="button" data-n="${q}">‘${q}’ যোগ করো</button>`;
    box.classList.add('show');
    kick('peck', 250); mimic(); look(0, 6);
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', () => { mood('listen'); look(0, 6); });
  input.addEventListener('blur', () => { mood(''); look(0, 0); });
  box.addEventListener('pointerdown', e => e.preventDefault());
  box.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    input.value = b.dataset.n;
    const match = matchInstitutions(b.dataset.n, kind).find(item => item.name === b.dataset.n);
    state.inst[kind] = match ? { id: match.id, name: match.name, district: match.district || '' } : { id: 'manual', name: b.dataset.n, district: '' };
    if (kind === 'school') state.school = state.inst.school.name;
    else state.college = state.inst.college.name;
    box.classList.remove('show');
    input.closest('.fl').classList.add('good');
    kick('hop'); hideKb(); refresh();
  });
  input.addEventListener('input', () => input.closest('.fl').classList.remove('good'));
};

/* ---- method cards ---- */
const markMethod = () => {
  host().querySelectorAll('.mc').forEach(card => card.classList.toggle('sel', card.dataset.m === state.method));
};

/* ---- celebrate ---- */
const confetti = () => {
  const cf = $('sky-cf');
  if (!cf) return;
  const colors = ['#2F6BFF', '#FF9F1C', '#00B386', '#E02D7B', '#8B3DFF'];
  for (let k = 0; k < 40; k++) {
    const e = document.createElement('i');
    e.style.left = Math.random() * 100 + '%';
    e.style.background = colors[k % 5];
    e.style.setProperty('--d', (1.6 + Math.random() * 1.4) + 's');
    e.style.setProperty('--x', (Math.random() * 120 - 60) + 'px');
    e.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
    cf.appendChild(e);
    setTimeout(() => e.remove(), 3400);
  }
};

const celebrate = () => {
  mood('cheer'); kick('loop', 1800);
  const h = $('sky-dn-h');
  if (h) h.textContent = `স্বাগতম, ${first()}!`;
  confetti(); setTimeout(confetti, 1000);
};

/* ---- build + bind ---- */
/* `built` guards the per-screen DOM rebuild; `globals` guards the document- and
   viewport-level listeners, which must attach exactly once no matter how many
   times the flow is reopened. */
let built = false, globals = false;
const build = () => {
  if (built) return;
  built = true;
  const root = host();
  if (!root) return;
  // The bird, bubble and footer are shared; only the screens change per mode.
  if (!$('sky-app')) root.innerHTML = CARD;
  const stage = $('sky-stage');
  stage.innerHTML = (state.mode === 'login' ? LOGIN_SCREENS : SIGNUP_SCREENS).join('');

  cta().addEventListener('click', next);
  $('sky-back').addEventListener('click', back);
  host().querySelectorAll('.cl').forEach(b => b.addEventListener('pointerdown', e => {
    e.preventDefault();
    const t = $(b.dataset.c);
    t.value = ''; t.dispatchEvent(new Event('input')); t.focus();
  }));

  if (state.mode === 'login') bindLogin();
  else bindSignup();

  host().querySelectorAll('.eye').forEach(b => {
    b.addEventListener('pointerdown', e => e.preventDefault());
    b.addEventListener('click', () => {
      const t = $(b.dataset.t);
      t.type = t.type === 'password' ? 'text' : 'password';
      mood(t.type === 'text' ? 'wow' : 'cover');
      setTimeout(() => { if (document.activeElement === t && t.type === 'password') mood('cover'); }, 500);
    });
  });

  host().querySelectorAll('.mc').forEach(c => c.addEventListener('click', () => {
    if (state.busy) return;
    state.method = c.dataset.m;
    markMethod(); kick('hop');
    talk(state.method === 'email' ? 'ইমেইলেই কোড পাঠাব!' : 'টেলিগ্রামে কোড পাঠাব!');
    setMethodCopy();
  }));

  bindOtp();
  if (globals) { wake(); return; }
  globals = true;
  document.addEventListener('pointerdown', e => { if (!e.target.closest('input,.fl,.chip,button,.sbtn')) hideKb(); });
  $('sky-stage').addEventListener('touchmove', hideKb, { passive: true });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); hideKb(); } });
  if (window.visualViewport) {
    // --vh only follows the visual viewport while a flow field is focused and the keyboard is really
    // up. Otherwise it is removed and the CSS falls back to 100dvh, so a stale (keyboard-sized) height
    // can never leave the bottom third of the screen empty after the keyboard closes.
    const fit = () => {
      const h = host(); if (!h) return;
      const vv = window.visualViewport, a = document.activeElement;
      const typing = !!(a && a.tagName === 'INPUT' && h.contains(a));
      if (typing && vv.height < window.innerHeight * 0.88) h.style.setProperty('--vh', vv.height + 'px');
      else h.style.removeProperty('--vh');
      window.scrollTo(0, 0);
    };
    window.visualViewport.addEventListener('resize', fit); fit();
  }

  /* ---- keyboard-aware layout (owner 2026-10-17) ----
     Keyboard up: compact mode (see sky-onboarding.css [data-kb]) - the bird glides to the top-left,
     the focused field is kept in view and nothing is cut off. Keyboard down: the bird glides back
     to the middle. The layout follows the focused field, not a guessed keyboard height, and the
     glide is measured before/after the change (FLIP) so it is smooth on every phone. */
  {
    const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const appEl = () => document.getElementById('sky-app');
    const editing = () => { const a = document.activeElement; const h = host(); return !!(a && a.tagName === 'INPUT' && h && h.contains(a)); };
    let kbTimer = 0, inTimer = 0, placeTimers = [];
    const place = () => {
      if (!editing()) return;
      const f = document.activeElement, scr = f.closest('.scr');
      if (!scr) return;
      const box = f.closest('.fl, .otp, .ob') || f;
      const sr = scr.getBoundingClientRect(), br = box.getBoundingClientRect();
      const hasList = !!scr.querySelector('.sug');
      let delta = 0;
      if (br.top < sr.top + 4) delta = br.top - sr.top - 6;
      else if (hasList && br.top > sr.top + 8) delta = br.top - sr.top - 6;   // keep the room below for suggestions
      else if (br.bottom > sr.bottom - 10) delta = br.bottom - sr.bottom + 14;
      if (Math.abs(delta) > 3) scr.scrollBy({ top: delta, behavior: reduce() ? 'auto' : 'smooth' });
    };
    // Keyboard up: the stage fills the space between the bubble and the Next button (CSS), and the
    // Next button sits just above the keyboard. The big bird stays ("roomy") whenever the active
    // screen still fits with it; only when it would not fit does the bird shrink to the corner.
    // Measured synchronously in one frame (try roomy -> check overflow), so nothing flickers.
    const fitStage = () => {
      const app = appEl(), stage = $('sky-stage');
      if (stage) stage.style.height = '';
      if (!app) return;
      if (app.dataset.kb !== '1') { delete app.dataset.kbroomy; app.style.removeProperty('--kbbird'); return; }
      const scr = stage && stage.querySelector('.scr.on');
      if (!scr) return;
      app.style.removeProperty('--kbbird');
      app.dataset.kbroomy = '1';
      // Size the big bird to the free space: grow into a gap, shrink when tight (aspect 1:1, so the
      // width change is the height change). Only if even 56px does not fit does it go to the corner.
      const top = scr.getBoundingClientRect().top;
      let bottom = top;
      for (const child of scr.children) { const r = child.getBoundingClientRect(); if (r.height > 0) bottom = Math.max(bottom, r.bottom); }
      const need = bottom - top + (parseFloat(getComputedStyle(scr).paddingBottom) || 0);
      const bird = $('sky-bird'), w = bird ? bird.getBoundingClientRect().width : 0;
      if (w) {
        const nw = Math.max(56, Math.min(170, Math.floor(w - (need - scr.clientHeight) - 8)));
        if (Math.abs(nw - w) > 2) app.style.setProperty('--kbbird', nw + 'px');
      }
      if (scr.scrollHeight > scr.clientHeight + 2 || scr.clientHeight < 96) { delete app.dataset.kbroomy; app.style.removeProperty('--kbbird'); }
    };
    const placeLater = () => { placeTimers.forEach(clearTimeout); placeTimers = [60, 380, 800].map(ms => setTimeout(() => { fitStage(); place(); }, ms)); };
    const setKb = on => {
      const app = appEl();
      if (!app || (app.dataset.kb === '1') === on) return;
      const bird = $('sky-bird'), bubble = $('sky-bubble');
      const first = bird && bird.getBoundingClientRect();
      const hostEl = host();
      const pageEl = hostEl && hostEl.parentElement;
      if (on) { app.dataset.kb = '1'; if (hostEl) hostEl.dataset.kb = '1'; if (pageEl) pageEl.dataset.skyKb = '1'; }
      else { delete app.dataset.kb; if (hostEl) delete hostEl.dataset.kb; if (pageEl) delete pageEl.dataset.skyKb; }
      fitStage();
      if (bird && first && !reduce() && bird.animate) {
        const last = bird.getBoundingClientRect();
        if (last.width) {
          const dx = first.left - last.left, dy = first.top - last.top, s = first.width / last.width;
          bird.animate([
            { transformOrigin: '0 0', translate: dx + 'px ' + dy + 'px', scale: String(s) },
            { transformOrigin: '0 0', translate: '0 0', scale: '1' }
          ], { duration: 340, easing: 'cubic-bezier(.2,.9,.25,1)' });
        }
        if (bubble) bubble.animate([{ opacity: 0, translate: on ? '-10px 0' : '0 -8px' }, { opacity: 1, translate: '0 0' }],
          { duration: 260, delay: 60, fill: 'backwards', easing: 'ease-out' });
      }
      placeLater();
    };
    // iOS sometimes never reports the keyboard going away (the page keeps its shrunken height
    // and the Next button stays high). With no field focused, the page-level helper in
    // ios-chrome.js restores the full height (the flow itself never touches html/body).
    const settle = force => {
      if (window.AhViewport) window.AhViewport.settle(force);
      [150, 500, 1100].forEach(ms => setTimeout(() => {
        if (editing() && !force) return;
        if (host()) host().style.removeProperty('--vh');
        window.scrollTo(0, 0);
      }, ms));
    };
    // The keyboard is really up only while the visual viewport is clearly shorter than the layout
    // viewport (the same test index.html uses for body.keyboard-open).
    const kbVisible = () => { const vv = window.visualViewport; return !vv || vv.height < window.innerHeight * 0.88; };
    let hideTimer = 0;
    // A field can stay focused after the keyboard is dismissed with the iOS bar (the caret keeps
    // blinking, the page keeps its shrunken height and the Next button hangs mid-screen). Compact
    // mode must follow the keyboard, not just focus: give the keyboard time to appear, then relax.
    const reeval = () => {
      clearTimeout(hideTimer);
      if (!editing()) return;
      if (kbVisible()) { setKb(true); return; }
      hideTimer = setTimeout(() => { if (editing() && !kbVisible()) { setKb(false); settle(true); } }, 900);
    };
    const evalKb = () => {
      clearTimeout(kbTimer);
      if (editing()) { setKb(true); placeLater(); reeval(); return; }
      // focus often hops straight to the next field; only leave compact mode if it stays empty
      kbTimer = setTimeout(() => { if (!editing()) { setKb(false); settle(false); } }, 160);
    };
    document.addEventListener('focusin', evalKb, true);
    document.addEventListener('focusout', evalKb, true);
    document.addEventListener('input', () => { if (!editing()) return; clearTimeout(inTimer); inTimer = setTimeout(() => { fitStage(); place(); }, 220); }, true);
    try {
      let stageTimer = 0;
      const refit = () => { clearTimeout(stageTimer); stageTimer = setTimeout(fitStage, 90); };
      const watch = () => { const st = $('sky-stage'); if (st) new MutationObserver(refit).observe(st, { attributes: true, attributeFilter: ['class', 'hidden'], childList: true, subtree: true }); return !!st; };
      if (!watch()) { let tries = 0; const t = setInterval(() => { if (watch() || ++tries > 40) clearInterval(t); }, 250); }
    } catch (_) {}
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => {
      if (editing()) { reeval(); placeLater(); return; }
      const app = appEl();
      if (app && app.dataset.kb === '1' && !kbVisible()) { setKb(false); settle(true); }
    });
    // Watchdog: iOS sometimes never fires the resize when the keyboard goes away. While compact mode
    // or a keyboard height is still applied, re-check twice a second and restore the full layout.
    // The state must hold for two ticks in a row (~1s), so a keyboard that is still sliding up is
    // never mistaken for a missing one.
    let stuckTicks = 0;
    setInterval(() => {
      const app = appEl(), h = host();
      if (!app || !h) { stuckTicks = 0; return; }
      const applied = app.dataset.kb === '1' || !!h.style.getPropertyValue('--vh');
      if (!applied || (editing() && kbVisible())) { stuckTicks = 0; return; }
      if (++stuckTicks < 2) return;
      stuckTicks = 0;
      if (app.dataset.kb === '1') setKb(false);
      h.style.removeProperty('--vh');
    }, 500);
  }
  wake();
};

const bindLogin = () => {
  const em = $('sky-lin-em');
  em.addEventListener('focus', () => { mood('listen'); look(0, 6); });
  em.addEventListener('blur', () => { mood(''); look(0, 0); });
  em.addEventListener('input', () => {
    state.email = em.value.trim();
    const ok = emailAcceptable(state.email);
    const blocked = EMAIL_RE.test(state.email) && !ok;
    $('sky-lf-em').classList.toggle('good', ok);
    $('sky-lem-h').className = blocked ? 'hint err' : 'hint';
    $('sky-lem-h').textContent = blocked ? disposableMessage() : ok ? 'চমৎকার, ঠিকানাটা ঠিক আছে' : '';
    kick('peck', 250); mimic(); look(Math.max(-6, Math.min(6, state.email.length * .4 - 6)), 6);
    if (ok) { mood('happy'); setTimeout(() => { if (document.activeElement === em) mood('listen'); }, 800); } else mood('listen');
    refresh();
  });
  host().querySelectorAll('#sky-l0 .chip').forEach(c => c.addEventListener('click', () => {
    em.value = em.value.split('@')[0] + '@' + c.dataset.d;
    em.dispatchEvent(new Event('input')); kick('hop'); hideKb();
  }));
  const pw = $('sky-lin-pw');
  pw.addEventListener('focus', () => mood('cover'));
  pw.addEventListener('blur', () => mood(''));
  pw.addEventListener('input', () => { state.pw = pw.value; $('sky-lf-pw').classList.remove('bad'); $('sky-lpw-h').textContent = ''; kick('peck', 250); refresh(); });

  const provider = async (name, label, call) => {
    if (state.busy) return;
    const api = bridge();
    if (!api) return fail('Account সেবা পাওয়া যাচ্ছে না, পেজটি একবার refresh করো।');
    setBusy(true); mood('listen'); talk(label);
    try {
      const done = await call(api);
      if (!done) { mood(''); $('sky-lem-h').className = 'hint err'; $('sky-lem-h').textContent = `${name} সাইন-ইন সম্পন্ন হয়নি, ইমেইল দিয়ে চেষ্টা করো।`; return; }
      api.finish(); go(4);
    } catch (error) {
      $('sky-lem-h').className = 'hint err';
      $('sky-lem-h').textContent = api.friendly ? api.friendly(error) : `${name} সাইন-ইন সম্পন্ন হয়নি, ইমেইল দিয়ে চেষ্টা করো।`;
    } finally { setBusy(false); }
  };
  $('sky-b-google').addEventListener('click', () => provider('Google', 'গুগলের সাথে যুক্ত হচ্ছি…', api => api.google()));
  $('sky-b-fb').addEventListener('click', () => provider('Telegram', 'টেলিগ্রামে যাচ্ছি…', api => (api.telegram ? api.telegram() : false)));
  $('sky-b-pass').addEventListener('click', () => provider('Passkey', 'আঙুল বা মুখ দিয়ে নিশ্চিত করো…', api => api.passkey()));

  $('sky-b-forgot').addEventListener('click', async () => {
    if (state.busy) return;
    const api = bridge();
    if (!api) return fail('Account সেবা পাওয়া যাচ্ছে না, পেজটি একবার refresh করো।');
    const email = em.value.trim();
    if (!emailAcceptable(email)) { $('sky-lem-h').className = 'hint err'; $('sky-lem-h').textContent = EMAIL_RE.test(email) ? disposableMessage() : 'আগে তোমার ইমেইলটা লিখো।'; em.focus(); return; }
    setBusy(true);
    try {
      await api.forgot(email);
      $('sky-lpw-h').className = 'hint ok';
      $('sky-lpw-h').textContent = 'রিসেট লিংক পাঠানোর চেষ্টা করা হয়েছে, ইনবক্স দেখো।';
    } catch (error) {
      $('sky-lpw-h').className = 'hint err';
      $('sky-lpw-h').textContent = api.friendly ? api.friendly(error) : 'এখন পাঠানো যাচ্ছে না, একটু পরে চেষ্টা করো।';
    } finally { setBusy(false); }
  });
  $('sky-b-signup').addEventListener('click', () => { const api = bridge(); if (api) api.showSignup(); });
};

const bindSignup = () => {
  const name = $('sky-in-name');
  name.addEventListener('focus', () => { mood('listen'); look(0, 6); nameDone = false; });
  name.addEventListener('input', () => {
    state.name = name.value; nameDone = false;
    $('sky-f-name').classList.toggle('good', state.name.trim().length >= 2);
    kick('peck', 250); mimic(); mood('listen'); eyes(state.name.length);
    look(Math.max(-6, Math.min(6, state.name.length * .8 - 6)), 6);
    clearTimeout(idleT);
    idleT = setTimeout(() => { if (state.i === 0 && state.name && document.activeElement === name) { mood('think'); look(6, -5); } }, 1700);
    refresh();
  });
  name.addEventListener('blur', () => {
    clearTimeout(idleT);
    if (state.i !== 0) return;
    eyes(0); look(0, 0);
    if (state.name.trim().length >= 2 && !nameDone) {
      nameDone = true; mood('happy'); kick('clap', 1500);
      talk(`বুঝেছি! তুমি ${first()}। কী সুন্দর নাম!`);
      setTimeout(() => { if (state.i === 0) mood(''); }, 2200);
    } else mood('');
  });

  setupDob();

  host().querySelectorAll('#sky-lv .chip').forEach(c => c.addEventListener('click', () => {
    host().querySelectorAll('#sky-lv .chip').forEach(x => x.classList.remove('sel'));
    c.classList.add('sel');
    state.level = c.dataset.v;
    $('sky-sf').style.display = 'block';
    $('sky-cwrap').style.display = state.level === 'SSC' ? 'none' : 'block';
    kick('hop'); mood('happy'); setTimeout(() => mood(''), 900);
    talk(state.level === 'SSC' ? 'ঠিক আছে! তোমার স্কুলটা খুঁজে নাও।' : 'দারুণ! স্কুল আর কলেজ দুটোই বলো।');
    refresh();
  }));
  wireInstitution('school', 'sky-in-sch', 'sky-sg-sch');
  wireInstitution('college', 'sky-in-col', 'sky-sg-col');
  $('sky-skipc').addEventListener('click', () => {
    state.skipC = !state.skipC;
    $('sky-skipc').textContent = state.skipC ? 'ঠিক আছে, কলেজ পরে দেব ✓' : 'এখনো কলেজে ভর্তি হইনি';
    $('sky-f-col').style.opacity = state.skipC ? .4 : 1;
    hideKb(); refresh();
  });

  const em = $('sky-in-em');
  em.addEventListener('focus', () => { mood('listen'); look(0, 6); });
  em.addEventListener('blur', () => { mood(''); look(0, 0); });
  em.addEventListener('input', () => {
    state.email = em.value.trim();
    const ok = emailAcceptable(state.email);
    const blocked = EMAIL_RE.test(state.email) && !ok;
    $('sky-f-em').classList.toggle('good', ok);
    $('sky-em-h').className = blocked ? 'hint err' : 'hint';
    $('sky-em-h').textContent = blocked ? disposableMessage() : ok ? 'চমৎকার, ঠিকানাটা ঠিক আছে' : '';
    kick('peck', 250); mimic(); look(Math.max(-6, Math.min(6, state.email.length * .4 - 6)), 6);
    if (ok) { mood('happy'); setTimeout(() => { if (document.activeElement === em) mood('listen'); }, 800); } else mood('listen');
    refresh();
  });
  host().querySelectorAll('#sky-s3 .chip').forEach(c => c.addEventListener('click', () => {
    em.value = em.value.split('@')[0] + '@' + c.dataset.d;
    em.dispatchEvent(new Event('input')); kick('hop'); hideKb();
  }));

  const pw = $('sky-in-pw'), pw2 = $('sky-in-pw2');
  pw.addEventListener('input', passwordCheck);
  pw2.addEventListener('input', passwordCheck);
  [pw, pw2].forEach(x => { x.addEventListener('focus', () => mood('cover')); x.addEventListener('blur', () => mood('')); });
};

const bindOtp = () => {
  const otp = $('sky-otp');
  if (!otp) return;
  const ods = otpBoxes(), cells = [...otp.querySelectorAll('.od')];
  ods.forEach((x, k) => {
    x.addEventListener('focus', () => { mood('listen'); look(0, 5); otp.classList.remove('hint1'); });
    x.addEventListener('blur', () => { mood(''); });
    x.addEventListener('input', () => {
      const d = norm(x.value);
      if (d.length > 1) {
        const arr = ods.map(o => o.value);
        for (let j = 0; j < d.length && k + j < 6; j++) arr[k + j] = d[j];
        fill(arr); ods[Math.min(k + d.length, 5)].focus();
      } else {
        x.value = d; cells[k].classList.toggle('f', !!d);
        if (d && k < 5) ods[k + 1].focus();
      }
      kick('peck', 250); mimic(); look((k - 2.5) * 2, 5); refresh();
      if (ods.every(o => o.value)) verifyCode();
    });
    x.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !x.value && k > 0) { ods[k - 1].focus(); ods[k - 1].value = ''; cells[k - 1].classList.remove('f'); refresh(); }
      if (e.key === 'ArrowLeft' && k > 0) ods[k - 1].focus();
      if (e.key === 'ArrowRight' && k < 5) ods[k + 1].focus();
    });
    x.addEventListener('paste', e => {
      const d = norm(e.clipboardData.getData('text') || '').slice(0, 6);
      if (!d) return;
      e.preventDefault(); fill(d.split('')); ods[Math.min(d.length, 5)].focus(); refresh();
      if (d.length === 6) verifyCode();
    });
  });
  const lk = $('sky-lk-c');
  if (lk) lk.addEventListener('click', checkLink);
  $('sky-rs-b').addEventListener('click', async () => {
    const api = bridge();
    if (!api || state.busy) return;
    kick('hop'); talk('নতুন কোড পাঠিয়ে দিলাম!');
    setBusy(true);
    try {
      const result = await within(state.method === 'telegram' ? api.startTelegram() : api.startEmail(), 60000);
      state.link = state.method === 'email' && result && result.link === true;
      showLink();
      state.resend = Number(result && result.resendAfter || 45);
      startResendCountdown(state.resend);
    } catch (error) {
      fail(api.friendly ? api.friendly(error) : 'নতুন কোড পাঠানো যায়নি, একটু পরে চেষ্টা করো।');
    } finally { setBusy(false); }
  });
};

/* ---------------------------------------------------------------- public */
const open = async (mode, opts = {}) => {
  const api = bridge();
  if (!api) return false;
  // The bridge owns the host element: it lives inside the account page, which
  // this script must not reach into directly.
  const root = api.mount ? api.mount() : host();
  if (!root) return false;
  state.mode = mode === 'login' ? 'login' : 'signup';
  state.i = 0;
  state.busy = false;
  state.last = lastScreen();
  state.caps = await api.capabilities();
  state.schools = await api.institutions('school');
  state.colleges = await api.institutions('college');
  state.inst = { school: null, college: null };
  if (state.mode === 'signup') {
    state.name = ''; state.level = ''; state.school = ''; state.college = ''; state.skipC = false;
    state.email = ''; state.pw = ''; state.pw2 = '';
    state.d = 15; state.m = 5; state.y = 2006;
  } else {
    state.email = ''; state.pw = '';
  }
  // Rebuild the screens for this mode; the shell is reused when it already exists.
  built = false;
  state.method = 'email';
  api.reveal(root);
  build();
  markMethod();
  const presetEmail = String((opts && opts.email) || '');
  if (presetEmail) {
    const field = $(state.mode === 'login' ? 'sky-lin-em' : 'sky-in-em');
    if (field) { field.value = presetEmail; field.dispatchEvent(new Event('input')); }
    state.email = presetEmail;
  }
  go(state.mode === 'login' && opts && opts.resume === 'verify' ? 2 : 0);
  const pending = api.takeNotice ? api.takeNotice() : null;
  if (pending && pending.text) notice(pending.text, pending.kind);
  return true;
};

const notice = (text, kind) => {
  if (!text) return;
  const hint = host() && host().querySelector('.scr.on .hint');
  if (hint) { hint.className = kind === 'error' ? 'hint err' : 'hint ok'; hint.textContent = text; }
  else talk(text);
};

const close = () => { const api = bridge(); if (api) api.conceal(); };

window.AdmissionSkyFlow = Object.freeze({ open, close, notice, get mode() { return state.mode; }, get i() { return state.i; }, get busy() { return state.busy; } });
})();
