// ✅ বুট-শেল স্ট্যাটিক-কন্ট্রাক্ট টেস্ট (v189-ac3)
// ইতিহাস: v176-এ ইনলাইন 3D-splash (ahfs-scene) ছিল; v178-nosplash-এ তা ইচ্ছাকৃতভাবে বাদ
// হয়ে index.html-এ এখন JS-নির্ভরহীন বুট-শেল (#ahSplash=লোডার)। এই স্যুট বর্তমান কন্ট্রাক্ট যাচাই করে।
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';

let html = readFileSync('index.html', 'utf8');
// external scripts সরিয়ে শুধু DOM + inline content নিই (static-first proof)
html = html.replace(/<script src="[^"]*"><\/script>/g, '');
html = html.replace(/<script>\s*function([\s\S]*?)<\/script>/g, '');

// static-only scene: কোনো JS ছাড়াই
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const doc = dom.window.document;
let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } };

const ah = doc.getElementById('ahSplash');
t('১. #ahSplash লোডার exist (JS ছাড়াই)', !!ah);
t('২. main.app-loading + role=status', ah && ah.tagName === 'MAIN' && ah.classList.contains('app-loading') && ah.getAttribute('role') === 'status');
const boot = ah && ah.querySelector('.ah-boot');
t('৩. .ah-boot শেল exist', !!boot);
t('৪. .ah-boot-mark জীবন্ত Sky avatar (SVG পাখি: wing + eyes + cap)', boot && boot.querySelector('.ah-boot-mark svg .sk-all') && boot.querySelector('.ah-boot-mark svg .sk-wr') && boot.querySelector('.ah-boot-mark svg .sk-eyes'));
t('৫. স্প্ল্যাশে শুধু লোগো — কোনো টেক্সট শিরোনাম (<b>) নেই', boot && !boot.querySelector('b'));
t('৬. লোডিং-কপি বাংলা "লোড হচ্ছে…"', boot && boot.querySelector('i') && boot.querySelector('i').textContent.includes('লোড হচ্ছে'));
t('৭. বুট-মিনিমাল CSS inline (ah-boot-min + keyframes ahBootPulse)', !!doc.getElementById('ah-boot-min') && doc.getElementById('ah-boot-min').textContent.includes('@keyframes ahBootPulse'));
t('৮. reduced-motion গার্ড (মোশন-সংবেদনশীল)', doc.getElementById('ah-boot-min').textContent.includes('prefers-reduced-motion'));
t('৯. পুরনো ইনলাইন-3D-splash আর নেই (v178-nosplash; ahfs-scene = 0)', !doc.querySelector('.ahfs-scene') && !html.includes('ahfs-scene'));
t('১০. app-id + #app রুট exist', !!doc.getElementById('app'));
t('১১. externl-স্ক্রিপ্ট-না-থাকলেও শেল রেন্ডার (static-first প্রমাণ)', !!doc.getElementById('app').querySelector('#ahSplash'));

t('১২. current account-retired service-worker marker', html.includes("const expectedSwVersion = 'v364-sky-goal'"));

// নো-JS ফলব্যাক: বডিতে আগে শুধু লোডিং-স্প্ল্যাশ ছিল, তাই স্ক্রিপ্ট-চালু-না-থাকা
// ক্রলার মাত্র ৮৪ অক্ষর পড়ত — অথচ প্রতিটি কোর্স-ল্যান্ডিং পেজ সম্পূর্ণ প্রিরেন্ডারড।
const nojs = [...doc.querySelectorAll('body noscript')]
  .map(n => n.textContent.replace(/\s+/g, ' ').trim()).join(' ');
t('১৩. নো-JS ফলব্যাক ক্রলার-পাঠ্য কনটেন্ট দেয় (৮৪ অক্ষরের স্প্ল্যাশ নয়)', nojs.length > 300);
t('১৪. নো-JS ফলব্যাক ব্র্যান্ড-শিরোনাম ও সারমর্ম দেয়',
  /Admission Hub/.test(nojs) && /ভর্তি প্রস্তুতি/.test(nojs));
t('১৫. নো-JS ফলব্যাক প্রতিটি কোর্স-ল্যান্ডিং পেজে লিংক করে',
  ['prottoy', 'prottoy-master', 'sandhi', 'somas'].every(s => html.includes(`href="/courses/${s}/"`)));
t('১৬. নো-JS ফলব্যাক বডিতেই থাকে (হেডের ফন্ট-ফলব্যাক অটুট)', doc.querySelectorAll('body noscript').length === 1);
t('১৭. নো-JS ব্লকের স্টাইল হেডে (স্পেক-সম্মত, রানটাইমে নিষ্ক্রিয়)',
  !!doc.getElementById('ah-nojs-min'));
t('১৮. Google Search Console মালিকানা-ট্যাগ হেডে (owner property-র জন্য)',
  !!doc.querySelector('meta[name="google-site-verification"]') && doc.querySelector('meta[name="google-site-verification"]').getAttribute('content') === 'qSlzeztG7xsLD3oYQz-CuO4WOg4xUZvmY37OhsWWPXE');
t('১৯. canonical আগের মতোই আছে (SEO-ট্যাগ যোগে বদলায়নি)',
  doc.querySelector('link[rel="canonical"]') && doc.querySelector('link[rel="canonical"]').getAttribute('href') === 'https://admissionsky.pages.dev/');

console.log(`\nINTRO-BOOTSHELL: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
