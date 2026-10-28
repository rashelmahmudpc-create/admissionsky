/* ============================================================
   ADMISSION HUB, Live app-wide language engine (blueprint §17)

   The app has two switch points that must agree: `AhI18n` in index.html
   (markup contract: data-bn / data-en) and the stored `ahLang` key that the AI
   page already reads. Neither reaches text rendered later by a module such as
   account-access.js or profile-ui.js, those build Bengali strings inline, so
   switching to English left the whole account and profile flow in Bengali.

   Rewriting ~200 inline strings across ~50 modules would touch every file and
   still miss the next one added. Instead this engine owns a translation table
   and rewrites Bengali text nodes in place, re-running on every `ah:lang` event
   and on DOM insertion. Modules keep writing Bengali (the honest default);
   the engine translates whatever appears.

   Scope and safety:
   • Only text nodes and the placeholder / aria-label / title attributes -
     never attribute values, never input values, never code.
   • Unknown strings are left untouched rather than machine-guessed, so a
     missing entry degrades to Bengali instead of showing wrong English.
   • Bengali numerals convert alongside the text so counts stay consistent.
   • The original Bengali is kept per node, so switching back is exact.
   ============================================================ */
(function () {
  'use strict';
  if (window.__ahLanguageEngine) return;
  window.__ahLanguageEngine = true;

  const KEY = 'ahLang';

  /* Bengali → English table. Keys are the exact rendered strings. */
  const DICT = {
    /* Profile, Sky instructions panel. */
    'SKY-কে তোমার নির্দেশনা': 'YOUR INSTRUCTIONS FOR SKY',
    'এক লাইনে লেখো Sky কীভাবে উত্তর দেবে, Sky সবসময় সেটা মানবে। শুধু পড়াশোনার ধরন; খারাপ কিছু রাখা যাবে না।': 'Write one line on how Sky should answer, and Sky will always follow it. Study style only, nothing harmful.',
    'এই সুবিধা এখন সাময়িক বন্ধ আছে।': 'This feature is temporarily off.',
    'নির্দেশনা': 'Instruction',
    'নির্দেশনা সেভ করো': 'Save instruction',
    'যেমন: সবসময় উদাহরণ দিয়ে বোঝাবে, শেষে একটা MCQ দেবে': 'For example: always explain with examples, end with one MCQ',
    'সবসময় সহজ বাংলায়, উদাহরণ দিয়ে বোঝাবে': 'Always explain in simple Bangla with examples',
    'উত্তর ছোট রাখবে, পয়েন্ট আকারে দেবে': 'Keep answers short and in bullet points',
    'প্রতিটা উত্তরের শেষে একটা ছোট প্র্যাকটিস প্রশ্ন দেবে': 'End every answer with a short practice question',
    'আমি মেডিকেল ভর্তি পরীক্ষার্থী, সেই অনুযায়ী বোঝাবে': 'I am a medical admission candidate, explain accordingly',
    'সেভ হয়েছে ✓, এখন থেকে Sky এভাবে উত্তর দেবে।': 'Saved ✓, Sky will answer this way from now on.',
    'নির্দেশনা মুছে ফেলা হয়েছে, Sky আগের মতো উত্তর দেবে।': 'Instruction cleared, Sky will answer as before.',
    'নির্দেশনা সেভ করতে লগইন করো।': 'Sign in to save an instruction.',
    'সেভ করা গেল না, আবার চেষ্টা করো।': 'Could not save, try again.',
    /* Account-flow copy that had no English entry (language-engine guard found
       these still Bengali in English mode). */
    '← পেছনে': '← Back',
    'নতুন code নিন': 'Get a new code',
    'Email-এ login link পাঠাও': 'Send a login link by email',
    'Email-এ আসা link চাপলেই যাচাই · code লাগবে না': 'Verify with the link in your email · no code needed',
    'Telegram verification শুধু Telegram account-এর নিয়ন্ত্রণ নিশ্চিত করে-Email মালিকানা নয়। Code বা Password কখনো অন্য কোনো chat-এ লিখবে না; শুধু secure form ব্যবহার করবে। START বা animation একা success নয়, নিশ্চিত ফল Admission Hub দেখাবে।': 'Telegram verification only proves control of your Telegram account, not ownership of the email. Never type the code or password into any other chat, use the secure form only. START or an animation alone is not success, only the confirmed result from Admission Hub is.',
    'এই ইমেইলে আগে ইমেইল-পাসওয়ার্ড দিয়ে অ্যাকাউন্ট খোলা হয়েছে, ইমেইল ও পাসওয়ার্ড দিয়ে সাইন ইন করো।': 'This email already has an email-password account. Sign in with that email and password.',
    'এই ইমেইলে কোড পাঠানো সম্ভব না। শুধু Gmail, Yahoo, iCloud, Hotmail বা Outlook ইমেইল ব্যবহার করো।': 'A code cannot be sent to this email. Use only Gmail, Yahoo, iCloud, Hotmail or Outlook.',
    'এই ইমেইল সেবাটি দিয়ে অ্যাকাউন্ট খোলা যায় না, একটি স্থায়ী ইমেইল ব্যবহার করুন।': 'This email service cannot be used to open an account. Use a permanent email address.',
    'Facebook/Messenger-এর মতো app-এর ভেতরের browser-এ Google লগইন করতে দেয় না। নিচের বাটন চাপলে সাইটটি Chrome-এ খুলবে, সেখানে Google দিয়ে ঢুকো।': 'Google sign-in does not work inside browsers built into apps like Facebook or Messenger. Tapping the button below opens the site in Chrome, where you can sign in with Google.',
    'Facebook/Messenger-এর মতো app-এর ভেতরের browser-এ Google লগইন করতে দেয় না। উপরের ⋯ মেনু থেকে "Open in browser" চাপো, অথবা লিংক কপি করে Safari বা Chrome-এ খোলো।': 'Google sign-in does not work inside browsers built into apps like Facebook or Messenger. Tap "Open in browser" in the ⋯ menu above, or copy the link and open it in Safari or Chrome.',
    'এই Email অন্য পদ্ধতিতে খোলা আছে, আগের পদ্ধতি দিয়ে ঢুকো।': 'This email was opened with another method. Sign in with that method.',
    'লগইন সম্পন্ন হয়নি, আবার চেষ্টা করো। বারবার হলে Chrome/Safari-এ সাইটটি খুলে চেষ্টা করো বা Email দিয়ে ঢুকো।': 'Sign-in did not complete. Try again. If it keeps failing, open the site in Chrome or Safari, or sign in with email.',
    'আগে আবার "Continue with Google" চাপো, ফিরে এসে এখানে ইমেইল ও পাসওয়ার্ড দাও। [google-token-missing]': 'Tap "Continue with Google" again first, then come back and enter the email and password here.',
    'নতুন সাইন-ইন পেজটি লোড হয়নি, পেজটি একবার refresh করো।': 'The new sign-in page did not load. Refresh the page once.',
    'Login link এখন পাঠানো যাচ্ছে না। Email OTP ব্যবহার করো।': 'A login link cannot be sent right now. Use email OTP instead.',
    'Login link মেয়াদোত্তীর্ণ বা অন্য browser-এ খোলা হয়েছে। যে browser থেকে link চেয়েছিলে সেখানে খোলো, অথবা নতুন link নাও।': 'The login link expired or was opened in another browser. Open it in the browser that requested it, or request a new link.',
    'অ্যাকাউন্ট': 'Account',
    'তোমার Admission Journey': 'Your admission journey',
    'নিরাপদ ও সহজেই account-এ প্রবেশ করো।': 'Sign in safely and easily.',
    'নিরাপদ ও সহজে account-এ প্রবেশ করো।': 'Sign in safely and easily.',
    'ভাষা বেছে নাও': 'Choose language',
    'বাংলা': 'Bangla',
    'ভাষা বেছে নাও': 'Choose language',
    'আপনার লক্ষ্য, আপনার অধিকার': 'Your goal, your right',
    'আপনার লক্ষ্যের পথে,': 'On the way to your goal,',
    'প্রথম ধাপটা আজ থেকেই।': 'take the first step today.',
    'শেখা থেকে অর্জন': 'From learning to achieving',
    'এক ধাপ করে সামনে': 'One step at a time',
    'পরিষ্কার ধারণা': 'Clear concepts',
    'নিজেকে যাচাই': 'Test yourself',
    'লক্ষ্যের দিকে': 'Towards your goal',
    'আজ থেকেই শুরু': 'Start today',
    'আবার দেখা হলো': 'Welcome back',
    'তোমার preparation যেখানে থেমেছিল, সেখান থেকেই শুরু করো।': 'Pick up your preparation where you left it.',
    'Log In করতে সমস্যা?': 'Trouble logging in?',
    'Password মনে না থাকলে Forgot password চাপো।': 'Tap Forgot password if you cannot recall it.',
    'নতুন হলে নিচে Sign Up করো।': 'New here? Sign up below.',
    'Passkey থাকলে এক ট্যাপে ঢুকতে পারো।': 'If you have a passkey, one tap gets you in.',
    'Password নতুন করে সেট করো': 'Set a new password',
    'Account-এর email লিখলে reset link পাঠানোর চেষ্টা করা হবে।': 'Enter your account email and we will try to send a reset link.',
    'Reset link পাঠান': 'Send reset link',
    'Login-এ ফিরুন': 'Back to login',
    'Log In-এ ফিরুন': 'Back to login',
    'তোমার বিদ্যালয়ের নাম লিখো': 'Type your school name',
    'নাম লিখতে শুরু করো, আমরা কাছাকাছি school খুঁজে দেব।': 'Start typing a name, we will find nearby matches.',
    'তোমার School কোনটি?': 'Which school is yours?',
    'সর্বোচ্চ ৩টি suggestion দেখাবে; নাম না পেলে নিজের লেখা ব্যবহার করো।': 'Up to 3 suggestions appear; if yours is missing, use your own wording.',
    'নাম খুঁজে পাচ্ছ না?': 'Cannot find the name?',
    'নিচে নাম না পেলে নিজের লেখা দিয়েই এগোতে পারবে।': 'If the name is not listed below, you can continue with your own wording.',
    'বিদ্যালয়ের নাম লিখে “নিজের লেখা ব্যবহার করুন” চাপো।': 'Type the school name and tap “Use my own wording”.',
    'পরে profile থেকে যেকোনো সময় বদলাতে পারবে।': 'You can change this from your profile any time.',
    'পরে profile থেকে যেকোনো তথ্য বদলাতে পারবে।': 'You can change any of this from your profile later.',
    'তুমি কোন কলেজ / বিশ্ববিদ্যালয়ে পড়েছ?': 'Which college or university did you attend?',
    'শিক্ষা প্রতিষ্ঠানের নাম লিখলে আমরা খুঁজে দেব।': 'Type the institution name and we will look it up.',
    'তোমার College / University?': 'Your college or university?',
    'এখন পড়ছ না? কলেজ/বিশ্ববিদ্যালয় না দিয়েও এগোতে পারো।': 'Not studying now? You can continue without a college or university.',
    'কলেজ/বিশ্ববিদ্যালয় খুঁজে পাচ্ছ না?': 'Cannot find your college or university?',
    'এখন পড়ছ না? খালি রেখেও Next চাপতে পারো।': 'Not studying now? You can leave it empty and tap Next.',
    'নাম না পেলে নিজের লেখা দিয়েই এগোতে পারবে।': 'If the name is missing, continue with your own wording.',
    'Account নিরাপদ করো': 'Secure your account',
    'Email ও শক্তিশালী Password দিয়ে account তৈরি করো': 'Create your account with an email and a strong password',
    'তোমার Email': 'Your email',
    'Verification method বাছার আগে কোনো message পাঠানো হবে না।': 'No message is sent before you choose a verification method.',
    'কমপক্ষে ৮ অক্ষর': 'At least 8 characters',
    'একটি বড় অক্ষর': 'One uppercase letter',
    'একটি সংখ্যা': 'One number',
    'আগে থেকেই account আছে?': 'Already have an account?',
    'Account তৈরির পরে Email অথবা Telegram-একটি বাস্তব verification method বেছে নেবে। তার আগে কিছু পাঠানো হবে না।': 'After signup you will choose a real verification method, email or Telegram. Nothing is sent before that.',
    'Sign Up-এর পর Email অথবা Telegram-একটি method বেছে নেবে। বেছে নেওয়ার আগে কিছু পাঠানো হবে না।': 'After signing up you will choose one method, email or Telegram. Nothing is sent before you pick.',
    'Sign Up-এর পর Email verification link পাঠানো হবে। Link-এ click করলেই verification সম্পন্ন হবে।': 'After signing up we will send an email verification link. One click on it completes verification.',
    'তোমার account তৈরি হয়েছে, প্রোফাইলের তথ্যও সংরক্ষিত।': 'Your account is created, your profile details are saved too.',
    'তোমার প্রোফাইল': 'Your profile',
    'এই তথ্যই তোমার admission profile': 'This is your admission profile',
    'নাম': 'Name',
    'জন্ম তারিখ': 'Date of birth',
    'বিদ্যালয়': 'School',
    'কলেজ / বিশ্ববিদ্যালয়': 'College / university',
    'তথ্য শুধু admission প্রস্তুতিতে ব্যবহার হবে।': 'This information is used only for admission preparation.',
    'পরের ধাপ': 'Next step',
    'একটি verification বাকি': 'One verification left',
    'একটি বাস্তব method দিয়ে verify করলেই account পুরোপুরি সক্রিয় হবে। পছন্দের আগে কোনো message যাবে না।': 'Verifying with a real method fully activates your account. No message goes out before you choose.',
    'নিরাপদ link, Email OTP নয়': 'Secure link, not an email OTP',
    'official bot-এর ৬ সংখ্যার code': 'Six-digit code from the official bot',
    'একটি verification method বেছে নাও': 'Choose a verification method',
    'তোমার account নিরাপদ রাখতে নিচের যেকোনো একটি পদ্ধতি ব্যবহার করো।': 'Use any one of the methods below to keep your account safe.',
    'সহজ ও দ্রুত · Email OTP নয়, নিরাপদ link': 'Simple and fast · a secure link, not an email OTP',
    'Email OTP': 'Email OTP',
    'Email-এ আসা ৬ সংখ্যার code · Email মালিকানার প্রমাণ': 'Six-digit code sent to your email · proof of email ownership',
    'Email link (Firebase)': 'Email link (Firebase)',
    'Firebase link · শেষ বিকল্প, backup হিসেবে': 'Firebase link · last resort, kept as backup',
    'Email-এ পাঠানো ৬ সংখ্যার code লিখো': 'Enter the six-digit code sent to your email',
    'তোমার Email-এ': 'to your email',
    'Code পাঠানো হয়েছে': 'The code was sent',
    '। এটি Email মালিকানার সরাসরি প্রমাণ।': '. This is direct proof of email ownership.',
    'Code না পেলে Spam folder দেখো, অথবা নতুন code নাও।': 'Did not get the code? Check your spam folder, or request a new code.',
    'Code কখনো অন্য কাউকে দিও না। Admission Hub কখনো ফোনে বা chat-এ code চাইবে না।': 'Never share the code with anyone. Admission Hub will never ask for it over the phone or in chat.',
    'অন্য পদ্ধতি ব্যবহার করো': 'Use another method',
    'নতুন code পাঠানো হয়েছে।': 'A new code has been sent.',
    'Email OTP যাচাই এখন পাওয়া যাচ্ছে না।': 'Email OTP verification is unavailable right now.',
    'নতুন code পাঠানো যায়নি।': 'A new code could not be sent.',
    'তোমার Email মালিকানা যাচাই হয়েছে।': 'Your email ownership has been verified.',
    '৬ সংখ্যার code লিখুন।': 'Enter the six-digit code.',
    'দ্রুত ও নিরাপদ · Verification শেষে optional': 'Fast and secure · optional after verification',
    'WhatsApp দিয়ে verify': 'Verify with WhatsApp',
    'এখন verification পাওয়া যাচ্ছে না': 'Verification is unavailable right now',
    'Telegram দিয়ে verify · Official bot-এর real ৬ সংখ্যার code': 'Verify with Telegram · real six-digit code from the official bot',
    'শুধু available method-ই কাজ করবে। Telegram Telegram account-এর নিয়ন্ত্রণ নিশ্চিত করে-Email মালিকানা নয়।': 'Only available methods work. Telegram proves control of your Telegram account, not email ownership.',
    'কোনটি বেছে নেবে?': 'Which one will you choose?',
    'Email link সবচেয়ে সহজ, Spam folder-ও দেখো।': 'An email link is simplest, check your spam folder too.',
    'Telegram code শুধু secure box-এ লিখবে।': 'Enter the Telegram code only in the secure box.',
    'Passkey verification-এর পরে যোগ করা যাবে।': 'A passkey can be added after verification.',
    'অন্য কোনো সমস্যা?': 'Any other problem?',
    'Help নাও': 'Get help',
    'আমরা তোমার verification-এর অপেক্ষায় আছি…': 'We are waiting for your verification…',
    'Verification link পাঠানো হয়েছে': 'Verification link sent',
    'তোমার email-এ': 'to your email',
    '। Email app-এ link-এ tap করে এখানে ফিরে আসো।': '. Tap the link in your email app and come back here.',
    'Email link খোলার অপেক্ষায়': 'Waiting for the email link to open',
    '✓ আমি Verify করেছি, Check করুন': '✓ I have verified, check now',
    'Continue চাপলেই একটি verification message যাবে। আগে কোনো message যাবে না।': 'One tap on Continue sends a verification message. Nothing is sent before that.',
    'নিরাপদ verification link পাঠানো হয়েছে।': 'A secure verification link has been sent.',
    '৬ সংখ্যার code, না পেলে নিরাপদ link': 'A 6-digit code, with a secure link as backup',
    'চাইলে পরে বেছে নিতে পারবে': 'You can switch to it later',
    'Telegram দিয়ে যাচাই': 'Verify with Telegram',
    'অন্য যাচাই পদ্ধতি': 'Another verification method',
    'Verification email আবার পাঠান': 'Resend verification email',
    'Verification আবার পাঠান': 'Resend verification',
    'তোমার Email-এ একটি ছোট্ট কাজ আছে': 'There is a small task in your email',
    'তোমার': 'Your',
    'নিজের সিদ্ধান্তে': 'on your own decision',
    'নিচের button চাপলে একটি verification link পাঠানো হবে। Email-এ গিয়ে link-এ tap করো।': 'Tapping the button below sends a verification link. Open your email and tap it.',
    'এখনো নতুন link পাঠানো হয়নি': 'No new link has been sent yet',
    'Email link নিয়ে টিপস': 'Tips for the email link',
    'Button চাপার পর Inbox, Spam ও Promotions দেখো।': 'After tapping the button, check Inbox, Spam and Promotions.',
    'Link-এ tap করে এখানে ফিরে এসো।': 'Tap the link and come back here.',
    'ফিরে এসে “আমি Verify করেছি” চাপো।': 'Then tap “I have verified”.',
    'Verification link পাঠান →': 'Send verification link →',
    'অন্য পদ্ধতি ব্যবহার করো': 'Use another method',
    'এই no-cost public version-এ সত্যিকারের WhatsApp verification এখনো available নয়। তাই কোনো message পাঠানো বা success দেখানো হবে না।': 'Real WhatsApp verification is not available in this no-cost public version, so no message is sent and no success is shown.',
    'এখন পাওয়া যাচ্ছে না': 'Unavailable right now',
    'Email link বা Telegram ব্যবহার করো': 'Use an email link or Telegram',
    'অন্য method বেছে নাও': 'Choose another method',
    'অন্য method বেছে নিন': 'Choose another method',
    'Telegram দিয়ে verify করো': 'Verify with Telegram',
    'Telegram খুলে verification request সম্পন্ন করো।': 'Open Telegram and complete the verification request.',
    'Telegram ধাপগুলো': 'Telegram steps',
    'Official bot খুলে START চাপো।': 'Open the official bot and tap START.',
    'Bot-এর ৬ সংখ্যার code শুধু secure box-এ লিখবে।': 'Enter the bot’s six-digit code only in the secure box.',
    'এটি Email মালিকানার প্রমাণ নয়।': 'This is not proof of email ownership.',
    'Official bot-এ START চাপলে real ৬ সংখ্যার code পাবে, Email মালিকানা নয়, Telegram account control নিশ্চিত করে।': 'Tapping START in the official bot gives a real six-digit code, it proves Telegram account control, not email ownership.',
    'Official bot খুলে': 'Open the official bot and',
    'চাপো। Bot যে ৬ সংখ্যার code পাঠাবে, সেটি শুধু নিচের secure box-এ লিখবে।': 'tap it. Enter the six-digit code the bot sends only in the secure box below.',
    '১': '1',
    'Official Telegram bot খোলো': 'Open the official Telegram bot',
    '২': '2',
    'START চাপো ও code নাও': 'Tap START and get the code',
    '৩': '3',
    'Admission Hub-এ code লিখো': 'Enter the code in Admission Hub',
    'START চাপার অপেক্ষায়…': 'Waiting for START…',
    'Telegram-এর ৬ সংখ্যার code': 'Telegram six-digit code',
    'Code পাওয়া যায়নি? Official bot-এ START চাপো।': 'No code yet? Tap START in the official bot.',
    'নতুন code নিন': 'Get a new code',
    'Telegram verification শুধু Telegram account-এর নিয়ন্ত্রণ নিশ্চিত করে-Email মালিকানা নয়। Code বা Password কখনো অন্য কোনো chat-এ লিখবে না; শুধু secure form ব্যবহার করবে। START বা animation একা success নয়-নিশ্চিত ফল Admission Hub দেখাবে।': 'Telegram verification proves control of your Telegram account, not email ownership. Never type the code or password into another chat; use only the secure form. START or an animation alone is not success, Admission Hub shows the confirmed result.',
    'আগের account-এ Google যুক্ত করো': 'Link Google to your existing account',
    'একই Email-এ account আছে। একবার আগের Email ও Password দিলে Google নতুন account না বানিয়ে সেটিতেই যুক্ত হবে।': 'An account already exists for this email. Enter its email and password once and Google will link to it instead of creating a new account.',
    'Google যুক্ত করে প্রবেশ করুন': 'Sign in by linking Google',
    'বিকল্প verification': 'Alternative verification',
    'তোমার জন্য available নিরাপদ method ব্যবহার হবে।': 'An available secure method will be used for you.',
    'Verification শুরু করুন': 'Start verification',
    'ফিরে যান': 'Go back',
    'নিরাপদ code লিখুন।': 'Enter the secure code.',
    'Telegram খুলুন': 'Open Telegram',
    'START চাপুন এবং পাওয়া ৬ সংখ্যার code নিচে লিখুন। Telegram খোলা সফল যাচাই নয়; এটি Email মালিকানার প্রমাণও নয়।': 'Tap START and enter the six-digit code below. Opening Telegram is not a successful verification and does not prove email ownership.',
    '৬ সংখ্যার code': 'Six-digit code',
    'Security verification দরকার': 'Security verification required',
    'সব device থেকে লগ আউট একটি গুরুত্বপূর্ণ কাজ। নিশ্চিত করতে তোমার verification-এ পাঠানো ৬ সংখ্যার code লিখুন।': 'Logging out of all devices is a significant action. To confirm, enter the six-digit code sent to your verification method.',
    'START চাপুন এবং পাওয়া ৬ সংখ্যার code নিচে লিখুন।': 'Tap START and enter the six-digit code below.',
    'বাতিল করুন': 'Cancel',
    'তোমার Email এবং account নিরাপদভাবে যাচাই হয়েছে।': 'Your email and account have been verified safely.',
    'এক ট্যাপেই নিরাপদে ঢুকবে': 'One tap gets you in safely',
    'Face ID, fingerprint বা device lock ব্যবহার করে account secure করো।': 'Secure your account with Face ID, fingerprint or your device lock.',
    'Passkey কী?': 'What is a passkey?',
    'ফোনের Face ID বা fingerprint-ই তোমার চাবি।': 'Your phone’s Face ID or fingerprint is the key.',
    'Password মনে রাখতে হয় না।': 'You do not have to remember a password.',
    'না চাইলে “পরে করব” চাপো।': 'If you would rather not, tap “Later”.',
    'তোমার device-এর built-in security ব্যবহার করা হবে।': 'Your device’s built-in security will be used.',
    'পরে করব': 'Later',
    'Passkey সম্পূর্ণ optional। Skip করলে Email, Password, Google বা Telegram বন্ধ হবে না। ফোনের নিজের অনুমতি screen-এ শেষ সিদ্ধান্ত তোমার।': 'A passkey is entirely optional. Skipping it does not disable email, password, Google or Telegram. The final decision is yours on your phone’s own permission screen.',
    'সব ঠিক আছে! 🎉': 'All set! 🎉',
    'তোমার account এখন প্রস্তুত।': 'Your account is ready.',
    '… Profile details দেখা হচ্ছে': '… Checking your profile details',
    'Admission Hub-এ প্রবেশ করো →': 'Enter Admission Hub →',
    'Account নিরাপদ ও সক্রিয়': 'Account secure and active',
    'তোমার account সত্যিকারের যাচাইয়ের মাধ্যমে সক্রিয় আছে।': 'Your account is active through real verification.',
    'এই device-এ দ্রুত প্রবেশ চালু করতে পারো।': 'You can enable quick access on this device.',
    'নতুন Passkey যোগ করুন': 'Add a new passkey',
    'এই device-কে trust করবে?': 'Trust this device?',
    'পরবর্তী ৩০ দিন এই device থেকে লগইন করলে extra verification লাগবে না।': 'Signing in from this device for the next 30 days will not need extra verification.',
    'Trust করি (৩০ দিন)': 'Trust it (30 days)',
    'না, ধন্যবাদ': 'No, thanks',
    'বিকল্প যাচাই': 'Alternative verification',
    'সব device থেকে Log Out': 'Log out of all devices',
    'Password ও প্রবেশের গোপন তথ্য এই পেজে দেখানো বা জমা রাখা হয় না।': 'Passwords and sign-in secrets are never shown or stored on this page.',
    'এই মুহূর্তে': 'right now',
    'বিদ্যালয়ের নাম লিখো': 'Type the school name',
    'কলেজ বা বিশ্ববিদ্যালয়ের নাম': 'College or university name',
    'একই Password আবার লিখো': 'Type the same password again',
    'বন্ধ করুন': 'Close',
    'Admission প্রস্তুতির interactive journey map': 'Interactive journey map for admission preparation',
    'Admission Hub সুবিধা': 'Admission Hub benefits',
    'প্রবেশের পদ্ধতি': 'Sign-in methods',
    'Google দিয়ে প্রবেশ এখন প্রস্তুত হচ্ছে': 'Google sign-in is being prepared',
    'Facebook দিয়ে প্রবেশ': 'Continue with Facebook',
    'Admission Hub AI সহায়ক': 'Admission Hub AI helper',
    'Password দেখুন': 'Show password',
    'Log In নিয়ে সাহায্য': 'Help with logging in',
    'প্রতিষ্ঠানের suggestion': 'Institution suggestions',
    'নাম খোঁজা নিয়ে সাহায্য': 'Help with name search',
    'Verification নিয়ে সাহায্য': 'Help with verification',
    'Email verification নিয়ে সাহায্য': 'Help with email verification',
    'Telegram verification নিয়ে সাহায্য': 'Help with Telegram verification',
    'Passkey নিয়ে সাহায্য': 'Help with passkeys',

    /* ---- Profile UI ---- */
    'Profile সম্পূর্ণ করুন': 'Complete your profile',
    'প্রথম practice শেষ করলে stats এখানে জীবন্ত হয়ে উঠবে।': 'Finish your first practice and these stats come alive.',
    'Real milestones only, কিছু না করলে fake step দেখাবে না।': 'Real milestones only, nothing is shown as done if you have not done it.',
    'প্রথম achievement-এর জন্য practice শুরু করুন।': 'Start practising to earn your first achievement.',
    'Real data থেকে unlock হয়, কোনো fake progress নেই।': 'Unlocked from real data, there is no fake progress.',
    'Real study data থেকে unlock হয়, কোনো fake progress নেই।': 'Unlocked from real study data, there is no fake progress.',
    'সব milestone real data থেকে আসে, skip/fake করা যায় না।': 'Every milestone comes from real data, none can be skipped or faked.',
    'Explicit settings, তুমি কী চাও সেটা তুমিই ঠিক করো।': 'Explicit settings, you decide what you want.',
    'লিংক কপি': 'Copy link',
    'Email, mobile, জন্মের তারিখ আর school-এর বিস্তারিত কখনো public হবে না।': 'Email, mobile, date of birth and school details are never made public.',
    'Email, mobile, জন্মের তারিখ আর school-এর বিস্তারিত কখনো public হবে না, কোনো visibility-তেই নয়।': 'Email, mobile, date of birth and school details are never made public, under any visibility setting.',
    'Private, এখনো কিছুই public নয়।': 'Private, nothing is public yet.',
    'এই অংশটা দেখা যাচ্ছে না, বাকি সব ঠিক আছে।': 'This part is not showing, everything else is fine.',
    'স্কুল / কলেজ': 'School / college',
    'উচ্চ শিক্ষা প্রতিষ্ঠান': 'Higher education institution',
    '(optional, সর্বোচ্চ ২৮০)': '(optional, up to 280)',
    'অপরিবর্তিত কিছু নেই, পরিবর্তন করলে Save হবে': 'Nothing changed yet, edits save when you tap Save',
    'ছবি সর্বোচ্চ 5MB · JPG, PNG · ক্রপ করে 1:1 করা হবে': 'Image up to 5MB · JPG, PNG · cropped to 1:1',
    'ছেলে / মেয়ে, যেটা তোমার সাথে মেলে': 'Male / female, whichever matches you',
    'Unit ও subject নির্ভর করে নির্বাচিত university + session-এর official catalog-এর ওপর।': 'Units and subjects come from the official catalog of the university and session you select.',
    'সর্বোচ্চ 5টা target রাখা যায়।': 'You can keep up to 5 targets.',
    'Target-এ university + unit নির্বাচন করলে ওই unit-এর official subject-গুলো এখানে দেখাবে।': 'Pick a university and unit in your target and that unit’s official subjects appear here.',
    '(১ম = first choice)': '(1st = first choice)',
    'এখনো কোনো target নেই, নিচে যোগ করো।': 'No target yet, add one below.',
    'তোমার goal': 'Your goal',
    '(সর্বোচ্চ ১৬০)': '(up to 160)',
    '(সর্বোচ্চ ৮)': '(up to 8)',
    'অন্য subject থাকলে নিচে add করো।': 'If you have another subject, add it below.',
    'সর্বোচ্চ 8টা subject রাখা যায়।': 'You can keep up to 8 subjects.',
    'বন্ধ করো': 'Close',
    'বাতিল': 'Cancel',
    'এই পছন্দ শুধু তোমার AI চ্যাটে প্রয়োগ হয়, অন্য user-এর সাথে কখনো share হয় না।': 'This preference applies only to your AI chat, it is never shared with another user.',
    'AI তোমার আগের কথা মনে রাখবে (device+account-এ save হয়)': 'The AI remembers your earlier conversation (saved to this device and account)',
    'ছবি ঠিক করো': 'Adjust photo',
    'ছবি ধরে টানুন · দুই আঙুলে বা +/− দিয়ে বড়-ছোট করুন': 'Drag the photo · pinch or use +/− to zoom',
    'Sign in to create your profile, এক identity, সব device-এ।': 'Sign in to create your profile, one identity across all your devices.',
    'Login যাচাই হচ্ছে…': 'Checking your login…',
    'Profile লোড করা যায়নি, নিশ্চিন্ত থাকো, তোমার session আর ডেটা ঠিক আছে।': 'Your profile could not load, rest assured your session and data are fine.',
    'Profile লোড করা যায়নি': 'Your profile could not load',
    'আবার চেষ্টা করো': 'Try again',
    'একটু পরে আবার চেষ্টা করো।': 'Try again in a moment.',
    'Profile খুঁজে পাওয়া যায়নি': 'Profile not found',
    'এই public profile এখন available নাই': 'This public profile is not available right now',
    'মালিক private সেট করেছে বা profile খুঁজে পাওয়া যায়নি।': 'The owner set it to private, or the profile was not found.',
    'আপনি Admission Hub-এ? Profile দেখো': 'Are you on Admission Hub? View your profile',
    'Avatar পরিবর্তন করো': 'Change avatar',
    'Study stats, Exam পেজে যাও': 'Study stats, go to the Exam page',
    'ফিরে যাও': 'Go back',
    'তোমার পুরো নাম': 'Your full name',
    'যেমন: নটর ডেম কলেজ': 'e.g. Notre Dame College',
    'জেলা (optional)': 'District (optional)',
    'যেমন: ঢাকা বিশ্ববিদ্যালয়': 'e.g. University of Dhaka',
    'নিজের সম্পর্কে এক লাইন…': 'One line about yourself…',
    'Photo সরাও': 'Remove photo',
    'মুছে ফেলো': 'Delete',
    'উপরে': 'Up',
    'নিচে': 'Down',
    'ইউনিভার্সিটি লিখো… (যেমন: CU, ঢাকা, BUET)': 'Type a university… (e.g. CU, Dhaka, BUET)',
    'যেমন: 2026-এ CU CSE-তে ভর্তি হবো': 'e.g. I will apply to CU CSE in 2026',
    'অন্য subject (manual)': 'Another subject (manual)',
    'ছোট করো': 'Zoom out',
    'বড় করো': 'Zoom in',
    'Public profile লোড হচ্ছে': 'Loading public profile',
    '👦 ছেলেদের': '👦 Boys',
    '👧 মেয়েদের': '👧 Girls',
    'অফলাইন, পরিবর্তনগুলো PENDING_SYNC-এ রাখা হয়েছে; নেট ফিরলে নিজেই save হবে।': 'Offline, changes are kept as PENDING_SYNC and save themselves when the network returns.',
    'অপেক্ষা করুন…': 'Please wait…',
    'নতুন Email পাঠানো হয়নি। নিচের resend option দিয়ে সত্যিকারের link চাইতে পারো।': 'No new email was sent right now. Use the resend option below to request a real link.',
    'Telegram তোমার Telegram account-এর নিয়ন্ত্রণ নিশ্চিত করেছে; Email মালিকানা দাবি করা হয়নি।': 'Telegram has confirmed control of your Telegram account; no email ownership is claimed.',
    'অ্যাকাউন্ট খুলুন': 'Open account',
    'যাচাইয়ের ইমেইল আবার পাঠান': 'Resend verification email',
    'প্রয়োজনে এখন আবার পাঠাতে পারেন।': 'You can resend it now if needed.',
    'নিরাপদ Telegram সংযোগ তৈরি হচ্ছে…': 'Setting up a secure Telegram connection…',
    'Telegram-এ কোড পাঠানো হয়েছে। সর্বশেষ ৬ সংখ্যার কোডটি লিখুন।': 'A code was sent to Telegram. Enter the latest 6-digit code.',
    'Bot-এ START চাপুন, তারপর পাওয়া কোডটি এখানে লিখুন।': 'Tap START in the bot, then enter the code you receive.',
    'কোডটি নিরাপদভাবে যাচাই হচ্ছে…': 'Verifying the code securely…',
    'কোডটি সঠিক নয়-Telegram-এর সর্বশেষ ৬ সংখ্যার কোড লিখুন।': 'That code is not correct, enter the latest 6-digit Telegram code.',
    'এই কোডের সময় শেষ। নিচে “নতুন কোড নিন” চাপুন।': 'This code has expired. Tap “Get a new code” below.',
    'অনেকবার ভুল কোড দেওয়া হয়েছে। নিরাপত্তার জন্য সাময়িকভাবে বন্ধ আছে।': 'Too many wrong codes. This is paused for your security.',
    'এই Telegram accountটি অন্য Admission Hub account-এর সঙ্গে আগে থেকেই যুক্ত।': 'This Telegram account is already linked to another Admission Hub account.',
    'Telegram যাচাই এখন সাময়িকভাবে পাওয়া যাচ্ছে না। ইমেইল ব্যবহার করুন।': 'Telegram verification is temporarily unavailable. Use email.',
    'Telegram account যাচাই সফল হয়েছে।': 'Telegram account verified successfully.',
    'নতুন কোড নিন': 'Get a new code',
    'Official Telegram Bot খুলুন': 'Open the official Telegram bot',
    'এই ডিভাইসে দ্রুত প্রবেশ চালু করতে পারেন। Passkey বাধ্যতামূলক নয়।': 'You can turn on quick sign-in for this device. A passkey is optional.',
    'সরান': 'Remove',
    'নিরাপত্তার তথ্য': 'Security',
    'Admission Hub-এর নতুন সংস্করণ এসেছে, পেজটি একবার refresh করে আবার চেষ্টা করো।': 'A new version of Admission Hub is out, refresh the page once and try again.',
    'Email বা Password সঠিক নয়। আবার দেখে লিখো।': 'Email or password is incorrect. Check it and try again.',
    'এই Email-এ account আছে-Log In করো।': 'An account already exists for this email, log in.',
    'Account verification এখনো শেষ হয়নি।': 'Account verification is not finished yet.',
    'কমপক্ষে ৮ অক্ষরের একটু শক্তিশালী Password দাও।': 'Use a slightly stronger password of at least 8 characters.',
    'মানব যাচাই সম্পন্ন হয়নি। পেজটি একবার রিফ্রেশ করে আবার চেষ্টা করো; তারপরেও না হলে ব্রাউজারের বিজ্ঞাপন ব্লকার বন্ধ করো।': 'The human check did not complete. Refresh the page once and try again; if it still fails, turn off your browser ad blocker.',
    'অনেকবার চেষ্টা হয়েছে, একটু অপেক্ষা করে আবার চেষ্টা করো।': 'Too many attempts, wait a moment and try again.',
    'Verification এখন শুরু করা যাচ্ছে না। কিছু পাঠানো হয়নি, একটু পরে আবার চেষ্টা করো।': 'Verification cannot start right now. Nothing was sent, try again shortly.',
    'Telegram verification এখন পাওয়া যাচ্ছে না-Email ব্যবহার করো।': 'Telegram verification is unavailable, use email.',
    'নিরাপদ প্রবেশের সময় শেষ হয়েছে, আবার Log In করো।': 'Your secure sign-in expired, log in again.',
    'এই device-এ Passkey এখন পাওয়া যাচ্ছে না, অন্য পথ ব্যবহার করো।': 'A passkey is not available on this device, use another method.',
    'এই পরিচয়টি অন্য account-এর সঙ্গে যুক্ত। নিরাপত্তার জন্য প্রবেশ বন্ধ রাখা হয়েছে।': 'This identity is linked to another account. Sign-in is blocked for security.',
    'কোডটি সঠিক নয়-আবার লিখে দেখো।': 'That code is not correct, try typing it again.',
    'Verificationটি সঠিক নয় বা সময় শেষ, আবার চেষ্টা করো।': 'The verification is wrong or expired, try again.',
    'ইন্টারনেট সংযোগ পাওয়া যাচ্ছে না, সংযোগ ঠিক হলে আবার চেষ্টা করো।': 'No internet connection, try again once you are back online.',
    'সাময়িক সমস্যা হয়েছে, একটু পরে আবার চেষ্টা করো।': 'Something went wrong temporarily, try again shortly.',
    'নতুন code পাঠাতে একটু অপেক্ষা করতে হবে, কিছুক্ষণ পরে আবার চেষ্টা করো।': 'Wait a moment before requesting another code, then try again.',
    'কোডের সময় শেষ হয়ে গেছে, নতুন code নাও।': 'That code expired, request a new one.',
    'অনেকবার ভুল কোড দেওয়া হয়েছে, একটু অপেক্ষা করে নতুন code নাও।': 'Too many wrong codes, wait a moment and request a new one.',
    'এই কোডটি আগেই ব্যবহার হয়েছে, নতুন code নাও।': 'That code was already used, request a new one.',
    'এখন Email পাঠানো যাচ্ছে না, একটু পরে আবার চেষ্টা করো।': 'Email cannot be sent right now, try again shortly.',
    'এই যাচাইয়ের পথটি এখন বন্ধ আছে, একটু পরে আবার চেষ্টা করো।': 'This verification method is closed right now, try again shortly.',
    'Account সেবাটি সাময়িকভাবে ব্যস্ত, একটু পরে আবার চেষ্টা করো।': 'The account service is temporarily busy, try again shortly.',
    'Verification session-এর সময় শেষ, আবার Sign Up বা Log In করো।': 'Your verification session expired, sign up or log in again.',
    'Profile একই সময়ে অন্য জায়গা থেকে বদলেছে, আবার দেখে সংরক্ষণ করো।': 'The profile changed elsewhere at the same time, review it and save again.',
    'এই লিংকে account সেবা নেই, অ্যাপের মূল ঠিকানা খুলে আবার চেষ্টা করো।': 'This link has no account service, open the main app address and try again.',
    'এই ঠিকানা থেকে account কাজ করছে না, অ্যাপের মূল লিংক থেকে আবার চেষ্টা করো।': 'Accounts do not work from this address, try again from the main app link.',
    'Account সেবাটি এখনো প্রস্তুত নয়-একটু পরে আবার চেষ্টা করো।': 'The account service is not ready yet, try again shortly.',
    'বিশ্ববিদ্যালয়': 'University',
    'স্কুল': 'School',
    'কলেজ': 'College',
    'স্কুল ও কলেজ': 'School & college',
    'নিজের লেখা ব্যবহার করুন': 'Use your own text',
    'আরও কিছু অক্ষর দাও': 'Add a few more characters',
    'শুরু হয়েছে': 'Started',
    'মোটামুটি': 'Fair',
    'ভালো': 'Good',
    'শক্তিশালী': 'Strong',
    'খুব শক্তিশালী': 'Very strong',
    'কমপক্ষে ৮ অক্ষর ব্যবহার করো': 'Use at least 8 characters',
    '✓ দুইটি Password মিলেছে': '✓ Passwords match',
    'Password দুইটি মিলছে না': 'Passwords do not match',
    'তোমার School-এর নাম লিখো।': 'Type your school name.',
    'Suggestion থেকে School বেছে নাও, অথবা নিজের লেখা ব্যবহার করো।': 'Pick a school from the suggestions, or use your own text.',
    'Suggestion থেকে College/University বেছে নাও, অথবা নিজের লেখা ব্যবহার করো।': 'Pick a college/university from the suggestions, or use your own text.',
    'সঠিক Email address লিখো।': 'Enter a valid email address.',
    'কমপক্ষে ৮ অক্ষরের Password দাও।': 'Use a password of at least 8 characters.',
    'Password-এ অন্তত একটি বড় English অক্ষর দাও।': 'Include at least one uppercase English letter.',
    'Password-এ অন্তত একটি সংখ্যা দাও।': 'Include at least one number.',
    'Password দুইটি মিলছে না।': 'Passwords do not match.',
    '• Profile details পরে সম্পূর্ণ করা যাবে': '• Profile details can be completed later',
    'এখন পড়ছ না': 'Not studying right now',
    'পেছনে যান': 'Go back',
    'তোমার Email-এ': 'To your email',
    'তোমার Telegram account-এর নিয়ন্ত্রণ নিশ্চিত হয়েছে। এটি Email মালিকানার দাবি নয়।': 'Control of your Telegram account is confirmed. This is not a claim of email ownership.',
    'তোমার Email এবং Admission Hub account নিরাপদভাবে যাচাই হয়েছে।': 'Your email and Admission Hub account were verified securely.',
    'তোমার Admission Hub account নিরাপদভাবে যাচাই হয়েছে।': 'Your Admission Hub account was verified securely.',
    'যাচাইকৃত account': 'Verified account',
    'যাচাইকৃত Email': 'Verified email',
    'তোমার একই account নিরাপদে সক্রিয় আছে।': 'Your same account is safely active.',
    'Official Telegram bot-এ START চাপুন, তারপর পাওয়া ৬ সংখ্যার কোড লিখুন।': 'Tap START in the official Telegram bot, then enter the 6-digit code you receive.',
    'Official Telegram bot-এ START চাপুন, তারপর পাওয়া ৬ সংখ্যার code নিচে লিখুন।': 'Tap START in the official Telegram bot, then enter the 6-digit code below.',
    'Official Telegram bot খুলে START চাপুন, তারপর পাওয়া ৬ সংখ্যার কোড লিখুন।': 'Open the official Telegram bot, tap START, then enter the 6-digit code.',
    'তোমার verification-এ ৬ সংখ্যার code পাঠানো হয়েছে, কোডটি নিচে লিখুন।': 'A 6-digit code was sent for your verification, enter it below.',
    'নিরাপদ যাচাই কোডটি লিখুন।': 'Enter the secure verification code.',
    'Telegram কোড যাচাই করুন': 'Verify Telegram code',
    'যাচাই করুন': 'Verify',
    'সেবাটি সময়মতো সাড়া দেয়নি, আবার চেষ্টা করুন।': 'The service did not respond in time, try again.',
    'ইন্টারনেট সংযোগ পাওয়া যাচ্ছে না।': 'No internet connection.',
    'Admission Hub অনুরোধটি শেষ করতে পারেনি।': 'Admission Hub could not finish the request.',
    'Session যাচাই চলছে, একটু অপেক্ষা করো…': 'Checking your session, one moment…',
    'যাচাইকৃত অ্যাকাউন্ট সক্রিয়': 'Verified account active',
    'সক্রিয়': 'Active',
    'Passkey অনুরোধটি বাতিল বা সময় শেষ হয়েছে, চাইলে আবার চেষ্টা করো।': 'The passkey request was cancelled or timed out, try again if you like.',
    'এই browser বা ঠিকানায় Passkey নিরাপদভাবে ব্যবহার করা যাচ্ছে না।': 'A passkey cannot be used safely on this browser or address.',
    'এই Passkeyটি আগে থেকেই যুক্ত আছে।': 'This passkey is already added.',
    'এই browser বা ডিভাইসে Passkey পাওয়া যাচ্ছে না।': 'No passkey is available on this browser or device.',
    'Passkey দিয়ে তোমার একই account-এ প্রবেশ হয়েছে।': 'You signed in to the same account with a passkey.',
    'এই browser বা ডিভাইসে Passkey যোগ করা যাচ্ছে না।': 'A passkey cannot be added on this browser or device.',
    'Passkey নিরাপদভাবে যুক্ত হয়েছে।': 'Passkey added securely.',
    'Passkey যোগ করা যায়নি।': 'Could not add the passkey.',
    'Passkey সরানো হয়েছে। অন্য লগইন পদ্ধতি চালু থাকবে।': 'Passkey removed. Other sign-in methods still work.',
    'Google সাইন-ইন সম্পন্ন হয়নি, ইমেইল দিয়ে চেষ্টা করুন।': 'Google sign-in did not complete, try with email.',
    'Google দিয়ে তোমার একই account-এ প্রবেশ হয়েছে।': 'You signed in to the same account with Google.',
    'Google popup এই browser-এ খোলা যায়নি-Passkey বা Email ব্যবহার করো।': 'The Google popup could not open in this browser, use a passkey or email.',
    'Google popup এখন পাওয়া যাচ্ছে না, ইমেইল লগইন ব্যবহার করুন।': 'The Google popup is unavailable, use email login.',
    'Google অনুমতি পাওয়া যায়নি।': 'Google permission was not granted.',
    'Google popup বন্ধ বা block হয়েছে, আবার চেষ্টা করুন।': 'The Google popup was closed or blocked, try again.',
    'Google অনুমতির সময় শেষ হয়েছে, আবার চেষ্টা করুন।': 'Google permission timed out, try again.',
    'Google popup খোলা যায়নি-browser popup অনুমতি দিন।': 'The Google popup could not open, allow popups in your browser.',
    'Google জানালাটি বন্ধ হয়ে গেছে, আবার চেষ্টা করো বা ইমেইল দিয়ে ঢুকো।': 'The Google window was closed, try again or continue with email.',
    'Google জানালা খোলা যায়নি-browser-এ popup অনুমতি দাও বা ইমেইল দিয়ে ঢুকো।': 'The Google window could not open, allow popups in your browser or continue with email.',
    'Google লগইন এই মুহূর্তে খুলছে না, আবার চেষ্টা করো বা ইমেইল দিয়ে ঢুকো।': 'Google sign-in is not opening right now, try again or continue with email.',
    'Google অনুমতি পাওয়া যায়নি, আবার চেষ্টা করো বা ইমেইল দিয়ে ঢুকো।': 'Google permission was not granted, try again or continue with email.',
    'Google বা Passkey দিয়ে দ্রুত প্রবেশ করো। চাইলে Email ও Password-ও ব্যবহার করতে পারো।': 'Sign in fast with Google or a passkey. You can also use email and password.',
    'Google দিয়ে দ্রুত প্রবেশ করো। চাইলে Email ও Password-ও ব্যবহার করতে পারো।': 'Sign in fast with Google. You can also use email and password.',
    'Email ও Password দিয়ে নিরাপদে প্রবেশ করো।': 'Sign in securely with email and password.',
    'Google দিয়ে প্রবেশ এখন পাওয়া যাচ্ছে না': 'Google sign-in is unavailable right now',
    'Facebook সাইন-ইন সম্পন্ন হয়নি, ইমেইল দিয়ে চেষ্টা করুন।': 'Facebook sign-in did not complete, try with email.',
    'Facebook লগইন এখন পাওয়া যাচ্ছে না, ইমেইল ব্যবহার করো।': 'Facebook login is unavailable right now, use email.',
    'Facebook দিয়ে তোমার একই account-এ প্রবেশ হয়েছে।': 'Entered the same account with Facebook.',
    'সব device থেকে লগ আউট হয়ে গেছে।': 'Logged out of all devices.',
    'অন্য tab থেকে লগ আউট হয়েছে।': 'Logged out from another tab.',
    'code-এর সময় শেষ হয়ে গেছে, বাতিল করে আবার চেষ্টা করুন।': 'The code expired, cancel and try again.',
    'গুরুত্বপূর্ণ কাজটি নিশ্চিত করতে একটি fresh verification পাঠানো হচ্ছে…': 'Sending a fresh verification to confirm this important action…',
    'টি active session)। এখানে পুনরায় লগইন করতে হবে।': 'active sessions). You need to log in again here.',
    'সেশনটি আগে থেকেই শেষ হয়ে গেছে।': 'The session had already ended.',
    'এই device trusted হয়েছে-৩০ দিনের মধ্যে extra verification লাগবে না।': 'This device is now trusted, no extra verification for 30 days.',
    'Account service এখন প্রস্তুত নয়-Guest হিসেবে Dashboard ব্যবহার করতে পারো।': 'The account service is not ready yet, you can use the dashboard as a guest.',
    'কাজটি শেষ হতে একটু সময় দাও।': 'Give it a moment to finish.',
    'Real account শুধু admissionhub.pages.dev বা admissionsky.pages.dev সাইটে খোলা যায়।': 'Real accounts can only be created on the main app site (admissionhub.pages.dev or admissionsky.pages.dev).',
    'Email verification নিশ্চিত হয়েছে।': 'Email verification confirmed.',
    'Verification এখনো শেষ হয়নি। Email-এর link খুলে ফিরে এসে আবার Check করো।': 'Verification is not finished. Open the email link, come back and tap Check again.',
    'Inbox নতুন tab-এ খোলা যায়নি, তোমার Email app খুলে verification link দেখো।': 'The inbox could not open in a new tab, open your email app to find the verification link.',
    'Telegram যাচাই এখন পাওয়া যাচ্ছে না।': 'Telegram verification is unavailable right now.',
    'যাচাই কোড পাঠানো হয়েছে।': 'Verification code sent.',
    'Password লুকান': 'Hide password',
    'এই Email-এ অ্যাকাউন্ট থাকলে reset link পাঠানোর অনুরোধ নেওয়া হয়েছে। কিছুক্ষণ পর Inbox, Spam ও Promotions দেখো।': 'If an account exists for this email, a reset link has been requested. Check Inbox, Spam and Promotions shortly.',
    'Passkey এখন যোগ করা হয়নি, অন্য Log In পথগুলো চালু আছে।': 'No passkey added yet, the other login methods still work.',
    'Account তৈরি হয়ে থাকতে পারে, কিন্তু কোনো verification message পাঠানো হয়নি। একটু পরে এই Email দিয়ে Log In করে method বেছে নাও।': 'The account may exist, but no verification message was sent. Log in with this email shortly and choose a method.',
    'সঠিক ইমেইল ঠিকানা লিখুন।': 'Enter a valid email address.',
    'পাসওয়ার্ডটি সঠিকভাবে লিখুন।': 'Enter the password correctly.',
    'যাচাইকৃত অ্যাকাউন্টে লগইন হয়েছে।': 'Signed in to a verified account.',
    'এই অ্যাকাউন্টটি এখনো যাচাইকৃত নয়। Gmail/ইমেইল অথবা Telegram-একটি পদ্ধতি বেছে নিন।': 'This account is not verified yet. Choose one method, Gmail/email or Telegram.',
    'তোমার account যাচাই করা আছে। নিরাপত্তার জন্য শুধু এই ডিভাইসটি একবার নিশ্চিত করো।': 'Your account is verified. For security, just confirm this device once.',
    'অ্যাকাউন্ট যাচাই সম্পন্ন হয়নি।': 'Account verification was not completed.',
    'Account verification বাকি। এই মুহূর্তে নতুন Email পাঠানো হয়নি-resend option ব্যবহার করতে পারো।': 'Verification is pending. No new email was sent right now, you can use the resend option.',
    'আগের অ্যাকাউন্টের ইমেইল ও পাসওয়ার্ড লিখুন।': 'Enter the email and password of your existing account.',
    'Google আগের account-এ নিরাপদে যুক্ত হয়েছে।': 'Google was linked securely to your existing account.',
    'অন্য যাচাই পদ্ধতি বেছে নিতে পারেন।': 'You can choose another verification method.',
    'Email link দিয়েও একই account verify করতে পারো।': 'You can also verify the same account with the email link.',
    'Telegram-এর ৬ সংখ্যার কোড লিখুন।': 'Enter the 6-digit Telegram code.',
    'Telegram account verification সফল। তোমার Admission Hub account সক্রিয় হয়েছে।': 'Telegram account verification succeeded. Your Admission Hub account is active.',
    'নতুন একবারের Telegram লিংক তৈরি হয়েছে। Bot খুলে START চাপুন।': 'A new one-time Telegram link is ready. Open the bot and tap START.',
    'ইমেইল ও পাসওয়ার্ড সঠিকভাবে লিখুন।': 'Enter the email and password correctly.',
    'ইমেইল ইতিমধ্যে যাচাইকৃত, এখন লগইন করুন।': 'The email is already verified, log in now.',
    'নতুন verification Email পাঠানো হয়েছে।': 'A new verification email was sent.',
    '(প্রয়োজন)': '(required)',
    '(ঐচ্ছিক)': '(optional)',
    'আন্তর্জাতিক ফরম্যাটে মোবাইল নম্বর লিখুন।': 'Enter the mobile number in international format.',
    'মোবাইল নম্বর +8801XXXXXXXXX ফরম্যাটে লিখুন।': 'Enter the mobile number in +8801XXXXXXXXX format.',
    '৬ সংখ্যার কোড লিখুন।': 'Enter the 6-digit code.',
    '৬ সংখ্যার code লিখুন।': 'Enter the 6-digit code.',
    'বিকল্প verification সফল হয়েছে। তোমার একই account চালু আছে।': 'Alternative verification succeeded. Your same account is active.',
    'নিরাপদভাবে লগ আউট হয়েছে।': 'Logged out securely.',
    'নিশ্চিত করো, সব device বন্ধ হবে': 'Confirm, all devices will be signed out',
    'Password বদলানো শেষ করে থাকলে নতুন Password দিয়ে Log In করো।': 'Once you finish changing the password, log in with the new one.',
    'Email-এর link খোলা হয়েছে। নিশ্চিত ফল দেখতে Check আবার চাপতে পারো।': 'The email link opened. Tap Check again to see the confirmed result.',
    'এই কাজটি account-এর জন্য। Guest হিসেবেই পড়াশোনা চালাতে পারো, অথবা সুবিধাটি ব্যবহার করতে Sign Up/Log In করো।': 'This action needs an account. Keep studying as a guest, or sign up / log in to use it.',
    'এই কাজের জন্য আগে Sign Up বা Log In করো।': 'Sign up or log in first for this action.',
    'সমস্যা হয়েছে': 'Something went wrong',
    'প্রথম mock test complete করুন': 'Complete your first mock test',
    'মোট 100 MCQ complete করুন': 'Complete 100 MCQs in total',
    'মোট 500 MCQ complete করুন': 'Complete 500 MCQs in total',
    '7 দিনের practice streak বানান': 'Build a 7-day practice streak',
    '5টা mistake master করুন': 'Master 5 mistakes',
    'Admission Hub-এ জয়েন': 'Join Admission Hub',
    'প্রথম practice/flash session': 'First practice / flash session',
    'প্রথম mock test': 'First mock test',
    'প্রথম achievement unlock': 'Unlock your first achievement',
    'প্রায় সম্পূর্ণ ✦': 'Almost complete ✦',
    'ভালো পথে': 'On track',
    'শুরু হয়ে গেছে': 'Already started',
    'নতুন যাত্রা': 'New journey',
    'নাম যোগ করো': 'Add your name',
    'জন্মের তারিখ দাও': 'Add your date of birth',
    'মোবাইল নম্বর দাও': 'Add your mobile number',
    'স্কুল/কলেজ লেখো': 'Add your school/college',
    'উচ্চ শিক্ষা প্রতিষ্ঠান লেখো': 'Add your higher institution',
    'Bio লেখো': 'Add a bio',
    'লক্ষ্য (টার্গেট) যোগ করো': 'Add your target',
    'Admission session বাছো': 'Choose your admission session',
    'Preferred subjects বাছো': 'Choose preferred subjects',
    'Academic goal লেখো': 'Add your academic goal',
    'Profile সম্পূর্ণ, ধন্যবাদ।': 'Profile complete, thank you.',
    'ট্যাপ করে কপি করো': 'Tap to copy',
    'আগে থেকেই চলো': 'Welcome back',
    'Session যোগ করো': 'Add a session',
    'Set a goal, specific লক্ষ্য': 'Set a goal, be specific',
    'কোন subject পছন্দ?': 'Which subjects do you like?',
    'বাংলা+English': 'Bangla + English',
    'বাংলা + English': 'Bangla + English',
    'বাংলা (Bengali)': 'Bangla (Bengali)',
    'তোমার public তথ্য অন্যরা দেখতে পাবে': 'Others can see your public information',
    'Public নয়, কেউ দেখতে পাবে না': 'Not public, nobody can see it',
    '✓ সব already saved': '✓ Everything is already saved',
    'কোনো পরিবর্তন নেই।': 'No changes.',
    'ডিফল্ট, সব পেজে প্রয়োগ হয়': 'Default, applies to every page',
    'সব পেজে প্রয়োগ হয়': 'Applies to every page',
    'ডিফল্ট থিম': 'Default theme',
    'রাতের মোড': 'Night mode',
    'Device-এর সাথে মানানসই': 'Matches your device',
    'Save হয়েছে ✓, পরের chat-এই প্রয়োগ হবে।': 'Saved ✓, it applies to your next chat.',
    'Save fail, আবার চেষ্টা করো।': 'Save failed, try again.',
    'Save fail, আবার চেষ্টা করুন।': 'Save failed, try again.',
    'কোনো public profile নেই, সব গোপন': 'No public profile, everything stays private',
    'নাম, AH-ID আর ছবি public-এ (leaderboard-style)': 'Name, AH-ID and photo go public (leaderboard style)',
    'নাম, ছবি, সব লক্ষ্য, session, goal, bio আর completion public-এ': 'Name, photo, all targets, sessions, goals, bio and completion go public',
    'ছবিটা পড়া যায়নি, অন্য ছবি দিয়ে দেখুন।': 'The image could not be read, try another one.',
    'টাইম আউট, ইন্টারনেট চেক করে আবার চেষ্টা করুন।': 'Timed out, check your internet and try again.',
    'ছবিটা 2MB-এর বেশি, ছোট ছবি ব্যবহার করুন।': 'The image is over 2MB, use a smaller one.',
    'Avatar সরানো হয়েছে, generated avatar ফিরেছে': 'Avatar removed, back to the generated avatar',
    'Avatar সরাতে সমস্যা': 'Could not remove the avatar',
    'File type support করে না, JPG/PNG দিন।': 'That file type is not supported, use JPG/PNG.',
    'Preferences সেভ হয়েছে ✓': 'Preferences saved ✓',
    'Default avatar সেভ হয়েছে ✓': 'Default avatar saved ✓',
    'Notifications setting সেভ হয়েছে ✓': 'Notifications setting saved ✓',
    'Language সেভ হয়েছে ✓': 'Language saved ✓',
    'Appearance সেভ হয়েছে ✓': 'Appearance saved ✓',
    'AH-ID কপি হয়েছে': 'AH-ID copied',
    'Public লিংক কপি হয়েছে': 'Public link copied',
    'কপি করা যায়নি, লিংকটি নিজে কপি করো:': 'Could not copy, copy the link yourself:',
    'ইউনিভার্সিটির নাম দাও (কমপক্ষে ২ অক্ষর)।': 'Enter the university name (at least 2 characters).',
    'নামটি বড় হয়ে গেছে।': 'That name is too long.',
    'Unit সর্বোচ্চ ২০ অক্ষর।': 'Unit can be at most 20 characters.',
    'এই target আগেই আছে।': 'That target is already added.',
    'Subject-এর নাম দাও।': 'Enter the subject name.',
    'Subject-এর নাম 40 অক্ষরের বেশি হতে পারে না।': 'Subject name cannot exceed 40 characters.',
    'Subjectটা আগেই আছে।': 'That subject is already added.',
    'Notification center এখনো ready নয়।': 'The notification center is not ready yet.',
    'নাম কমপক্ষে ২ অক্ষরের হতে হবে।': 'The name must be at least 2 characters.',
    'সঠিক মোবাইল নম্বর দাও (যেমন: +8801XXXXXXXXX)।': 'Enter a valid mobile number (e.g. +8801XXXXXXXXX).',
    'Bio সর্বোচ্চ ২৮০ অক্ষর হতে পারে।': 'Bio can be at most 280 characters.',
    'সঠিক তারিখ দাও।': 'Enter a valid date.',
    'প্রতিষ্ঠানের নাম কমপক্ষে ২ অক্ষরের হতে হবে।': 'The institution name must be at least 2 characters.',
    'কিছু না পরিবর্তন করলে সংরক্ষণ করা যাবে না।': 'Nothing can be saved if nothing changed.',
    'সংরক্ষিত হয়েছে ✓': 'Saved ✓',
    'এই সময়ে অন্য জায়গা থেকে পরিবর্তন হয়েছে, latest version load হচ্ছে…': 'Changed elsewhere at the same time, loading the latest version…',
    'একটু দ্রুত বেশি, এক-দু সেকেন্ড পরে আবার চেষ্টা করো।': 'A bit too fast, try again in a second or two.',
    'সংরক্ষণ করা যায়নি, আবার চেষ্টা করো।': 'Could not save, try again.',
    'সব progress save হবে': 'All progress will be saved',
    'Exam history সব device-এ': 'Exam history on every device',
    'Leaderboard ও rewards': 'Leaderboard and rewards',
    'AI তোমার জন্য personalized': 'AI personalized for you',
    'Public Profile toggle': 'Public profile toggle',
    'ট্যাপ করলে এরর কপি হবে': 'Tap to copy the error',
    'স্ক্রিপ্টে সমস্যা আছে -': 'There is a script problem -',
    'নেটওয়ার্ক থেকে ফাইল অসম্পূর্ণ এসেছে -': 'A file arrived incomplete from the network -',
    '। আরেকবার রিফ্রেশ করলে ঠিক হবে।': ' Another refresh should fix it.',
    'লোড হচ্ছে…': 'Loading…',
    'Public profile খোলা হচ্ছে…': 'Opening public profile…',
    'এই অংশটা এখনো লোড হয়নি': 'This part has not loaded yet',
    'সব ধরনের পরীক্ষায় প্রযোজ্য · নেগেটিভ মার্ক প্রশ্নের মার্কসের চেয়ে কম রাখো': 'Applies to every exam · keep the negative mark below the question mark',
    'Custom serial লিখুন, যেমন 1-20 বা 45-50।': 'Enter a custom serial, such as 1-20 or 45-50.',
    'একটি range সর্বোচ্চ ২০০১টি serial পর্যন্ত দেওয়া যাবে।': 'One range may cover up to 2001 serials.',
    'Custom serial ব্যবহার করতে একটি Topic নির্বাচন করুন।': 'Pick one topic to use a custom serial.',
    'শেষে যান': 'Go to the end',
    '← আগের ৫০': '← Previous 50',
    'পরের ৫০ →': 'Next 50 →',
    'এখন পর্যন্ত Score:': 'Score so far:',
    'আপনার Flash Test শেষ হয়েছে': 'Your flash test is over',
    'Detailed result দেখার আগে আপনার test summary একবার দেখে নিন।': 'Review your test summary before opening the detailed result.',
    'এখন Detailed Result-এ গিয়ে প্রতিটি প্রশ্ন, সঠিক উত্তর ও explanation দেখতে পারবেন।': 'Open the detailed result to see every question, the right answer and its explanation.',
    'Detailed Result দেখুন →': 'See detailed result →',
    'Exam Center-এ যান': 'Go to Exam Center',
    'ফলাফল সেভ হয়নি -': 'Result not saved -',
    'সেকেন্ডে আবার চেষ্টা হবে…': 'seconds before the next attempt…',
    'এই ফলাফলে কোনো প্রশ্নের পরিসংখ্যান পাওয়া যায়নি।': 'No question statistics were found for this result.',
    'এই পরীক্ষায় দুর্বল topic-এর প্রশ্ন পাওয়া যায়নি, Lifetime Weak Topic Test ব্যবহার করো': 'No weak-topic questions in this exam, use the Lifetime Weak Topic Test',
    'কোনো ভুল প্রশ্ন নেই, মাশাআল্লাহ!': 'No wrong answers, well done!',
    'এই পরীক্ষার প্রশ্নগুলোই revision-এ নেওয়া হচ্ছে': 'These exam questions are being queued for revision',
    'পরীক্ষার ফলাফল পাওয়া যায়নি': 'The exam result was not found',
    'দুর্বল টপিকে পর্যাপ্ত প্রশ্ন পাওয়া যায়নি': 'Not enough questions in the weak topics',
    'কোনো ভুল প্রশ্ন নেই, flash review-এর জন্য আগে পরীক্ষায় ভুল করো': 'No wrong answers, miss a few in an exam first to build a flash review',
    'এই ফলাফলে কোনো প্রশ্ন পাওয়া যায়নি': 'No questions were found for this result',
    'মাঝারি': 'Medium',
    'দুর্বল': 'Weak',
    'সাবজেক্ট অনুযায়ী সেরা অংশ:': 'Best subjects:',
    'রিভিশনে priority:': 'Revision priority:',
    'সহ আরো কয়েকটি topic।': 'and a few more topics.',
    'শুধু ভুল প্রশ্ন Mistake Book-এ যোগ করা যাবে': 'Only wrong questions can be added to the Mistake Book',
    'ভুলের খাতায় যোগ করা হয়েছে': 'Added to the mistake book',
    'Bookmark-এ সংরক্ষিত হয়েছে': 'Saved to bookmarks',
    'Bookmark থেকে সরানো হয়েছে': 'Removed from bookmarks',
    'সব': 'All',
    'সঠিক': 'Correct',
    'ভুল': 'Wrong',
    'উত্তর দেওয়া হয়নি': 'Not answered',
    '✓ সঠিক উত্তর': '✓ Correct answer',
    '🟢 সঠিক উত্তর': '🟢 Correct answer',
    '🔴 ভুল উত্তর': '🔴 Wrong answer',
    '🟡 উত্তর দেওয়া হয়নি': '🟡 Not answered',
    'প্রশ্নের তথ্য পাওয়া যায়নি': 'Question details were not found',
    '💡 ব্যাখ্যা': '💡 Explanation',
    '✓ ভুলের খাতায় আছে': '✓ In the mistake book',
    '📕 ভুলের খাতায় যোগ করুন': '📕 Add to the mistake book',
    '🔁 আবার অনুশীলন করুন': '🔁 Practise again',
    '← সব Exam History': '← All exam history',
    'এই ফলাফলটি History archive থেকে খোলা হয়েছে': 'This result was opened from the history archive',
    'সদ্য সম্পন্ন': 'Just completed',
    'সংরক্ষিত ফলাফল': 'Saved result',
    'দারুণ করেছো!': 'Great work!',
    'ভালো চেষ্টা!': 'Good effort!',
    'চেষ্টা চালিয়ে যাও!': 'Keep going!',
    'নির্ভুলতা': 'Accuracy',
    'তোমার স্কোর': 'Your score',
    'সঠিক উত্তর': 'Correct answers',
    'নেগেটিভ': 'Negative',
    'উত্তরহীন': 'Unanswered',
    '🎉 এই পরীক্ষায় কোনো ভুল নেই!': '🎉 No wrong answers in this exam!',
    'এই ফিল্টারে কোনো সঠিক প্রশ্ন নেই।': 'No correct questions under this filter.',
    'এই পরীক্ষায় কোনো উত্তরহীন প্রশ্ন নেই।': 'No unanswered questions in this exam.',
    'এই পরীক্ষায় কোনো প্রশ্নের তথ্য নেই।': 'No question details for this exam.',
    'প্রশ্ন রিভিউ': 'Question review',
    'ভুল প্রশ্নগুলো আগে Mistake Book-এ সংরক্ষণ করে আবার অনুশীলন করো।': 'Save the wrong questions to the Mistake Book first, then practise them again.',
    'তোমার ভুল নেই, এখন আরও challenging একটি Mock Test দিয়ে প্রস্তুতি যাচাই করো।': 'No mistakes, test your preparation with a harder mock exam.',
    '🎯 এখন কী করবেন?': '🎯 What to do now',
    '🎯 দুর্বল টপিক অনুশীলন': '🎯 Practise weak topics',
    '🔁 ভুলগুলো আবার দাও': '🔁 Retry the wrong ones',
    'টি priority topic': 'priority topics',
    'দুর্বল topic শনাক্ত হলে এখানে আসবে': 'Weak topics will appear here once detected',
    'এই ফলাফলের ভিত্তিতে পরের revision শুরু করার সবচেয়ে কার্যকর তিনটি পথ বেছে নাও।': 'Pick the three most effective ways to start your next revision, based on this result.',
    'আজকের সবচেয়ে ভালো কাজ: ভুল প্রশ্নগুলো আবার সমাধান করা।': 'Today\'s best move: solve the wrong questions again.',
    'Exam Center-এ ফিরে যাও': 'Back to Exam Center',
    'Exam History-তে ফিরে যাও': 'Back to exam history',
    'কোনো প্রাসঙ্গিক পরীক্ষা নেই': 'No relevant exam found',
    'কোনো Mistake নেই': 'No mistakes yet',
    'কমান্ড সেন্টার': 'Command center',
    'Custom Serial-এর জন্য ঠিক ১টি Topic নির্বাচন করুন।': 'Pick exactly one topic for a custom serial.',
    'একটি Topic নির্বাচন করে serial লিখুন: 1-20 অথবা 45-50। একাধিক range: 1-20,45-50,88': 'Pick a topic and type a serial: 1-20 or 45-50. Multiple ranges: 1-20,45-50,88',
    'ঠিক সময়ে ছোট রিমাইন্ডার, Telegram + iPhone push। কারণ না থাকলে কিছুই পাঠায় না।': 'A short reminder on time, Telegram and iPhone push. Nothing is sent without a reason.',
    '↩️ আবার শিখি': '↩️ Learn again',
    '✅ শিখে গেছি': '✅ Learned it',
    '✅ শিখে গেছি, Mastered': '✅ Learned, mastered',
    '↩️ আবার অনুশীলনে': '↩️ Back to practice',
    'Recommended প্রশ্নগুলো এই ডিভাইসে পাওয়া যায়নি': 'The recommended questions were not found on this device',
    'Flash test শুরু করা যায়নি': 'The flash test could not start',
    'আপনার পরিকল্পনা ভালোভাবে এগোচ্ছে, আজকের লক্ষ্যটি সম্পন্ন করুন।': 'Your plan is on track, finish today\'s goal.',
    'গতির সাথে ফিরতে প্রতিদিন আরও একটি ছোট টপিক যোগ করুন।': 'Add one more short topic a day to get back on pace.',
    'আজ ২৫ মিনিটের একটি ফোকাসড রিভিশন সেশন দিয়ে পিছিয়ে থাকা দিনগুলো ধরুন।': 'Catch up the missed days with a 25-minute focused revision session today.',
    'আজ ও গতকাল কোনো সংরক্ষিত অনুশীলন নেই, প্রথম একটি বাস্তব সেশন শুরু করুন।': 'No saved practice today or yesterday, start your first real session.',
    'আজকের অনুশীলন গতকালের চেয়ে ভালো, এই ধারাটি বজায় রাখুন।': 'Today\'s practice beats yesterday\'s, keep the streak going.',
    'কোনো 90-Day Plan পাওয়া যায়নি, আগে Plan তৈরি করো': 'No 90-day plan found, create a plan first',
    'Plan JSON কপি হয়েছে, widget গাইডে পেস্ট করো': 'Plan JSON copied, paste it into the widget guide',
    'planner.json ডাউনলোড হয়েছে': 'planner.json downloaded',
    '📋 JSON কপি করো': '📋 Copy JSON',
    '✓ কপি হয়েছে': '✓ Copied',
    'ম্যানুয়ালি সিলেক্ট করে কপি করো': 'Select and copy manually',
    'আজকের প্রস্তুতি শুরু করো': 'Start today\'s preparation',
    /* P17/P18 dashboard cards. These render as a single text node whose value
       carries the emoji, so the key includes it. */
    '🎯 আমাকে প্রস্তুত করো': '🎯 Prepare Me',
    'তোমার পরীক্ষার ইতিহাস দেখে আজ কী পড়বে, কত প্রশ্ন, সাজিয়ে দেয়': 'Reads your exam history and lays out what to study today, and how many questions',
    'পরিকল্পনা দেখো': 'See plan',
    '🏆 ভর্তি-বুদ্ধি': '🏆 Admission Intel',
    'তোমার বিশ্ববিদ্যালয় ও ইউনিটের সাবজেক্ট-কভারেজ, দুর্বলতা আর রিভিশন-প্ল্যান': 'Subject coverage for your university and unit, plus weak spots and a revision plan',
    'দেখো': 'See',
    'Question Bank, Exam, AI ও Progress-সব টুল এক জায়গায়।': 'Question bank, exam, AI and progress, every tool in one place.',
    'শুধু একটি ইংরেজি শব্দ লিখুন।': 'Type a single English word.',
    'বাংলা অর্থ পাওয়া যায়নি।': 'No Bangla meaning found.',
    'বাংলা অর্থ': 'Bangla meaning',
    'Example পাওয়া যায়নি।': 'No example found.',
    '🔎 Dictionary API থেকে যাচাই করা হচ্ছে…': '🔎 Checking against the dictionary API…',
    'শব্দের তথ্য পাওয়া যায়নি।': 'No details found for this word.',
    'নির্ভরযোগ্য dictionary entry পাওয়া যায়নি। বানান যাচাই করে আবার চেষ্টা করুন।': 'No reliable dictionary entry found. Check the spelling and try again.',
    'রবিবার': 'Sunday',
    'সোমবার': 'Monday',
    'মঙ্গলবার': 'Tuesday',
    'বুধবার': 'Wednesday',
    'বৃহস্পতিবার': 'Thursday',
    'শুক্রবার': 'Friday',
    'শনিবার': 'Saturday',
    /* Dashboard weekly dots and the header date use Intl.DateTimeFormat('bn',
       {weekday:'short'}), which yields «বুধ», «বৃহস্পতি», different words from
       the full names above, so they need their own entries. */
    'রবি': 'Sun', 'সোম': 'Mon', 'মঙ্গল': 'Tue', 'বুধ': 'Wed',
    'বৃহস্পতি': 'Thu', 'শুক্র': 'Fri', 'শনি': 'Sat',
    'নোটিফিকেশন': 'Notifications',
    'সাপ্তাহিক অগ্রগতি': 'Weekly progress',
    'পরীক্ষা-দিন পর্যন্ত (সেট করা তারিখ অনুযায়ী)': 'Until the exam day (based on the date you set)',
    'এখনো আজকের কোনো ডেটা নেই, একটি মক-টেস্ট দিয়ে শুরু করো, তারপর এখানে তোমার দুর্বলতা ও অগ্রগতির বাস্তব-বিশ্লেষণ দেখাবে।': 'No data for today yet, start with a mock test and your real weakness and progress analysis will appear here.',
    'জানুয়ারি': 'January',
    'ফেব্রুয়ারি': 'February',
    'মার্চ': 'March',
    'এপ্রিল': 'April',
    'মে': 'May',
    'জুন': 'June',
    'জুলাই': 'July',
    'আগস্ট': 'August',
    'সেপ্টেম্বর': 'September',
    'অক্টোবর': 'October',
    'নভেম্বর': 'November',
    'ডিসেম্বর': 'December',
    'শুভ ভোর 🌅': 'Good dawn 🌅',
    'শুভ সকাল ☀️': 'Good morning ☀️',
    'শুভ দুপুর 🌤️': 'Good afternoon 🌤️',
    'শুভ বিকাল 🌇': 'Good afternoon 🌇',
    'শুভ সন্ধ্যা 🌆': 'Good evening 🌆',
    'শুভ রাত্রি 🌙': 'Good night 🌙',
    'রাত': 'night',
    'ভোর': 'dawn',
    'সকাল': 'morning',
    'দুপুর': 'noon',
    'বিকাল': 'afternoon',
    'সন্ধ্যা': 'evening',
    'One-Time Mock Test খুলুন': 'Open a one-time mock test',
    'নিজের প্রশ্ন import করে Mock দিন ও ফলাফল দেখুন': 'Import your own questions, take a mock and see the result',
    'টপিক': 'Topic',
    'বিষয়': 'Subject',
    'আজ': 'Today',
    'টি প্রশ্ন করেছ -': 'questions done -',
    'সঠিকতা': 'Accuracy',
    'কোনো উত্তরের স্কোর-রেকর্ড নেই': 'No scored answers recorded yet',
    '। এখনো যথেষ্ট টপিক-ডেটা নেই, আরো পরীক্ষা দিলে দুর্বলতা-রাডার ভরাট হবে।': ' Not enough topic data yet, more exams will fill the weakness radar.',
    'দিনের ধারাবাহিকতা চমৎকার!': 'Excellent daily consistency!',
    'শুভ শুভ - Scholar': 'Well done, scholar',
    'আজকের Admission Mission': 'Today\'s admission mission',
    '📘 বাংলা': '📘 Bangla',
    '🎉 আজকের লক্ষ্য পূরণ হয়েছে! আরো এগিয়ে যাও।': '🎉 Today\'s goal is done! Keep pushing.',
    '🎯 আজ আর': '🎯 Only',
    'টি প্রশ্ন বাকি, চালিয়ে যাও!': 'questions left today, keep going!',
    '📈 আজকের সঠিকতা': '📈 Today\'s accuracy',
    '· পরীক্ষা, সংখ্যা': '· exams',
    '📭 আজ কোনো ডেটা নেই, প্রথম পরীক্ষা দিলে এখানে ফলাফল দেখাবে।': '📭 No data today, take your first exam and results appear here.',
    '📝 প্রথম পরীক্ষা দাও': '📝 Take your first exam',
    'কোর্স চালু করো, এখানে অগ্রগতি দেখাবে': 'Start a course, progress shows here',
    'কোর্স →': 'Courses →',
    'এক জায়গায় সব টুল': 'Every tool in one place',
    'সাপ্তাহিক সঠিকতা-গ্রাফ': 'Weekly accuracy graph',
    'বিশ্লেষণ': 'Analysis',
    'এখনো পর্যাপ্ত টপিক-ডেটা নেই, পরীক্ষা দিলে এখানে দুর্বলতা-তালিকা তৈরি হবে।': 'Not enough topic data yet, exams build your weakness list here.',
    'ভুল-খাতা রিভিশন': 'Mistake book revision',
    'নোট-পুনরালোচনা': 'Note review',
    'আজকের Study Checklist': 'Today\'s study checklist',
    'প্ল্যান এখনো নেই': 'No plan yet',
    '৯০-দিনের ক্যালেন্ডার-ভিত্তিক স্টাডি-প্ল্যান বানালে এখানে দিন-ভিত্তিক চেকলিস্ট দেখাবে।': 'Build a 90-day calendar-based study plan and a day-by-day checklist appears here.',
    'সব টুল': 'All tools',
    'বন্ধ': 'Off',
    'ইউনিট': 'Unit',
    'পরীক্ষা-তারিখ': 'Exam date',
    'আজকের কাজ-টিক ✅': 'Today\'s tasks done ✅',
    'আনটিক': 'Untick',
    '[dv2] build পতন, পুরনো ড্যাশবোর্ডে ফলব্যাক': '[dv2] build failed, falling back to the legacy dashboard',
    'Google সাইন-ইন সম্পন্ন হয়নি, ইমেইল দিয়ে চেষ্টা করুন।': 'Google sign-in did not finish, try with email.',
    'Google দিয়ে তোমার একই account-এ প্রবেশ হয়েছে।': 'You signed into the same account with Google.',
    'Email যাচাই এখন পাওয়া যাচ্ছে না।': 'Email verification is unavailable right now.',
    'তোমার account-এ প্রবেশ হয়েছে।': 'You are signed in to your account.',
    'Google দিয়ে তোমার account-এ প্রবেশ হয়েছে।': 'You signed in with Google.',
    'Facebook দিয়ে তোমার account-এ প্রবেশ হয়েছে।': 'You signed in with Facebook.',
    'Passkey দিয়ে প্রবেশ হয়েছে।': 'Signed in with a passkey.',
    /* Round 8 (2026-09-17), profile stuck-session rescue view */
    'Login যাচাই শেষ হয়নি': 'Session check did not finish',
    'আবার চেষ্টা করুন, অথবা সরাসরি Login করুন': 'Try again, or sign in directly',
    'আবার চেষ্টা করুন': 'Try again',
    'Login করুন': 'Sign in',
  };

  /* Bengali digits, so numbers inside a translated string stay consistent. */
  const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
  const toEnDigits = (s) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

  const get = () => {
    try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'bn'; } catch (_) { return 'bn'; }
  };

  const ATTRS = ['placeholder', 'aria-label', 'title'];
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'INPUT']);

  /* Bengali composes many letters two ways in Unicode: য় is either U+09DF or
     য + ় (U+09AF U+09BC), and the two are visually identical. Source files and
     this table can each pick a different form, so both sides are normalised
     before lookup, otherwise a string silently fails to translate. */
  const norm = (s) => (typeof s === 'string' && s.normalize ? s.normalize('NFC') : s);
  const NORM_DICT = {};
  for (const [k, v] of Object.entries(DICT)) NORM_DICT[norm(k)] = v;

  /* A node's Bengali source is remembered on first sight so switching back to
     Bengali restores the exact original text and attributes. */
  const original = new WeakMap();

  /* A handful of strings carry a live count the user typed or earned, so no
     fixed key can match them. These rules keep the sentence structure and
     reuse the dictionary's own wording, which is why they live here rather
     than as more table entries with hand-written duplicates. */
  const RULES = [
    {
      re: /^আবার পাঠানো যাবে \(([0-9০-৯][0-9০-৯,]*)\s*সেকেন্ড\)$/,
      en: (m) => `You can resend in (${m[1]} sec)`
    },
    {
      re: /^নিরাপত্তার জন্য ([0-9০-৯][0-9০-৯,]*)\s*সেকেন্ড পর আবার পাঠাতে পারবেন।$/,
      en: (m) => `For your security you can resend in ${m[1]} seconds.`
    },
    {
      re: /^নতুন কোড \(([0-9০-৯][0-9০-৯,]*)\s*সেকেন্ড পর\)$/,
      en: (m) => `New code (in ${m[1]} sec)`
    },
    {
      re: /^([0-9০-৯][0-9০-৯,]*)টি Passkey যুক্ত আছে। Passkey কখনো বাধ্যতামূলক নয়।$/,
      en: (m) => `${m[1]} passkeys are added. A passkey is never required.`
    },
    {
      re: /^সব device থেকে লগ আউট হয়েছে \(([0-9০-৯][0-9০-৯,]*)টি active session\)। এখানে পুনরায় লগইন করতে হবে।$/,
      en: (m) => `Logged out of all devices (${m[1]} active sessions). Log in again here.`
    },
    {
      re: /^([0-9০-৯]+)\/([0-9০-৯]+) সম্পূর্ণ, নিচের যেটা বাকি, সেটায় চাপ দিলেই সরাসরি সেই ঘরে চলে যাবে।$/,
      en: (m) => `${toEnDigits(m[1])}/${toEnDigits(m[2])} complete, tap what is left below to jump straight there.`
    },
    /* Dashboard v2 copy: each of these is a fixed sentence wrapped around a
       number the student earned or typed, so no table key can ever match it. */
    {
      re: /^🎯 আজ আর ([0-9০-৯][0-9০-৯,]*)টি প্রশ্ন বাকি, চালিয়ে যাও!$/,
      en: (m) => `🎯 ${toEnDigits(m[1])} more questions today, keep going!`
    },
    {
      re: /^🔥 মাত্র ([0-9০-৯][0-9০-৯,]*) দিন = 10 Day Badge$/,
      en: (m) => `🔥 Only ${toEnDigits(m[1])} days to the 10-Day Badge`
    },
    {
      re: /^গত ৭ দিনে মোট ([0-9০-৯][0-9০-৯,]*)টি প্রশ্ন সমাধান হয়েছে \(সত্যিকারের সংরক্ষিত ডেটা\)।$/,
      en: (m) => `${toEnDigits(m[1])} questions answered in the last 7 days (real saved data).`
    },
    {
      re: /^সাপ্তাহিক-লক্ষ্য-অনুযায়ী প্রস্তুতি \(গত ৭ দিন\), লক্ষ্য: প্রতি-সপ্তাহে ([0-9০-৯][0-9০-৯,]*) প্রশ্ন$/,
      en: (m) => `Weekly-goal progress (last 7 days), target: ${toEnDigits(m[1])} questions per week`
    },
    {
      re: /^📈 আজকের সঠিকতা ([0-9০-৯][0-9০-৯,]*%|-) · পরীক্ষা, সংখ্যা ([0-9০-৯][0-9০-৯,]*)$/,
      en: (m) => `📈 Today's accuracy ${m[1] === '-' ? '-' : toEnDigits(m[1])} · Exams ${toEnDigits(m[2])}`
    },
    {
      /* The long header date, e.g. «বুধবার, ১৬ সেপ্টেম্বর, ২০২৬». The weekday and
         month are looked up in the same dictionary the rest of this file uses,
         so the two never drift apart. */
      re: /^([\u0980-\u09FF]+), ([0-9০-৯]+)\s+([\u0980-\u09FF]+), ([0-9০-৯]+)$/,
      en: (m) => `${NORM_DICT[norm(m[1])] || m[1]}, ${toEnDigits(m[2])} ${NORM_DICT[norm(m[3])] || m[3]}, ${toEnDigits(m[4])}`
    },
    {
      /* Study-insight sentence: a count, an accuracy, one of two follow-ups and
         an optional streak clause. The weakest-topic name is the student's own
         content, so it is carried through unchanged rather than translated. */
      re: /^আজ ([0-9০-৯][0-9০-৯,]*)টি প্রশ্ন করেছ, (?:সঠিকতা ([0-9০-৯][0-9০-৯,]*)%|কোনো উত্তরের স্কোর-রেকর্ড নেই)। (?:(?:তোমার দুর্বলতম টপিক: "(.+?)" \(([0-9০-৯][0-9০-৯,]*)% সঠিক\), আজ এটা রিভিশন করো।)|(?:এখনো যথেষ্ট টপিক-ডেটা নেই, আরো পরীক্ষা দিলে দুর্বলতা-রাডার ভরাট হবে।))(?: 🔥 ([0-9০-৯][0-9০-৯,]*) দিনের ধারাবাহিকতা চমৎকার!)?$/,
      en: (m) => {
        const head = `Today you answered ${toEnDigits(m[1])} questions, ${m[2] ? 'accuracy ' + toEnDigits(m[2]) + '%' : 'no scored answers yet'}.`;
        const body = m[3]
          ? ` Your weakest topic: “${m[3]}” (${toEnDigits(m[4])}% correct), revise it today.`
          : ' Not enough topic data yet, take more exams and your weakness radar fills in.';
        return head + body + (m[5] ? ` 🔥 ${toEnDigits(m[5])} days in a row, excellent!` : '');
      }
    }
  ];

  /* Bengali letters and signs, but not the digits (U+09E6–U+09EF), so a run
     that only carries numbers can be converted without translating words. */
  const BN_LETTER = /[\u0980-\u09E5\u09F0-\u0A00]/;
  const BN_MONTHS = {
    'জানুয়ারি': 'January', 'ফেব্রুয়ারি': 'February', 'মার্চ': 'March', 'এপ্রিল': 'April',
    'মে': 'May', 'জুন': 'June', 'জুলাই': 'July', 'আগস্ট': 'August', 'সেপ্টেম্বর': 'September',
    'অক্টোবর': 'October', 'নভেম্বর': 'November', 'ডিসেম্বর': 'December',
    'জানু': 'Jan', 'ফেব': 'Feb', 'এপ্রি': 'Apr', 'জুল': 'Jul', 'আগ': 'Aug',
    'সেপ': 'Sep', 'অক্টো': 'Oct', 'নভে': 'Nov', 'ডিসে': 'Dec'
  };

  /* Rendered strings are often a sentence plus a value, "PROFILE COMPLETION ·
     ভালো পথে", an achievement line, a year in Bengali digits. Translating each
     segment on its own keeps the surrounding numbers and separators exactly as
     the module built them. */
  const translateSegment = (segment) => {
    const hit = NORM_DICT[norm(segment)];
    if (hit) return toEnDigits(hit);
    const date = segment.match(/^([0-9০-৯]+)\s+([\u0980-\u09FF]+),?\s+([0-9০-৯]+)$/);
    if (date && BN_MONTHS[date[2]]) {
      return `${toEnDigits(date[1])} ${BN_MONTHS[date[2]]} ${toEnDigits(date[3])}`;
    }
    if (/[০-৯]/.test(segment) && !BN_LETTER.test(segment)) return toEnDigits(segment);
    return null;
  };

  const applySegments = (text) => {
    const joined = text.split(' · ').map((part) => translateSegment(part) ?? part).join(' · ');
    return joined === text ? null : joined;
  };

  const translate = (text) => {
    const direct = NORM_DICT[norm(text)];
    if (direct) return direct;
    const trimmed = text.trim();
    if (!trimmed) return text;
    const hit = NORM_DICT[norm(trimmed)];
    if (hit) return text.replace(trimmed, toEnDigits(hit));
    for (const rule of RULES) {
      const m = trimmed.match(rule.re);
      if (m) return text.replace(trimmed, toEnDigits(rule.en(m)));
    }
    const single = translateSegment(trimmed);
    if (single != null) return text.replace(trimmed, single);
    const segments = applySegments(trimmed);
    if (segments != null) return text.replace(trimmed, segments);
    return null;
  };

  /* The engine both reads and writes node values, so it has to tell its own
     output apart from a module's rewrite. `lastOut` holds what we wrote; when
     the node no longer matches it, the module (a timer, a count-up, a toast)
     has replaced the text and that new value is the source to translate -
     without this, a live number would be pinned to the first value seen. */
  const lastOut = new WeakMap();

  const translateTextNode = (el, lang) => {
    const cur = el.nodeValue;
    const known = original.get(el);
    let src = known;
    if (known === undefined || (lastOut.has(el) && cur !== lastOut.get(el))) {
      src = cur;
      original.set(el, src);
    }
    if (lang === 'en') {
      const out = translate(src);
      if (out != null) {
        if (cur !== out) el.nodeValue = out;
        lastOut.set(el, out);
      } else {
        lastOut.set(el, cur);
      }
    } else if (cur !== src) {
      el.nodeValue = src;
      lastOut.set(el, src);
    }
  };

  const walk = (root, lang) => {
    if (!root) return;
    // A MutationObserver hands us the changed node itself, and for a live
    // sentence that is a bare text node with no element root to walk.
    if (root.nodeType === 3) {
      if (root.parentElement && SKIP_TAGS.has(root.parentElement.tagName)) return;
      translateTextNode(root, lang);
      return;
    }
    if (root.nodeType === 4) return;
    const nodes = [];
    const push = (n) => nodes.push(n);
    if (root.nodeType === 1 || root.nodeType === 9 || root.nodeType === 11) {
      const iter = document.createTreeWalker(root, 1 | 4, null);
      let n = iter.nextNode();
      while (n) { push(n); n = iter.nextNode(); }
      push(root);
    }
    for (const el of nodes) {
      if (el.nodeType === 4) continue;
      if (el.nodeType === 3) {
        if (el.parentElement && SKIP_TAGS.has(el.parentElement.tagName)) continue;
        translateTextNode(el, lang);
        continue;
      }
      if (el.nodeType !== 1) continue;
      // An INPUT/TEXTAREA has no translatable text child, but its own
      // placeholder still is copy, so only the text walk is skipped.
      for (const attr of ATTRS) {
        if (!el.hasAttribute(attr)) continue;
        const key = `ah-orig-${attr}`;
        if (!el.hasAttribute(key)) el.setAttribute(key, el.getAttribute(attr));
        const src = el.getAttribute(key);
        if (lang === 'en') {
          const out = translate(src);
          if (out != null) el.setAttribute(attr, out);
        } else {
          el.setAttribute(attr, src);
        }
      }
    }
  };

  const apply = (root) => {
    const lang = get();
    try { document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'bn'); } catch (_) {}
    walk(root || document.body, lang);
  };

  /* Late-rendered markup (a view swap, a toast, a sheet) is translated as it
     appears, which is what makes this work without touching those modules. */
  const observe = () => {
    if (typeof MutationObserver !== 'function') return;
    let queued = false;
    const pending = new Set();
    new MutationObserver((records) => {
      if (get() !== 'en') return;
      for (const r of records) {
        if (r.type === 'characterData') pending.add(r.target);
        for (const n of r.addedNodes || []) pending.add(n);
      }
      if (queued || !pending.size) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        const batch = [...pending];
        pending.clear();
        for (const n of batch) walk(n, 'en');
      });
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  };

  window.addEventListener('ah:lang', () => apply());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { apply(); observe(); });
  else { apply(); observe(); }

  window.AhLanguage = { apply, translate, dict: DICT, get };
})();
