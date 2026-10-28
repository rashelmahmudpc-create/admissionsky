/**
 * Gmail → Gemini → Telegram, বাংলা সারাংশ (owner automation, 2026-10-24).
 *
 * কোথায় চলে: Google Apps Script (সম্পূর্ণ ফ্রি, কোনো সার্ভার লাগে না)।
 * এই ফাইলটা রিপোর শিপিং বান্ডলে যায় না — `docs/` বিল্ড থেকে বাদ।
 *
 * সেটআপ (একবার):
 *   1. https://script.google.com → New project → এই কোডটা পেস্ট করুন।
 *   2. Project Settings → Script properties-এ তিনটা কী যোগ করুন:
 *        GEMINI_KEY  = আপনার Gemini API key
 *        TG_TOKEN    = Telegram বটের টোকেন (BotFather)
 *        TG_CHAT_ID  = আপনার chat id (@userinfobot দিয়ে পাওয়া যায়)
 *      (কী কোডে লিখবেন না — Script property-তেই থাকুক)
 *   3. Triggers → Add trigger → function `gmailDigest` → Time-driven →
 *      Minutes timer → every 10 minutes। অনুমতি চাইলে দিন।
 *   4. প্রথমবার `setup()` একবার চালান: লেবেল বানায় আর পুরোনো মেইল বাদ দেয়।
 *
 * কীভাবে কাজ করে: নতুন (unread, INBOX) মেইল দেখে → Gemini দিয়ে ২–৩ লাইনের
 * বাংলা সারাংশ বানায় → Telegram-এ পাঠায় → `ai-digest` লেবেল দিয়ে চিহ্নিত করে,
 * যাতে একই মেইল দুইবার না যায়।
 */

var LABEL = 'ai-digest';
var MAX_PER_RUN = 5;          // এক রানে সর্বোচ্চ কতটা মেইল (quota বাঁচাতে)
var GEMINI_MODEL = 'gemini-2.0-flash';
var MAX_BODY_CHARS = 4000;    // মেইলের বেশি অংশ মডেলকে দেব না

function setup() {
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  // এখনকার সব মেইল লেবেল করে দিন, নাহলে প্রথম রানেই ১০০০+ মেইলের সারাংশ যাবে।
  var threads = GmailApp.search('in:inbox -label:' + LABEL, 0, 100);
  while (threads.length) {
    label.addToThreads(threads);
    threads = GmailApp.search('in:inbox -label:' + LABEL, 0, 100);
  }
  Logger.log('setup done');
}

function gmailDigest() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('GEMINI_KEY');
  var token = props.getProperty('TG_TOKEN');
  var chatId = props.getProperty('TG_CHAT_ID');
  if (!key || !token || !chatId) {
    Logger.log('GEMINI_KEY / TG_TOKEN / TG_CHAT_ID কোনটা নেই — বন্ধ থাকল');
    return;
  }

  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  var threads = GmailApp.search('in:inbox is:unread -label:' + LABEL, 0, MAX_PER_RUN);
  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var msg = thread.getMessages()[0];
    var subject = msg.getSubject() || '(বিষয় নেই)';
    var from = msg.getFrom();
    var body = (msg.getPlainBody() || '').substring(0, MAX_BODY_CHARS);

    var summary = geminiSummary(key, subject, from, body);
    if (!summary) {
      // মডেল ব্যর্থ হলে লেবেল দেব না — পরের রানে আবার চেষ্টা হবে।
      continue;
    }
    var text = '📧 ' + subject + '\n' + '👤 ' + from + '\n\n' + summary + '\n\n🔗 ' + thread.getPermalink();
    if (telegramSend(token, chatId, text)) label.addToThread(thread);
  }
}

function geminiSummary(key, subject, from, body) {
  var prompt = 'নিচের ইমেইলটা ২–৩ বাক্যে সহজ বাংলায় সারাংশ করো। কী দরকার বা কী অ্যাকশন লাগতে পারে থাকলে শেষে একটা লাইনে বলো। '
    + 'শুধু সারাংশ লিখো, ভূমিকা নয়।\n\n'
    + 'Subject: ' + subject + '\nFrom: ' + from + '\n\n' + body;
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL
    + ':generateContent?key=' + encodeURIComponent(key);
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    if (res.getResponseCode() !== 200) {
      Logger.log('gemini ' + res.getResponseCode() + ': ' + res.getContentText().substring(0, 300));
      return '';
    }
    var data = JSON.parse(res.getContentText());
    var parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    var out = parts.map(function (p) { return p.text || ''; }).join('').trim();
    return out.substring(0, 1200);
  } catch (e) {
    Logger.log('gemini failed: ' + e);
    return '';
  }
}

function telegramSend(token, chatId, text) {
  try {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({
        chat_id: chatId,
        text: text.substring(0, 4000),
        disable_web_page_preview: false
      })
    });
    if (res.getResponseCode() !== 200) {
      Logger.log('telegram ' + res.getResponseCode() + ': ' + res.getContentText().substring(0, 300));
      return false;
    }
    return true;
  } catch (e) {
    Logger.log('telegram failed: ' + e);
    return false;
  }
}
