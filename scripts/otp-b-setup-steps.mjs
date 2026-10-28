#!/usr/bin/env node
// Prints the one-click copy link and the exact values to paste, so the owner
// never has to read code or dig through the repo.
//
//   node scripts/otp-b-setup-steps.mjs [--secret=<value>]

const secretFlag = process.argv.slice(2).find(arg => arg.startsWith('--secret='));
const secret = secretFlag ? secretFlag.slice('--secret='.length) : '<run with --secret=YOUR_SECRET>';

const raw = 'https://raw.githubusercontent.com/rashelmahmudpc-create/admission-hub-demo/main/apps-script/Code.gs';

console.log(`
========================================================
 otp-b (ফ্রি Gmail backup), আপনার ২ ধাপ
========================================================

ধাপ ১: script.google.com খুলুন → + New project

  ডিফল্ট কোড মুছে ফেলুন, তারপর এই লিংক থেকে কোডটা কপি-পেস্ট করুন:

    ${raw}

  (লিংকটা খুললে সাদা পেজে শুধু কোড দেখাবে। Ctrl+A দিয়ে সিলেক্ট,
   Ctrl+C দিয়ে কপি, তারপর Apps Script এডিটরে Ctrl+V)

ধাপ ২: বাঁয়ে ⚙️ Project Settings → Script Properties
        → Add script property, এই ২টা দিন:

    Name             Value
    SHARED_SECRET    ${secret}
    DAILY_LIMIT      100

ধাপ ৩: উপরে ডানে Deploy → New deployment
        ⚙️ আইকন → Web app বাছুন

    Execute as:       Me
    Who has access:   Anyone        ← ভুল হলে কাজ করবে না

        Deploy চাপুন → লম্বা একটা /exec লিংক পাবেন

ধাপ ৪: ওই /exec লিংকটা আমাকে পাঠান। বাকিটা আমি করব।

========================================================
`);
