/**
 * get_datetime (owner 2026-10-18): Sky's clock and calendar. Pure, no I/O.
 * Live time in Asia/Dhaka (UTC+6, no DST), weekday, English date, Bangla
 * (Bangabda, BD revised 2019) date, and "days left" to a date in the question.
 */
const BN = '০১২৩৪৫৬৭৮৯';
const bn = (s) => String(s).replace(/\d/g, (d) => BN[+d]);
const DAY_MS = 86400000;
const TZ_MS = 6 * 3600000;
const WEEK_BN = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
const MONTH_BN = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const MONTH_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const BANGLA_MONTHS = ['বৈশাখ', 'জ্যৈষ্ঠ', 'আষাঢ়', 'শ্রাবণ', 'ভাদ্র', 'আশ্বিন', 'কার্তিক', 'অগ্রহায়ণ', 'পৌষ', 'মাঘ', 'ফাল্গুন', 'চৈত্র'];

export const RE_TIME = /(কয়টা\s*বাজে|কটা\s*বাজে|কয়টা\s*বাজছে|সময়\s*কত|এখন\s*(কয়টা|কটা|সময়)|কত\s*তারিখ|তারিখ\s*কত|কী\s*বার|কি\s*বার|কোন\s*বার|বার\s*কী|কোন\s*মাস|বাংলা\s*(তারিখ|মাস|সন)|বঙ্গাব্দ|ক্যালেন্ডার|দিন\s*বাকি|দিন\s*আছে|what\s*time|current\s*time|time\s*now|what('?s|\s*is)\s*(the\s*)?(date|day)|today'?s\s*date|what\s*day|which\s*day|\bcalendar\b|days?\s*(left|remaining|until|till)|how\s*many\s*days)/i;
export const isTimeQuestion = (text) => RE_TIME.test(String(text || '').slice(0, 300));

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const utcDay = (y, m, d) => Date.UTC(y, m, d) / DAY_MS;

/** Bangabda date (Bangladesh revised calendar, 2019): 1 Boishakh = 14 April,
 *  first six months 31 days, Falgun 29 (30 when that February is leap), rest 30. */
export function banglaDate(y, m, d) {
  const startY = (m > 3 || (m === 3 && d >= 14)) ? y : y - 1;
  let off = utcDay(y, m, d) - utcDay(startY, 3, 14);
  const lens = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, isLeap(startY + 1) ? 30 : 29, 30];
  let i = 0;
  while (i < 11 && off >= lens[i]) { off -= lens[i]; i++; }
  return { year: startY - 593, month: i + 1, day: off + 1, monthName: BANGLA_MONTHS[i] };
}

/** Dhaka wall-clock parts for an epoch ms. */
export function dhakaParts(nowMs) {
  const t = new Date(Number(nowMs) + TZ_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes(), wd: t.getUTCDay() };
}

/** A date named in the question: 2026-12-01, 01/12/2026, "১ ডিসেম্বর", "December 1 2026". */
export function parseTargetDate(text, today) {
  const t = String(text || '').replace(/[০-৯]/g, (c) => String(BN.indexOf(c))).toLowerCase();
  let y, m, d, x;
  if ((x = t.match(/\b(20\d\d)-(\d{1,2})-(\d{1,2})\b/))) { y = +x[1]; m = +x[2] - 1; d = +x[3]; }
  else if ((x = t.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d\d)\b/))) { d = +x[1]; m = +x[2] - 1; y = +x[3]; }
  else {
    for (let i = 0; i < 12 && m == null; i++) {
      const names = [MONTH_BN[i], MONTH_EN[i], MONTH_EN[i].slice(0, 3)];
      for (const n of names) {
        const re = new RegExp('(\\d{1,2})\\s*(?:th|st|nd|rd|শে|লা|ই|ঠা)?\\s*' + n + '(?:\\s*,?\\s*(20\\d\\d))?|' + n + '\\s*(\\d{1,2})(?:\\s*,?\\s*(20\\d\\d))?', 'i');
        const mm = t.match(re);
        if (mm && (n.length > 3 || /[a-z]/.test(n))) { m = i; d = +(mm[1] || mm[3]); y = +(mm[2] || mm[4]) || 0; break; }
      }
    }
    if (m == null) return null;
    if (!y) { y = today.y; if (utcDay(y, m, d) < utcDay(today.y, today.m, today.d)) y++; }
  }
  if (!(m >= 0 && m < 12 && d >= 1 && d <= 31)) return null;
  const chk = new Date(Date.UTC(y, m, d));
  if (chk.getUTCMonth() !== m) return null;
  return { y, m, d };
}

/** The tool: everything Sky needs to answer a time / date / calendar question. */
export function getDateTime(nowMs = Date.now(), text = '') {
  const p = dhakaParts(nowMs);
  const b = banglaDate(p.y, p.m, p.d);
  const h12 = p.hh % 12 || 12;
  const part = p.hh < 4 ? 'রাত' : p.hh < 12 ? 'সকাল' : p.hh < 15 ? 'দুপুর' : p.hh < 18 ? 'বিকাল' : p.hh < 20 ? 'সন্ধ্যা' : 'রাত';
  const out = {
    ok: true,
    timezone: 'Asia/Dhaka',
    iso: p.y + '-' + String(p.m + 1).padStart(2, '0') + '-' + String(p.d).padStart(2, '0') + 'T' + String(p.hh).padStart(2, '0') + ':' + String(p.mm).padStart(2, '0') + '+06:00',
    time: part + ' ' + bn(h12) + ':' + bn(String(p.mm).padStart(2, '0')),
    weekday: WEEK_BN[p.wd],
    date: bn(p.d) + ' ' + MONTH_BN[p.m] + ' ' + bn(p.y),
    bangla: bn(b.day) + ' ' + b.monthName + ' ' + bn(b.year) + ' বঙ্গাব্দ'
  };
  const target = parseTargetDate(text, p);
  if (target) {
    out.target = bn(target.d) + ' ' + MONTH_BN[target.m] + ' ' + bn(target.y);
    out.daysLeft = utcDay(target.y, target.m, target.d) - utcDay(p.y, p.m, p.d);
  }
  return out;
}

/** One line added to every chat's system prompt so "this year" / "today" are never guessed. */
export function nowLine(nowMs = Date.now()) {
  const r = getDateTime(nowMs);
  return 'NOW (Asia/Dhaka, live clock): ' + r.iso + ', ' + r.weekday + ', ' + r.date + ' (' + r.bangla + '), ' + r.time + '. Use this for today, this year and countdowns; never guess the date.';
}

export function renderDateTime(r) {
  const lines = ['🕒 **এখন ' + r.time + '** (বাংলাদেশ সময়)', '', '- বার: **' + r.weekday + '**', '- তারিখ: **' + r.date + '**', '- বাংলা তারিখ: **' + r.bangla + '**'];
  if (r.target) {
    const n = r.daysLeft;
    lines.push('', n > 0 ? '⏳ ' + r.target + ' আসতে আর **' + bn(n) + ' দিন** বাকি।' : n === 0 ? '📌 ' + r.target + ', আজই!' : '📌 ' + r.target + ' পার হয়ে গেছে ' + bn(-n) + ' দিন আগে।');
  }
  return lines.join('\n');
}
