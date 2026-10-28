(() => {
  'use strict';

  const API = '/api/auth/v1';
  const ENTRY_COOKIE = 'ah_entry_v1';
  const ENTRY_MAX_AGE = 365 * 24 * 60 * 60;
  const entryMode = () => {
    const row = String(document.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${ENTRY_COOKIE}=`));
    const value = row ? decodeURIComponent(row.slice(row.indexOf('=') + 1)) : '';
    return ['guest', 'account'].includes(value) ? value : '';
  };
  const rememberEntry = mode => {
    if (!['guest', 'account'].includes(mode)) return;
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${ENTRY_COOKIE}=${mode}; Path=/; Max-Age=${ENTRY_MAX_AGE}; SameSite=Lax${secure}`;
  };

  const state = {
    session: null,
    verification: null,
    telegram: null,
    telegramTimer: null,
    backup: null,
    stepUp: null,
    passkeys: [],
    busy: false,
    initialized: false,
    available: null,
    resendTimer: null,
    resendCooldownSeconds: 60,
    signupStep: 'personal',
    returnDestination: '',
    signupJourney: false,
    pendingProfile: null,
    profileBound: false,
    profileSynced: false,
    profileSyncPromise: null,
    profilePendingAttempted: false,
    currentView: 'login',
    emailStatusBusy: false,
    successTimer: null,
    afterVerified: 'success',
    verificationLabel: 'Account',
    institutionIndex: null,
    institutionSelection: { school: null, college: null },
    capabilities: {
      google: { available: false, clientId: '' },
      facebook: { available: false, appId: '' },
      passkey: { available: false, enrollmentAvailable: false },
      telegram: { available: false },
      emailOwnership: { available: false },
      emailPassword: { available: false },
      backup: { available: false, contactInput: 'none' }
    },
    ownership: null,
    ownershipTimer: null,
    googleClientId: '',
    googleReady: false,
    googlePromise: null,
    firebaseAuthPromise: null,
    facebookAppId: '',
    facebookPromise: null
  };

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'ah-account-launcher';
  launcher.setAttribute('aria-label', 'অ্যাকাউন্ট খুলুন');
  launcher.setAttribute('aria-controls', 'ah-account-page');
  launcher.dataset.authenticated = 'false';
  launcher.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 12.2a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 7.3c.9-3.3 3.3-5 7-5s6.1 1.7 7 5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg><span class="ah-account-launcher-label">অ্যাকাউন্ট</span><span class="ah-account-dot" aria-hidden="true"></span>';

  const pageHost = document.createElement('div');
  pageHost.id = 'ah-account-page';
  // Admission Sky (owner's bird-led signup / log-in) owns its own stylesheet.
  // Injecting it here keeps the two designs independent: removing the flow's
  // script removes its look with it, with nothing left over in this sheet.
  if (!document.getElementById('ah-sky-flow-style')) {
    const skyStyle = document.createElement('link');
    skyStyle.id = 'ah-sky-flow-style';
    skyStyle.rel = 'stylesheet';
    skyStyle.href = 'sky-onboarding.css?v=sky-flow-20261016-v6';
    document.head.append(skyStyle);
  }
  pageHost.className = 'ah-account-page';
  pageHost.hidden = true;
  pageHost.innerHTML = `
    <main class="ah-account-shell" aria-labelledby="ah-account-title" data-current-view="login" data-visual-contract="code-native-page-system-v1">
      <button class="ah-account-close" type="button" data-role="close" aria-label="বন্ধ করুন">×</button>
      <header class="ah-account-head">
        <p class="ah-account-kicker">Admission Hub</p>
        <h2 class="ah-account-title" id="ah-account-title">তোমার Admission Journey</h2>
        <p class="ah-account-subtitle" data-role="account-subtitle">নিরাপদ ও সহজে account-এ প্রবেশ করো।</p>
      </header>
      <div class="ah-account-body">
        <div class="ah-account-message" data-role="message" hidden aria-live="polite"></div>

        <div class="ah-account-view ah-welcome-view" data-view="welcome" hidden data-page-contract="code-native-welcome-v1" data-media-contract="zero-raster-entry-v1">
          <!-- The owner's Welcome Story (welcome-story.js) paints this view. These
               native anchors stay in the DOM as the fallback wiring: the story's
               buttons call the bridge, and when the flow or the story is not
               loaded (an old bundle, or jsdom) they open the real signup/login
               form directly. CSS keeps them out of the story's way. -->
          <header class="ah-welcome-header">
            <span class="ah-welcome-mount" data-native-welcome-mount="welcome-onboarding-v1" hidden></span>
            <label class="ah-language-picker"><span class="sr-only">ভাষা বেছে নাও</span><select data-role="welcome-language" aria-label="ভাষা বেছে নাও"><option value="bn">বাংলা</option><option value="en">English</option></select></label>
          </header>
          <div class="ah-entry-actions" aria-label="প্রবেশের পদ্ধতি">
            <button class="ah-account-primary ah-entry-signup" type="button" data-role="welcome-signup"><span data-bn="Sign Up" data-en="Sign Up">Sign Up</span><b aria-hidden="true">→</b></button>
            <button class="ah-account-secondary ah-entry-login" type="button" data-role="welcome-login"><span data-bn="Log In" data-en="Log In">Log In</span><b aria-hidden="true">→</b></button>
            <div class="ah-account-google ah-welcome-google" data-role="welcome-google-button"><button class="ah-account-secondary" type="button" disabled aria-label="Google দিয়ে প্রবেশ এখন প্রস্তুত হচ্ছে"><span class="ah-google-g" aria-hidden="true">G</span><span>Continue with Google</span><b aria-hidden="true">→</b></button></div>
            <button class="ah-account-link ah-entry-guest" type="button" data-role="continue-guest"><span data-bn="Continue as Guest" data-en="Continue as Guest">Continue as Guest</span><b aria-hidden="true">→</b></button>
          </div>
          <div class="ah-account-telegram ah-welcome-telegram" data-role="welcome-telegram-button" hidden><button class="ah-account-secondary" type="button" aria-label="Continue with Telegram"><span class="ah-telegram-logo" aria-hidden="true"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#29A9EB"/><path fill="#fff" d="M5.4 11.8l11.6-4.5c.5-.2 1 .1.8.9l-2 9.3c-.1.6-.5.8-1.1.5l-3-2.2-1.4 1.4c-.2.2-.3.3-.6.3l.2-3.1 5.6-5.1c.2-.2 0-.3-.4-.1l-6.9 4.4-3-.9c-.6-.2-.6-.6.2-.9z"/></svg></span><span>Continue with Telegram</span><b aria-hidden="true">→</b></button></div>
        </div>

        <form class="ah-account-view ah-login-view" data-view="login" data-login-contract="reference-login-v1" novalidate>
          <div class="ah-login-hero" aria-hidden="true"><span class="ah-login-orb"><svg viewBox="0 0 24 24" fill="none"><path d="m6.5 12.4 4 4L17.6 8.6"/></svg></span><i class="ah-login-spark one">✦</i><i class="ah-login-spark two">✦</i><i class="ah-login-spark three">✦</i></div>
          <h3 class="ah-login-title">আবার দেখা হলো <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 10.5a11 11 0 0 1 16 0"/><path d="M7 13.8a6.5 6.5 0 0 1 10 0"/><circle cx="12" cy="17.2" r="1.6"/></svg></h3>
          <p class="ah-login-sub">তোমার preparation যেখানে থেমেছিল, সেখান থেকেই শুরু করো।</p><button class="ah-account-link ah-calm-back" type="button" data-role="login-back" data-bn="← পেছনে" data-en="← Back">← পেছনে</button>
          <div class="ah-account-field ah-login-field"><label class="ah-account-label" for="ah-login-email"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.2" y="5.6" width="17.6" height="12.8" rx="3.2"/><path d="m4.6 8.2 7.4 5 7.4-5"/></svg><span>EMAIL</span></label><input class="ah-account-input" id="ah-login-email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="student@gmail.com" required></div>
          <div class="ah-account-field ah-login-field"><label class="ah-account-label" for="ah-login-password"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10" width="14" height="10.5" rx="3.2"/><path d="M8.2 10V7.6a3.8 3.8 0 0 1 7.6 0V10"/></svg><span>PASSWORD</span></label><div class="ah-password-wrap"><input class="ah-account-input" id="ah-login-password" name="password" type="password" autocomplete="current-password" minlength="8" maxlength="128" placeholder="••••••••" required><button class="ah-password-toggle" type="button" data-password-target="ah-login-password" aria-label="Password দেখুন"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 12S6 6.8 12 6.8 20.5 12 20.5 12 18 17.2 12 17.2 3.5 12 3.5 12Z"/><circle cx="12" cy="12" r="2.6"/></svg></button></div></div>
          <div class="ah-login-row"><label class="ah-login-remember"><input type="checkbox" id="ah-login-remember" checked><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m6.5 12.4 4 4L17.6 8.6"/></svg></span><b>Remember me</b></label><button class="ah-account-link ah-forgot-link" type="button" data-role="show-forgot">Forgot password?</button></div>
          <button class="ah-account-primary ah-login-submit" type="submit"><span>Log In</span><b aria-hidden="true">→</b></button>
          <div class="ah-account-preferred" data-role="preferred-methods" hidden>
            <div class="ah-account-divider"><span>OR</span></div>
            <div class="ah-account-google" data-role="google-button" hidden></div>
            <button class="ah-account-method ah-account-passkey" type="button" data-role="passkey-login" hidden><span class="ah-passkey-key" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="14.5" r="4.5"/><path d="m12.5 11 8-8"/><path d="M16 6.5h4.5V11"/></svg></span><span>Use Passkey</span></button>
            <p class="ah-account-method-help" data-role="method-help" hidden></p>
          </div>
          <div class="ah-help ah-login-help">
            <button class="ah-help-fab" type="button" data-help-toggle="ah-login-help-card" aria-expanded="false" aria-controls="ah-login-help-card" aria-label="Log In নিয়ে সাহায্য"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.2" y="8.2" width="15.6" height="11" rx="5"/><path d="M12 8.2V5.6"/><circle cx="12" cy="4.4" r="1.4"/><circle cx="9.4" cy="13.2" r="1.1"/><circle cx="14.6" cy="13.2" r="1.1"/><path d="M9.7 16.4c1.5 1 3.1 1 4.6 0"/></svg></button>
            <div class="ah-help-card" id="ah-login-help-card" hidden><strong>Log In করতে সমস্যা?</strong><ul><li>Password মনে না থাকলে Forgot password চাপো।</li><li>নতুন হলে নিচে Sign Up করো।</li><li>Passkey থাকলে এক ট্যাপে ঢুকতে পারো।</li></ul></div>
          </div>
          <p class="ah-account-switch">Don't have an account? <button class="ah-account-link" type="button" data-role="show-signup">Sign Up</button></p>
        </form>

        <form class="ah-account-view ah-forgot-view" data-view="forgot" hidden novalidate>
          <div class="ah-view-intro"><span class="ah-mini-orb" aria-hidden="true">↺</span><div><h3>Password নতুন করে সেট করো</h3><p>Account-এর email লিখলে reset link পাঠানোর চেষ্টা করা হবে।</p></div></div>
          <div class="ah-account-field"><label class="ah-account-label" for="ah-forgot-email">Email address</label><input class="ah-account-input" id="ah-forgot-email" type="email" autocomplete="email" maxlength="254" placeholder="you@email.com" required></div>
          <button class="ah-account-primary" type="submit">Reset link পাঠান</button>
          <button class="ah-account-secondary" type="button" data-role="forgot-back">Login-এ ফিরুন</button>
        </form>

        <form class="ah-account-view ah-signup-view" data-view="signup" data-personal-visual-contract="interactive-native-personal-v1" data-media-contract="zero-raster-entry-v1" data-signup-current-step="personal" hidden novalidate>
          <header class="ah-signup-topbar">
            <div class="ah-signup-brand" aria-label="Admission Hub">
              <span class="ah-signup-brand-mark" aria-hidden="true"><svg viewBox="0 0 44 34" fill="none"><path d="m3 12 19-9 19 9-19 9L3 12Z"/><path d="M10 16v8c7 5 17 5 24 0v-8l-12 6-12-6Z"/><path d="M38 14v9"/><circle cx="38" cy="25" r="2"/></svg></span>
              <span><strong>Admission <em>Hub</em></strong><small>Build your admission profile</small></span>
            </div>
            <strong class="ah-signup-steplabel">Education</strong>
            <span class="ah-signup-secure"><i aria-hidden="true"></i>Private</span>
          </header>

          <nav class="ah-signup-progress" aria-label="Signup progress">
            <ol>
              <li><button type="button" class="active" data-signup-step-button="personal" aria-current="step"><i>1</i><span>Personal</span><small>Your identity</small></button></li>
              <li><button type="button" data-signup-step-button="education"><i>2</i><span>Education</span><small>Study details</small></button></li>
              <li><button type="button" data-signup-step-button="security"><i>3</i><span>Security</span><small>Secure account</small></button></li>
            </ol>
          </nav>

          <section class="ah-signup-panel ah-personal-panel" data-signup-panel="personal" aria-labelledby="ah-personal-title">
            <div class="ah-personal-intro">
              <div class="ah-personal-copy">
                <p class="ah-personal-kicker"><i aria-hidden="true"></i>STEP 01 · PERSONAL</p>
                <h1 id="ah-personal-title">Set up your profile</h1>
              </div>
              <p class="ah-personal-subcopy">Just your name and date of birth, we'll handle the rest.</p>
            </div>

            <div class="ah-personal-card">
              <header>
                <div><h2>Personal information</h2></div>
              </header>

              <div class="ah-account-field ah-personal-name-field">
                <label class="ah-account-label" for="ah-signup-name">Full name</label>
                <div class="ah-personal-input-wrap"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20c.7-4.6 2.9-6.8 6.5-6.8s5.8 2.2 6.5 6.8"/></svg></span><input class="ah-account-input" id="ah-signup-name" name="fullName" autocomplete="name" maxlength="80" placeholder="Enter your full name" aria-describedby="ah-name-feedback" required></div>
                <p class="ah-field-feedback" id="ah-name-feedback" data-role="name-feedback" aria-live="polite"></p>
              </div>

              <div class="ah-account-field ah-personal-mobile-field" data-mobile-signup-contract="signup-mobile-v1">
                <label class="ah-account-label" for="ah-signup-mobile">Mobile <small style="opacity:.55;font-weight:500">(optional)</small></label>
                <div class="ah-personal-input-wrap"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><line x1="10.5" y1="18.5" x2="13.5" y2="18.5"/></svg></span><input class="ah-account-input" id="ah-signup-mobile" name="mobile" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="+8801XXXXXXXXX" aria-describedby="ah-mobile-feedback"></div>
                <p class="ah-field-feedback" id="ah-mobile-feedback" data-role="mobile-feedback" aria-live="polite"></p>
              </div>

              <fieldset class="ah-personal-dob-card" data-dob-contract="premium-dropdown-dob-v2">
                <legend>Date of birth</legend>
                <div class="ah-dob-selects">
                  <div class="ah-dob-select-col">
                    <span class="ah-dob-select-label">Day</span>
                    <span class="ah-dob-select-wrap"><select class="ah-dob-select" id="ah-dob-day" aria-label="Day" required></select><svg aria-hidden="true" viewBox="0 0 12 8"><path d="M1 1.8 6 6.6 11 1.8"/></svg></span>
                  </div>
                  <div class="ah-dob-select-col">
                    <span class="ah-dob-select-label">Month</span>
                    <span class="ah-dob-select-wrap"><select class="ah-dob-select" id="ah-dob-month" aria-label="Month" required></select><svg aria-hidden="true" viewBox="0 0 12 8"><path d="M1 1.8 6 6.6 11 1.8"/></svg></span>
                  </div>
                  <div class="ah-dob-select-col">
                    <span class="ah-dob-select-label">Year</span>
                    <span class="ah-dob-select-wrap"><select class="ah-dob-select" id="ah-dob-year" aria-label="Year" required></select><svg aria-hidden="true" viewBox="0 0 12 8"><path d="M1 1.8 6 6.6 11 1.8"/></svg></span>
                  </div>
                </div>
                <output class="sr-only" data-role="dob-preview" aria-live="polite">Select your date of birth</output>
              </fieldset>

              <p class="ah-personal-privacy"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3 5 6v5c0 4.8 2.5 8 7 10 4.5-2 7-5.2 7-10V6l-7-3Z"/><path d="m9.4 12.1 1.7 1.7 3.7-4"/></svg></span><span><strong>Your information is encrypted and stays private</strong></span></p>
            </div>

            <div class="ah-personal-actions">
              <button class="ah-account-primary ah-personal-next" type="button" data-role="signup-next-education"><span>Continue</span><b aria-hidden="true">→</b></button>
            </div>
          </section>
          <section class="ah-signup-panel ah-institution-panel ah-education-panel ah-education-school-panel" data-signup-panel="school" data-institution-kind="school" hidden>
            <div class="ah-standalone-heading ah-education-heading"><h3>তোমার বিদ্যালয়ের নাম লিখো</h3><p>নাম লিখতে শুরু করো, আমরা কাছাকাছি school খুঁজে দেব।</p></div>
            <div class="ah-campus-strip ah-education-ornament" aria-hidden="true"><span>♧</span><i>▥</i><b>⌂</b><i>▥</i><span>♧</span></div>
            <div class="ah-account-field ah-search-field">
              <label class="sr-only" for="ah-signup-school">তোমার School কোনটি?</label>
              <div class="ah-search-input-wrap"><span class="ah-search-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4.4 4.4"/></svg></span><input class="ah-account-input" id="ah-signup-school" autocomplete="off" maxlength="120" placeholder="বিদ্যালয়ের নাম লিখো" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ah-school-results" required></div>
              <div class="ah-search-results ah-institution-results" id="ah-school-results" role="listbox" aria-label="প্রতিষ্ঠানের suggestion" hidden></div>
              <p class="ah-field-feedback">সর্বোচ্চ ৩টি suggestion দেখাবে; নাম না পেলে নিজের লেখা ব্যবহার করো।</p>
            </div>
            <div class="ah-edu-assist">
              <button class="ah-edu-assist-button" type="button" data-role="education-help" aria-expanded="false" aria-controls="ah-school-help" aria-label="নাম খোঁজা নিয়ে সাহায্য">
                <span class="ah-edu-assist-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="4.2" y="8.2" width="15.6" height="11" rx="4.2"/><path d="M12 8.2V5.4"/><circle cx="12" cy="4.4" r="1.5"/><path d="M9.2 12.6v1.6"/><path d="M14.8 12.6v1.6"/><path d="M9.6 16.6h4.8"/></svg></span>
              </button>
              <div class="ah-edu-assist-card" id="ah-school-help" hidden>
                <strong>নাম খুঁজে পাচ্ছ না?</strong>
                <ul><li>নিচে নাম না পেলে নিজের লেখা দিয়েই এগোতে পারবে।</li><li>বিদ্যালয়ের নাম লিখে “নিজের লেখা ব্যবহার করুন” চাপো।</li><li>পরে profile থেকে যেকোনো সময় বদলাতে পারবে।</li></ul>
              </div>
            </div>
            <div class="ah-panel-actions ah-bottom-actions ah-education-actions">
              <button class="ah-account-primary ah-education-next" type="button" data-role="signup-next-college"><span>Next</span><b aria-hidden="true">→</b></button>
            </div>
          </section>
          <section class="ah-signup-panel ah-institution-panel ah-education-panel ah-education-college-panel" data-signup-panel="college" data-institution-kind="college" hidden>
            <div class="ah-standalone-heading ah-education-heading"><h3>তুমি কোন কলেজ / বিশ্ববিদ্যালয়ে পড়েছ?</h3><p>শিক্ষা প্রতিষ্ঠানের নাম লিখলে আমরা খুঁজে দেব।</p></div>
            <div class="ah-account-field ah-search-field">
              <label class="sr-only" for="ah-signup-college">তোমার College / University?</label>
              <div class="ah-search-input-wrap"><span class="ah-search-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.4"/><path d="m15.8 15.8 4.4 4.4"/></svg></span><input class="ah-account-input" id="ah-signup-college" autocomplete="off" maxlength="120" placeholder="কলেজ বা বিশ্ববিদ্যালয়ের নাম" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ah-college-results" ></div>
              <div class="ah-search-results ah-institution-results" id="ah-college-results" role="listbox" aria-label="প্রতিষ্ঠানের suggestion" hidden></div>
              <p class="ah-field-feedback">এখন পড়ছ না? কলেজ/বিশ্ববিদ্যালয় না দিয়েও এগোতে পারো।</p>
            </div>
            <div class="ah-edu-assist">
              <button class="ah-edu-assist-button" type="button" data-role="education-help" aria-expanded="false" aria-controls="ah-college-help" aria-label="নাম খোঁজা নিয়ে সাহায্য">
                <span class="ah-edu-assist-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="4.2" y="8.2" width="15.6" height="11" rx="4.2"/><path d="M12 8.2V5.4"/><circle cx="12" cy="4.4" r="1.5"/><path d="M9.2 12.6v1.6"/><path d="M14.8 12.6v1.6"/><path d="M9.6 16.6h4.8"/></svg></span>
              </button>
              <div class="ah-edu-assist-card" id="ah-college-help" hidden>
                <strong>কলেজ/বিশ্ববিদ্যালয় খুঁজে পাচ্ছ না?</strong>
                <ul><li>এখন পড়ছ না? খালি রেখেও Next চাপতে পারো।</li><li>নাম না পেলে নিজের লেখা দিয়েই এগোতে পারবে।</li></ul>
              </div>
            </div>
            <div class="ah-panel-actions ah-bottom-actions ah-education-actions">
              <button class="ah-account-primary ah-education-next" type="button" data-role="signup-next-security"><span>Next</span><b aria-hidden="true">→</b></button>
            </div>
          </section>
          <section class="ah-signup-panel ah-security-panel" data-signup-panel="security" hidden>
            <div class="ah-standalone-heading"><h3>Account নিরাপদ করো</h3><p>Email ও শক্তিশালী Password দিয়ে account তৈরি করো</p></div>
            <div class="ah-account-field"><label class="ah-account-label" for="ah-signup-email">তোমার Email</label><input class="ah-account-input" id="ah-signup-email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="you@email.com" required><p class="ah-field-feedback">Verification method বাছার আগে কোনো message পাঠানো হবে না।</p></div>
            <div class="ah-account-field"><label class="ah-account-label" for="ah-signup-password">Password</label><div class="ah-password-wrap"><input class="ah-account-input" id="ah-signup-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="কমপক্ষে ৮ অক্ষর" required><button class="ah-password-toggle" type="button" data-password-target="ah-signup-password" aria-label="Password দেখুন"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 12S6 6.8 12 6.8 20.5 12 20.5 12 18 17.2 12 17.2 3.5 12 3.5 12Z"/><circle cx="12" cy="12" r="2.6"/></svg></button></div><div class="ah-password-meter"><i data-role="password-meter"></i></div><p class="ah-field-feedback" data-role="password-strength">Password strength</p></div>
            <div class="ah-account-field"><label class="ah-account-label" for="ah-signup-confirm">Confirm Password</label><div class="ah-password-wrap"><input class="ah-account-input" id="ah-signup-confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="একই Password আবার লিখো" required><button class="ah-password-toggle" type="button" data-password-target="ah-signup-confirm" aria-label="Password দেখুন"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 12S6 6.8 12 6.8 20.5 12 20.5 12 18 17.2 12 17.2 3.5 12 3.5 12Z"/><circle cx="12" cy="12" r="2.6"/></svg></button></div><p class="ah-field-feedback" data-role="password-match"></p></div>
            <ul class="ah-password-rules" aria-label="Password requirements"><li data-password-rule="length">কমপক্ষে ৮ অক্ষর</li><li data-password-rule="uppercase">একটি বড় অক্ষর</li><li data-password-rule="number">একটি সংখ্যা</li></ul>
            <div class="ah-panel-actions ah-bottom-actions"><button class="ah-account-secondary" type="button" data-role="signup-back-education">← Back</button><button class="ah-account-primary" type="submit">Create Account →</button></div>
          </section>
          <p class="ah-account-switch">আগে থেকেই account আছে? <button class="ah-account-link" type="button" data-role="show-login">Log In</button></p>
          <p class="ah-account-note" data-role="signup-verification-note">Account তৈরির পরে Email অথবা Telegram-একটি বাস্তব verification method বেছে নেবে। তার আগে কিছু পাঠানো হবে না।</p>
        </form>

        <div class="ah-account-view ah-created-view" data-view="created" hidden>
          <header class="ah-created-hero">
            <span class="ah-created-emblem" aria-hidden="true">
              <span class="ah-created-ring"></span>
              <svg viewBox="0 0 24 24" fill="none"><path d="M5.4 12.5l4.2 4.2L18.7 7.6"/></svg>
              <i class="ah-created-spark one">✦</i>
              <i class="ah-created-spark two">✦</i>
              <i class="ah-created-spark three">✦</i>
            </span>
            <h3 class="ah-account-view-title">Account Created!</h3>
            <p class="ah-account-mask">তোমার account তৈরি হয়েছে, প্রোফাইলের তথ্যও সংরক্ষিত।</p>
          </header>

          <section class="ah-created-card" aria-labelledby="ah-created-profile-title">
            <header class="ah-created-card-head">
              <span class="ah-created-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 12.4a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4Z"/><path d="M4.4 20.2c.9-3.6 4-5.6 7.6-5.6s6.7 2 7.6 5.6"/></svg></span>
              <span class="ah-created-card-titles"><strong id="ah-created-profile-title">তোমার প্রোফাইল</strong><small>এই তথ্যই তোমার admission profile</small></span>
            </header>
            <dl class="ah-created-rows">
              <div><dt>নাম</dt><dd data-role="created-name">-</dd></div>
              <div><dt>জন্ম তারিখ</dt><dd data-role="created-dob">-</dd></div>
              <div><dt>বিদ্যালয়</dt><dd data-role="created-school">-</dd></div>
              <div><dt>কলেজ / বিশ্ববিদ্যালয়</dt><dd data-role="created-college">-</dd></div>
              <div><dt>Account</dt><dd data-role="created-email">-</dd></div>
            </dl>
            <p class="ah-created-card-foot">পরে profile থেকে যেকোনো তথ্য বদলাতে পারবে।</p>
          </section>

          <div class="ah-created-actions">
            <button class="ah-account-primary ah-view-bottom-cta" type="button" data-role="created-continue">Continue →</button>
            <p class="ah-created-footnote">তথ্য শুধু admission প্রস্তুতিতে ব্যবহার হবে।</p>
          </div>

          <section class="ah-created-next" aria-labelledby="ah-created-next-title">
            <header class="ah-created-next-head">
              <span class="ah-created-next-kicker">পরের ধাপ</span>
              <strong id="ah-created-next-title">একটি verification বাকি</strong>
            </header>
            <p class="ah-created-next-copy">Continue চাপলেই একটি verification message যাবে। আগে কোনো message যাবে না।</p>
            <ul class="ah-created-next-list">
              <li><span class="ah-created-next-icon email" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="3.2" y="5.6" width="17.6" height="12.8" rx="3.2"/><path d="m4.6 8.2 7.4 5 7.4-5"/></svg></span><span><strong>Email verification</strong><small>৬ সংখ্যার code, না পেলে নিরাপদ link</small></span></li>
              <li><span class="ah-created-next-icon telegram" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20.4 4.6 3.9 11.1l4.9 1.7 1.6 5.1 2.7-3.4 4.3 2.9 3-12.8Z"/><path d="m8.8 12.8 7.6-5.3-5.4 6.7"/></svg></span><span><strong>Telegram</strong><small>চাইলে পরে বেছে নিতে পারবে</small></span></li>
            </ul>
          </section>
        </div>

        <div class="ah-account-view ah-verification-view" data-view="verify" data-mode="select" data-verify-contract="reference-verify-v1" hidden>
          <div class="ah-account-verify-badge" aria-hidden="true" data-role="verification-badge">✓</div>
          <p class="ah-view-kicker">ACCOUNT CREATED</p>
          <h3 class="ah-account-view-title" data-role="verification-title">একটি verification method বেছে নাও</h3>
          <div data-role="verification-selection">
            <p class="ah-account-mask">তোমার account নিরাপদ রাখতে নিচের যেকোনো একটি পদ্ধতি ব্যবহার করো।</p>
            <div class="ah-method-stack">
              <button class="ah-method-card recommended is-selected" type="button" data-role="email-ownership-start"><span class="ah-method-icon email" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="3.2" y="5.6" width="17.6" height="12.8" rx="3.2"/><path d="m4.6 8.2 7.4 5 7.4-5"/></svg></span><span><strong>Email OTP</strong><small>Email-এ আসা ৬ সংখ্যার code · Email মালিকানার প্রমাণ</small><em>✦ Recommended</em></span><span class="ah-method-trail"><span class="ah-method-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m6.5 12.4 4 4L17.6 8.6"/></svg></span><b aria-hidden="true">›</b></span></button>
              <button class="ah-method-card" type="button" data-role="email-magiclink-start"><span class="ah-method-icon email" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="3.2" y="5.6" width="17.6" height="12.8" rx="3.2"/><path d="m4.6 8.2 7.4 5 7.4-5"/></svg></span><span><strong data-bn="Email-এ login link পাঠাও" data-en="Send a login link by email">Email-এ login link পাঠাও</strong><small data-bn="Email-এ আসা link চাপলেই যাচাই · code লাগবে না" data-en="Verify with the link in your email · no code needed">Email-এ আসা link চাপলেই যাচাই · code লাগবে না</small></span><span class="ah-method-trail"><b aria-hidden="true">›</b></span></button>
              <button class="ah-method-card telegram" type="button" data-role="telegram-verification-start"><span class="ah-method-icon telegram" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20.4 4.6 3.9 11.1l4.9 1.7 1.6 5.1 2.7-3.4 4.3 2.9 3-12.8Z"/><path d="m8.8 12.8 7.6-5.3-5.4 6.7"/></svg></span><span><strong>Telegram</strong><small>Telegram দিয়ে verify · Official bot-এর real ৬ সংখ্যার code</small></span><span class="ah-method-trail"><b aria-hidden="true">›</b></span></button>
              <button class="ah-method-card unavailable" type="button" disabled aria-disabled="true"><span class="ah-method-icon passkey" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="14.5" r="4.5"/><path d="m12.5 11 8-8"/><path d="M16 6.5h4.5V11"/></svg></span><span><strong>Passkey</strong><small>দ্রুত ও নিরাপদ · Verification শেষে optional</small></span><span class="ah-method-trail"><b class="ah-method-lock" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10.5" rx="3.2"/><path d="M8.2 10V7.6a3.8 3.8 0 0 1 7.6 0V10"/></svg></b></span></button>
              <button class="ah-method-card whatsapp unavailable" type="button" data-role="whatsapp-info" aria-describedby="ah-whatsapp-unavailable"><span class="ah-method-icon whatsapp" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3.8c-4.5 0-8.2 3.6-8.2 8 0 1.5.4 2.9 1.2 4.2L3.8 20l4.1-1.1a8 8 0 0 0 4.1 1.1c4.5 0 8.2-3.6 8.2-8s-3.7-8.2-8.2-8.2Z"/><path d="M9 9.2c.5 2.3 2.5 4.3 4.8 4.8l1-1.2 1.9 1c-.3 1-.9 1.5-1.9 1.4-3.1-.4-5.8-3.1-6.2-6.2-.1-1 .4-1.6 1.4-1.9l1 1.9-1 1.2Z"/></svg></span><span><strong>WhatsApp</strong><small>WhatsApp দিয়ে verify</small><small class="ah-method-status" id="ah-whatsapp-unavailable">এখন verification পাওয়া যাচ্ছে না</small></span><span class="ah-method-trail"><b aria-hidden="true">›</b></span></button>
              <button class="ah-method-card" type="button" data-role="email-verification-start"><span class="ah-method-icon email" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="3.2" y="5.6" width="17.6" height="12.8" rx="3.2"/><path d="m4.6 8.2 7.4 5 7.4-5"/></svg></span><span><strong>Email link (Firebase)</strong><small>Firebase link · শেষ বিকল্প, backup হিসেবে</small></span><span class="ah-method-trail"><b aria-hidden="true">›</b></span></button>
            </div>
            <p class="ah-account-note">শুধু available method-ই কাজ করবে। Telegram Telegram account-এর নিয়ন্ত্রণ নিশ্চিত করে-Email মালিকানা নয়।</p>
            <div class="ah-help ah-verify-help">
              <button class="ah-help-fab" type="button" data-help-toggle="ah-verify-help-card" aria-expanded="false" aria-controls="ah-verify-help-card" aria-label="Verification নিয়ে সাহায্য"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.2" y="8.2" width="15.6" height="11" rx="5"/><path d="M12 8.2V5.6"/><circle cx="12" cy="4.4" r="1.4"/><circle cx="9.4" cy="13.2" r="1.1"/><circle cx="14.6" cy="13.2" r="1.1"/><path d="M9.7 16.4c1.5 1 3.1 1 4.6 0"/></svg></button>
              <div class="ah-help-card" id="ah-verify-help-card" hidden><strong>কোনটি বেছে নেবে?</strong><ul><li>Email link সবচেয়ে সহজ, Spam folder-ও দেখো।</li><li>Telegram code শুধু secure box-এ লিখবে।</li><li>Passkey verification-এর পরে যোগ করা যাবে।</li></ul></div>
              <p class="ah-help-line">অন্য কোনো সমস্যা? <button class="ah-account-link" type="button" data-help-toggle="ah-verify-help-card" aria-expanded="false" aria-controls="ah-verify-help-card">Help নাও</button></p>
            </div>
          </div>
          <div data-role="verification-email-panel" hidden>
            <div class="ah-mail-hero" aria-hidden="true"><span class="ah-mail-orb"><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5.5" width="18" height="13" rx="3.5"/><path d="m4.5 8 7.5 5.2 7.5-5.2"/></svg><i><svg viewBox="0 0 24 24" fill="none"><path d="m6.5 12.4 4 4L17.6 8.6"/></svg></i></span><i class="ah-login-spark one">✦</i><i class="ah-login-spark two">✦</i><span class="ah-mail-shield-float"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3 5 6v5c0 4.8 2.5 8 7 10 4.5-2 7-5.2 7-10V6l-7-3Z"/><path d="m9.4 12.1 1.7 1.7 3.7-4"/></svg></span></div>
            <h3 class="ah-account-view-title">আমরা তোমার verification-এর অপেক্ষায় আছি…</h3>
            <p class="ah-account-mask" data-role="verification-email-copy">Verification link পাঠানো হয়েছে <strong data-role="mask">তোমার email-এ</strong>। Email app-এ link-এ tap করে এখানে ফিরে আসো।</p>
            <div class="ah-status-card ah-waiting-status ah-mail-card"><span class="ah-mail-chip" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="3.2" y="5.6" width="17.6" height="12.8" rx="3.2"/><path d="m4.6 8.2 7.4 5 7.4-5"/></svg></span><div><strong data-role="email-status-address">Verification pending…</strong><small>Email link খোলার অপেক্ষায়</small></div><span class="ah-mail-shield" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3 5 6v5c0 4.8 2.5 8 7 10 4.5-2 7-5.2 7-10V6l-7-3Z"/><path d="m9.4 12.1 1.7 1.7 3.7-4"/></svg></span></div>
            <button class="ah-account-primary ah-mail-primary" type="button" data-role="open-email"><span>Open Email</span><b aria-hidden="true">→</b></button>
            <button class="ah-account-secondary ah-mail-secondary" type="button" data-role="verified-login">✓ আমি Verify করেছি, Check করুন</button>
            <button class="ah-account-telegram" type="button" data-role="telegram-alternative" hidden><span class="ah-account-telegram-icon" aria-hidden="true">➤</span><span><strong>Telegram দিয়ে যাচাই</strong><small>অন্য যাচাই পদ্ধতি</small></span></button>
            <details class="ah-account-resend ah-mail-resend"><summary>Verification email আবার পাঠান</summary><form data-role="resend-form" novalidate><div class="ah-account-field"><label class="ah-account-label" for="ah-resend-email">Email</label><input class="ah-account-input" id="ah-resend-email" type="email" autocomplete="email" maxlength="254" required></div><div class="ah-account-field"><label class="ah-account-label" for="ah-resend-password">Password</label><input class="ah-account-input" id="ah-resend-password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required></div><p class="ah-account-resend-status" data-role="resend-status" aria-live="polite"></p><button class="ah-account-secondary" type="submit" data-role="resend-submit">Verification আবার পাঠান</button></form></details>
          </div>
          <p class="ah-account-switch"><button class="ah-account-link" type="button" data-role="verify-back">Log In-এ ফিরুন</button></p>
        </div>

        <div class="ah-account-view ah-email-intro-view" data-view="email-intro" data-email-contract="reference-email-v1" hidden>
          <div class="ah-mail-hero" aria-hidden="true"><span class="ah-mail-orb"><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5.5" width="18" height="13" rx="3.5"/><path d="m4.5 8 7.5 5.2 7.5-5.2"/></svg><i><svg viewBox="0 0 24 24" fill="none"><path d="m6.5 12.4 4 4L17.6 8.6"/></svg></i></span><i class="ah-login-spark one">✦</i><i class="ah-login-spark two">✦</i><span class="ah-mail-shield-float"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3 5 6v5c0 4.8 2.5 8 7 10 4.5-2 7-5.2 7-10V6l-7-3Z"/><path d="m9.4 12.1 1.7 1.7 3.7-4"/></svg></span></div>
          <h3 class="ah-account-view-title">তোমার Email-এ একটি ছোট্ট কাজ আছে <svg class="ah-title-mail" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.2" y="5.6" width="17.6" height="12.8" rx="3.2"/><path d="m4.6 8.2 7.4 5 7.4-5"/></svg></h3>
          <p class="ah-account-mask">তোমার <strong>নিজের সিদ্ধান্তে</strong> নিচের button চাপলে একটি verification link পাঠানো হবে। Email-এ গিয়ে link-এ tap করো।</p>
          <div class="ah-email-address-card ah-mail-card"><span class="ah-mail-chip" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="3.2" y="5.6" width="17.6" height="12.8" rx="3.2"/><path d="m4.6 8.2 7.4 5 7.4-5"/></svg></span><div><strong data-role="email-intro-address">তোমার Email</strong><small>এখনো নতুন link পাঠানো হয়নি</small></div><span class="ah-mail-shield" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3 5 6v5c0 4.8 2.5 8 7 10 4.5-2 7-5.2 7-10V6l-7-3Z"/><path d="m9.4 12.1 1.7 1.7 3.7-4"/></svg></span></div>
          <div class="ah-mini-journey" aria-label="Verification progress"><span class="done">✓<small>Account<br>Created</small></span><i></i><span>2<small>Email<br>Send</small></span><i></i><span>3<small>Enter<br>Admission Hub</small></span></div>
          <div class="ah-help ah-email-help">
            <button class="ah-help-fab" type="button" data-help-toggle="ah-email-help-card" aria-expanded="false" aria-controls="ah-email-help-card" aria-label="Email verification নিয়ে সাহায্য"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.2" y="8.2" width="15.6" height="11" rx="5"/><path d="M12 8.2V5.6"/><circle cx="12" cy="4.4" r="1.4"/><circle cx="9.4" cy="13.2" r="1.1"/><circle cx="14.6" cy="13.2" r="1.1"/><path d="M9.7 16.4c1.5 1 3.1 1 4.6 0"/></svg></button>
            <div class="ah-help-card" id="ah-email-help-card" hidden><strong>Email link নিয়ে টিপস</strong><ul><li>Button চাপার পর Inbox, Spam ও Promotions দেখো।</li><li>Link-এ tap করে এখানে ফিরে এসো।</li><li>ফিরে এসে “আমি Verify করেছি” চাপো।</li></ul></div>
          </div>
          <button class="ah-account-primary ah-mail-primary ah-view-bottom-cta" type="button" data-role="email-intro-continue">Verification link পাঠান →</button>
          <button class="ah-account-link ah-calm-back" type="button" data-role="email-intro-back">অন্য পদ্ধতি ব্যবহার করো</button>
        </div>

        <form class="ah-account-view ah-email-ownership-view" data-view="email-ownership" data-state="waiting" hidden novalidate>
          <div class="ah-mail-hero" aria-hidden="true"><span class="ah-mail-orb"><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5.5" width="18" height="13" rx="3.5"/><path d="m4.5 8 7.5 5.2 7.5-5.2"/></svg><i><svg viewBox="0 0 24 24" fill="none"><path d="m6.5 12.4 4 4L17.6 8.6"/></svg></i></span><span class="ah-mail-shield-float"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3 5 6v5c0 4.8 2.5 8 7 10 4.5-2 7-5.2 7-10V6l-7-3Z"/><path d="m9.4 12.1 1.7 1.7 3.7-4"/></svg></span></div>
          <p class="ah-view-kicker">EMAIL OWNERSHIP</p>
          <h3 class="ah-account-view-title">Email-এ পাঠানো ৬ সংখ্যার code লিখো</h3>
          <p class="ah-account-mask">Code পাঠানো হয়েছে <strong data-role="ownership-mask">তোমার Email-এ</strong>। এটি Email মালিকানার সরাসরি প্রমাণ।</p>
          <div class="ah-account-field ah-otp-field"><label class="ah-account-label" for="ah-ownership-code">৬ সংখ্যার code</label><div class="ah-six-code" aria-hidden="true"><span data-otp-digit="0"></span><span data-otp-digit="1"></span><span data-otp-digit="2"></span><span data-otp-digit="3"></span><span data-otp-digit="4"></span><span data-otp-digit="5"></span></div><input class="ah-account-input ah-account-otp" id="ah-ownership-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" aria-describedby="ah-ownership-code-help" required></div><p class="ah-field-feedback ah-otp-help" id="ah-ownership-code-help">Code না পেলে Spam folder দেখো, অথবা নতুন code নাও।</p>
          <p class="ah-account-fine" data-role="ownership-expiry" hidden></p>
          <button class="ah-account-primary" type="submit" data-role="ownership-verify">Verify →</button>
          <button class="ah-account-secondary" type="button" data-role="ownership-resend">নতুন code নিন</button>
          <p class="ah-account-note">Code কখনো অন্য কাউকে দিও না। Admission Hub কখনো ফোনে বা chat-এ code চাইবে না।</p>
          <p class="ah-account-switch"><button class="ah-account-link" type="button" data-role="ownership-back">অন্য পদ্ধতি ব্যবহার করো</button></p>
        </form>

        <div class="ah-account-view ah-provider-info-view ah-whatsapp-info-view" data-view="whatsapp-info" hidden>
          <div class="ah-provider-phone whatsapp" aria-hidden="true"><span>◉</span><i>✓</i></div>
          <h3 class="ah-account-view-title">WhatsApp verification</h3>
          <p class="ah-account-mask">এই no-cost public version-এ সত্যিকারের WhatsApp verification এখনো available নয়। তাই কোনো message পাঠানো বা success দেখানো হবে না।</p>
          <div class="ah-unavailable-card" role="status"><span>i</span><div><strong>এখন পাওয়া যাচ্ছে না</strong><small>Email link বা Telegram ব্যবহার করো</small></div></div>
          <button class="ah-account-primary ah-view-bottom-cta" type="button" disabled>Continue with WhatsApp</button>
          <button class="ah-account-link ah-calm-back" type="button" data-role="whatsapp-info-back">অন্য method বেছে নাও</button>
        </div>

        <div class="ah-account-view ah-provider-info-view ah-telegram-intro-view" data-view="telegram-intro" data-telegram-contract="reference-telegram-v1" hidden>
          <h3 class="ah-account-view-title">Telegram দিয়ে verify করো</h3>
          <p class="ah-account-mask">Telegram খুলে verification request সম্পন্ন করো।</p>
          <div class="ah-tg-hero" aria-hidden="true"><span class="ah-tg-orbit"></span><span class="ah-tg-orb"><svg viewBox="0 0 24 24" fill="none"><path d="M20.4 4.6 3.9 11.1l4.9 1.7 1.6 5.1 2.7-3.4 4.3 2.9 3-12.8Z"/><path d="m8.8 12.8 7.6-5.3-5.4 6.7"/></svg></span><span class="ah-tg-badge one"><svg viewBox="0 0 24 24" fill="none"><path d="m6.5 12.4 4 4L17.6 8.6"/></svg></span><span class="ah-tg-badge two"><svg viewBox="0 0 24 24" fill="none"><path d="m3.5 12.8 3.2 3.2 6.5-7.4"/><path d="m11 16 2.2 2.2 6.3-7.2"/></svg></span><i class="ah-login-spark one">✦</i><i class="ah-login-spark two">✦</i></div>
          <div class="ah-tg-bot-card"><span class="ah-tg-bot-chip" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20.4 4.6 3.9 11.1l4.9 1.7 1.6 5.1 2.7-3.4 4.3 2.9 3-12.8Z"/></svg></span><div><strong>Telegram Verification Bot</strong><small>⚡ Secure connection · End-to-end</small></div><span class="ah-tg-shield" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3 5 6v5c0 4.8 2.5 8 7 10 4.5-2 7-5.2 7-10V6l-7-3Z"/><path d="m9.4 12.1 1.7 1.7 3.7-4"/></svg></span></div>
          <div class="ah-help ah-telegram-help">
            <button class="ah-help-fab" type="button" data-help-toggle="ah-telegram-help-card" aria-expanded="false" aria-controls="ah-telegram-help-card" aria-label="Telegram verification নিয়ে সাহায্য"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.2" y="8.2" width="15.6" height="11" rx="5"/><path d="M12 8.2V5.6"/><circle cx="12" cy="4.4" r="1.4"/><circle cx="9.4" cy="13.2" r="1.1"/><circle cx="14.6" cy="13.2" r="1.1"/><path d="M9.7 16.4c1.5 1 3.1 1 4.6 0"/></svg></button>
            <div class="ah-help-card" id="ah-telegram-help-card" hidden><strong>Telegram ধাপগুলো</strong><ul><li>Official bot খুলে START চাপো।</li><li>Bot-এর ৬ সংখ্যার code শুধু secure box-এ লিখবে।</li><li>এটি Email মালিকানার প্রমাণ নয়।</li></ul></div>
          </div>
          <button class="ah-account-primary ah-tg-primary ah-view-bottom-cta" type="button" data-role="telegram-intro-continue"><span class="ah-tg-btn-plane" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M20.4 4.6 3.9 11.1l4.9 1.7 1.6 5.1 2.7-3.4 4.3 2.9 3-12.8Z"/></svg></span><span>Continue with Telegram</span><b aria-hidden="true">→</b></button>
          <p class="ah-tg-truth">Official bot-এ START চাপলে real ৬ সংখ্যার code পাবে, Email মালিকানা নয়, Telegram account control নিশ্চিত করে।</p>
          <button class="ah-account-secondary ah-tg-back" type="button" data-role="telegram-intro-back">অন্য পদ্ধতি ব্যবহার করো</button>
        </div>

        <form class="ah-account-view ah-account-telegram-view" data-view="telegram" data-state="connecting" hidden novalidate>
          <div class="ah-telegram-hero" aria-hidden="true"><span>➤</span><i></i></div><p class="ah-view-kicker">SECURE VERIFICATION</p><h3 class="ah-account-view-title">Telegram দিয়ে verify করো</h3><p class="ah-account-mask">Official bot খুলে <strong>START</strong> চাপো। Bot যে ৬ সংখ্যার code পাঠাবে, সেটি শুধু নিচের secure box-এ লিখবে।</p>
          <ol class="ah-account-telegram-steps" aria-label="Telegram verification steps"><li><span>১</span> Official Telegram bot খোলো</li><li><span>২</span> START চাপো ও code নাও</li><li><span>৩</span> Admission Hub-এ code লিখো</li></ol>
          <a class="ah-account-primary ah-account-external ah-account-telegram-open" data-role="telegram-link" target="_blank" rel="noopener noreferrer">Continue with Telegram →</a><div class="ah-account-telegram-status" data-role="telegram-status" aria-live="polite">START চাপার অপেক্ষায়…</div>
          <div class="ah-account-field ah-otp-field"><label class="ah-account-label" for="ah-telegram-code">Telegram-এর ৬ সংখ্যার code</label><div class="ah-six-code" aria-hidden="true"><span data-otp-digit="0"></span><span data-otp-digit="1"></span><span data-otp-digit="2"></span><span data-otp-digit="3"></span><span data-otp-digit="4"></span><span data-otp-digit="5"></span></div><input class="ah-account-input ah-account-otp" id="ah-telegram-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" aria-describedby="ah-telegram-code-help" required></div><p class="ah-field-feedback ah-otp-help" id="ah-telegram-code-help">Code পাওয়া যায়নি? Official bot-এ START চাপো।</p>
          <button class="ah-account-primary" type="submit" data-role="telegram-verify">Verify →</button><button class="ah-account-secondary" type="button" data-role="telegram-resend" data-bn="নতুন code নিন" data-en="Get a new code">নতুন code নিন</button><p class="ah-account-note" data-bn="Telegram verification শুধু Telegram account-এর নিয়ন্ত্রণ নিশ্চিত করে-Email মালিকানা নয়। Code বা Password কখনো অন্য কোনো chat-এ লিখবে না; শুধু secure form ব্যবহার করবে। START বা animation একা success নয়, নিশ্চিত ফল Admission Hub দেখাবে।" data-en="Telegram verification proves control of your Telegram account only, not ownership of the email. Never type the code or password into any other chat; use the secure form only. START or an animation alone is not success, only the confirmed result from Admission Hub is.">Telegram verification শুধু Telegram account-এর নিয়ন্ত্রণ নিশ্চিত করে-Email মালিকানা নয়। Code বা Password কখনো অন্য কোনো chat-এ লিখবে না; শুধু secure form ব্যবহার করবে। START বা animation একা success নয়, নিশ্চিত ফল Admission Hub দেখাবে।</p><p class="ah-account-switch"><button class="ah-account-link" type="button" data-role="telegram-email-back">অন্য method বেছে নিন</button></p>
        </form>

        <form class="ah-account-view" data-view="google-link" hidden novalidate><div class="ah-account-verify-badge" aria-hidden="true">G</div><h3 class="ah-account-view-title">আগের account-এ Google যুক্ত করো</h3><p class="ah-account-mask">একই Email-এ account আছে। একবার আগের Email ও Password দিলে Google নতুন account না বানিয়ে সেটিতেই যুক্ত হবে।</p><div class="ah-account-field"><label class="ah-account-label" for="ah-link-email">Email</label><input class="ah-account-input" id="ah-link-email" type="email" autocomplete="email" maxlength="254" required></div><div class="ah-account-field"><label class="ah-account-label" for="ah-link-password">Password</label><input class="ah-account-input" id="ah-link-password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required></div><button class="ah-account-primary" type="submit">Google যুক্ত করে প্রবেশ করুন</button><p class="ah-account-switch"><button class="ah-account-link" type="button" data-role="link-cancel">Login-এ ফিরুন</button></p></form>

        <form class="ah-account-view" data-view="backup-prepare" hidden novalidate><div class="ah-account-verify-badge" aria-hidden="true">✓</div><h3 class="ah-account-view-title">বিকল্প verification</h3><p class="ah-account-mask">তোমার জন্য available নিরাপদ method ব্যবহার হবে।</p><div class="ah-account-field" data-role="backup-contact-field"><label class="ah-account-label" for="ah-backup-contact">Mobile number <span data-role="backup-contact-mode">(optional)</span></label><input class="ah-account-input" id="ah-backup-contact" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="+8801XXXXXXXXX"></div><button class="ah-account-primary" type="submit">Verification শুরু করুন</button><p class="ah-account-switch"><button class="ah-account-link" type="button" data-role="backup-prepare-cancel">ফিরে যান</button></p></form>
        <form class="ah-account-view" data-view="backup" hidden novalidate><div class="ah-account-verify-badge" aria-hidden="true">✓</div><h3 class="ah-account-view-title">বিকল্প verification</h3><p class="ah-account-mask" data-role="backup-instruction">নিরাপদ code লিখুন।</p><div class="ah-account-interaction" data-role="backup-interaction" hidden><a class="ah-account-primary ah-account-external" data-role="backup-link" target="_blank" rel="noopener noreferrer">Telegram খুলুন</a><p>START চাপুন এবং পাওয়া ৬ সংখ্যার code নিচে লিখুন। Telegram খোলা সফল যাচাই নয়; এটি Email মালিকানার প্রমাণও নয়।</p></div><div class="ah-account-field" data-role="backup-code-field"><label class="ah-account-label" for="ah-backup-code">৬ সংখ্যার code</label><input class="ah-account-input ah-account-otp" id="ah-backup-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><button class="ah-account-primary" type="submit" data-role="backup-verify">Verify</button><p class="ah-account-switch"><button class="ah-account-link" type="button" data-role="backup-cancel">ফিরে যান</button></p></form>

        <form class="ah-account-view" data-view="step-up" hidden novalidate><div class="ah-account-verify-badge" aria-hidden="true">🔒</div><h3 class="ah-account-view-title">Security verification দরকার</h3><p class="ah-account-mask" data-role="step-up-instruction">সব device থেকে লগ আউট একটি গুরুত্বপূর্ণ কাজ। নিশ্চিত করতে তোমার verification-এ পাঠানো ৬ সংখ্যার code লিখুন।</p><div class="ah-account-interaction" data-role="step-up-interaction" hidden><a class="ah-account-primary ah-account-external" data-role="step-up-link" target="_blank" rel="noopener noreferrer">Telegram খুলুন</a><p>START চাপুন এবং পাওয়া ৬ সংখ্যার code নিচে লিখুন।</p></div><div class="ah-account-field"><label class="ah-account-label" for="ah-stepup-code">৬ সংখ্যার code</label><input class="ah-account-input ah-account-otp" id="ah-stepup-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><p class="ah-account-fine" data-role="step-up-expiry" hidden></p><button class="ah-account-primary" type="submit" data-role="step-up-verify">Verify</button><p class="ah-account-switch"><button class="ah-account-link" type="button" data-role="step-up-cancel">বাতিল করুন</button></p></form>

        <div class="ah-account-view ah-verified-view" data-view="verified" hidden>
          <div class="ah-success-check ah-success-glow" aria-hidden="true"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="46"/><path d="m38 61 14 14 31-34"/></svg></div>
          <h3 class="ah-account-view-title" data-role="verified-title">Email Verified! 🎉</h3>
          <p class="ah-account-mask" data-role="verified-copy">তোমার Email এবং account নিরাপদভাবে যাচাই হয়েছে।</p>
          <div class="ah-ready-list"><span>✓ Account Created</span><span data-role="verified-method-row">✓ Email Verified</span><span>✓ Ready for Admission Hub</span></div>
          <button class="ah-account-primary ah-view-bottom-cta" type="button" data-role="verified-continue">Continue →</button>
        </div>

        <div class="ah-account-view ah-passkey-onboarding" data-view="security-setup" data-passkey-contract="reference-passkey-v1" hidden>
          <div class="ah-pk-hero" aria-hidden="true"><span class="ah-pk-ring"></span><span class="ah-pk-phone"><i></i><svg viewBox="0 0 24 24" fill="none"><path d="M6.5 19a7.5 7.5 0 0 1-.8-3.3 7.5 7.5 0 0 1 12.6-5.4"/><path d="M9 19a5 5 0 0 1-.6-2.3 5 5 0 0 1 8.3-3.7"/><path d="M12 12.5v4"/><path d="M17.5 15.6a7.5 7.5 0 0 1-1.9 3.2"/></svg></span><span class="ah-pk-badge one"><svg viewBox="0 0 24 24" fill="none"><path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="9.5" cy="11" r="1"/><circle cx="14.5" cy="11" r="1"/><path d="M9.5 14.5c1.6 1 3.4 1 5 0"/></svg></span><span class="ah-pk-badge two"><svg viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m14.8 14.8 4.7 4.7"/><path d="m17.5 17.5 1.8 1.8M19.3 17.5l-1.8 1.8"/></svg></span><i class="ah-login-spark one">✦</i><i class="ah-login-spark two">✦</i></div>
          <h3 class="ah-account-view-title">এক ট্যাপেই নিরাপদে ঢুকবে <svg class="ah-title-lock" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10" width="14" height="10.5" rx="3.2"/><path d="M8.2 10V7.6a3.8 3.8 0 0 1 7.6 0V10"/></svg></h3>
          <p class="ah-account-mask">Face ID, fingerprint বা device lock ব্যবহার করে account secure করো।</p>
          <div class="ah-pk-options"><div class="ah-pk-option"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="9.5" cy="11" r="1"/><circle cx="14.5" cy="11" r="1"/><path d="M9.5 14.5c1.6 1 3.4 1 5 0"/></svg></span><strong>Face ID</strong></div><div class="ah-pk-option"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M6.5 19a7.5 7.5 0 0 1-.8-3.3 7.5 7.5 0 0 1 12.6-5.4"/><path d="M9 19a5 5 0 0 1-.6-2.3 5 5 0 0 1 8.3-3.7"/><path d="M12 12.5v4"/></svg></span><strong>Fingerprint</strong></div><div class="ah-pk-option"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10.5" rx="3.2"/><path d="M8.2 10V7.6a3.8 3.8 0 0 1 7.6 0V10"/></svg></span><strong>Device Lock</strong></div></div>
          <div class="ah-help ah-passkey-help">
            <button class="ah-help-fab" type="button" data-help-toggle="ah-passkey-help-card" aria-expanded="false" aria-controls="ah-passkey-help-card" aria-label="Passkey নিয়ে সাহায্য"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.2" y="8.2" width="15.6" height="11" rx="5"/><path d="M12 8.2V5.6"/><circle cx="12" cy="4.4" r="1.4"/><circle cx="9.4" cy="13.2" r="1.1"/><circle cx="14.6" cy="13.2" r="1.1"/><path d="M9.7 16.4c1.5 1 3.1 1 4.6 0"/></svg></button>
            <div class="ah-help-card" id="ah-passkey-help-card" hidden><strong>Passkey কী?</strong><ul><li>ফোনের Face ID বা fingerprint-ই তোমার চাবি।</li><li>Password মনে রাখতে হয় না।</li><li>না চাইলে “পরে করব” চাপো।</li></ul></div>
          </div>
          <button class="ah-account-primary ah-pk-primary ah-view-bottom-cta" type="button" data-role="setup-passkey"><span>Create Passkey</span><b aria-hidden="true">→</b></button>
          <p class="ah-pk-foot"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 5 6v5c0 4.8 2.5 8 7 10 4.5-2 7-5.2 7-10V6l-7-3Z"/><path d="m9.4 12.1 1.7 1.7 3.7-4"/></svg><span>তোমার device-এর built-in security ব্যবহার করা হবে।</span></p>
          <button class="ah-account-link ah-calm-back" type="button" data-role="setup-skip">পরে করব</button>
          <p class="ah-account-note">Passkey সম্পূর্ণ optional। Skip করলে Email, Password, Google বা Telegram বন্ধ হবে না। ফোনের নিজের অনুমতি screen-এ শেষ সিদ্ধান্ত তোমার।</p>
        </div>

        <div class="ah-account-view ah-success-view" data-view="success" hidden><div class="ah-success-check" aria-hidden="true"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="46"/><path d="m38 61 14 14 31-34"/></svg></div><p class="ah-view-kicker">ALL SET</p><h3 class="ah-account-view-title">সব ঠিক আছে! 🎉</h3><p class="ah-account-mask">তোমার account এখন প্রস্তুত।</p><div class="ah-ready-list"><span data-role="ready-profile">… Profile details দেখা হচ্ছে</span><span>✓ Verification Complete</span><span>✓ Admission Hub Ready</span></div><button class="ah-account-primary" type="button" data-role="enter-app">Admission Hub-এ প্রবেশ করো →</button></div>

        <div class="ah-account-view" data-view="signed" hidden><div class="ah-account-secure"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2m-11 0h12v10H6V10Zm6 4v2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg><div><h3>Account নিরাপদ ও সক্রিয়</h3><p data-role="account-verification-summary">তোমার account সত্যিকারের যাচাইয়ের মাধ্যমে সক্রিয় আছে।</p></div></div><div class="ah-account-identity"><p class="ah-account-identity-label" data-role="identity-label">Admission Hub account</p><p class="ah-account-identity-value" data-role="identity">-</p></div><section class="ah-account-security-tools" data-role="passkey-tools" hidden><div class="ah-account-tool-head"><div><h3>Passkey</h3><p data-role="passkey-status">এই device-এ দ্রুত প্রবেশ চালু করতে পারো।</p></div><span aria-hidden="true">◉</span></div><div data-role="passkey-list"></div><button class="ah-account-secondary" type="button" data-role="passkey-add">নতুন Passkey যোগ করুন</button></section><section class="ah-account-security-tools" data-role="trust-prompt" hidden><div class="ah-account-tool-head"><div><h3>এই device-কে trust করবে?</h3><p>পরবর্তী ৩০ দিন এই device থেকে লগইন করলে extra verification লাগবে না।</p></div></div><button class="ah-account-secondary" type="button" data-role="trust-accept">Trust করি (৩০ দিন)</button><button class="ah-account-link" type="button" data-role="trust-decline">না, ধন্যবাদ</button></section><button class="ah-account-secondary" type="button" data-role="backup-start" hidden>বিকল্প যাচাই</button><button class="ah-account-secondary" type="button" data-role="logout">Log Out</button><button class="ah-account-secondary ah-account-danger" type="button" data-role="logout-all">সব device থেকে Log Out</button><p class="ah-account-fine">Password ও প্রবেশের গোপন তথ্য এই পেজে দেখানো বা জমা রাখা হয় না।</p></div>
      </div>

    </main>
  `;

  const $ = selector => pageHost.querySelector(selector);

  /* The welcome picker only swapped the data-bn/data-en copy inside this page:
     it never told either engine, so the first screen looked English while the
     engine still believed Bengali. Route the choice through AhI18n, which owns
     `ahLang` and fires `ah:lang` for the runtime translator.

     Keep this module free of web-storage access: native-auth-protection scans
     it for the browser storage globals and fails if any appear, because these
     auth flows must never place credentials in client storage. Persisting the
     choice is the engines' job, not ours, do not name those globals here
     either, since the guard is a plain text scan that reads comments too. */
  const setWelcomeLanguage = (language, { persist = true } = {}) => {
    const selected = language === 'en' ? 'en' : 'bn';
    if (persist) {
      try {
        if (window.AhI18n) window.AhI18n.set(selected);
        else window.dispatchEvent(new CustomEvent('ah:lang', { detail: { lang: selected } }));
      } catch (_) {}
    }
    const heading = $('#ah-welcome-heading');
    if (heading) {
      const lines = String(heading.dataset[selected] || heading.dataset.bn || '').split('|');
      heading.textContent = '';
      lines.forEach((line, index) => {
        if (index > 0) heading.append(document.createElement('br'));
        const node = index === 1 ? document.createElement('em') : document.createTextNode(line);
        if (node.nodeType === 1) node.textContent = line;
        heading.append(node);
      });
    }
    pageHost.querySelectorAll('[data-bn][data-en]:not(#ah-welcome-heading)').forEach(node => {
      const value = String(node.dataset[selected] || node.dataset.bn || '');
      if (value.includes('|')) {
        node.textContent = '';
        value.split('|').forEach((line, index) => {
          if (index > 0) node.append(document.createElement('br'));
          node.append(document.createTextNode(line));
        });
      } else node.textContent = value;
    });
    document.documentElement.lang = selected;
  };
  const message = (text = '', kind = 'info') => {
    /* A queued timer can fire after the page is torn down (closed tab,
       bfcache restore, test teardown); there is nothing left to paint
       into, so leave quietly instead of throwing out of a timer. */
    if (typeof document === 'undefined') return;
    if (text && (state.currentView === 'sky' || document.getElementById('ah-account-page')?.dataset.skyFlow === 'on')) {
      state.skyPendingNotice = { text, kind };
      try { window.AdmissionSkyFlow?.notice?.(text, kind); } catch (_) {}
    }
    const node = $('[data-role="message"]');
    if (!node) return;
    node.textContent = text;
    node.dataset.kind = kind;
    node.hidden = !text;
  };

  const resendSecondsRemaining = () => Math.max(0, Math.ceil((Number(state.verification?.resendUntil || 0) - Date.now()) / 1000));
  const updateResendCooldown = () => {
    const button = $('[data-role="resend-submit"]');
    const status = $('[data-role="resend-status"]');
    if (!button || !status) return;
    const remaining = resendSecondsRemaining();
    button.disabled = state.busy || remaining > 0;
    button.textContent = remaining > 0 ? `আবার পাঠানো যাবে (${remaining.toLocaleString('bn-BD')} সেকেন্ড)` : 'যাচাইয়ের ইমেইল আবার পাঠান';
    status.textContent = remaining > 0 ? `নিরাপত্তার জন্য ${remaining.toLocaleString('bn-BD')} সেকেন্ড পর আবার পাঠাতে পারবেন।` : 'প্রয়োজনে এখন আবার পাঠাতে পারেন।';
    if (remaining === 0 && state.resendTimer) { clearInterval(state.resendTimer); state.resendTimer = null; }
  };
  const startResendCooldown = seconds => {
    const duration = Math.min(86400, Math.max(0, Math.ceil(Number(seconds) || 0)));
    if (!state.verification) return;
    state.verification.resendUntil = Date.now() + duration * 1000;
    if (state.resendTimer) clearInterval(state.resendTimer);
    state.resendTimer = duration > 0 ? setInterval(updateResendCooldown, 1000) : null;
    updateResendCooldown();
  };
  const clearResendCooldown = () => {
    if (state.resendTimer) clearInterval(state.resendTimer);
    state.resendTimer = null;
    if (state.verification) state.verification.resendUntil = 0;
    updateResendCooldown();
  };

  const clearTelegramTimer = () => {
    if (state.telegramTimer) clearInterval(state.telegramTimer);
    state.telegramTimer = null;
  };
  const clearOwnershipTimer = () => {
    if (state.ownershipTimer) clearInterval(state.ownershipTimer);
    state.ownershipTimer = null;
  };
  const telegramResendRemaining = () => Math.max(0, Math.ceil((Number(state.telegram?.resendUntil || 0) - Date.now()) / 1000));
  const renderTelegramDigits = () => {
    const input = $('#ah-telegram-code');
    const value = String(input?.value || '').replace(/\D/g, '').slice(0, 6);
    if (input && input.value !== value) input.value = value;
    pageHost.querySelectorAll('[data-otp-digit]').forEach((box, index) => {
      box.textContent = value[index] || '';
      box.classList.toggle('filled', index < value.length);
      box.classList.toggle('next', index === value.length);
    });
  };
  const renderTelegramState = (mode = state.telegram?.mode || 'waiting') => {
    const view = $('[data-view="telegram"]');
    const status = $('[data-role="telegram-status"]');
    const resend = $('[data-role="telegram-resend"]');
    const verify = $('[data-role="telegram-verify"]');
    if (!view || !status || !resend || !verify || !state.telegram) return;
    const expired = Number(state.telegram.expiresAt || 0) > 0 && Date.now() >= Number(state.telegram.expiresAt);
    const remaining = telegramResendRemaining();
    const nextMode = expired && !['success', 'locked'].includes(mode) ? 'expired' : mode;
    state.telegram.mode = nextMode;
    view.dataset.state = nextMode;
    const labels = {
      connecting: 'নিরাপদ Telegram সংযোগ তৈরি হচ্ছে…',
      waiting: state.telegram.codeSent
        ? 'Telegram-এ কোড পাঠানো হয়েছে। সর্বশেষ ৬ সংখ্যার কোডটি লিখুন।'
        : 'Bot-এ START চাপুন, তারপর পাওয়া কোডটি এখানে লিখুন।',
      checking: 'কোডটি নিরাপদভাবে যাচাই হচ্ছে…',
      wrong: 'কোডটি সঠিক নয়-Telegram-এর সর্বশেষ ৬ সংখ্যার কোড লিখুন।',
      expired: 'এই কোডের সময় শেষ। নিচে “নতুন কোড নিন” চাপুন।',
      locked: 'অনেকবার ভুল কোড দেওয়া হয়েছে। নিরাপত্তার জন্য সাময়িকভাবে বন্ধ আছে।',
      conflict: 'এই Telegram accountটি অন্য Admission Hub account-এর সঙ্গে আগে থেকেই যুক্ত।',
      unavailable: 'Telegram যাচাই এখন সাময়িকভাবে পাওয়া যাচ্ছে না। ইমেইল ব্যবহার করুন।',
      success: 'Telegram account যাচাই সফল হয়েছে।'
    };
    status.textContent = labels[nextMode] || labels.waiting;
    resend.disabled = state.busy || remaining > 0;
    resend.textContent = remaining > 0
      ? `নতুন কোড (${remaining.toLocaleString('bn-BD')} সেকেন্ড পর)`
      : 'নতুন কোড নিন';
    verify.disabled = state.busy || ['expired', 'locked', 'conflict', 'unavailable', 'success'].includes(nextMode);
  };
  const setTelegramChallenge = info => {
    const hasLink = info?.interaction?.type === 'telegram-link' && Boolean(info?.interaction?.url);
    if (!info?.attemptId || (!hasLink && info?.codeSent !== true)) return false;
    clearTelegramTimer();
    state.telegram = {
      attemptId: info.attemptId,
      interaction: hasLink ? info.interaction : null,
      codeSent: info.codeSent === true,
      expiresAt: Number(info.expiresAt || 0),
      resendUntil: Number(info.resendAt || 0) > Date.now()
        ? Number(info.resendAt)
        : Date.now() + Math.max(0, Number(info.resendAfter || 0)) * 1000,
      mode: 'waiting'
    };
    const link = $('[data-role="telegram-link"]');
    link.hidden = !hasLink;
    if (hasLink) link.href = info.interaction.url;
    else link.removeAttribute('href');
    link.dataset.label = 'Official Telegram Bot খুলুন';
    link.textContent = link.dataset.label;
    $('#ah-telegram-code').value = '';
    renderTelegramDigits();
    renderTelegramState('waiting');
    state.telegramTimer = setInterval(() => {
      renderTelegramState();
      if (state.telegram?.mode === 'expired' && telegramResendRemaining() === 0) clearTelegramTimer();
    }, 1000);
    return true;
  };

  const accountVerified = session => Boolean(
    session?.authenticated && (session?.accountVerified === true || session?.emailVerified === true || session?.telegramVerified === true)
  );

  const notify = () => {
    const detail = Object.freeze({
      authenticated: accountVerified(state.session),
      accountVerified: accountVerified(state.session),
      guest: entryMode() === 'guest' && !accountVerified(state.session),
      emailVerified: Boolean(state.session?.emailVerified),
      telegramVerified: Boolean(state.session?.telegramVerified),
      user: state.session?.user || null
    });
    window.dispatchEvent(new CustomEvent('admissionhub:authchange', { detail }));
  };

  const setBusy = busy => {
    state.busy = Boolean(busy);
    $('.ah-account-shell')?.setAttribute('aria-busy', state.busy ? 'true' : 'false');
    pageHost.querySelectorAll('button,input,select').forEach(element => {
      if (state.busy) {
        if (!element.disabled) { element.dataset.ahBusyDisabled = 'true'; element.disabled = true; }
      } else if (element.dataset.ahBusyDisabled === 'true') {
        element.disabled = false;
        delete element.dataset.ahBusyDisabled;
      }
    });
    pageHost.querySelectorAll('.ah-account-primary').forEach(button => {
      const isActive = button.closest('.ah-account-view:not([hidden])');
      if (button.classList.contains('ah-entry-signup')) return;
      if (!button.dataset.label) button.dataset.label = button.textContent;
      button.innerHTML = state.busy && isActive ? '<span class="ah-account-spinner" aria-hidden="true"></span>অপেক্ষা করুন…' : button.dataset.label;
    });
    updateResendCooldown();
    if (state.telegram) renderTelegramState();
  };

  const renderPasskeys = () => {
    const list = $('[data-role="passkey-list"]');
    const status = $('[data-role="passkey-status"]');
    if (!list || !status) return;
    list.textContent = '';
    status.textContent = state.passkeys.length
      ? `${state.passkeys.length.toLocaleString('bn-BD')}টি Passkey যুক্ত আছে। Passkey কখনো বাধ্যতামূলক নয়।`
      : 'এই ডিভাইসে দ্রুত প্রবেশ চালু করতে পারেন। Passkey বাধ্যতামূলক নয়।';
    state.passkeys.forEach((credential, index) => {
      const row = document.createElement('div');
      row.className = 'ah-account-passkey-row';
      const label = document.createElement('span');
      label.textContent = `Passkey ${Number(index + 1).toLocaleString('bn-BD')}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ah-account-link';
      remove.dataset.credentialId = credential.id;
      remove.textContent = 'সরান';
      remove.addEventListener('click', () => removePasskey(credential.id));
      row.append(label, remove);
      list.append(row);
    });
  };

  const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const safeStudentText = value => String(value || '')
    .replace(/\bFirebase\b/gi, 'account system')
    .replace(/\bbackend\b/gi, 'Admission Hub')
    .replace(/\bAPI(?:\s+key)?\b/gi, 'নিরাপত্তার তথ্য')
    .replace(/\bprovider\b/gi, 'service')
    .replace(/\btoken\b/gi, 'নিরাপত্তার তথ্য')
    .replace(/\bwebhook\b|\bSMTP\b|\bquota\b|\bdatabase\b/gi, 'service');

  const friendlyError = error => {
    if (typeof error?.userMessage === 'string' && error.userMessage.trim()) return error.userMessage.trim();
    if (!error?.code && typeof error?.message === 'string' && /[\u0980-\u09FF]/.test(error.message)) return error.message;
    const known = {
      ACCOUNT_LINK_REQUIRED: 'এই ইমেইলে আগে ইমেইল-পাসওয়ার্ড দিয়ে অ্যাকাউন্ট খোলা হয়েছে, ইমেইল ও পাসওয়ার্ড দিয়ে সাইন ইন করো।',
      CLIENT_UPDATE_REQUIRED: 'Admission Hub-এর নতুন সংস্করণ এসেছে, পেজটি একবার refresh করে আবার চেষ্টা করো।',
      INVALID_CREDENTIALS: 'Email বা Password সঠিক নয়। আবার দেখে লিখো।',
      HUMAN_CHECK_FAILED: 'মানব যাচাই সম্পন্ন হয়নি। পেজটি একবার রিফ্রেশ করে আবার চেষ্টা করো; তারপরেও না হলে ব্রাউজারের বিজ্ঞাপন ব্লকার বন্ধ করো।',
      EMAIL_ALREADY_IN_USE: 'এই Email-এ account আছে-Log In করো।',
      DISPOSABLE_EMAIL: 'এই ইমেইলে কোড পাঠানো সম্ভব না। শুধু Gmail, Yahoo, iCloud, Hotmail বা Outlook ইমেইল ব্যবহার করো।',
      EMAIL_NOT_VERIFIED: 'Account verification এখনো শেষ হয়নি।',
      WEAK_PASSWORD: 'কমপক্ষে ৮ অক্ষরের একটু শক্তিশালী Password দাও।',
      RATE_LIMITED: 'অনেকবার চেষ্টা হয়েছে, একটু অপেক্ষা করে আবার চেষ্টা করো।',
      VERIFICATION_UNAVAILABLE: 'Verification এখন শুরু করা যাচ্ছে না। কিছু পাঠানো হয়নি, একটু পরে আবার চেষ্টা করো।',
      TELEGRAM_VERIFICATION_UNAVAILABLE: 'Telegram verification এখন পাওয়া যাচ্ছে না-Email ব্যবহার করো।',
      SESSION_INVALID: 'নিরাপদ প্রবেশের সময় শেষ হয়েছে, আবার Log In করো।',
      PASSKEY_UNAVAILABLE: 'এই device-এ Passkey এখন পাওয়া যাচ্ছে না, অন্য পথ ব্যবহার করো।',
      ACCOUNT_CONFLICT: 'এই পরিচয়টি অন্য account-এর সঙ্গে যুক্ত। নিরাপত্তার জন্য প্রবেশ বন্ধ রাখা হয়েছে।',
      OTP_INVALID: 'কোডটি সঠিক নয়-আবার লিখে দেখো।',
      CHALLENGE_INVALID: 'Verificationটি সঠিক নয় বা সময় শেষ, আবার চেষ্টা করো।',
      RESEND_COOLDOWN: 'নতুন code পাঠাতে একটু অপেক্ষা করতে হবে, কিছুক্ষণ পরে আবার চেষ্টা করো।',
      OTP_EXPIRED: 'কোডের সময় শেষ হয়ে গেছে, নতুন code নাও।',
      OTP_LOCKED: 'অনেকবার ভুল কোড দেওয়া হয়েছে, একটু অপেক্ষা করে নতুন code নাও।',
      OTP_USED: 'এই কোডটি আগেই ব্যবহার হয়েছে, নতুন code নাও।',
      DELIVERY_UNAVAILABLE: 'এখন Email পাঠানো যাচ্ছে না, একটু পরে আবার চেষ্টা করো।',
      BACKUP_UNAVAILABLE: 'এই যাচাইয়ের পথটি এখন বন্ধ আছে, একটু পরে আবার চেষ্টা করো।',
      AUTH_PROVIDER_UNAVAILABLE: 'Account সেবাটি সাময়িকভাবে ব্যস্ত, একটু পরে আবার চেষ্টা করো।',
      STORAGE_UNAVAILABLE: 'Account সেবাটি সাময়িকভাবে ব্যস্ত, একটু পরে আবার চেষ্টা করো।',
      TELEGRAM_VERIFICATION_INVALID: 'Verification session-এর সময় শেষ, আবার Sign Up বা Log In করো।',
      PROFILE_VERSION_CONFLICT: 'Profile একই সময়ে অন্য জায়গা থেকে বদলেছে, আবার দেখে সংরক্ষণ করো।',
      ENDPOINT_UNAVAILABLE: 'এই লিংকে account সেবা নেই, অ্যাপের মূল ঠিকানা খুলে আবার চেষ্টা করো।',
      ORIGIN_FORBIDDEN: 'এই ঠিকানা থেকে account কাজ করছে না, অ্যাপের মূল লিংক থেকে আবার চেষ্টা করো।',
      NOT_CONFIGURED: 'Account সেবাটি এখনো প্রস্তুত নয়-একটু পরে আবার চেষ্টা করো।',
    };
    if (known[error?.code]) return known[error.code];
    if (error?.status === 0) return 'ইন্টারনেট সংযোগ পাওয়া যাচ্ছে না, সংযোগ ঠিক হলে আবার চেষ্টা করো।';
    // A named reason from the API beats the generic banner: the server already
    // says in Bengali which step failed, so the user is not left guessing.
    if (typeof error?.serverMessage === 'string' && error.serverMessage.trim()) return error.serverMessage.trim();
    return 'সাময়িক সমস্যা হয়েছে, একটু পরে আবার চেষ্টা করো।';
  };

  const navigateDashboard = () => {
    try {
      if (typeof window.navigate === 'function') window.navigate('dashboard');
      else {
        location.hash = 'dashboard';
        if (window.Router) window.Router.path = 'dashboard';
        if (typeof window.render === 'function') window.render();
      }
    } catch (_) {}
    document.dispatchEvent(new CustomEvent('admissionhub:entry-complete', {
      detail: Object.freeze({ mode: entryMode() || 'guest', destination: 'dashboard' })
    }));
  };

  const PENDING_SIGNUP_COOKIE = 'ah_signup_pending_v1';
  const pendingSignupMode = () => {
    const row = String(document.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${PENDING_SIGNUP_COOKIE}=`));
    const value = row ? decodeURIComponent(row.slice(row.indexOf('=') + 1)) : '';
    if (value === '1') return 'select';
    return ['select', 'email', 'telegram', 'email-ownership'].includes(value) ? value : '';
  };
  const pendingSignup = () => Boolean(pendingSignupMode());
  const rememberPendingSignup = (active, mode = 'select') => {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    const value = active && ['select', 'email', 'telegram', 'email-ownership'].includes(mode) ? mode : '';
    document.cookie = `${PENDING_SIGNUP_COOKIE}=${value}; Path=/; Max-Age=${active ? 3600 : 0}; SameSite=Lax${secure}`;
  };

  const EN_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const populateDob = () => {
    const day = $('#ah-dob-day');
    const month = $('#ah-dob-month');
    const year = $('#ah-dob-year');
    if (!day || day.options.length > 1) return;
    day.add(new Option('-', ''));
    month.add(new Option('-', ''));
    year.add(new Option('-', ''));
    for (let value = 1; value <= 31; value += 1) day.add(new Option(String(value), String(value)));
    EN_MONTHS.forEach((label, index) => month.add(new Option(label, String(index + 1))));
    const current = new Date().getFullYear();
    for (let value = current - 8; value >= current - 60; value -= 1) year.add(new Option(String(value), String(value)));
  };

  const syncDobDays = () => {
    const day = $('#ah-dob-day');
    const month = Number($('#ah-dob-month')?.value || 0);
    const year = Number($('#ah-dob-year')?.value || 0);
    if (!day) return;
    const previous = Number(day.value || 0);
    const maximum = month && year ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 31;
    if (day.options.length !== maximum + 1) {
      day.textContent = '';
      day.add(new Option('-', ''));
      for (let value = 1; value <= maximum; value += 1) day.add(new Option(String(value), String(value)));
      day.value = previous > 0 && previous <= maximum ? String(previous) : '';
    }
  };

  const selectedDob = () => {
    const day = Number($('#ah-dob-day')?.value || 0);
    const month = Number($('#ah-dob-month')?.value || 0);
    const year = Number($('#ah-dob-year')?.value || 0);
    if (!day || !month || !year) return '';
    const value = new Date(Date.UTC(year, month - 1, day));
    if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day || value.getTime() > Date.now()) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const updateDobPreview = () => {
    const dob = selectedDob();
    const label = dob
      ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${dob}T00:00:00Z`))
      : 'Select your date of birth';
    pageHost.querySelectorAll('[data-role="dob-preview"]').forEach(output => { output.textContent = label; });
  };

  const setupDobDropdowns = () => {
    populateDob();
    updateDobPreview();
    pageHost.querySelectorAll('#ah-dob-day').forEach(select => select.addEventListener('change', () => {
      syncDobDays();
      updateDobPreview();
    }));
    pageHost.querySelectorAll('#ah-dob-month,#ah-dob-year').forEach(select => select.addEventListener('change', () => {
      syncDobDays();
      updateDobPreview();
    }));
  };

  const normalizeInstitutionText = value => String(value || '').normalize('NFKC').toLocaleLowerCase('bn-BD')
    .replace(/[’‘`´]/g, "'").replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

  const buildInstitutionIndex = () => {
    if (state.institutionIndex) return state.institutionIndex;
    const source = Array.isArray(window.AdmissionHubInstitutionsV1) ? window.AdmissionHubInstitutionsV1 : [];
    const rows = source.map(item => {
      const search = normalizeInstitutionText([item.name, item.district, ...(item.aliases || [])].join(' '));
      return Object.freeze({ ...item, search, tokens: Object.freeze(search.split(' ').filter(Boolean)) });
    });
    const prefixes = new Map();
    rows.forEach((row, index) => row.tokens.forEach(token => {
      const max = Math.min(18, token.length);
      for (let size = 1; size <= max; size += 1) {
        const prefix = token.slice(0, size);
        if (!prefixes.has(prefix)) prefixes.set(prefix, new Set());
        prefixes.get(prefix).add(index);
      }
    }));
    state.institutionIndex = Object.freeze({ rows: Object.freeze(rows), prefixes });
    return state.institutionIndex;
  };

  const institutionMatches = (query, kind) => {
    const normalized = normalizeInstitutionText(query);
    if (normalized.length < 2) return [];
    const index = buildInstitutionIndex();
    const queryTokens = normalized.split(' ').filter(Boolean);
    const candidateSets = queryTokens.map(token => index.prefixes.get(token.slice(0, 18))).filter(Boolean);
    let candidates = candidateSets.length ? [...candidateSets[0]] : index.rows.map((_, rowIndex) => rowIndex);
    for (const set of candidateSets.slice(1)) candidates = candidates.filter(rowIndex => set.has(rowIndex));
    const accepts = row => kind === 'school' ? ['school', 'both'].includes(row.type) : ['higher', 'both'].includes(row.type);
    return candidates.map(rowIndex => index.rows[rowIndex]).filter(accepts).filter(row => queryTokens.every(token => row.search.includes(token)))
      .map(row => ({ row, score: row.search.startsWith(normalized) ? 0 : row.tokens.some(token => token.startsWith(normalized)) ? 1 : 2 }))
      .sort((a, b) => a.score - b.score || a.row.name.localeCompare(b.row.name, 'en'))
      .slice(0, 3).map(item => item.row);
  };

  const closeInstitutionResults = kind => {
    const input = kind === 'school' ? $('#ah-signup-school') : $('#ah-signup-college');
    const results = kind === 'school' ? $('#ah-school-results') : $('#ah-college-results');
    if (results) { results.hidden = true; results.textContent = ''; }
    if (input) input.setAttribute('aria-expanded', 'false');
  };

  // Education step (school / college), code-native option rows: an icon chip, the
  // institution name, a "type · district" line and a selection circle on the right.
  const INSTITUTION_ICONS = Object.freeze({
    school: '<svg viewBox="0 0 24 24" fill="none"><path d="m4 10.5 8-6 8 6"/><path d="M6 10v10h12V10"/><path d="M12 4.5V6"/><path d="M10 20v-5h4v5"/></svg>',
    higher: '<svg viewBox="0 0 24 24" fill="none"><path d="m3 9.2 9-4.2 9 4.2-9 4.2-9-4.2Z"/><path d="M7.5 11.4V16c3 2.2 6 2.2 9 0v-4.6"/><path d="M20 10.2v5"/></svg>',
    manual: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 6.5v11"/><path d="M6.5 12h11"/></svg>'
  });

  const institutionKindOf = item => {
    if (!item) return 'manual';
    if (item.type === 'school') return 'school';
    return /university|বিশ্ববিদ্যালয়/i.test(item.name) ? 'university' : 'college';
  };

  // School step keeps the English type word, college step uses the Bengali type word
  // (matches the two reference screens the owner supplied on 2026-09-14).
  const institutionTypeLabel = (item, panelKind = 'school') => {
    const kind = institutionKindOf(item);
    const bengali = panelKind === 'college';
    if (kind === 'university') return bengali ? 'বিশ্ববিদ্যালয়' : 'University';
    if (kind === 'school') return bengali ? 'স্কুল' : 'School';
    const isCollege = item.type !== 'both' || /college/i.test(item.name);
    if (bengali) return isCollege ? 'কলেজ' : 'স্কুল ও কলেজ';
    return isCollege ? 'College' : 'School & College';
  };

  const buildInstitutionOption = ({ iconKind, name, meta, manual = false, selected = false }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ah-institution-option${manual ? ' manual' : ''}${selected ? ' is-selected' : ''}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    const chip = document.createElement('span');
    chip.className = 'ah-institution-chip';
    chip.setAttribute('aria-hidden', 'true');
    const icon = { school: INSTITUTION_ICONS.school, college: INSTITUTION_ICONS.higher, university: INSTITUTION_ICONS.higher }[iconKind];
    chip.innerHTML = icon || INSTITUTION_ICONS.manual;
    const text = document.createElement('span');
    text.className = 'ah-institution-text';
    const strong = document.createElement('strong');
    strong.textContent = name;
    const small = document.createElement('small');
    small.textContent = meta;
    text.append(strong, small);
    const check = document.createElement('span');
    check.className = 'ah-institution-check';
    check.setAttribute('aria-hidden', 'true');
    button.append(chip, text, check);
    return button;
  };

  const renderInstitutionResults = (kind, query) => {
    const input = kind === 'school' ? $('#ah-signup-school') : $('#ah-signup-college');
    const results = kind === 'school' ? $('#ah-school-results') : $('#ah-college-results');
    if (!input || !results) return;
    const trimmed = String(query || '').trim();
    if (trimmed.length < 2) return closeInstitutionResults(kind);
    const matches = institutionMatches(trimmed, kind);
    results.textContent = '';
    const choose = item => {
      const manual = item === null;
      const value = manual ? trimmed.slice(0, 120) : item.name;
      input.value = value;
      input.dataset.institutionId = manual ? 'manual' : item.id;
      state.institutionSelection[kind] = Object.freeze({ id: manual ? 'manual' : item.id, name: value, district: manual ? '' : item.district });
      closeInstitutionResults(kind);
      input.focus();
    };
    matches.forEach(item => {
      const option = buildInstitutionOption({
        iconKind: institutionKindOf(item),
        name: item.name,
        meta: `${institutionTypeLabel(item, kind)} · ${item.district}`,
        selected: input.dataset.institutionId === item.id
      });
      option.dataset.institutionType = institutionKindOf(item);
      option.addEventListener('pointerdown', event => event.preventDefault());
      option.addEventListener('click', () => choose(item));
      results.append(option);
    });
    const manual = buildInstitutionOption({
      iconKind: 'manual',
      name: `“${trimmed.slice(0, 70)}”`,
      meta: 'নিজের লেখা ব্যবহার করুন',
      manual: true,
      selected: input.dataset.institutionId === 'manual'
    });
    manual.addEventListener('pointerdown', event => event.preventDefault());
    manual.addEventListener('click', () => choose(null));
    results.append(manual);
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const setupEducationAssist = () => {
    pageHost.querySelectorAll('[data-role="education-help"]').forEach(button => {
      const card = button.getAttribute('aria-controls') ? document.getElementById(button.getAttribute('aria-controls')) : null;
      button.addEventListener('click', () => {
        const open = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', String(!open));
        if (card) card.hidden = open;
      });
    });
  };

  // Reference auth screens (v254): one generic toggle for every code-native help
  // card on the login / verify / email / telegram / passkey screens. Plain div
  // show/hide only - no dialog semantics, no network call, no AI routing.
  const setupHelpToggles = () => {
    pageHost.querySelectorAll('[data-help-toggle]').forEach(button => button.addEventListener('click', () => {
      const card = button.getAttribute('aria-controls') ? document.getElementById(button.getAttribute('aria-controls')) : null;
      if (!card) return;
      const willOpen = card.hidden;
      card.hidden = !willOpen;
      pageHost.querySelectorAll('[data-help-toggle="' + button.dataset.helpToggle + '"]').forEach(peer => peer.setAttribute('aria-expanded', String(willOpen)));
    }));
  };

  // "Remember me" keeps the email only in page memory (this tab session).
  // Browser-persisted credential stores stay forbidden for client code
  // (see the native-auth-protection guard).
  let rememberedEmail = '';
  const prefillRememberedEmail = () => {
    const input = $('#ah-login-email');
    if (rememberedEmail && input && !input.value) input.value = rememberedEmail;
  };

  const setupInstitutionSearch = kind => {
    const input = kind === 'school' ? $('#ah-signup-school') : $('#ah-signup-college');
    const results = kind === 'school' ? $('#ah-school-results') : $('#ah-college-results');
    if (!input || !results) return;
    let timer = 0;
    input.addEventListener('input', () => {
      state.institutionSelection[kind] = null;
      delete input.dataset.institutionId;
      clearTimeout(timer);
      timer = setTimeout(() => renderInstitutionResults(kind, input.value), 170);
    });
    input.addEventListener('focus', () => { if (input.value.trim().length >= 2) renderInstitutionResults(kind, input.value); });
    input.addEventListener('blur', () => setTimeout(() => closeInstitutionResults(kind), 120));
    const keyboard = event => {
      const options = [...results.querySelectorAll('[role="option"]')];
      if (!options.length || results.hidden) return;
      const active = document.activeElement;
      const index = options.indexOf(active);
      if (event.key === 'ArrowDown') { event.preventDefault(); (options[Math.min(options.length - 1, index + 1)] || options[0]).focus(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); (options[Math.max(0, index - 1)] || options[options.length - 1]).focus(); }
      else if (event.key === 'Escape') { event.preventDefault(); closeInstitutionResults(kind); input.focus(); }
    };
    input.addEventListener('keydown', keyboard);
    results.addEventListener('keydown', keyboard);
  };

  const normalizedName = () => $('#ah-signup-name')?.value.trim().replace(/\s+/g, ' ') || '';
  const normalizedMobile = () => $('#ah-signup-mobile')?.value.trim().replace(/[\s()-]/g, '') || '';
  const validName = value => value.length >= 2 && value.length <= 80 && /^[\p{L}\p{M} .'-]+$/u.test(value) && (value.match(/\p{L}/gu) || []).length >= 2;
  const showFieldFeedback = (role, text, kind = '') => {
    const node = $(`[data-role="${role}"]`);
    if (!node) return;
    node.textContent = text;
    node.classList.toggle('valid', kind === 'valid');
    node.classList.toggle('error', kind === 'error');
  };

  const updatePasswordFeedback = () => {
    const password = $('#ah-signup-password')?.value || '';
    const confirm = $('#ah-signup-confirm')?.value || '';
    let score = 0;
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[^\p{L}\p{N}\s]/u.test(password)) score += 1;
    const labels = ['আরও কিছু অক্ষর দাও','শুরু হয়েছে','মোটামুটি','ভালো','শক্তিশালী','খুব শক্তিশালী'];
    const meter = $('[data-role="password-meter"]');
    if (meter) {
      meter.style.width = `${Math.min(100, score * 20)}%`;
      meter.style.background = score >= 4 ? '#14a879' : score >= 2 ? '#e4a620' : '#d45a49';
    }
    const ruleState = {
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      number: /\d/.test(password)
    };
    pageHost.querySelectorAll('[data-password-rule]').forEach(rule => rule.classList.toggle('met', Boolean(ruleState[rule.dataset.passwordRule])));
    showFieldFeedback('password-strength', password ? `Strength: ${labels[score]}` : 'কমপক্ষে ৮ অক্ষর ব্যবহার করো', score >= 4 ? 'valid' : '');
    showFieldFeedback('password-match', !confirm ? '' : password === confirm ? '✓ দুইটি Password মিলেছে' : 'Password দুইটি মিলছে না', password === confirm && confirm ? 'valid' : confirm ? 'error' : '');
  };

  const validateDob = () => {
    if (!selectedDob()) { message('Please select your full date of birth.', 'error'); $('#ah-dob-day')?.focus(); return false; }
    return true;
  };

  const validatePersonal = () => {
    const name = normalizedName();
    if (!validName(name)) { showFieldFeedback('name-feedback', 'Please enter at least 2 characters.', 'error'); $('#ah-signup-name')?.focus(); return false; }
    showFieldFeedback('name-feedback', '✓ Looks good, your name is set', 'valid');
    const mobileVal = normalizedMobile();
    const mobileOk = !mobileVal || /^\+?[0-9]{8,15}$/.test(mobileVal);
    showFieldFeedback('mobile-feedback', mobileOk ? (mobileVal ? '✓ Mobile saved to profile' : '') : 'Mobile number not valid.', mobileOk ? (mobileVal ? 'valid' : '') : 'error');
    if (!mobileOk) { $('#ah-signup-mobile')?.focus(); return false; }
    return validateDob();
  };

  const validateSchool = () => {
    const school = $('#ah-signup-school');
    if (!school?.value.trim()) { message('তোমার School-এর নাম লিখো।', 'error'); school?.focus(); return false; }
    if (!state.institutionSelection.school || state.institutionSelection.school.name !== school.value.trim()) {
      renderInstitutionResults('school', school.value);
      message('Suggestion থেকে School বেছে নাও, অথবা নিজের লেখা ব্যবহার করো।', 'error');
      school.focus();
      return false;
    }
    return true;
  };

  const validateCollege = () => {
    const college = $('#ah-signup-college');
    if (college?.value.trim() && (!state.institutionSelection.college || state.institutionSelection.college.name !== college.value.trim())) {
      renderInstitutionResults('college', college.value);
      message('Suggestion থেকে College/University বেছে নাও, অথবা নিজের লেখা ব্যবহার করো।', 'error');
      college.focus();
      return false;
    }
    return true;
  };

  const validateEducation = () => validateSchool() && validateCollege();

  const validateSecurity = () => {
    const email = $('#ah-signup-email');
    const password = $('#ah-signup-password')?.value || '';
    const confirm = $('#ah-signup-confirm')?.value || '';
    if (!email?.value.trim() || !email.checkValidity()) { message('সঠিক Email address লিখো।', 'error'); email?.focus(); return false; }
    // Owner order 2026-10-16: a throwaway inbox is refused at the field. The
    // Worker refuses POST /signup too, so this is only the earlier, friendlier
    // message; the list ships in email-policy-client.js.
    if (window.ADMISSION_HUB_isDisposableEmail?.(email.value.trim())) {
      message(window.ADMISSION_HUB_DISPOSABLE_EMAIL_MESSAGE || 'এই ইমেইল সেবাটি দিয়ে অ্যাকাউন্ট খোলা যায় না, একটি স্থায়ী ইমেইল ব্যবহার করুন।', 'error');
      email.focus(); return false;
    }
    if (password.length < 8) { message('কমপক্ষে ৮ অক্ষরের Password দাও।', 'error'); $('#ah-signup-password')?.focus(); return false; }
    if (!/[A-Z]/.test(password)) { message('Password-এ অন্তত একটি বড় English অক্ষর দাও।', 'error'); $('#ah-signup-password')?.focus(); return false; }
    if (!/\d/.test(password)) { message('Password-এ অন্তত একটি সংখ্যা দাও।', 'error'); $('#ah-signup-password')?.focus(); return false; }
    if (password !== confirm) { message('Password দুইটি মিলছে না।', 'error'); $('#ah-signup-confirm')?.focus(); return false; }
    return true;
  };

  const focusWhenUnclaimed = (target, delay = 35) => setTimeout(() => {
    const node = typeof target === 'function' ? target() : target;
    const active = document.activeElement;
    if (!node || node.closest('[hidden]')) return;
    if (!active || active === document.body || !pageHost.contains(active) || active.closest('[hidden]')) node.focus();
  }, delay);

  const setSignupStep = (requestedStep, { validate = false } = {}) => {
    const step = requestedStep === 'education' ? 'school' : requestedStep;
    const order = ['personal', 'school', 'college', 'security'];
    if (!order.includes(step)) return false;
    const currentStep = order.includes(state.signupStep) ? state.signupStep : 'personal';
    const currentIndex = order.indexOf(currentStep);
    const nextIndex = order.indexOf(step);
    const validators = { personal: validatePersonal, school: validateSchool, college: validateCollege };
    if (validate && nextIndex > currentIndex) {
      for (let index = currentIndex; index < nextIndex; index += 1) {
        if (validators[order[index]] && !validators[order[index]]()) return false;
      }
    }
    state.signupStep = step;
    const signupShell = $('.ah-account-shell');
    const signupView = $('[data-view="signup"]');
    if (signupShell) signupShell.dataset.signupStep = step;
    if (signupView) signupView.dataset.signupCurrentStep = step;
    pageHost.querySelectorAll('[data-signup-panel]').forEach(panel => { panel.hidden = panel.dataset.signupPanel !== step; });
    const stage = step === 'personal' ? 'personal' : ['school', 'college'].includes(step) ? 'education' : 'security';
    const stages = ['personal', 'education', 'security'];
    const stageIndex = stages.indexOf(stage);
    pageHost.querySelectorAll('[data-signup-step-button]').forEach(button => {
      const index = stages.indexOf(button.dataset.signupStepButton);
      button.classList.toggle('active', button.dataset.signupStepButton === stage);
      button.classList.toggle('done', index < stageIndex);
      button.setAttribute('aria-current', button.dataset.signupStepButton === stage ? 'step' : 'false');
    });
    message();
    const focus = {
      personal: null,
      school: $('#ah-signup-school'),
      college: $('#ah-signup-college'),
      security: $('#ah-signup-email')
    }[step];
    focusWhenUnclaimed(focus);
    if (state.currentView === 'signup' && !/jsdom/i.test(navigator.userAgent || '')) requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
    return true;
  };

  const collectProfile = () => Object.freeze({
    fullName: normalizedName(),
    mobile: normalizedMobile(),
    dob: selectedDob(),
    school: Object.freeze({ ...state.institutionSelection.school }),
    higherInstitution: state.institutionSelection.college ? Object.freeze({ ...state.institutionSelection.college }) : null
  });

  const syncPendingProfile = async ({ pending = false } = {}) => {
    if (!state.pendingProfile || !state.profileBound || state.profileSynced) return false;
    if (state.profileSyncPromise) return state.profileSyncPromise;
    if (pending && state.profilePendingAttempted) return false;
    if (pending) state.profilePendingAttempted = true;
    state.profileSyncPromise = (async () => {
      try {
        const result = await api(pending ? '/profile/pending' : '/profile', {
          method: 'POST',
          body: state.pendingProfile,
          timeoutMs: pending ? 6000 : 10000
        });
        state.profileSynced = result?.saved === true;
        if (state.profileSynced) {
          document.dispatchEvent(new CustomEvent('admissionhub:profile-ready', { detail: state.pendingProfile }));
        } else if (pending) {
          state.profilePendingAttempted = false;
        }
        return state.profileSynced;
      } catch (_) {
        // A failed write must not burn the one-shot guard. The signup details
        // live only in memory, so a transient failure here would otherwise
        // strand them forever; a later verification step has to be able to
        // retry. The in-flight promise above still blocks duplicate writes.
        if (pending) state.profilePendingAttempted = false;
        return false;
      }
      finally { state.profileSyncPromise = null; }
    })();
    return state.profileSyncPromise;
  };

  const refreshProfileReadiness = async () => {
    let ready = state.profileSynced;
    if (!ready && state.pendingProfile && state.profileBound) ready = await syncPendingProfile();
    if (!ready) {
      try { ready = Boolean((await api('/profile'))?.profile); } catch (_) {}
    }
    const row = $('[data-role="ready-profile"]');
    if (row) row.textContent = ready ? '✓ Profile Created' : '• Profile details পরে সম্পূর্ণ করা যাবে';
  };

  const showReadyTransition = () => {
    rememberPendingSignup(false);
    showView('success');
    refreshProfileReadiness();
  };

  const renderCreatedSummary = () => {
    const profile = state.pendingProfile || {};
    const set = (role, value) => {
      const node = pageHost.querySelector(`[data-role="${role}"]`);
      if (node) node.textContent = value && String(value).trim() ? String(value).trim() : '-';
    };
    const dobLabel = profile.dob
      ? new Intl.DateTimeFormat('bn-BD', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${profile.dob}T00:00:00Z`))
      : selectedDob()
        ? new Intl.DateTimeFormat('bn-BD', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${selectedDob()}T00:00:00Z`))
        : '';
    set('created-name', profile.fullName || normalizedName());
    set('created-dob', dobLabel);
    set('created-school', profile.school?.name || state.institutionSelection.school?.name);
    set('created-college', profile.higherInstitution?.name || state.institutionSelection.college?.name || 'এখন পড়ছ না');
    set('created-email', state.verification?.emailMasked || state.verification?.email || '');
  };

  let skyRouteHook = null;
  const SKY_ROUTED_VIEWS = new Set(['login', 'signup', 'forgot', 'verify', 'telegram', 'email-ownership', 'email-intro', 'telegram-intro', 'created', 'google-link', 'whatsapp-info']);
  /* Owner 2026-10-16: the old sign-in / sign-up screens are retired. Every entry
   * view opens the Admission Sky flow; renderView only draws them in the bare
   * test harness, where sky-onboarding.js is not on the page. */
  const showView = (name, keepMessage = false) => {
    if (SKY_ROUTED_VIEWS.has(name) && skyRouteHook && skyRouteHook(name)) return;
    return renderView(name, keepMessage);
  };
  const renderView = (name, keepMessage = false) => {
    state.currentView = name;
    const shell = $('.ah-account-shell');
    pageHost.dataset.currentView = name;
    if (shell) shell.dataset.currentView = name;
    pageHost.querySelectorAll('[data-view]').forEach(view => { view.hidden = view.dataset.view !== name; });
    const closeButton = $('[data-role="close"]');
    if (closeButton) {
      closeButton.hidden = name === 'welcome';
      closeButton.setAttribute('aria-label', name === 'signup' ? 'পেছনে যান' : 'বন্ধ করুন');
    }
    if (!keepMessage) message();
    const body = $('.ah-account-body');
    if (body) body.scrollTop = 0;
    if (name === 'login') {
      prefillRememberedEmail();
      focusWhenUnclaimed(() => $('#ah-login-email'), 30);
    }
    if (name === 'signup') {
      populateDob();
      setSignupStep(state.signupStep || 'personal');
      updateDobPreview();
    }
    if (name === 'created') {
      renderCreatedSummary();
      // keep the success screen starting at the top: the security step can leave the
      // page scrolled down and late font/layout work nudges the offset again.
      const toTop = () => { try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) {} };
      toTop();
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(toTop);
      setTimeout(toTop, 260);
      setTimeout(toTop, 620);
    }
    if (name === 'verify') {
      const selecting = state.verification?.mode === 'select';
      const sent = state.verification?.emailSent === true;
      const verificationView = $('[data-view="verify"]');
      if (verificationView) verificationView.dataset.mode = selecting ? 'select' : 'email';
      const currentMask = $('[data-role="mask"]');
      if (currentMask) currentMask.textContent = state.verification?.emailMasked || 'তোমার Email-এ';
      $('[data-role="verification-title"]').textContent = selecting ? 'একটি verification method বেছে নাও' : 'Verification pending…';
      $('[data-role="verification-badge"]').textContent = selecting ? '✓' : '✉';
      $('[data-role="verification-selection"]').hidden = !selecting;
      $('[data-role="verification-email-panel"]').hidden = selecting;
      $('[data-role="telegram-verification-start"]').hidden = !state.capabilities.telegram.available;
      $('[data-role="email-ownership-start"]').hidden = !state.capabilities.emailOwnership.available;
      const magicStart = $('[data-role="email-magiclink-start"]');
      if (magicStart) magicStart.hidden = !state.capabilities.emailOwnership.available;
      const copy = $('[data-role="verification-email-copy"]');
      if (copy) copy.innerHTML = sent
        ? 'Verification link পাঠানো হয়েছে <strong data-role="mask"></strong>। Email app-এ link-এ tap করে এখানে ফিরে আসো।'
        : 'এই মুহূর্তে <strong data-role="mask"></strong> নতুন Email পাঠানো হয়নি। নিচের resend option দিয়ে সত্যিকারের link চাইতে পারো।';
      const mask = $('[data-role="mask"]');
      if (mask) mask.textContent = state.verification?.emailMasked || 'তোমার Email-এ';
      if (state.verification?.email) $('#ah-resend-email').value = state.verification.email;
      $('[data-role="telegram-alternative"]').hidden = !state.capabilities.telegram.available;
      const emailStatusAddress = $('[data-role="email-status-address"]');
      if (emailStatusAddress) emailStatusAddress.textContent = sent ? '\u2713 Verification email sent' : 'Verification pending\u2026';
      updateResendCooldown();
    }
    if (name === 'email-ownership') {
      const mask = $('[data-role="ownership-mask"]');
      if (mask) mask.textContent = state.verification?.emailMasked || 'তোমার Email-এ';
      renderOwnershipDigits();
      updateOwnershipResend();
    }
    if (name === 'email-intro') {
      const address = $('[data-role="email-intro-address"]');
      if (address) address.textContent = state.verification?.emailMasked || state.verification?.email || 'তোমার Email';
    }
    if (name === 'telegram') { renderTelegramDigits(); renderTelegramState(); }
    if (name === 'verified') {
      const label = ['Email', 'Telegram'].includes(state.verificationLabel) ? state.verificationLabel : 'Account';
      $('[data-role="verified-title"]').textContent = `${label} Verified! 🎉`;
      $('[data-role="verified-copy"]').textContent = label === 'Telegram'
        ? 'তোমার Telegram account-এর নিয়ন্ত্রণ নিশ্চিত হয়েছে। এটি Email মালিকানার দাবি নয়।'
        : label === 'Email'
          ? 'তোমার Email এবং Admission Hub account নিরাপদভাবে যাচাই হয়েছে।'
          : 'তোমার Admission Hub account নিরাপদভাবে যাচাই হয়েছে।';
      $('[data-role="verified-method-row"]').textContent = `✓ ${label} Verified`;
    }
    if (name === 'signed') {
      $('[data-role="identity"]').textContent = state.session?.user?.emailMasked || 'যাচাইকৃত account';
      const byTelegram = state.session?.telegramVerified === true && state.session?.emailVerified !== true;
      $('[data-role="identity-label"]').textContent = byTelegram ? 'Telegram-verified account' : 'যাচাইকৃত Email';
      $('[data-role="account-verification-summary"]').textContent = byTelegram
        ? 'Telegram তোমার Telegram account-এর নিয়ন্ত্রণ নিশ্চিত করেছে; Email মালিকানা দাবি করা হয়নি।'
        : 'তোমার একই account নিরাপদে সক্রিয় আছে।';
      renderPasskeys();
    }
    const focusTarget = {
      welcome: () => $('[data-role="welcome-signup"]'),
      forgot: () => $('#ah-forgot-email'),
      created: () => $('[data-role="created-continue"]'),
      verify: () => state.verification?.mode === 'select'
        ? $('[data-role="email-ownership-start"]:not([hidden])') || $('[data-role="email-verification-start"]') : $('[data-role="open-email"]'),
      'email-ownership': () => $('#ah-ownership-code'),
      'email-intro': () => $('[data-role="email-intro-continue"]'),
      'whatsapp-info': () => $('[data-role="whatsapp-info-back"]'),
      'telegram-intro': () => $('[data-role="telegram-intro-continue"]'),
      telegram: () => $('#ah-telegram-code'),
      'google-link': () => $('#ah-link-email'),
      resend: () => $('#ah-resend-email'),
      backup: () => $('#ah-backup-code'),
      'step-up': () => $('#ah-stepup-code'),
      verified: () => $('[data-role="verified-continue"]'),
      'security-setup': () => $('[data-role="setup-passkey"]'),
      success: () => $('[data-role="enter-app"]'),
      signed: () => $('[data-role="close"]')
    }[name];
    if (focusTarget) focusWhenUnclaimed(focusTarget, name === 'telegram' || name === 'backup' ? 80 : 35);
  };

  const configureBackupView = interaction => {
    const telegram = interaction?.type === 'telegram-link';
    const panel = $('[data-role="backup-interaction"]');
    const codeField = $('[data-role="backup-code-field"]');
    const code = $('#ah-backup-code');
    const instruction = $('[data-role="backup-instruction"]');
    const verify = $('[data-role="backup-verify"]');
    panel.hidden = !telegram;
    codeField.hidden = false;
    code.required = true;
    instruction.textContent = telegram
      ? 'Official Telegram bot-এ START চাপুন, তারপর পাওয়া ৬ সংখ্যার কোড লিখুন।'
      : 'নিরাপদ যাচাই কোডটি লিখুন।';
    const verifyLabel = telegram ? 'Telegram কোড যাচাই করুন' : 'যাচাই করুন';
    verify.textContent = verifyLabel;
    verify.dataset.label = verifyLabel;
    const link = $('[data-role="backup-link"]');
    if (telegram) link.href = interaction.url;
    else link.removeAttribute('href');
  };

  const canaryConfigPath = () => {
    try {
      const current = new URL(location.href);
      const query = new URLSearchParams();
      for (const name of ['googleCanary', 'passkeyCanary', 'telegramCanary']) {
        if (current.searchParams.get(name) === '1') query.set(name, '1');
      }
      const suffix = query.toString();
      return `/config${suffix ? `?${suffix}` : ''}`;
    } catch (_) { return '/config'; }
  };

  const backupApiPath = path => {
    try {
      const current = new URL(location.href);
      return current.searchParams.get('telegramCanary') === '1' ? `${path}?telegramCanary=1` : path;
    } catch (_) { return path; }
  };

  // Owner 2026-10-16: an ownership OTP is only sent after a human check. The
  // Worker verifies the token; this just mints it. With no site key configured
  // (or the script unavailable) it resolves empty, and the server guard, which
  // only arms once its secret exists, stays the single source of truth.
  let tsApiPromise = null;
  const humanToken = () => {
    const siteKey = String(window.ADMISSION_HUB_TURNSTILE_SITEKEY || '').trim();
    if (!siteKey) return Promise.resolve('');
    if (!tsApiPromise) {
      tsApiPromise = window.turnstile ? Promise.resolve(window.turnstile) : new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Human check load failed'));
        script.onerror = () => { tsApiPromise = null; reject(new Error('Human check load failed')); };
        document.head.appendChild(script);
      });
    }
    return tsApiPromise.then(api => new Promise((resolve, reject) => {
      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      // Owner report 2026-10-24: signup stopped at "তথ্যটি ভুল" right after the
      // confirm-password field. A 1px, near-transparent host is fine while the
      // check passes silently, but when Cloudflare decides a human must tap, the
      // challenge has nowhere to render — the widget times out, the token comes
      // back empty, and the server refuses the send. So the host starts collapsed
      // and expands into a real, clickable box for the duration of a challenge.
      const collapsed = 'position:fixed;right:0;bottom:0;width:1px;height:1px;overflow:hidden;opacity:.01;z-index:2147483647;';
      const expanded = 'position:fixed;right:12px;bottom:12px;min-width:300px;min-height:70px;padding:10px;overflow:visible;opacity:1;z-index:2147483647;background:#ffffff;border:1px solid #d7dce3;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,.18);';
      host.style.cssText = collapsed;
      const label = document.createElement('p');
      label.textContent = 'মানব যাচাই সম্পন্ন করো।';
      label.style.cssText = 'margin:0 0 8px;font:600 13px/1.4 system-ui,sans-serif;color:#0f172a;';
      label.hidden = true;
      host.appendChild(label);
      const mount = document.createElement('div');
      mount.style.cssText = 'width:300px;height:65px;';
      host.appendChild(mount);
      document.body.appendChild(host);
      let done = false, widgetId = null;
      const finish = (fn, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { api.remove(widgetId); } catch (_) {}
        try { host.remove(); } catch (_) {}
        fn(value);
      };
      // A challenge needs a human: it gets 60s, not the 15s a silent pass needs.
      let timer = setTimeout(() => finish(resolve, ''), 15000);
      const expand = () => {
        host.setAttribute('aria-hidden', 'false');
        host.style.cssText = expanded;
        label.hidden = false;
        clearTimeout(timer);
        timer = setTimeout(() => finish(resolve, ''), 60000);
      };
      const collapse = () => {
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = collapsed;
        label.hidden = true;
      };
      try {
        widgetId = api.render(mount, {
          sitekey: siteKey, action: 'email_ownership', size: 'normal', appearance: 'interaction-only',
          'before-interactive-callback': expand,
          'after-interactive-callback': collapse,
          callback: token => finish(resolve, String(token || '')),
          'error-callback': () => finish(resolve, ''),
          'expired-callback': () => finish(resolve, '')
        });
      } catch (_) { finish(resolve, ''); return; }
      try { api.execute(widgetId); } catch (_) {}
    })).catch(() => '');
  };

  const api = async (path, options = {}) => {
    const attempt = async () => {
    let requestPath = path;  
    try {  
      const current = new URL(location.href);  
      if (current.searchParams.get('telegramCanary') === '1') {  
        const target = new URL(`${API}${path}`, current.origin);  
        if (!target.searchParams.has('telegramCanary')) target.searchParams.set('telegramCanary', '1');  
        requestPath = `${target.pathname.slice(API.length)}${target.search}`;  
      }  
    } catch (_) {}  
    let response;  
    const controller = new AbortController();  
    /* OTP / verification sends walk the provider chain on the server (a cold
     * Apps Script mailer alone can take ~11s), so an 18s ceiling aborted sends
     * that the server then completed: the "sometimes the OTP never comes" bug.
     * Those paths get a 45s ceiling; everything else keeps 18s. */
    const slowSend = /\/(email-ownership|telegram\/verification|account-verification\/email|backup)\/(start|resend)(\?|$)/.test(String(path || ''));
    const socialSignIn = /^\/(google|facebook)(\/link)?(\?|$)/.test(String(path || ''));
    const ceiling = slowSend || socialSignIn ? 45000 : 18000;
    const timeoutMs = Math.min(ceiling, Math.max(2000, Number(options.timeoutMs) || ceiling));  
    const timeout = setTimeout(() => controller.abort(), timeoutMs);  
    try {  
      response = await fetch(`${API}${requestPath}`, {  
        method: options.method || 'GET',  
        credentials: 'same-origin',  
        signal: controller.signal,  
        headers: {  
          'X-AH-Auth-UI': 'auth-premium-v6',  
          ...(options.signupFlow ? { 'X-AH-Signup-Flow': 'pending-v1' } : {}),
          ...(options.body ? { 'Content-Type': 'application/json' } : {})  
        },  
        ...(options.body ? { body: JSON.stringify(options.body) } : {})  
      });  
    } catch (error) {  
      const text = error?.name === 'AbortError' ? 'সেবাটি সময়মতো সাড়া দেয়নি, আবার চেষ্টা করুন।' : 'ইন্টারনেট সংযোগ পাওয়া যাচ্ছে না।';  
      throw Object.assign(new Error(text), { status: 0 });  
    } finally { clearTimeout(timeout); }  
    let data = {};
    let parsed = false;
    try { data = await response.json(); parsed = Boolean(data && typeof data === 'object'); } catch (_) {}  
    if (!response.ok) {  
      const error = new Error('Admission Hub অনুরোধটি শেষ করতে পারেনি।');  
      error.status = response.status;
      error.authStage = String(response.headers.get('X-AH-Auth-Stage') || '').replace(/[^A-Z0-9_]/g, '').slice(0, 40);
      error.diagnostic = String(response.headers.get('X-AH-Auth-Diagnostic') || '').replace(/[^A-Z0-9_]/g, '').slice(0, 80);
      error.code = typeof data?.error?.code === 'string' ? data.error.code : '';  
      // A host that serves the SPA but has no auth backend (the legacy GitHub
      // Pages mirror, or the stale hyphenated Pages project) replies with an
      // HTML error page, so there is no machine code to map. Name that case
      // instead of falling through to the generic 'সাময়িক সমস্যা' banner.
      if (!error.code && !parsed) error.code = 'ENDPOINT_UNAVAILABLE';
      // The API already answers in Bengali with a specific reason. Carrying it
      // through stops friendlyError from flattening every unmapped code into the
      // same dead end and hiding what actually failed.
      error.serverMessage = typeof data?.error?.message === 'string' ? data.error.message : '';
      error.retryAfter = Number(data?.error?.retryAfter || response.headers.get('Retry-After') || 0);  
      throw error;  
    }  
    return data;  
    };
    try {
      return await attempt();
    } catch (error) {
      // Session recovery (Phase 5 §16/§27): an expired session on an
      // authenticated tab triggers ONE coordinated refresh, then the original
      // request is retried exactly once. No recovery loops: /session itself
      // uses noRecovery, and this branch runs at most once per call.
      if (!options.noRecovery && error.status === 401 && error.code === 'SESSION_INVALID' && ['AUTHENTICATED', 'LOGGING_OUT'].includes(sessionState)) {
        setSessionState('RECOVERING');
        if (!pageHost.hidden) message('Session যাচাই চলছে, একটু অপেক্ষা করো…', 'info');
        const recovered = await coordinatedRefresh();
        if (recovered && accountVerified(state.session)) {
          try { return await attempt(); } catch (retryError) { throw retryError; }
        }
      }
      throw error;
    }
  };

  const updateLauncher = () => {
    const signed = accountVerified(state.session);
    launcher.dataset.authenticated = String(signed);
    launcher.setAttribute('aria-label', signed ? 'যাচাইকৃত অ্যাকাউন্ট সক্রিয়' : 'অ্যাকাউন্ট খুলুন');
    const label = launcher.querySelector('.ah-account-launcher-label');
    if (label) label.textContent = signed ? 'সক্রিয়' : 'অ্যাকাউন্ট';
    notify();
  };

  const passkeyBrowserReady = () => Boolean(
    window.isSecureContext !== false &&
    window.PublicKeyCredential &&
    navigator.credentials &&
    typeof navigator.credentials.get === 'function' &&
    typeof navigator.credentials.create === 'function'
  );

  const decodeBase64Url = value => {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
    return Uint8Array.from(raw, character => character.charCodeAt(0));
  };
  const encodeBase64Url = value => {
    const bytes = new Uint8Array(value || new ArrayBuffer(0));
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };
  const publicKeyOptions = (options, registration) => {
    const converted = { ...options, challenge: decodeBase64Url(options.challenge) };
    if (registration) converted.user = { ...options.user, id: decodeBase64Url(options.user.id) };
    const key = registration ? 'excludeCredentials' : 'allowCredentials';
    if (Array.isArray(options[key])) converted[key] = options[key].map(item => ({ ...item, id: decodeBase64Url(item.id) }));
    return converted;
  };
  const registrationPayload = credential => ({
    rawId: encodeBase64Url(credential.rawId),
    clientDataJSON: encodeBase64Url(credential.response.clientDataJSON),
    attestationObject: encodeBase64Url(credential.response.attestationObject),
    transports: typeof credential.response.getTransports === 'function' ? credential.response.getTransports() : []
  });
  const assertionPayload = credential => ({
    rawId: encodeBase64Url(credential.rawId),
    clientDataJSON: encodeBase64Url(credential.response.clientDataJSON),
    authenticatorData: encodeBase64Url(credential.response.authenticatorData),
    signature: encodeBase64Url(credential.response.signature),
    ...(credential.response.userHandle ? { userHandle: encodeBase64Url(credential.response.userHandle) } : {})
  });
  const passkeyErrorMessage = error => {
    if (error?.name === 'NotAllowedError') return 'Passkey অনুরোধটি বাতিল বা সময় শেষ হয়েছে, চাইলে আবার চেষ্টা করো।';
    if (error?.name === 'SecurityError') return 'এই browser বা ঠিকানায় Passkey নিরাপদভাবে ব্যবহার করা যাচ্ছে না।';
    if (error?.name === 'InvalidStateError') return 'এই Passkeyটি আগে থেকেই যুক্ত আছে।';
    return friendlyError(error);
  };

  const establishSession = async (result, text, { offerPasskey = true } = {}) => {
    const onboarding = state.signupJourney || pendingSignup();
    // "Once per account" is decided by the server, not by guesswork: `created`
    // is true only on the round-trip that brought the account into existence.
    const brandNewAccount = result?.created === true;
    const mayOfferPasskey = offerPasskey && (brandNewAccount || Boolean(onboarding));
    state.session = result;
    state.verification = null;
    state.telegram = null;
    state.backup = null;
    state.ownership = null;
    clearTelegramTimer();
    clearOwnershipTimer();
    clearResendCooldown();
    setSessionState('AUTHENTICATED');
    scheduleNextRefresh();
    broadcastAuthEvent('login');
    rememberEntry('account');
    updateLauncher();
    // The account's own credential list decides the prompt, the global
    // "enrollment available" capability cannot. This await is what makes the
    // decision reliable: the view is chosen only after the list is known.
    if (mayOfferPasskey) await refreshPasskeyStatus();
    const ownsPasskey = state.passkeys.length > 0;
    const showSetup = mayOfferPasskey && !ownsPasskey
      && state.capabilities.passkey.enrollmentAvailable && passkeyBrowserReady();
    if (onboarding) {
      state.verificationLabel = result?.emailVerified === true ? 'Email' : result?.telegramVerified === true ? 'Telegram' : 'Account';
      state.afterVerified = showSetup ? 'security-setup' : 'success';
      showView('verified');
    } else if (showSetup) showView('security-setup');
    else {
      showView('signed');
      updateTrustPrompt();
      /* A finished login (Google, Facebook, Email, Passkey) must land on the
       * Dashboard, not on the account card (owner report 2026-10-15: "after
       * Continue with Google it stays on the same page"). A saved return
       * destination is handled by restoreReturnDestination() below. */
      if (!state.returnDestination) {
        try { close(); } catch (_) {}
      }
    }
    if (onboarding) message();
    else message(text, 'success');
    if (!onboarding) {
      refreshPasskeyStatus();
      syncPendingProfile();
    }
    restoreReturnDestination();
  };

  const refreshPasskeyStatus = async () => {
    if (!state.session || !state.capabilities.passkey.enrollmentAvailable || !passkeyBrowserReady()) {
      state.passkeys = [];
      renderPasskeys();
      return;
    }
    try {
      const result = await api('/passkey/status');
      state.passkeys = Array.isArray(result.credentials) ? result.credentials : [];
      renderPasskeys();
    } catch (_) {
      state.passkeys = [];
      renderPasskeys();
    }
  };

  const loginWithPasskey = async () => {
    if (state.busy) return;
    if (!passkeyBrowserReady()) return message('এই browser বা ডিভাইসে Passkey পাওয়া যাচ্ছে না।', 'info');
    setBusy(true);
    try {
      const begin = await api('/passkey/authentication/begin', { method: 'POST', body: {} });
      const credential = await navigator.credentials.get({ publicKey: publicKeyOptions(begin.options, false) });
      if (!credential) throw new DOMException('Passkey cancelled', 'NotAllowedError');
      const result = await api('/passkey/authentication/finish', {
        method: 'POST',
        body: { challengeId: begin.challengeId, response: assertionPayload(credential) }
      });
      await establishSession(result, 'Passkey দিয়ে তোমার একই account-এ প্রবেশ হয়েছে।', { offerPasskey: false });
    } catch (error) { message(passkeyErrorMessage(error), 'error'); }
    finally { setBusy(false); }
  };

  const addPasskey = async ({ onboarding = false } = {}) => {
    if (state.busy || !state.session) return;
    if (!passkeyBrowserReady()) return message('এই browser বা ডিভাইসে Passkey যোগ করা যাচ্ছে না।', 'info');
    setBusy(true);
    try {
      const begin = await api('/passkey/registration/begin', { method: 'POST', body: {} });
      const credential = await navigator.credentials.create({ publicKey: publicKeyOptions(begin.options, true) });
      if (!credential) throw new DOMException('Passkey cancelled', 'NotAllowedError');
      const result = await api('/passkey/registration/finish', {
        method: 'POST',
        body: { challengeId: begin.challengeId, response: registrationPayload(credential) }
      });
      await refreshPasskeyStatus();
      if (result.registered && onboarding) {
        if (state.signupJourney || pendingSignup()) showReadyTransition();
        else showView('signed');
      }
      if (!onboarding || !result.registered) message(result.registered ? 'Passkey নিরাপদভাবে যুক্ত হয়েছে।' : 'Passkey যোগ করা যায়নি।', result.registered ? 'success' : 'error');
    } catch (error) { message(passkeyErrorMessage(error), 'error'); }
    finally { setBusy(false); }
  };

  async function removePasskey(credentialId) {
    if (state.busy || !credentialId) return;
    setBusy(true);
    try {
      await api('/passkey/remove', { method: 'POST', body: { credentialId } });
      await refreshPasskeyStatus();
      message('Passkey সরানো হয়েছে। অন্য লগইন পদ্ধতি চালু থাকবে।', 'success');
    } catch (error) { message(friendlyError(error), 'error'); }
    finally { setBusy(false); }
  }

  /* Owner 2026-10-17: "Continue with Google" is a full-page redirect straight to
   * Google's own sign-in page (accounts.google.com) -- no popup, no direct GSI
   * popup, no Firebase page in between. Google runs on its own Firebase app whose
   * authDomain is THIS site: _worker.js proxies /__/auth/* to Firebase and the
   * OAuth client authorises https://admissionsky.pages.dev/__/auth/handler, so
   * Google says "continue to admissionsky.pages.dev" and the redirect result is
   * kept in first-party storage (nothing lost to partitioning on phones/PWAs).
   * Facebook stays on the old 'ah-google' app with the firebaseapp.com authDomain:
   * its Facebook app only knows that redirect URI. POST /google is unchanged. */
  const GOOGLE_AUTH_DOMAIN = 'admissionsky-997d2.firebaseapp.com';
  const GOOGLE_SKY_HOST = 'admissionsky.pages.dev';
  const GOOGLE_SKY_APP = 'ah-google-sky';
  const GOOGLE_AUTH_PROJECT = 'admissionsky-997d2';
  /* Public Firebase Web API key of the auth project. Not a confidential secret:
   * the same value is inlined in .github/workflows/deploy-pages-worker.yml. */
  const GOOGLE_AUTH_API_KEY = 'AIzaSyCMYPy-qANPN1pPPI1B957wwKezmotK_NI';
  const FIREBASE_SDK_VERSION = '10.12.2';

  const loadScriptOnce = src => new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-ah-src="${src}"]`);
    if (existing) {
      if (existing.dataset.ahLoaded === '1') return resolve(true);
      existing.addEventListener('load', () => resolve(true), { once: true });
      existing.addEventListener('error', () => reject(new Error(`load failed: ${src}`)), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.ahSrc = src;
    script.onload = () => { script.dataset.ahLoaded = '1'; resolve(true); };
    script.onerror = () => reject(new Error(`load failed: ${src}`));
    document.head.append(script);
  });

  const loadFirebaseSdk = async () => {
    /* app-compat is usually already on the page (the app preloads it for
     * analytics), so only fetch what is actually missing. A host or test that
     * injects firebase.auth is used as-is. */
    if (!window.firebase) {
      /* Self-hosted copy first (works offline and needs no third-party origin);
       * gstatic is the fallback. */
      let base = './sdk';
      try { await loadScriptOnce(`${base}/firebase-app-compat.js`); }
      catch (_) {
        base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
        await loadScriptOnce(`${base}/firebase-app-compat.js`);
      }
    }
    if (!(window.firebase && typeof window.firebase.auth === 'function')) {
      await loadScriptOnce('./sdk/firebase-auth-compat.js');
    }
    if (!window.firebase || typeof window.firebase.auth !== 'function') throw new Error('Firebase Auth unavailable');
    return window.firebase;
  };

  const firebaseAuthFor = async (name, authDomain) => {
    const firebase = await loadFirebaseSdk();
    const named = (firebase.apps || []).find(app => app.name === name);
    const app = named || firebase.initializeApp({ apiKey: GOOGLE_AUTH_API_KEY, authDomain, projectId: GOOGLE_AUTH_PROJECT }, name);
    return firebase.auth(app);
  };

  /* Facebook only: the original app, authDomain firebaseapp.com. */
  const loadFirebaseAuth = () => {
    if (!state.firebaseAuthPromise) {
      state.firebaseAuthPromise = firebaseAuthFor('ah-google', GOOGLE_AUTH_DOMAIN);
      state.firebaseAuthPromise.catch(() => { state.firebaseAuthPromise = null; });
    }
    return state.firebaseAuthPromise;
  };

  /* Google only: authDomain is our own site. */
  const loadGoogleAuth = () => {
    if (!state.googleAuthPromise) {
      state.googleAuthPromise = firebaseAuthFor(GOOGLE_SKY_APP, GOOGLE_SKY_HOST);
      state.googleAuthPromise.catch(() => { state.googleAuthPromise = null; });
    }
    return state.googleAuthPromise;
  };

  /* Facebook only (unchanged): the Firebase OAuth popup completes through a
   * hidden relay on the authDomain. A mobile WebView, an in-app browser and an
   * installed PWA run that relay with no shared storage, so the handshake never
   * returns. On those surfaces Facebook signs in by full-page redirect instead;
   * desktop keeps the popup, and a dead popup still falls back (popupDead). */
  const oauthPopupSupported = () => {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return false;
    } catch (_) {}
    const ua = String((navigator && navigator.userAgent) || '');
    if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Twitter|TikTok|SnapChat|Pinterest/i.test(ua)) return false;
    return true;
  };

  /* A popup that is blocked, unsupported, or killed by the missing shared
   * storage all land in the same dead end on a phone; the redirect works there,
   * so fall back to it rather than reporting the failure. A user who closed the
   * popup deliberately is NOT one of these -- that intent is respected. */
  const popupDead = error => ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment',
    'auth/web-storage-unsupported', 'auth/internal-error'].includes(String(error?.code || ''));

  const OAUTH_REDIRECT = 'oauth-redirect';
  const OAUTH_REDIRECT_FLAG = 'ah-oauth-redirect';
  const GOOGLE_REDIRECT_FLAG = 'ah-google-redirect';

  /* Owner 2026-10-17: after Google the Welcome screen came back with no error.
   * Tab storage (our flag + Firebase's pendingRedirect) is empty when the
   * return lands in another browsing context (installed app, tab handover), so
   * the return was never noticed. A marker on the URL Firebase returns to
   * survives that; finishOAuthRedirect() uses it as a fallback. Non-secret. */
  const OAUTH_RETURN_PARAM = 'ahAuthReturn';
  const stripOAuthReturnParam = () => {
    let marker = '';
    try {
      const here = new URL(location.href);
      marker = String(here.searchParams.get(OAUTH_RETURN_PARAM) || '');
      if (marker) {
        here.searchParams.delete(OAUTH_RETURN_PARAM);
        history.replaceState(history.state, '', here.pathname + here.search + here.hash);
      }
    } catch (_) {}
    return marker;
  };
  /* Firebase only asks for a redirect result when its own pending mark is in
   * tab storage; put that fixed, non-secret mark back after a lost tab. */
  const restoreFirebasePendingRedirect = appName => {
    const pendingKey = `firebase:pendingRedirect:${GOOGLE_AUTH_API_KEY}:${appName}`;
    try {
      if (!sessionStorage.getItem(pendingKey)) sessionStorage.setItem(pendingKey, '"true"');
    } catch (_) {}
  };
  const beginOAuthRedirect = async (auth, provider, google = false) => {
    try {
      if (google) sessionStorage.setItem(GOOGLE_REDIRECT_FLAG, '1');
      else sessionStorage.setItem(OAUTH_REDIRECT_FLAG, '1');
    } catch (_) {}
    try {
      const here = new URL(location.href);
      here.searchParams.set(OAUTH_RETURN_PARAM, google ? 'g' : 'f');
      history.replaceState(history.state, '', here.pathname + here.search + here.hash);
    } catch (_) {}
    try {
      await auth.signInWithRedirect(provider);
    } catch (error) {
      stripOAuthReturnParam();
      throw error;
    }
    return OAUTH_REDIRECT;
  };

  /* Google refuses in-app browsers and WebViews (403 disallowed_useragent), so
   * Google is never started there -- the visitor is sent to Chrome instead. */
  const IN_APP_BROWSER_UA = /FBAN|FBAV|FB_IAB|FB4A|FBIOS|FBSS|Messenger|Instagram|Line\/|MicroMessenger|Twitter|TikTok|musical_ly|BytedanceWebview|SnapChat|Pinterest|LinkedInApp|; wv\)/i;
  const userAgentText = () => String((navigator && navigator.userAgent) || '');
  const inAppBrowser = () => IN_APP_BROWSER_UA.test(userAgentText());
  const GOOGLE_SKY_URL = `https://${GOOGLE_SKY_HOST}/?ahGoogle=1`;
  const GOOGLE_CHROME_INTENT = `intent://${GOOGLE_SKY_HOST}/?ahGoogle=1#Intent;scheme=https;package=com.android.chrome;end`;

  const googleMessage = error => {
    const code = String(error?.code || '');
    let text = 'Google লগইন এই মুহূর্তে খুলছে না, আবার চেষ্টা করো বা ইমেইল দিয়ে ঢুকো।';
    if (code === 'in-app-browser') text = 'এই app-এর ভেতরের browser-এ Google লগইন হয় না-Chrome-এ খুলে চেষ্টা করো।';
    else if (code === 'auth/network-request-failed') text = 'ইন্টারনেট সংযোগ পাওয়া যায়নি, নেট চালু করে আবার চেষ্টা করো।';
    else if (code === 'auth/web-storage-unsupported' || code === 'auth/operation-not-supported-in-this-environment') text = 'এই browser-এ Google লগইন হয় না-Chrome বা Safari-এ সাইটটি খুলে চেষ্টা করো।';
    else if (code === 'auth/unauthorized-domain') text = 'এই ঠিকানা থেকে Google লগইন চালু নেই-admissionsky.pages.dev থেকে চেষ্টা করো।';
    else if (code === 'auth/user-disabled') text = 'এই Google account বন্ধ করা আছে, অন্য পদ্ধতিতে ঢুকো।';
    else if (code === 'auth/account-exists-with-different-credential') text = 'এই Email অন্য পদ্ধতিতে খোলা আছে, আগের পদ্ধতি দিয়ে ঢুকো।';
    return code ? `${text} [${code}]` : text;
  };
  const GOOGLE_LOCAL_CODES = new Set(['in-app-browser', 'firebase-sdk-unavailable']);
  const googleErrorText = error => {
    const code = String(error?.code || '');
    if (!code || code.startsWith('auth/') || GOOGLE_LOCAL_CODES.has(code)) return googleMessage(error);
    const detail = String(error?.diagnostic || error?.authStage || '');
    return `${friendlyError(error)} [${[code, detail].filter(Boolean).join(' · ')}]`;
  };

  const showGoogleInAppHelp = () => {
    let panel = document.getElementById('ah-google-inapp');
    if (!panel) {
      const android = /Android/i.test(userAgentText());
      panel = document.createElement('div');
      panel.id = 'ah-google-inapp';
      panel.dataset.role = 'google-inapp';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.6)';
      const card = document.createElement('div');
      card.style.cssText = 'width:100%;max-width:380px;background:#fff;color:#0f172a;border-radius:16px;padding:20px;font:15px/1.55 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.35)';
      const title = document.createElement('h3');
      title.style.cssText = 'margin:0 0 8px;font-size:18px';
      title.textContent = 'Chrome-এ খুলে Google দিয়ে ঢুকো';
      const text = document.createElement('p');
      text.style.cssText = 'margin:0 0 14px';
      text.textContent = android
        ? 'Facebook/Messenger-এর মতো app-এর ভেতরের browser-এ Google লগইন করতে দেয় না। নিচের বাটন চাপলে সাইটটি Chrome-এ খুলবে, সেখানে Google দিয়ে ঢুকো।'
        : 'Facebook/Messenger-এর মতো app-এর ভেতরের browser-এ Google লগইন করতে দেয় না। উপরের ⋯ মেনু থেকে "Open in browser" চাপো, অথবা লিংক কপি করে Safari বা Chrome-এ খোলো।';
      const style = primary => `display:block;box-sizing:border-box;width:100%;margin:0 0 10px;padding:12px;border-radius:12px;font:600 15px system-ui,sans-serif;text-align:center;text-decoration:none;cursor:pointer;${primary ? 'background:#2563eb;color:#fff;border:0' : 'background:#fff;color:#1e293b;border:1px solid #cbd5e1'}`;
      card.append(title, text);
      if (android) {
        const chrome = document.createElement('a');
        chrome.href = GOOGLE_CHROME_INTENT;
        chrome.dataset.role = 'google-open-chrome';
        chrome.textContent = 'Chrome-এ খুলুন';
        chrome.style.cssText = style(true);
        card.append(chrome);
      }
      const field = document.createElement('input');
      field.type = 'text';
      field.readOnly = true;
      field.value = GOOGLE_SKY_URL;
      field.dataset.role = 'google-link-field';
      field.style.cssText = 'display:none;box-sizing:border-box;width:100%;margin:0 0 10px;padding:10px;border:1px solid #cbd5e1;border-radius:10px;font:14px system-ui,sans-serif';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.dataset.role = 'google-copy-link';
      copy.textContent = 'লিংক কপি করুন';
      copy.style.cssText = style(!android);
      copy.addEventListener('click', () => {
        const done = () => { copy.textContent = 'লিংক কপি হয়েছে ✓'; };
        const manual = () => {
          field.style.display = 'block';
          field.focus();
          field.select();
          try { if (document.execCommand && document.execCommand('copy')) done(); } catch (_) {}
        };
        try { navigator.clipboard.writeText(GOOGLE_SKY_URL).then(done, manual); } catch (_) { manual(); }
      });
      const close = document.createElement('button');
      close.type = 'button';
      close.dataset.role = 'google-inapp-close';
      close.textContent = 'বন্ধ করুন';
      close.style.cssText = style(false);
      close.addEventListener('click', () => { panel.style.display = 'none'; });
      const code = document.createElement('p');
      code.style.cssText = 'margin:4px 0 0;font-size:12px;color:#64748b;text-align:center';
      code.textContent = 'কোড: in-app-browser';
      card.append(copy, field, close, code);
      panel.append(card);
      document.body.append(panel);
    }
    panel.style.display = 'flex';
    return panel;
  };

  /* The only way Google starts. Never a popup: either the whole page goes to
   * Google, or (wrong host) to admissionsky.pages.dev first, or (in-app
   * browser) the "open in Chrome" panel. */
  const startGoogleRedirect = async () => {
    if (inAppBrowser()) {
      showGoogleInAppHelp();
      throw Object.assign(new Error('in-app-browser'), { code: 'in-app-browser' });
    }
    if (String(location.hostname || '') !== GOOGLE_SKY_HOST) {
      location.assign(GOOGLE_SKY_URL);
      return new Promise(() => {});
    }
    let auth;
    try { auth = await loadGoogleAuth(); } catch (error) {
      throw Object.assign(new Error('Firebase Auth unavailable'), { code: String(error?.code || 'firebase-sdk-unavailable') });
    }
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');
    if (typeof provider.setCustomParameters === 'function') provider.setCustomParameters({ prompt: 'select_account' });
    return beginOAuthRedirect(auth, provider, true);
  };

  /* Runs once at boot, and only when a redirect we started is coming back, so
   * an ordinary load never pays for the getRedirectResult round-trip. */
  const finishOAuthRedirect = async () => {
    let facebookPending = false;
    let googlePending = false;
    try {
      facebookPending = sessionStorage.getItem(OAUTH_REDIRECT_FLAG) === '1';
      googlePending = sessionStorage.getItem(GOOGLE_REDIRECT_FLAG) === '1';
      if (facebookPending) sessionStorage.removeItem(OAUTH_REDIRECT_FLAG);
      if (googlePending) sessionStorage.removeItem(GOOGLE_REDIRECT_FLAG);
    } catch (_) {}
    // Fallback when tab storage was lost on the way back (see OAUTH_RETURN_PARAM).
    const returnMarker = stripOAuthReturnParam();
    let recovered = false;
    if (!facebookPending && !googlePending) {
      if (returnMarker === 'g') googlePending = true;
      else if (returnMarker === 'f') facebookPending = true;
      recovered = googlePending || facebookPending;
    }
    if (!facebookPending && !googlePending) return;
    // Must happen before the auth instance starts (it reads the mark at init).
    if (recovered) restoreFirebasePendingRedirect(googlePending ? GOOGLE_SKY_APP : 'ah-google');
    const auth = await (googlePending ? loadGoogleAuth() : loadFirebaseAuth()).catch(() => null);
    if (!auth || typeof auth.getRedirectResult !== 'function') {
      if (googlePending) {
        open();
        showView('login');
        message(googleMessage({ code: 'firebase-sdk-unavailable' }), 'error');
      }
      return;
    }
    let result = null;
    let redirectError = null;
    try { result = await auth.getRedirectResult(); } catch (error) { redirectError = error; }
    const accessToken = String(result?.credential?.accessToken || '');
    if (!result?.user || accessToken.length < 20) {
      /* The redirect came back empty: the user backed out, or the browser
       * dropped the result. Say so (with the real code) instead of silently
       * leaving them on the same page. */
      open();
      showView('login');
      const code = String(redirectError?.code || (recovered ? 'storage-lost' : ''));
      const text = code === 'auth/account-exists-with-different-credential'
        ? 'এই Email অন্য পদ্ধতিতে খোলা আছে, আগের পদ্ধতি দিয়ে ঢুকো।'
        : 'লগইন সম্পন্ন হয়নি, আবার চেষ্টা করো। বারবার হলে Chrome/Safari-এ সাইটটি খুলে চেষ্টা করো বা Email দিয়ে ঢুকো।';
      message(code ? `${text} [${code}]` : text, 'error');
      return;
    }
    const providerId = googlePending ? 'google.com' : String(result.credential?.providerId || result.user.providerId || '');
    try {
      if (providerId === 'facebook.com') {
        const r = await api('/facebook', { method: 'POST', body: { accessToken } });
        await establishSession(r, 'Facebook \u09a6\u09bf\u09af\u09bc\u09c7 \u09a4\u09cb\u09ae\u09be\u09b0 account-\u098f \u09aa\u09cd\u09b0\u09ac\u09c7\u09b6 \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964');
      } else if (providerId === 'google.com') {
        state.googleLinkToken = '';
        const r = await api('/google', { method: 'POST', body: { accessToken } });
        await establishSession(r, 'Google \u09a6\u09bf\u09af\u09bc\u09c7 \u09a4\u09cb\u09ae\u09be\u09b0 account-\u098f \u09aa\u09cd\u09b0\u09ac\u09c7\u09b6 \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964');
      }
      landOnDashboard();
    } catch (error) {
      open();
      if (providerId === 'google.com') {
        /* Keep the fresh Google token in memory only, so the "link to your
         * existing account" form can finish without a second trip to Google. */
        if (error?.code === 'ACCOUNT_LINK_REQUIRED') {
          state.googleLinkToken = accessToken;
          showView('google-link');
        }
        message(googleErrorText(error), 'error');
        return;
      }
      message(error?.code ? friendlyError(error) : '\u09b2\u0997\u0987\u09a8 \u09b8\u09ae\u09cd\u09aa\u09a8\u09cd\u09a8 \u09b9\u09af\u09bc\u09a8\u09bf\u2014\u0986\u09ac\u09be\u09b0 \u099a\u09c7\u09b7\u09cd\u099f\u09be \u0995\u09b0\u09cb\u0964', 'error');
    }
  };

  const signInWithGoogle = async () => {
    if (state.busy) return;
    setBusy(true);
    try {
      await startGoogleRedirect();
    } catch (error) {
      message(googleErrorText(error), 'error');
    } finally { setBusy(false); }
  };

  const loadGoogle = clientId => {
    if (state.googlePromise) return state.googlePromise;
    if (clientId) state.googleClientId = clientId;
    state.googlePromise = Promise.resolve(true).then(() => {
      const hosts = [
        $('[data-role="google-button"]'),
        $('[data-role="welcome-google-button"]')
      ].filter(Boolean);
      hosts.forEach(host => {
        if (host.querySelector('button[data-ah-google]')) return;
        host.textContent = '';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ah-account-secondary';
        button.dataset.ahGoogle = '1';
        button.textContent = 'Continue with Google';
        button.addEventListener('click', () => { signInWithGoogle(); });
        host.append(button);
        host.hidden = false;
      });
      state.googleReady = true;
      return true;
    });
    return state.googlePromise;
  };

  /* Facebook sign-in runs through Firebase's own authDomain, exactly like the
   * Google fix above, and for the same reason. The raw FB JS SDK opens
   * www.facebook.com/dialog/oauth directly, and Facebook shows its own
   * "Sorry, something went wrong" page for this app -- the owner's screenshot
   * of 2026-10-15. The Firebase SDK instead opens its handler on the authDomain
   * (admissionsky-997d2.firebaseapp.com, which Firebase provisions and Facebook
   * accepts) and returns a Facebook access token -- exactly what POST /facebook
   * accepts, so no backend change is needed. */
  const facebookMessage = error => {
    const code = String(error?.code || '');
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return 'Facebook \u099c\u09be\u09a8\u09be\u09b2\u09be\u099f\u09bf \u09ac\u09a8\u09cd\u09a7 \u09b9\u09af\u09bc\u09c7 \u0997\u09c7\u099b\u09c7\u2014\u0986\u09ac\u09be\u09b0 \u099a\u09c7\u09b7\u09cd\u099f\u09be \u0995\u09b0\u09cb \u09ac\u09be \u0987\u09ae\u09c7\u0987\u09b2 \u09a6\u09bf\u09af\u09bc\u09c7 \u09a2\u09c1\u0995\u09cb\u0964';
    }
    if (code === 'auth/popup-blocked') {
      return 'Facebook \u099c\u09be\u09a8\u09be\u09b2\u09be \u0996\u09cb\u09b2\u09be \u09af\u09be\u09af\u09bc\u09a8\u09bf\u2014browser-\u098f popup \u0985\u09a8\u09c1\u09ae\u09a4\u09bf \u09a6\u09be\u0993 \u09ac\u09be \u0987\u09ae\u09c7\u0987\u09b2 \u09a6\u09bf\u09af\u09bc\u09c7 \u09a2\u09c1\u0995\u09cb\u0964';
    }
    return 'Facebook \u09b2\u0997\u0987\u09a8 \u098f\u0987 \u09ae\u09c1\u09b9\u09c1\u09b0\u09cd\u09a4\u09c7 \u0996\u09c1\u09b2\u099b\u09c7 \u09a8\u09be\u2014\u0986\u09ac\u09be\u09b0 \u099a\u09c7\u09b7\u09cd\u099f\u09be \u0995\u09b0\u09cb \u09ac\u09be \u0987\u09ae\u09c7\u0987\u09b2 \u09a6\u09bf\u09af\u09bc\u09c7 \u09a2\u09c1\u0995\u09cb\u0964';
  };

  const facebookAccessToken = async () => {
    const auth = await loadFirebaseAuth();
    const provider = new window.firebase.auth.FacebookAuthProvider();
    provider.addScope('email');
    provider.addScope('public_profile');
    if (!oauthPopupSupported()) return beginOAuthRedirect(auth, provider);
    let credential;
    try {
      credential = await auth.signInWithPopup(provider);
    } catch (error) {
      if (!popupDead(error)) throw new Error(facebookMessage(error));
      return beginOAuthRedirect(auth, provider);
    }
    const token = String(credential?.credential?.accessToken || '');
    if (token.length < 20) throw new Error('Facebook \u0985\u09a8\u09c1\u09ae\u09a4\u09bf \u09aa\u09be\u0993\u09af\u09bc\u09be \u09af\u09be\u09af\u09bc\u09a8\u09bf\u2014\u0986\u09ac\u09be\u09b0 \u099a\u09c7\u09b7\u09cd\u099f\u09be \u0995\u09b0\u09cb \u09ac\u09be \u0987\u09ae\u09c7\u0987\u09b2 \u09a6\u09bf\u09af\u09bc\u09c7 \u09a2\u09c1\u0995\u09cb\u0964');
    return token;
  };

  const signInWithFacebook = async () => {
    if (state.busy) return;
    setBusy(true);
    try {
      const accessToken = await facebookAccessToken();
      if (accessToken === OAUTH_REDIRECT) return;
      const result = await api('/facebook', { method: 'POST', body: { accessToken } });
      await establishSession(result, 'Facebook \u09a6\u09bf\u09af\u09bc\u09c7 \u09a4\u09cb\u09ae\u09be\u09b0 \u098f\u0995\u0987 account-\u098f \u09aa\u09cd\u09b0\u09ac\u09c7\u09b6 \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964');
    } catch (error) {
      if (error?.code === 'ACCOUNT_LINK_REQUIRED') showView('google-link');
      message(error?.code ? friendlyError(error) : facebookMessage(error), 'error');
    } finally { setBusy(false); }
  };

  /* Owner 2026-10-18: "Continue with Telegram" (replaces Facebook). The
   * browser goes to oauth.telegram.org for the official bot and comes back to
   * /?tgLogin=1 with Telegram's signed payload; the Worker checks the signature. */
  const TELEGRAM_LOGIN_FLAG = 'ah-telegram-login-pending';
  const TELEGRAM_LOGIN_KEYS = ['tgLogin', 'id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash'];
  const telegramLoginPayload = () => {
    let payload = null;
    const fragment = String(location.hash || '');
    const marker = fragment.indexOf('tgAuthResult=');
    if (marker !== -1) {
      try {
        let raw = decodeURIComponent(fragment.slice(marker + 13).split('&')[0]).replace(/-/g, '+').replace(/_/g, '/');
        while (raw.length % 4) raw += '=';
        const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
        payload = JSON.parse(new TextDecoder().decode(bytes));
      } catch (_) { payload = null; }
    }
    const query = new URLSearchParams(location.search);
    if (!payload && query.get('id') && query.get('hash')) {
      payload = {};
      for (const key of TELEGRAM_LOGIN_KEYS.slice(1)) if (query.has(key)) payload[key] = query.get(key);
    }
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  };
  const finishTelegramLogin = async () => {
    let pending = false;
    try { pending = sessionStorage.getItem(TELEGRAM_LOGIN_FLAG) === '1'; sessionStorage.removeItem(TELEGRAM_LOGIN_FLAG); } catch (_) {}
    const returned = new URLSearchParams(location.search).get('tgLogin') === '1' || String(location.hash || '').includes('tgAuthResult=');
    if (!returned) return;
    const payload = telegramLoginPayload();
    try {
      const url = new URL(location.href);
      for (const key of TELEGRAM_LOGIN_KEYS) url.searchParams.delete(key);
      history.replaceState(history.state, '', url.pathname + url.search);
    } catch (_) {}
    if (accountVerified(state.session)) return;
    if (!payload) {
      if (pending) { open(); message('Telegram login was not completed. Please try again.', 'error'); }
      return;
    }
    setBusy(true);
    try {
      const result = await api('/telegram/login', { method: 'POST', body: payload });
      await establishSession(result, 'Signed in with Telegram.');
      landOnDashboard();
    } catch (error) {
      open();
      message(error?.code ? friendlyError(error) : 'Telegram login failed. Please try again.', 'error');
    } finally { setBusy(false); }
  };
  const signInWithTelegram = () => {
    const botId = String(state.capabilities.telegramLogin?.botId || '');
    if (state.busy || !state.capabilities.telegramLogin?.available || !/^\d{5,15}$/.test(botId)) return false;
    const origin = location.origin;
    try { sessionStorage.setItem(TELEGRAM_LOGIN_FLAG, '1'); } catch (_) {}
    const params = new URLSearchParams({ bot_id: botId, origin, embed: '0', request_access: 'write', return_to: `${origin}/?tgLogin=1` });
    location.assign(`https://oauth.telegram.org/auth?${params.toString()}`);
    return true;
  };

  const linkGoogle = async (email, password) => {
    // The Google token from the redirect that just came back (memory only).
    const accessToken = String(state.googleLinkToken || '');
    if (accessToken.length < 20) {
      throw Object.assign(new Error('google-token-missing'), { userMessage: 'আগে আবার "Continue with Google" চাপো, ফিরে এসে এখানে ইমেইল ও পাসওয়ার্ড দাও। [google-token-missing]' });
    }
    const result = await api('/google/link', { method: 'POST', body: { email, password, accessToken } });
    state.googleLinkToken = '';
    return result;
  };

  const applyCapabilities = auth => {
    state.available = auth?.available === true;
    const methods = auth?.methods || {};
    state.capabilities.google = {
      available: methods.google?.available === true && typeof methods.google?.clientId === 'string',
      clientId: methods.google?.clientId || ''
    };
    state.capabilities.facebook = {
      available: methods.facebook?.available === true && typeof methods.facebook?.clientId === 'string',
      appId: methods.facebook?.clientId || ''
    };
    state.capabilities.passkey = {
      available: methods.passkey?.available === true && passkeyBrowserReady(),
      enrollmentAvailable: (methods.passkey?.enrollmentAvailable === true || methods.passkey?.available === true) && passkeyBrowserReady()
    };
    /* Owner 2026-10-18: Telegram is a LOGIN method now; the post-signup
     * Telegram verification choice is removed. */
    state.capabilities.telegram = { available: false };
    state.capabilities.telegramLogin = {
      available: methods.telegramLogin?.available === true && /^\d{5,15}$/.test(String(methods.telegramLogin?.botId || '')),
      botId: String(methods.telegramLogin?.botId || '')
    };
    state.capabilities.emailOwnership = { available: methods.emailOwnership?.available === true };
    // Email + password is the base method: the server only reports it as
    // unavailable when it is deliberately switched off, so absent means on.
    state.capabilities.emailPassword = { available: methods.emailPassword?.available !== false };
    state.capabilities.backup = {
      available: methods.backup?.available === true,
      contactInput: ['none', 'optional', 'required'].includes(methods.backup?.contactInput) ? methods.backup.contactInput : 'none'
    };
    const preferred = $('[data-role="preferred-methods"]');
    const passkey = $('[data-role="passkey-login"]');
    const passkeyTools = $('[data-role="passkey-tools"]');
    const backup = $('[data-role="backup-start"]');
    passkey.hidden = !state.capabilities.passkey.available;
    passkeyTools.hidden = !state.capabilities.passkey.enrollmentAvailable;
    backup.hidden = !state.capabilities.backup.available;
    preferred.hidden = !(state.capabilities.google.available || state.capabilities.passkey.available);
    $('[data-role="account-subtitle"]').textContent = state.capabilities.passkey.available
      ? 'Google বা Passkey দিয়ে দ্রুত প্রবেশ করো। চাইলে Email ও Password-ও ব্যবহার করতে পারো।'
      : state.capabilities.google.available
        ? 'Google দিয়ে দ্রুত প্রবেশ করো। চাইলে Email ও Password-ও ব্যবহার করতে পারো।'
        : 'Email ও Password দিয়ে নিরাপদে প্রবেশ করো।';
    $('[data-role="signup-verification-note"]').textContent = state.capabilities.telegram.available
      ? 'Sign Up-এর পর Email অথবা Telegram-একটি method বেছে নেবে। বেছে নেওয়ার আগে কিছু পাঠানো হবে না।'
      : 'Sign Up-এর পর Email verification link পাঠানো হবে। Link-এ click করলেই verification সম্পন্ন হবে।';
    if (state.capabilities.google.available) loadGoogle(state.capabilities.google.clientId);
    else {
      const host = $('[data-role="welcome-google-button"]');
      if (host && !host.querySelector('button')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ah-account-secondary';
        button.disabled = true;
        button.textContent = 'Continue with Google';
        button.setAttribute('aria-label', 'Google দিয়ে প্রবেশ এখন পাওয়া যাচ্ছে না');
        host.append(button);
      }
    }
    const telegramHost = $('[data-role="welcome-telegram-button"]');
    if (telegramHost) {
      telegramHost.hidden = true; /* Owner 2026-10-18: Telegram lives on the Welcome Story, never above it. */
    }
  };

  /* ===== Session Engine (Phase 5, v256), state machine + refresh coordinator =====
     - Centralized state transitions (blueprint §3); UI reads data-session-state.
     - Single-flight refresh: concurrent callers share ONE /session call (§21-22).
     - Refresh retries network failures with backoff, max budget, no infinite
       loops (§8); 401/403 are terminal auth states (§24).
     - Network failure never logs the user out (§17).
     - Session failure never touches identity: clearing local session state is
       the most this module may do (§30). */
  const SESSION_STATES = Object.freeze(['INITIALIZING', 'CHECKING_SESSION', 'AUTHENTICATED', 'REFRESHING', 'RECOVERING', 'EXPIRING', 'LOGGING_OUT', 'UNAUTHENTICATED', 'ERROR']);
  const SESSION_TRANSITIONS = Object.freeze({
    INITIALIZING: new Set(['CHECKING_SESSION', 'UNAUTHENTICATED', 'ERROR']),
    CHECKING_SESSION: new Set(['AUTHENTICATED', 'UNAUTHENTICATED', 'ERROR']),
    AUTHENTICATED: new Set(['REFRESHING', 'RECOVERING', 'EXPIRING', 'LOGGING_OUT', 'UNAUTHENTICATED', 'ERROR']),
    REFRESHING: new Set(['AUTHENTICATED', 'RECOVERING', 'UNAUTHENTICATED', 'ERROR']),
    RECOVERING: new Set(['AUTHENTICATED', 'UNAUTHENTICATED', 'ERROR']),
    EXPIRING: new Set(['REFRESHING', 'RECOVERING', 'LOGGING_OUT', 'UNAUTHENTICATED', 'ERROR']),
    LOGGING_OUT: new Set(['UNAUTHENTICATED', 'ERROR', 'RECOVERING', 'AUTHENTICATED']),
    UNAUTHENTICATED: new Set(['CHECKING_SESSION', 'AUTHENTICATED', 'INITIALIZING']),
    ERROR: new Set(['CHECKING_SESSION', 'UNAUTHENTICATED', 'AUTHENTICATED'])
  });
  let sessionState = 'INITIALIZING';
  let wasEverAuthenticatedThisTab = false;
  const getSessionState = () => sessionState;
  const setSessionState = to => {
    if (!SESSION_STATES.includes(to) || sessionState === to) return;
    if (!SESSION_TRANSITIONS[sessionState].has(to)) return;
    sessionState = to;
    if (pageHost) pageHost.dataset.sessionState = to;
    if (to === 'AUTHENTICATED') wasEverAuthenticatedThisTab = true;
    // Phase 7B3 (AUTH STABLE): every auth state transition is observable,
    // so auth-dependent UI (Profile) can leave AUTH_LOADING deterministically
    // instead of guessing. Guest is only ever rendered after the check completes.
    try { notify(); } catch (_) {}
  };
  const MAX_NETWORK_REFRESH_ATTEMPTS = 2;
  const REFRESH_BACKOFF_MS = Object.freeze([400, 1200]);
  const REFRESH_AHEAD_MS = 60 * 60 * 1000;
  const REFRESH_SCHEDULE_MIN_MS = 60 * 1000;
  const REFRESH_SCHEDULE_MAX_MS = 6 * 60 * 60 * 1000;
  let refreshInFlight = null;
  let refreshScheduleTimer = null;

  const clearRefreshSchedule = () => {
    if (refreshScheduleTimer) { clearTimeout(refreshScheduleTimer); refreshScheduleTimer = null; }
  };
  const scheduleNextRefresh = () => {
    clearRefreshSchedule();
    const expiresAt = Number(state.session?.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
    const delay = Math.min(Math.max(expiresAt - Date.now() - REFRESH_AHEAD_MS, REFRESH_SCHEDULE_MIN_MS), REFRESH_SCHEDULE_MAX_MS);
    refreshScheduleTimer = setTimeout(() => {
      if (state.session && (sessionState === 'AUTHENTICATED' || sessionState === 'ERROR')) {
        setSessionState('EXPIRING');
        void refreshSession();
      }
    }, delay);
  };

  const clearAuthLocalState = () => {
    state.session = null;
    state.passkeys = [];
    state.backup = null;
    state.telegram = null;
    clearStepUpTimer();
    state.stepUp = null;
    clearTelegramTimer();
    clearRefreshSchedule();
  };

  const performSessionRefresh = async () => {
    if (sessionState === 'AUTHENTICATED' || sessionState === 'EXPIRING') setSessionState('REFRESHING');
    let networkTries = 0;
    for (;;) {
      try {
        const current = await api('/session', { noRecovery: true });
        if (!accountVerified(current)) {
          const hadSession = Boolean(state.session);
          clearAuthLocalState();
          setSessionState('UNAUTHENTICATED');
          updateLauncher();
          if (hadSession && !pageHost.hidden) showView('login');
          return false;
        }
        state.session = current;
        rememberEntry('account');
        setSessionState('AUTHENTICATED');
        updateLauncher();
        if (!pageHost.hidden && state.session) showView('signed');
        refreshPasskeyStatus();
        scheduleNextRefresh();
        return true;
      } catch (error) {
        if (error.status === 0 && networkTries < MAX_NETWORK_REFRESH_ATTEMPTS) {
          networkTries += 1;
          await new Promise(resolve => setTimeout(resolve, REFRESH_BACKOFF_MS[networkTries - 1] || 1200));
          continue; // network hiccup: retry, state untouched (blueprint §17)
        }
        if (error.status === 0) {
          // still offline: keep current auth state, retry on next trigger
          if (state.session) setSessionState('AUTHENTICATED');
          return Boolean(state.session);
        }
        // Terminal auth failure (401/403): the session is gone. Only redirect
        // to the login view when this tab actually held a session, during a
        // cold bootstrap the view choice belongs to the bootstrap flow.
        const hadSession = Boolean(state.session);
        clearAuthLocalState();
        setSessionState('UNAUTHENTICATED');
        updateLauncher();
        if (hadSession && !pageHost.hidden) showView('login');
        return false;
      }
    }
  };

  const coordinatedRefresh = () => {
    if (!refreshInFlight) {
      refreshInFlight = performSessionRefresh().finally(() => { refreshInFlight = null; });
    }
    return refreshInFlight;
  };

  const refreshSession = async () => {
    if (sessionState === 'INITIALIZING') setSessionState('CHECKING_SESSION');
    await coordinatedRefresh();
    return state.session;
  };

  /* ===== Multi-tab session sync (Phase 5 §25) =====
     Login in one tab updates the others; logout in one tab signs them out.
     BroadcastChannel only, no browser storage is ever used for auth sync,
     keeping the zero-storage invariant (owner rule + protection tests). */
  const AUTH_SYNC_CHANNEL = 'admission-hub-auth-v1';
  const TAB_ID = `tab-${Math.random().toString(36).slice(2, 10)}`;
  let authSyncChannel = null;
  const broadcastAuthEvent = type => {
    if (!authSyncChannel) return;
    try { authSyncChannel.postMessage({ type, source: TAB_ID, at: Date.now() }); } catch (_) {}
  };
  const handleAuthSyncMessage = payload => {
    if (!payload || typeof payload !== 'object' || payload.source === TAB_ID) return;
    if (payload.type === 'logout' || payload.type === 'logout-all') {
      if (state.session) {
        clearAuthLocalState();
        setSessionState('UNAUTHENTICATED');
        updateLauncher();
        if (!pageHost.hidden) {
          showView('login');
          message(payload.type === 'logout-all' ? 'সব device থেকে লগ আউট হয়ে গেছে।' : 'অন্য tab থেকে লগ আউট হয়েছে।', 'info');
        }
      }
    } else if (payload.type === 'login') {
      if (!state.session) void coordinatedRefresh();
    }
  };
  const setupAuthSync = () => {
    if (typeof BroadcastChannel === 'function' && !authSyncChannel) {
      authSyncChannel = new BroadcastChannel(AUTH_SYNC_CHANNEL);
      authSyncChannel.onmessage = event => handleAuthSyncMessage(event?.data);
    }
  };

  /* ===== Deep-link restore (Phase 5 §19) =====
     The anchor the user was heading to while logged out is remembered on
     open() and restored exactly once after a successful re-login. */
  const captureReturnDestination = () => {
    try {
      if (location.hash) state.returnDestination = location.hash;
    } catch (_) {}
  };
  const restoreReturnDestination = () => {
    const dest = state.returnDestination;
    if (!dest || !accountVerified(state.session)) return;
    state.returnDestination = '';
    try {
      close();
    } catch (_) {}
    try {
      const target = new URL(location.href);
      target.hash = dest;
      history.replaceState(null, '', target.pathname + target.search + target.hash);
      const el = document.getElementById(dest.slice(1));
      if (el) el.scrollIntoView();
    } catch (_) {}
  };

  /* ===== Phase 6, Step-up security challenge (§12) =====
     Sensitive actions (e.g. "log out on every device") can require a fresh
     verification. The server answers STEP_UP_REQUIRED while the session is
     still valid; the user completes the purpose-bound challenge and the
     action is retried exactly once with the one-time stepUpToken. */
  const clearStepUpTimer = () => {
    if (state.stepUp?.timer) { clearInterval(state.stepUp.timer); state.stepUp.timer = null; }
  };
  const updateStepUpExpiry = () => {
    const line = $('[data-role="step-up-expiry"]');
    if (!line || !state.stepUp) return;
    if (!state.stepUp.expiresAt) { line.hidden = true; return; }
    const remaining = state.stepUp.expiresAt - Date.now();
    line.hidden = false;
    if (remaining <= 0) {
      line.textContent = 'code-এর সময় শেষ হয়ে গেছে, বাতিল করে আবার চেষ্টা করুন।';
      clearStepUpTimer();
      return;
    }
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    line.textContent = `code আর ${minutes} মিনিট ${seconds} সেকেন্ডের জন্য বৈধ।`;
  };
  const finishStepUp = (showSigned = true) => {
    clearStepUpTimer();
    state.stepUp = null;
    if (showSigned && accountVerified(state.session)) showView('signed');
  };
  const startStepUpChallenge = async pendingAction => {
    if (!accountVerified(state.session)) return;
    state.stepUp = { pending: pendingAction, challengeRef: '', method: '', expiresAt: 0, timer: null };
    const codeInput = $('#ah-stepup-code');
    if (codeInput) codeInput.value = '';
    showView('step-up');
    message('গুরুত্বপূর্ণ কাজটি নিশ্চিত করতে একটি fresh verification পাঠানো হচ্ছে…', 'info');
    setBusy(true);
    try {
      const result = await api('/security/challenge/request', { method: 'POST', body: { purpose: 'step-up', method: 'email' } });
      if (!state.stepUp || !state.stepUp.pending) return;
      state.stepUp.challengeRef = String(result.challengeRef || '');
      state.stepUp.method = String(result.method || 'email');
      state.stepUp.expiresAt = Number(result.expiresAt || 0);
      const telegram = result.interaction?.type === 'telegram-link';
      const panel = $('[data-role="step-up-interaction"]');
      if (panel) panel.hidden = !telegram;
      if (telegram) {
        const link = $('[data-role="step-up-link"]');
        if (link) link.href = String(result.interaction.url || '');
      }
      const instruction = $('[data-role="step-up-instruction"]');
      if (instruction) instruction.textContent = telegram
        ? 'Official Telegram bot-এ START চাপুন, তারপর পাওয়া ৬ সংখ্যার code নিচে লিখুন।'
        : 'তোমার verification-এ ৬ সংখ্যার code পাঠানো হয়েছে, কোডটি নিচে লিখুন।';
      updateStepUpExpiry();
      state.stepUp.timer = setInterval(updateStepUpExpiry, 1000);
      focusWhenUnclaimed(() => $('#ah-stepup-code'), 80);
    } catch (error) {
      finishStepUp();
      message(friendlyError(error), 'error');
    } finally { setBusy(false); }
  };

  const completeLogoutAll = result => {
    clearAuthLocalState();
    setSessionState('UNAUTHENTICATED');
    broadcastAuthEvent('logout-all');
    updateLauncher();
    showView('login');
    message('সব device থেকে লগ আউট হয়েছে (' + (result.revoked ?? 0) + 'টি active session)। এখানে পুনরায় লগইন করতে হবে।', 'success');
  };

  // Single logout path for the account card AND the Profile v2 frame (which
  // calls AdmissionAccount.logout()). Before 2026-10-18 the profile button only
  // showed a "(demo)" toast and never ended the session.
  const performLogout = async () => {
    if (state.busy) return false;
    setBusy(true);
    setSessionState('LOGGING_OUT');
    try {
      // Flush in-memory signup details while the session is still valid.
      try { await syncPendingProfile({ pending: true }); } catch (_) {}
      try {
        await api('/session/logout', { method: 'POST', body: {} });
      } catch (error) {
        // An already-ended session has the same end state: signed out.
        if (!(error && (error.status === 401 || error.status === 403))) throw error;
      }
      clearAuthLocalState();
      setSessionState('UNAUTHENTICATED');
      broadcastAuthEvent('logout');
      updateLauncher(); showView('login'); message('নিরাপদভাবে লগ আউট হয়েছে।', 'success');
      return true;
    } catch (error) { setSessionState('ERROR'); message(friendlyError(error), 'error'); return false; }
    finally { setBusy(false); }
  };

  const performLogoutAll = async () => {
    if (state.busy || !accountVerified(state.session)) return false;
    setBusy(true);
    setSessionState('LOGGING_OUT');
    try {
      const result = await api('/session/logout-all', { method: 'POST', body: {} });
      completeLogoutAll(result);
      return true;
    } catch (error) {
      if (error.status === 409 && error.code === 'STEP_UP_REQUIRED') {
        // The session is still valid, the server asked for a fresh
        // verification. Run the challenge, then retry with the token.
        setSessionState('AUTHENTICATED');
        void startStepUpChallenge(async stepUpToken => {
          try {
            const result = await api('/session/logout-all', { method: 'POST', body: { stepUpToken } });
            completeLogoutAll(result);
          } catch (retryError) {
            if (retryError.status === 401 || retryError.status === 403) {
              clearAuthLocalState();
              setSessionState('UNAUTHENTICATED');
              broadcastAuthEvent('logout-all');
              updateLauncher();
              showView('login');
              message('সেশনটি আগে থেকেই শেষ হয়ে গেছে।', 'info');
            } else {
              setSessionState('ERROR');
              message(friendlyError(retryError), 'error');
            }
          }
        });
        return false;
      }
      if (error.status === 401 || error.status === 403) {
        // The session was already gone: the end state is the same.
        clearAuthLocalState();
        setSessionState('UNAUTHENTICATED');
        broadcastAuthEvent('logout-all');
        updateLauncher();
        showView('login');
        message('সেশনটি আগে থেকেই শেষ হয়ে গেছে।', 'info');
        return true;
      }
      setSessionState('ERROR');
      message(friendlyError(error), 'error');
      return false;
    } finally { setBusy(false); }
  };

  /* Phase 6, "trust this device 30 days" consent (chunk-2 Q1). Offered
     once after a login the policy flagged with trustOffer; accepting posts
     to /security/device/trust, declining just hides the prompt. */
  const updateTrustPrompt = () => {
    const prompt = $('[data-role="trust-prompt"]');
    if (!prompt) return;
    const security = state.session?.session?.security;
    prompt.hidden = !(security?.trustOffer === true && security?.trusted !== true);
  };
  const acceptDeviceTrust = async () => {
    if (state.busy || !accountVerified(state.session)) return;
    setBusy(true);
    try {
      await api('/security/device/trust', { method: 'POST', body: {} });
      if (state.session?.session) {
        state.session.session.security = { ...(state.session.session.security || {}), trusted: true, trustOffer: false };
      }
      updateTrustPrompt();
      message('এই device trusted হয়েছে-৩০ দিনের মধ্যে extra verification লাগবে না।', 'success');
    } catch (error) {
      updateTrustPrompt();
      message(friendlyError(error), 'error');
    } finally { setBusy(false); }
  };
  const declineDeviceTrust = () => {
    if (state.session?.session) {
      state.session.session.security = { ...(state.session.session.security || {}), trustOffer: false };
    }
    updateTrustPrompt();
  };

  const setAccountPageActive = active => {
    const visible = Boolean(active);
    pageHost.hidden = !visible;
    document.body.classList.toggle('ah-account-page-active', visible);
    document.documentElement.classList.remove('ah-pre');
    const app = document.getElementById('app');
    const navigation = document.getElementById('navRoot');
    [app, navigation].filter(Boolean).forEach(node => {
      node.inert = visible;
      if (visible) node.setAttribute('aria-hidden', 'true');
      else node.removeAttribute('aria-hidden');
    });
    if (visible) requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  };
  // Mount point for the Admission Sky flow (sky-onboarding.js). The design is a
  // real page of its own, so this page hosts it and steps aside; the flow asks
  // for it through window.AdmissionSkyBridge below.
  const skyMount = () => {
    let node = document.getElementById('ah-sky-flow');
    if (!node) {
      node = document.createElement('div');
      node.id = 'ah-sky-flow';
      node.hidden = true;
      pageHost.append(node);
    }
    return node;
  };
  // The welcome screen is the entry point: it is shown first, and the owner's
  // Welcome Story artboard (welcome-story.js) fills it. Its Sign Up / Sign In /
  // Google / Facebook / Guest buttons open the Sky flow in the matching mode.
  // The story's script loads after this module, so it mounts itself when ready;
  // until then the view is simply empty rather than a half-painted design.
  const showWelcome = () => {
    const welcome = pageHost.querySelector('.ah-welcome-view');
    if (welcome) welcome.classList.add('ah-welcome-live');
    showView('welcome');
    const story = window.AdmissionWelcomeStory;
    if (story) { try { story.resize(); } catch (_) {} }
  };
  // The native (pre-flow) entry for a mode, used when the Sky flow cannot open
  // -- an old cached bundle or a network failure. It is the real signup form or
  // the real login form, never an empty page.
  const showLegacyEntry = mode => {
    if (skyScriptLinked()) {
      showWelcome();
      message('নতুন সাইন-ইন পেজটি লোড হয়নি, পেজটি একবার refresh করো।', 'error');
      return;
    }
    const welcome = pageHost.querySelector('.ah-welcome-view');
    if (welcome) welcome.classList.add('ah-welcome-live');
    if (mode === 'signup') {
      state.signupJourney = true;
      state.signupStep = 'personal';
      renderView('signup');
    } else {
      state.signupJourney = false;
      state.pendingProfile = null;
      state.profileBound = false;
      renderView('login');
    }
  };
  const skyReady = () => Boolean(window.AdmissionSkyFlow && window.AdmissionSkyBridge);
  const launchSky = mode => {
    try {
      Promise.resolve(window.AdmissionSkyFlow.open(mode, takeSkyEntry()))
        .then(opened => { if (opened === false) showLegacyEntry(mode); })
        .catch(error => { console.error('[Admission Sky] open failed:', error); showLegacyEntry(mode); });
    } catch (error) {
      console.error('[Admission Sky] open failed:', error);
      showLegacyEntry(mode);
    }
  };
  let skyWaitToken = 0;
  // The page links the flow's script (index.html preloads it) whenever the flow
  // is part of this build. Match the .js asset specifically: this module injects
  // the flow's .css link itself, which would otherwise always match.
  const skyScriptLinked = () => Boolean(document.querySelector('link[href*="sky-onboarding.js"], script[src*="sky-onboarding.js"]'));
  const openSky = mode => {
    const token = ++skyWaitToken;
    if (skyReady()) { launchSky(mode); return true; }
    // sky-onboarding.js is injected by app-seed.js, which runs AFTER this file,
    // so on a cold load the flow is not defined yet. Falling back right away
    // left first-time visitors on a blank page. Wait for the flow instead, and
    // only fall back if it never arrives (old cached bundle / network failure).
    // A page that does not reference the flow at all will never load it (the
    // bare test harness), so fall back at once there rather than idling.
    if (!skyScriptLinked()) { showLegacyEntry(mode); return false; }
    const started = Date.now();
    const poll = () => {
      if (token !== skyWaitToken) return;
      if (['signed', 'telegram', 'verify', 'created'].includes(state.currentView)) return;
      if (!document.body.classList.contains('ah-account-page-active')) return;
      if (skyReady()) { launchSky(mode); return; }
      if (Date.now() - started > 8000) { showLegacyEntry(mode); return; }
      setTimeout(poll, 50);
    };
    setTimeout(poll, 0);
    return true;
  };
  const takeSkyEntry = () => { const entry = state.skyEntry || {}; state.skyEntry = null; return entry; };
  skyRouteHook = name => {
    if (!skyScriptLinked()) return false;
    const mode = name === 'signup' ? 'signup' : 'login';
    const resume = ['verify', 'telegram', 'email-ownership', 'email-intro', 'telegram-intro', 'created'].includes(name) ? 'verify' : '';
    state.skyEntry = { resume, email: String(state.verification?.email || '') };
    // Owner 2026-10-17: after logout the previous screen (signed-in card, old
    // login form or the last Sky screen) stayed painted for 1-2s while the flow
    // loaded its data. Hide it now; the page shows the Sky colour + a spinner
    // until reveal() mounts the fresh flow. Session cleanup is not touched here.
    if (state.currentView !== 'sky') {
      pageHost.querySelectorAll('.ah-account-shell [data-view]').forEach(view => { view.hidden = true; });
      const staleSky = document.getElementById('ah-sky-flow');
      if (staleSky) staleSky.hidden = true;
      delete pageHost.dataset.skyFlow;
    }
    state.currentView = 'sky';
    pageHost.dataset.currentView = 'sky';
    setAccountPageActive(true);
    openSky(mode);
    return true;
  };
  const open = options => {
    const forceWelcome = options?.forceWelcome === true;
    if (!accountVerified(state.session)) captureReturnDestination();
    setAccountPageActive(true);
    if (accountVerified(state.session)) showView('signed');
    else if (state.telegram) showView('telegram');
    else if (state.verification) showView('verify');
    else if (forceWelcome || !entryMode()) showWelcome();
    else showView('login');
    if (state.available === false && state.currentView !== 'welcome') message('Account service এখন প্রস্তুত নয়-Guest হিসেবে Dashboard ব্যবহার করতে পারো।' + unavailableHint(), 'info');
  };
  const close = () => {
    if (state.stepUp) finishStepUp(false);
    setAccountPageActive(false);
    message();
    try { launcher.focus(); } catch (_) {}
  };
  /* Owner 2026-10-17: a finished Google/Facebook redirect sign-in must land on
   * the Dashboard, not stay on the Sky signup flow. Cancels a Sky launch still
   * waiting for its script, hides the flow, ends a pending signup journey and
   * closes the account page; reveal() ignores a late Sky open afterwards. */
  const landOnDashboard = () => {
    if (!accountVerified(state.session)) return;
    state.oauthLanded = true;
    skyWaitToken += 1;
    state.signupJourney = false;
    rememberPendingSignup(false);
    const mount = document.getElementById('ah-sky-flow');
    if (mount) mount.hidden = true;
    delete pageHost.dataset.skyFlow;
    close();
    try { notify(); } catch (_) {}
  };
  const dismiss = () => {
    if (state.busy) return message('কাজটি শেষ হতে একটু সময় দাও।', 'info');
    if (state.currentView === 'signup' && state.signupStep !== 'personal') {
      const previous = { school: 'personal', college: 'school', security: 'college' }[state.signupStep];
      if (previous) { setSignupStep(previous); return; }
    }
    $('#ah-login-password').value = '';
    $('#ah-signup-password').value = '';
    $('#ah-signup-confirm').value = '';
    updatePasswordFeedback();
    if (!entryMode() && !state.session && !state.verification) {
      showView('welcome');
      return;
    }
    close();
  };
  const prefillLogin = email => { if (email) $('#ah-login-email').value = email; };
  const unavailableHint = () => {
    try {
      if (typeof location !== 'undefined' && !/(^|\.)admissionhub\.pages\.dev$/i.test(location.hostname || '')) {
        return ' Real account শুধু admissionhub.pages.dev বা admissionsky.pages.dev সাইটে খোলা যায়।';
      }
    } catch (_) {}
    return '';
  };
  const ensureAvailable = () => {
    if (state.available !== false) return true;
    message('Account service এখন প্রস্তুত নয়-Guest হিসেবে Dashboard ব্যবহার করতে পারো।' + unavailableHint(), 'info');
    return false;
  };

  const recoverPendingTelegram = async () => {
    if (!state.capabilities.telegram.available || accountVerified(state.session)) return false;
    try {
      const result = await api('/telegram/verification/pending');
      if (result?.pending && setTelegramChallenge(result)) return true;
      if (result?.selectionRequired) {
        const mode = pendingSignupMode() === 'email' ? 'email' : 'select';
        state.verification = {
          email: '',
          emailMasked: result.emailMasked || 'তোমার Email-এ',
          emailSent: mode === 'email',
          mode,
          resendUntil: 0
        };
        if (!pageHost.hidden) showView('verify');
        return true;
      }
    } catch (_) {}
    return false;
  };

  const recoverPendingAccountVerification = async () => {
    const pendingMode = pendingSignupMode();
    if (!pendingMode || state.verification || state.telegram || accountVerified(state.session)) return false;
    state.signupJourney = true;
    state.profileBound = true;
    try {
      const result = await api('/account-verification/email/status', { method: 'POST', body: {} });
      if (result?.authenticated === true && result?.emailVerified === true) {
        await establishSession(result, 'Email verification নিশ্চিত হয়েছে।', { offerPasskey: true });
        return true;
      }
      state.verification = {
        email: '',
        emailMasked: result?.emailMasked || 'তোমার Email-এ',
        emailSent: pendingMode === 'email',
        mode: pendingMode === 'email' ? 'email' : 'select',
        resendUntil: 0
      };
      return true;
    } catch (error) {
      if (['TELEGRAM_VERIFICATION_INVALID', 'SESSION_INVALID'].includes(error?.code)) {
        rememberPendingSignup(false);
        state.signupJourney = false;
        state.profileBound = false;
        return false;
      }
      state.verification = {
        email: '',
        emailMasked: 'তোমার Email-এ',
        emailSent: pendingMode === 'email',
        mode: pendingMode === 'email' ? 'email' : 'select',
        resendUntil: 0
      };
      return true;
    }
  };

  const checkEmailVerification = async ({ silent = false } = {}) => {
    if (state.emailStatusBusy || accountVerified(state.session)) return false;
    state.emailStatusBusy = true;
    const button = $('[data-role="verified-login"]');
    if (button) button.disabled = true;
    try {
      const result = await api('/account-verification/email/status', { method: 'POST', body: {} });
      if (result?.authenticated === true && result?.emailVerified === true) {
        state.signupJourney = state.signupJourney || pendingSignup();
        await establishSession(result, 'Email verification নিশ্চিত হয়েছে।', { offerPasskey: true });
        return true;
      }
      if (!silent) message('Verification এখনো শেষ হয়নি। Email-এর link খুলে ফিরে এসে আবার Check করো।', 'info');
      return false;
    } catch (error) {
      if (!silent) message(friendlyError(error), 'error');
      return false;
    } finally {
      state.emailStatusBusy = false;
      if (button) button.disabled = state.busy;
    }
  };

  const beginEmailVerification = async () => {
    if (state.busy || !state.verification) return;
    setBusy(true);
    try {
      if (state.pendingProfile && state.profileBound && !state.profileSynced) await syncPendingProfile({ pending: true });
      const result = await api('/account-verification/email/start', { method: 'POST', body: {} });
      if (result.alreadyVerified) {
        setBusy(false);
        await checkEmailVerification();
        return;
      }
      if (result.verification?.sent !== true) throw Object.assign(new Error('delivery-not-confirmed'), { code: 'VERIFICATION_UNAVAILABLE' });
      state.verification.emailSent = true;
      state.verification.mode = 'email';
      if (state.signupJourney || pendingSignup()) rememberPendingSignup(true, 'email');
      state.verification.emailMasked = result.verification?.emailMasked || state.verification.emailMasked;
      startResendCooldown(result.verification?.resendAfter || state.resendCooldownSeconds);
      showView('verify');
    } catch (error) { message(friendlyError(error), 'error'); }
    finally { setBusy(false); }
  };

  // The email-intro button used to call beginEmailVerification directly, which
  // sent the Firebase link and skipped every OTP provider. Route it through the
  // OTP chain like created-continue does; the Worker itself falls back to the
  // Firebase link when every provider is exhausted. Only when the OTP family is
  // unavailable does the button still request the link directly.
  const beginEmailIntro = async () => {
    if (state.capabilities?.emailOwnership?.available) { await beginEmailOwnership(); return; }
    await beginEmailVerification();
  };

  const openEmailInbox = () => {
    const email = String(state.verification?.email || '').toLowerCase();
    const domain = email.split('@')[1] || '';
    const target = /(^|\.)gmail\.com$/.test(domain) ? 'https://mail.google.com/'
      : /(^|\.)(outlook|hotmail|live)\.(com|co\.uk)$/.test(domain) ? 'https://outlook.live.com/mail/'
        : /(^|\.)yahoo\./.test(domain) ? 'https://mail.yahoo.com/'
          : 'https://mail.google.com/';
    const opened = window.open(target, '_blank', 'noopener,noreferrer');
    if (!opened) message('Inbox নতুন tab-এ খোলা যায়নি, তোমার Email app খুলে verification link দেখো।', 'info');
  };

  const beginTelegramVerification = async () => {
    if (state.busy || !state.verification || !state.capabilities.telegram.available) return;
    setBusy(true);
    try {
      if (state.pendingProfile && state.profileBound && !state.profileSynced) await syncPendingProfile({ pending: true });
      const result = await api('/telegram/verification/start', { method: 'POST', body: { turnstileToken: await humanToken() } });
      if (!setTelegramChallenge(result)) throw new Error('Telegram যাচাই এখন পাওয়া যাচ্ছে না।');
      if (state.signupJourney || pendingSignup()) rememberPendingSignup(true, 'telegram');
      showView('telegram');
    } catch (error) {
      if (error.retryAfter > 0 && state.telegram) state.telegram.resendUntil = Date.now() + error.retryAfter * 1000;
      message(friendlyError(error), 'error');
    } finally { setBusy(false); }
  };

  const beginEmailOwnership = async () => {
    if (state.busy || !state.verification || !state.capabilities.emailOwnership.available) return;
    setBusy(true);
    try {
      if (state.pendingProfile && state.profileBound && !state.profileSynced) await syncPendingProfile({ pending: true });
      const result = await api('/email-ownership/start', { method: 'POST', body: { turnstileToken: await humanToken() } });
      if (result.alreadyVerified) {
        setBusy(false);
        await checkEmailVerification();
        return;
      }
      if (state.signupJourney || pendingSignup()) rememberPendingSignup(true, 'email-ownership');
      // The Worker sends the 6-digit code while any OTP provider has quota and
      // falls back to the Firebase link once they are exhausted. Both routes are
      // the same button, so route on what the server reports sending.
      if (result.delivery?.method === 'firebase-link') {
        // The Worker already sent the link as the last resort, so reveal the
        // waiting panel with mode 'email'. Calling beginEmailVerification here
        // would fire a second sendOobCode and burn the free daily quota.
        state.verification.emailSent = true;
        state.verification.mode = 'email';
        state.ownership = null;
        startResendCooldown(Number(result.delivery?.resendAfter || state.resendCooldownSeconds));
        showView('verify');
        return;
      }
      if (!setOwnershipChallenge(result.ownership)) throw new Error('Email OTP যাচাই এখন পাওয়া যাচ্ছে না।');
      showView('email-ownership');
    } catch (error) { message(friendlyError(error), 'error'); }
    finally { setBusy(false); }
  };

  // Descope magic link (otp-m). Only the attemptId is kept locally (10 min);
  // the link token itself is never stored, it is read once from the URL.
  // The attemptId rides in a 10-minute first-party cookie (no Web Storage); it is
  // useless without the HttpOnly verification ticket the Worker already holds.
  const MAGIC_COOKIE = 'ah_magic_v1';
  const MAGIC_ATTEMPT = /^[A-Za-z0-9_-]{24,96}$/;
  const writeMagicAttempt = attemptId => {
    const ok = MAGIC_ATTEMPT.test(String(attemptId || ''));
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${MAGIC_COOKIE}=${ok ? attemptId : ''}; Path=/; Max-Age=${ok ? 600 : 0}; SameSite=Lax${secure}`;
  };
  const readMagicAttempt = () => {
    const row = String(document.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${MAGIC_COOKIE}=`));
    const attemptId = row ? row.slice(row.indexOf('=') + 1) : '';
    return MAGIC_ATTEMPT.test(attemptId) ? { attemptId } : null;
  };
  const beginEmailMagicLink = async () => {
    if (state.busy || !state.verification || !state.capabilities.emailOwnership.available) return;
    setBusy(true);
    try {
      if (state.pendingProfile && state.profileBound && !state.profileSynced) await syncPendingProfile({ pending: true });
      const result = await api('/email-ownership/start', { method: 'POST', body: { turnstileToken: await humanToken(), method: 'magic-link' } });
      if (result.alreadyVerified) { setBusy(false); await checkEmailVerification(); return; }
      if (result.delivery?.method !== 'email-magic-link' || !result.ownership?.attemptId) throw new Error('Login link এখন পাঠানো যাচ্ছে না। Email OTP ব্যবহার করো।');
      if (state.signupJourney || pendingSignup()) rememberPendingSignup(true, 'select');
      writeMagicAttempt(result.ownership.attemptId);
      message(`Login link পাঠানো হয়েছে ${result.ownership.emailMasked || 'তোমার Email-এ'}। Email খুলে link চাপো (Spam-ও দেখো)।`, 'success');
    } catch (error) { message(friendlyError(error), 'error'); }
    finally { setBusy(false); }
  };
  const consumeMagicLink = async token => {
    const saved = readMagicAttempt();
    writeMagicAttempt('');
    open();
    if (!saved?.attemptId) {
      message('Login link মেয়াদোত্তীর্ণ বা অন্য browser-এ খোলা হয়েছে। যে browser থেকে link চেয়েছিলে সেখানে খোলো, অথবা নতুন link নাও।', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await api('/email-ownership/verify', { method: 'POST', body: { attemptId: saved.attemptId, token } });
      state.verificationLabel = 'Email';
      state.ownership = null;
      await establishSession(result, 'তোমার Email মালিকানা যাচাই হয়েছে।');
    } catch (error) { message(friendlyError(error), 'error'); }
    finally { setBusy(false); }
  };

  const setOwnershipChallenge = info => {
    if (!info?.attemptId) return false;
    state.ownership = {
      attemptId: info.attemptId,
      expiresAt: Number(info.expiresAt || 0),
      resendUntil: Date.now() + Math.max(0, Number(info.resendAfter || 0)) * 1000
    };
    const input = $('#ah-ownership-code');
    if (input) input.value = '';
    renderOwnershipDigits();
    updateOwnershipResend();
    return true;
  };

  const renderOwnershipDigits = () => {
    const value = String($('#ah-ownership-code')?.value || '');
    $('[data-view="email-ownership"]')?.querySelectorAll('[data-otp-digit]').forEach((cell, index) => {
      const digit = value[index] || '';
      cell.textContent = digit;
      cell.classList.toggle('is-filled', Boolean(digit));
    });
  };

  const updateOwnershipResend = () => {
    const button = $('[data-role="ownership-resend"]');
    if (!button) return;
    const until = Number(state.ownership?.resendUntil || 0);
    const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    button.disabled = state.busy || remaining > 0;
    if (remaining > 0) {
      button.textContent = `আবার পাঠান (${remaining}s)`;
      if (!state.ownershipTimer) state.ownershipTimer = setInterval(updateOwnershipResend, 1000);
    } else {
      button.textContent = 'নতুন code নিন';
      if (state.ownershipTimer) { clearInterval(state.ownershipTimer); state.ownershipTimer = null; }
    }
  };

  const requestBackup = async (contact = '') => {
    if (state.busy || !state.session || !state.capabilities.backup.available) return;
    setBusy(true);
    try {
      const result = await api(backupApiPath('/backup/request'), {
        method: 'POST',
        body: { purpose: 'account-backup', ...(contact ? { contact } : {}), turnstileToken: await humanToken() }
      });
      state.backup = { attemptId: result.attemptId, purpose: 'account-backup', interaction: result.interaction || null };
      $('#ah-backup-code').value = '';
      $('#ah-backup-contact').value = '';
      configureBackupView(state.backup.interaction);
      showView('backup');
      message(result.interaction ? 'Official Telegram bot খুলে START চাপুন, তারপর পাওয়া ৬ সংখ্যার কোড লিখুন।' : 'যাচাই কোড পাঠানো হয়েছে।', 'success');
    } catch (error) { message(friendlyError(error), 'error'); }
    finally { setBusy(false); }
  };

  const initialize = () => {
    if (state.initialized || !document.body) return;
    state.initialized = true;
    setupAuthSync();
    // Phase 7 hotfix (owner directive): the floating account launcher pill is
    // removed from every page. The Profile tab (my-profile) is the single
    // account entry point, guests see Sign In, signed-in users see the
    // Account card. The element is still created so state tracking
    // (dataset.authenticated) and focus fallbacks keep working.
    document.body.append(pageHost);
    /* This shell renders after index.html's AhI18n boot pass, so any
       [data-bn]/[data-en] copy inside it would keep the markup language. Apply
       once here; AhI18n.set() re-applies on every later language change. */
    if (window.AhI18n && typeof window.AhI18n.apply === 'function') window.AhI18n.apply();
    launcher.addEventListener('click', open);
    $('.ah-account-close').addEventListener('click', dismiss);
    const welcomeLanguage = $('[data-role="welcome-language"]');
    if (welcomeLanguage) {
      // Reflect the stored choice, then only persist on a real user change.
      // The boot call must not write, or opening the page would stamp the
      // default over a language the user already chose elsewhere.
      const current = window.AhI18n ? window.AhI18n.get() : 'bn';
      welcomeLanguage.value = current;
      welcomeLanguage.addEventListener('change', () => setWelcomeLanguage(welcomeLanguage.value));
      setWelcomeLanguage(current, { persist: false });
    }
    // The owner's Welcome Story (welcome-story.js) paints the welcome view. Its
    // stylesheet and script are loaded here rather than linked in index.html so
    // the entry's look travels with the story, exactly like the Sky flow's.
    // The story injects its own markup into #ah-welcome-story and finds the
    // language picker by [data-role="welcome-language"].
    if (!document.getElementById('ah-welcome-story-style')) {
      const storyStyle = document.createElement('link');
      storyStyle.id = 'ah-welcome-story-style';
      storyStyle.rel = 'stylesheet';
      storyStyle.href = 'welcome-story.css?v=welcome-story-20261018-v3';
      document.head.append(storyStyle);
    }
    if (!document.getElementById('ah-welcome-story')) {
      const storyHost = document.createElement('div');
      storyHost.id = 'ah-welcome-story';
      const welcomeView = pageHost.querySelector('.ah-welcome-view');
      if (welcomeView) welcomeView.append(storyHost);
    }
    if (!document.querySelector('script[src*="welcome-story.js"]')) {
      const storyScript = document.createElement('script');
      storyScript.src = 'welcome-story.js?v=welcome-story-20261018-v3';
      storyScript.defer = true;
      document.head.append(storyScript);
    }
    setupDobDropdowns();
    setupInstitutionSearch('school');
    setupInstitutionSearch('college');
    setupEducationAssist();
    setupHelpToggles();
    prefillRememberedEmail();
    $('#ah-telegram-code').addEventListener('input', renderTelegramDigits);
    $('#ah-signup-name').addEventListener('input', () => {
      const name = normalizedName();
      showFieldFeedback('name-feedback', !name ? '' : validName(name) ? '✓ Looks good, your name is set' : 'Please enter at least 2 characters.', validName(name) ? 'valid' : name ? 'error' : '');
    });
    $('#ah-signup-password').addEventListener('input', updatePasswordFeedback);
    $('#ah-signup-confirm').addEventListener('input', updatePasswordFeedback);
    const EYE_OPEN = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 12S6 6.8 12 6.8 20.5 12 20.5 12 18 17.2 12 17.2 3.5 12 3.5 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>';
    const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4.5 20 19.5"/><path d="M9.9 7.1A8.6 8.6 0 0 1 12 6.8c6 0 8.5 5.2 8.5 5.2a17 17 0 0 1-3.3 3.7M6 8.6A16 16 0 0 0 3.5 12S6 17.2 12 17.2c1 0 1.9-.2 2.7-.4"/></svg>';
    pageHost.querySelectorAll('[data-password-target]').forEach(button => button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordTarget);
      if (!input) return;
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      button.innerHTML = reveal ? EYE_OFF : EYE_OPEN;
      button.setAttribute('aria-label', reveal ? 'Password লুকান' : 'Password দেখুন');
    }));

    $('[data-role="welcome-signup"]').addEventListener('click', () => {
      if (openSky('signup')) return;
      state.signupJourney = true;
      state.signupStep = 'personal';
      showView('signup');
    });
    $('[data-role="welcome-login"]').addEventListener('click', () => {
      if (openSky('login')) return;
      state.signupJourney = false;
      state.pendingProfile = null;
      state.profileBound = false;
      showView('login');
    });
    $('[data-role="continue-guest"]').addEventListener('click', () => {
      rememberEntry('guest');
      state.signupJourney = false;
      close();
      navigateDashboard();
      notify();
    });
    $('[data-role="welcome-telegram-button"] button')?.addEventListener('click', () => signInWithTelegram());
    $('[data-role="signup-next-education"]').addEventListener('click', () => setSignupStep('school', { validate: true }));
    $('[data-role="signup-back-personal"]')?.addEventListener('click', () => setSignupStep('personal'));
    $('[data-role="signup-next-college"]').addEventListener('click', () => setSignupStep('college', { validate: true }));
    $('[data-role="signup-back-school"]')?.addEventListener('click', () => setSignupStep('school'));
    $('[data-role="signup-next-security"]').addEventListener('click', () => setSignupStep('security', { validate: true }));
    $('[data-role="signup-back-education"]').addEventListener('click', () => setSignupStep('college'));
    pageHost.querySelectorAll('[data-signup-step-button]').forEach(button => button.addEventListener('click', () => {
      const target = button.dataset.signupStepButton === 'education' ? 'school' : button.dataset.signupStepButton;
      const order = ['personal', 'school', 'college', 'security'];
      const current = order.indexOf(state.signupStep);
      const next = order.indexOf(target);
      if (next <= current) setSignupStep(target);
      else setSignupStep(target, { validate: true });
    }));

    $('[data-role="show-forgot"]').addEventListener('click', () => {
      $('#ah-forgot-email').value = $('#ah-login-email').value;
      $('#ah-login-password').value = '';
      showView('forgot');
      focusWhenUnclaimed(() => $('#ah-forgot-email'), 30);
    });
    $('[data-role="forgot-back"]').addEventListener('click', () => { prefillLogin($('#ah-forgot-email').value); showView('login'); });
    $('[data-role="login-back"]')?.addEventListener('click', () => { if (state.busy) return; message(); showWelcome(); });
    $('[data-view="forgot"]').addEventListener('submit', async event => {
      event.preventDefault();
      if (state.busy || !ensureAvailable()) return;
      const email = $('#ah-forgot-email').value.trim();
      if (!email || !$('#ah-forgot-email').checkValidity()) return message('সঠিক Email address লিখো।', 'error');
      setBusy(true);
      try {
        await api('/password-reset', { method: 'POST', body: { email, turnstileToken: await humanToken() } });
        message('এই Email-এ অ্যাকাউন্ট থাকলে reset link পাঠানোর অনুরোধ নেওয়া হয়েছে। কিছুক্ষণ পর Inbox, Spam ও Promotions দেখো।', 'success');
      } catch (error) { message(friendlyError(error), 'error'); }
      finally { setBusy(false); }
    });

    $('[data-role="enter-app"]').addEventListener('click', () => { close(); navigateDashboard(); });
    $('[data-role="open-email"]').addEventListener('click', openEmailInbox);
    $('[data-role="verified-login"]').addEventListener('click', () => checkEmailVerification());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !pageHost.hidden && state.currentView === 'verify' && state.verification?.mode === 'email') checkEmailVerification({ silent: true });
    });
    const journeyConsole = $('[data-native-welcome-visual="journey-console-v1"]');
    if (journeyConsole && !reducedMotion()) {
      journeyConsole.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch') return;
        const rect = journeyConsole.getBoundingClientRect();
        const rotateY = ((event.clientX - rect.left) / Math.max(1, rect.width) - .5) * 3.5;
        const rotateX = ((event.clientY - rect.top) / Math.max(1, rect.height) - .5) * -2.5;
        journeyConsole.style.setProperty('--ah-console-rx', `${rotateX}deg`);
        journeyConsole.style.setProperty('--ah-console-ry', `${rotateY}deg`);
      });
      journeyConsole.addEventListener('pointerleave', () => {
        journeyConsole.style.removeProperty('--ah-console-rx');
        journeyConsole.style.removeProperty('--ah-console-ry');
      });
    }

    $('[data-role="show-signup"]').addEventListener('click', () => {
      state.signupJourney = true;
      state.signupStep = 'personal';
      $('#ah-signup-email').value = $('#ah-login-email').value;
      $('#ah-login-password').value = '';
      showView('signup');
    });
    pageHost.querySelectorAll('[data-role="show-login"]').forEach(button => button.addEventListener('click', () => {
      state.signupJourney = false;
      if (!state.profileBound) state.pendingProfile = null;
      prefillLogin($('#ah-signup-email').value);
      $('#ah-signup-password').value = '';
      $('#ah-signup-confirm').value = '';
      showView('login');
    }));
    $('[data-role="verified-continue"]').addEventListener('click', () => {
      if (state.afterVerified === 'security-setup') showView('security-setup');
      else showReadyTransition();
    });
    $('[data-role="passkey-login"]').addEventListener('click', loginWithPasskey);
    $('[data-role="passkey-add"]').addEventListener('click', addPasskey);
    $('[data-role="setup-passkey"]').addEventListener('click', () => addPasskey({ onboarding: true }));
    $('[data-role="setup-skip"]').addEventListener('click', () => {
      if (state.signupJourney || pendingSignup()) showReadyTransition();
      else {
        showView('signed');
        message('Passkey এখন যোগ করা হয়নি, অন্য Log In পথগুলো চালু আছে।', 'info');
      }
    });

    $('[data-view="signup"]').addEventListener('submit', async event => {
      event.preventDefault();
      if (state.busy || !ensureAvailable()) return;
      if (!validatePersonal()) { setSignupStep('personal'); validatePersonal(); return; }
      if (!validateSchool()) { setSignupStep('school'); validateSchool(); return; }
      if (!validateCollege()) { setSignupStep('college'); validateCollege(); return; }
      if (!validateSecurity()) { setSignupStep('security'); validateSecurity(); return; }
      const email = $('#ah-signup-email').value.trim();
      const password = $('#ah-signup-password').value;
      state.pendingProfile = collectProfile();
      state.profileBound = false;
      state.profileSynced = false;
      state.profilePendingAttempted = false;
      state.signupJourney = true;
      setBusy(true);
      try {
        const result = await api('/signup', { method: 'POST', signupFlow: true, body: { email, password, turnstileToken: await humanToken() } });
        const selectionRequired = result.verification?.selectionRequired === true;
        const emailSent = result.verification?.sent === true;
        if (!selectionRequired && !emailSent) throw Object.assign(new Error('delivery-not-confirmed'), { code: 'VERIFICATION_UNAVAILABLE' });
        state.profileBound = true;
        rememberPendingSignup(true, selectionRequired ? 'select' : 'email');
        state.verification = {
          email,
          emailMasked: result.verification?.emailMasked || email,
          emailSent,
          mode: selectionRequired ? 'select' : 'email',
          resendUntil: 0
        };
        clearTelegramTimer();
        state.telegram = null;
        await syncPendingProfile({ pending: true });
        if (emailSent) startResendCooldown(result.verification?.resendAfter || state.resendCooldownSeconds);
        showView('created');
      } catch (error) {
        if (error.code === 'EMAIL_ALREADY_IN_USE') {
          clearResendCooldown();
          state.verification = null;
          state.pendingProfile = null;
          state.profileBound = false;
          state.signupJourney = false;
          rememberPendingSignup(false);
          prefillLogin(email);
          showView('login');
        } else if (error.code === 'VERIFICATION_UNAVAILABLE') {
          state.verification = null;
          state.profileBound = false;
          rememberPendingSignup(false);
          prefillLogin(email);
          showView('login');
          message('Account তৈরি হয়ে থাকতে পারে, কিন্তু কোনো verification message পাঠানো হয়নি। একটু পরে এই Email দিয়ে Log In করে method বেছে নাও।', 'error');
          return;
        }
        message(friendlyError(error), 'error');
      } finally {
        $('#ah-signup-password').value = '';
        $('#ah-signup-confirm').value = '';
        updatePasswordFeedback();
        setBusy(false);
      }
    });

    $('[data-view="login"]').addEventListener('submit', async event => {
      event.preventDefault();
      if (state.busy || !ensureAvailable()) return;
      const email = $('#ah-login-email').value.trim();
      const password = $('#ah-login-password').value;
      if (!email || !$('#ah-login-email').checkValidity()) return message('সঠিক ইমেইল ঠিকানা লিখুন।', 'error');
      if (password.length < 8) return message('পাসওয়ার্ডটি সঠিকভাবে লিখুন।', 'error');
      rememberedEmail = $('#ah-login-remember')?.checked ? email : '';
      setBusy(true);
      try {
        const result = await api('/login', { method: 'POST', body: { email, password, remember: $('#ah-login-remember')?.checked === true, turnstileToken: await humanToken() } });
        if (result.authenticated === true) {
          await establishSession(result, 'যাচাইকৃত অ্যাকাউন্টে লগইন হয়েছে।');
        } else if (result.verification?.reason === 'new-device') {
          // The account is already verified; Phase-6 is asking us to confirm the
          // *device* once. Calling this an unverified account made the student
          // repeat a verification they had already completed.
          state.verification = {
            email,
            emailMasked: result.verification?.emailMasked || email,
            emailSent: false,
            mode: 'select',
            newDevice: true,
            resendUntil: 0
          };
          state.telegram = null;
          showView('verify');
          message('তোমার account যাচাই করা আছে। নিরাপত্তার জন্য শুধু এই ডিভাইসটি একবার নিশ্চিত করো।', 'info');
        } else if (result.verification?.selectionRequired === true) {
          state.verification = {
            email,
            emailMasked: result.verification?.emailMasked || email,
            emailSent: false,
            mode: 'select',
            resendUntil: 0
          };
          state.telegram = null;
          showView('verify');
          message('এই অ্যাকাউন্টটি এখনো যাচাইকৃত নয়। Gmail/ইমেইল অথবা Telegram-একটি পদ্ধতি বেছে নিন।', 'info');
        } else if (setTelegramChallenge(result.verification?.telegram)) {
          state.verification = { email, emailMasked: result.verification?.emailMasked || email, emailSent: false, mode: 'select', resendUntil: 0 };
          showView('telegram');
        } else {
          throw Object.assign(new Error('অ্যাকাউন্ট যাচাই সম্পন্ন হয়নি।'), { code: 'EMAIL_NOT_VERIFIED' });
        }
      } catch (error) {
        if (error.code === 'EMAIL_NOT_VERIFIED') {
          clearResendCooldown();
          state.verification = { email, emailMasked: email, emailSent: false, mode: 'email', resendUntil: 0 };
          showView('verify');
          message('Account verification বাকি। এই মুহূর্তে নতুন Email পাঠানো হয়নি-resend option ব্যবহার করতে পারো।', 'info');
        } else message(friendlyError(error), 'error');
      } finally { $('#ah-login-password').value = ''; setBusy(false); }
    });

    $('[data-view="google-link"]').addEventListener('submit', async event => {
      event.preventDefault();
      if (state.busy) return;
      const email = $('#ah-link-email').value.trim();
      const password = $('#ah-link-password').value;
      if (!email || !$('#ah-link-email').checkValidity() || password.length < 8) return message('আগের অ্যাকাউন্টের ইমেইল ও পাসওয়ার্ড লিখুন।', 'error');
      setBusy(true);
      try {
        const result = await linkGoogle(email, password);
        await establishSession(result, 'Google আগের account-এ নিরাপদে যুক্ত হয়েছে।');
      } catch (error) { message(friendlyError(error), 'error'); }
      finally { $('#ah-link-password').value = ''; setBusy(false); }
    });
    $('[data-role="link-cancel"]').addEventListener('click', () => { $('#ah-link-password').value = ''; prefillLogin($('#ah-link-email').value); showView('login'); });

    // One button starts the whole email journey: the Worker tries the OTP
    // providers in order and falls back to the Firebase link on its own. Only
    // when the OTP family is unavailable does the method picker remain reachable.
    $('[data-role="created-continue"]').addEventListener('click', async () => {
      if (state.busy) return;
      if (state.capabilities?.emailOwnership?.available) { await beginEmailOwnership(); return; }
      showView('verify');
    });
    $('[data-role="email-ownership-start"]').addEventListener('click', beginEmailOwnership);
    $('[data-role="email-magiclink-start"]')?.addEventListener('click', beginEmailMagicLink);
    $('[data-role="ownership-back"]').addEventListener('click', () => showView('verify'));
    $('[data-role="ownership-resend"]').addEventListener('click', async () => {
      if (state.busy || Date.now() < Number(state.ownership?.resendUntil || 0)) return;
      setBusy(true);
      try {
        const result = await api('/email-ownership/start', { method: 'POST', body: { turnstileToken: await humanToken() } });
        if (result.delivery?.method === 'firebase-link') {
          state.verification.emailSent = true;
          state.verification.mode = 'email';
          state.ownership = null;
          startResendCooldown(Number(result.delivery?.resendAfter || state.resendCooldownSeconds));
          showView('verify');
          message('নিরাপদ verification link পাঠানো হয়েছে।', 'info');
          return;
        }
        if (!setOwnershipChallenge(result.ownership)) throw new Error('নতুন code পাঠানো যায়নি।');
        message('নতুন code পাঠানো হয়েছে।', 'info');
      } catch (error) { message(friendlyError(error), 'error'); }
      finally { setBusy(false); }
    });
    $('#ah-ownership-code').addEventListener('input', event => {
      event.target.value = String(event.target.value || '').replace(/\D/g, '').slice(0, 6);
      renderOwnershipDigits();
    });
    $('[data-view="email-ownership"]').addEventListener('submit', async event => {
      event.preventDefault();
      if (state.busy || !state.ownership) return;
      const code = String($('#ah-ownership-code').value || '').replace(/\D/g, '');
      if (!/^\d{6}$/.test(code)) return message('৬ সংখ্যার code লিখুন।', 'error');
      setBusy(true);
      try {
        const result = await api('/email-ownership/verify', {
          method: 'POST',
          body: { attemptId: state.ownership.attemptId, code }
        });
        state.verificationLabel = 'Email';
        clearOwnershipTimer();
        state.ownership = null;
        await establishSession(result, 'তোমার Email মালিকানা যাচাই হয়েছে।');
      } catch (error) {
        $('#ah-ownership-code').value = '';
        renderOwnershipDigits();
        message(friendlyError(error), 'error');
      } finally { setBusy(false); }
    });
    $('[data-role="email-verification-start"]').addEventListener('click', () => showView('email-intro'));
    $('[data-role="email-intro-continue"]').addEventListener('click', beginEmailIntro);
    $('[data-role="email-intro-back"]').addEventListener('click', () => showView('verify'));
    $('[data-role="whatsapp-info"]').addEventListener('click', () => showView('whatsapp-info'));
    $('[data-role="whatsapp-info-back"]').addEventListener('click', () => showView('verify'));
    $('[data-role="telegram-verification-start"]').addEventListener('click', () => showView('telegram-intro'));
    $('[data-role="telegram-intro-continue"]').addEventListener('click', beginTelegramVerification);
    $('[data-role="telegram-intro-back"]').addEventListener('click', () => showView('verify'));
    $('[data-role="telegram-alternative"]').addEventListener('click', () => showView('telegram-intro'));
    $('[data-role="telegram-email-back"]').addEventListener('click', () => {
      if (state.signupJourney || pendingSignup()) rememberPendingSignup(true, state.verification?.mode === 'email' ? 'email' : 'select');
      showView('verify');
      message(state.verification?.mode === 'select'
        ? 'অন্য যাচাই পদ্ধতি বেছে নিতে পারেন।'
        : 'Email link দিয়েও একই account verify করতে পারো।', 'info');
    });
    $('[data-view="telegram"]').addEventListener('submit', async event => {
      event.preventDefault();
      if (state.busy || !state.telegram) return;
      const code = $('#ah-telegram-code').value.trim();
      if (!/^\d{6}$/.test(code)) return message('Telegram-এর ৬ সংখ্যার কোড লিখুন।', 'error');
      setBusy(true);
      renderTelegramState('checking');
      try {
        const result = await api('/telegram/verification/verify', {
          method: 'POST',
          body: { attemptId: state.telegram.attemptId, code }
        });
        renderTelegramState('success');
        await establishSession(result, 'Telegram account verification সফল। তোমার Admission Hub account সক্রিয় হয়েছে।');
      } catch (error) {
        $('#ah-telegram-code').value = '';
        renderTelegramDigits();
        const mode = error.code === 'OTP_EXPIRED' ? 'expired'
          : error.code === 'OTP_LOCKED' ? 'locked'
            : error.code === 'TELEGRAM_VERIFICATION_PENDING' ? 'waiting'
              : ['OTP_INVALID', 'INVALID_INPUT'].includes(error.code) ? 'wrong'
                : error.code === 'ACCOUNT_CONFLICT' ? 'conflict' : 'unavailable';
        renderTelegramState(mode);
        message(friendlyError(error), 'error');
      } finally { setBusy(false); }
    });
    $('[data-role="telegram-resend"]').addEventListener('click', async () => {
      if (state.busy || !state.telegram) return;
      const remaining = telegramResendRemaining();
      if (remaining > 0) return message(`আরও ${remaining.toLocaleString('bn-BD')} সেকেন্ড পর নতুন কোড নিতে পারবেন।`, 'info');
      setBusy(true);
      renderTelegramState('connecting');
      try {
        const result = await api('/telegram/verification/resend', { method: 'POST', body: {} });
        if (!setTelegramChallenge(result)) throw new Error('Telegram যাচাই এখন পাওয়া যাচ্ছে না।');
        message('নতুন একবারের Telegram লিংক তৈরি হয়েছে। Bot খুলে START চাপুন।', 'success');
      } catch (error) {
        if (error.retryAfter > 0 && state.telegram) state.telegram.resendUntil = Date.now() + error.retryAfter * 1000;
        renderTelegramState(error.code === 'OTP_LOCKED' ? 'locked' : 'unavailable');
        message(friendlyError(error), 'error');
      } finally { setBusy(false); }
    });
    $('[data-role="verify-back"]').addEventListener('click', () => {
      const email = state.verification?.email || $('#ah-resend-email').value;
      clearResendCooldown(); state.verification = null; state.telegram = null; clearTelegramTimer();
      $('#ah-resend-email').value = ''; $('#ah-resend-password').value = '';
      state.signupJourney = false;
      state.pendingProfile = null;
      state.profileBound = false;
      rememberPendingSignup(false);
      prefillLogin(email);
      showView('login');
    });

    $('[data-role="resend-form"]').addEventListener('submit', async event => {
      event.preventDefault();
      if (state.busy || !ensureAvailable()) return;
      const remaining = resendSecondsRemaining();
      if (remaining > 0) return message(`আরও ${remaining.toLocaleString('bn-BD')} সেকেন্ড পর আবার পাঠাতে পারবেন।`, 'info');
      const email = $('#ah-resend-email').value.trim();
      const password = $('#ah-resend-password').value;
      if (!email || !$('#ah-resend-email').checkValidity() || password.length < 8) return message('ইমেইল ও পাসওয়ার্ড সঠিকভাবে লিখুন।', 'error');
      setBusy(true);
      try {
        const result = await api('/verification/resend', { method: 'POST', body: { email, password, turnstileToken: await humanToken() } });
        if (result.alreadyVerified) {
          clearResendCooldown(); state.verification = null; prefillLogin(email); showView('login');
          message('ইমেইল ইতিমধ্যে যাচাইকৃত, এখন লগইন করুন।', 'success');
        } else {
          if (result.verification?.sent !== true) throw Object.assign(new Error('delivery-not-confirmed'), { code: 'VERIFICATION_UNAVAILABLE' });
          state.verification = { email, emailMasked: result.verification?.emailMasked || email, emailSent: true, mode: 'email', resendUntil: 0 };
          startResendCooldown(result.verification?.resendAfter || state.resendCooldownSeconds);
          showView('verify');
          message('নতুন verification Email পাঠানো হয়েছে।', 'success');
        }
      } catch (error) {
        if (error.retryAfter > 0) startResendCooldown(error.retryAfter);
        message(friendlyError(error), 'error');
      } finally { $('#ah-resend-password').value = ''; setBusy(false); }
    });

    $('[data-role="backup-start"]').addEventListener('click', () => {
      if (state.busy || !state.session || !state.capabilities.backup.available) return;
      const mode = state.capabilities.backup.contactInput;
      if (mode === 'none') return requestBackup();
      $('[data-role="backup-contact-mode"]').textContent = mode === 'required' ? '(প্রয়োজন)' : '(ঐচ্ছিক)';
      $('#ah-backup-contact').required = mode === 'required';
      $('#ah-backup-contact').value = '';
      showView('backup-prepare');
      setTimeout(() => $('#ah-backup-contact')?.focus(), 30);
    });
    $('[data-view="backup-prepare"]').addEventListener('submit', event => {
      event.preventDefault();
      if (state.busy) return;
      const contact = $('#ah-backup-contact').value.trim();
      if (state.capabilities.backup.contactInput === 'required' && !contact) return message('আন্তর্জাতিক ফরম্যাটে মোবাইল নম্বর লিখুন।', 'error');
      if (contact && !/^\+[1-9]\d{7,14}$/.test(contact)) return message('মোবাইল নম্বর +8801XXXXXXXXX ফরম্যাটে লিখুন।', 'error');
      requestBackup(contact);
    });
    $('[data-role="backup-prepare-cancel"]').addEventListener('click', () => { $('#ah-backup-contact').value = ''; showView('signed'); });
    $('[data-view="backup"]').addEventListener('submit', async event => {
      event.preventDefault();
      if (state.busy || !state.backup) return;
      const code = $('#ah-backup-code').value.trim();
      if (!/^\d{6}$/.test(code)) return message('৬ সংখ্যার কোড লিখুন।', 'error');
      setBusy(true);
      try {
        await api(backupApiPath('/backup/verify'), {
          method: 'POST',
          body: {
            attemptId: state.backup.attemptId,
            purpose: state.backup.purpose,
            code
          }
        });
        state.backup = null;
        $('#ah-backup-code').value = '';
        showView('signed');
        message('বিকল্প verification সফল হয়েছে। তোমার একই account চালু আছে।', 'success');
      } catch (error) { $('#ah-backup-code').value = ''; message(friendlyError(error), 'error'); }
      finally { setBusy(false); }
    });
    $('[data-role="backup-cancel"]').addEventListener('click', () => { state.backup = null; $('#ah-backup-code').value = ''; configureBackupView(null); showView('signed'); });

    $('[data-view="step-up"]').addEventListener('submit', async event => {
      event.preventDefault();
      if (state.busy || !state.stepUp?.challengeRef || !state.stepUp?.pending) return;
      const code = $('#ah-stepup-code').value.trim();
      if (!/^\d{6}$/.test(code)) return message('৬ সংখ্যার code লিখুন।', 'error');
      setBusy(true);
      try {
        const result = await api('/security/challenge/verify', {
          method: 'POST',
          body: { challengeRef: state.stepUp.challengeRef, purpose: 'step-up', code }
        });
        const pending = state.stepUp?.pending;
        const token = String(result.stepUpToken || '');
        clearStepUpTimer();
        state.stepUp = null;
        $('#ah-stepup-code').value = '';
        if (pending) await pending(token);
      } catch (error) {
        $('#ah-stepup-code').value = '';
        message(friendlyError(error), 'error');
      } finally { setBusy(false); }
    });
    $('[data-role="step-up-cancel"]').addEventListener('click', () => {
      if (state.busy) return;
      const challengeRef = state.stepUp?.challengeRef;
      if (challengeRef) {
        void api('/security/challenge/cancel', { method: 'POST', body: { challengeRef, purpose: 'step-up' } }).catch(() => {});
      }
      finishStepUp();
    });

    $('[data-role="trust-accept"]').addEventListener('click', () => { void acceptDeviceTrust(); });
    $('[data-role="trust-decline"]').addEventListener('click', () => { declineDeviceTrust(); });

    $('[data-role="logout"]').addEventListener('click', () => { void performLogout(); });

    $('[data-role="logout-all"]').addEventListener('click', async () => {
      if (state.busy) return;
      const button = $('[data-role="logout-all"]');
      const ARMED_LABEL = 'নিশ্চিত করো, সব device বন্ধ হবে';
      if (!button.dataset.armed) {
        button.dataset.armed = '1';
        button.dataset.label = button.textContent;
        button.textContent = ARMED_LABEL;
        setTimeout(() => { if (button.isConnected && button.dataset.armed) { delete button.dataset.armed; button.textContent = button.dataset.label; delete button.dataset.label; } }, 4000);
        return;
      }
      delete button.dataset.armed;
      const armedLabel = button.dataset.label;
      delete button.dataset.label;
      const done = await performLogoutAll();
      if (button.isConnected) button.textContent = done ? 'সব device থেকে Log Out' : armedLabel;
    });

    let returnedFromEmail = false;
    let returnedFromPasswordReset = false;
    let googleHandoff = false;
    let magicToken = '';
    try {
      const current = new URL(location.href);
      // ?magic=1&t=…: Descope login link. Take the token, then strip it from the
      // address bar/history at once so it is never bookmarked, shared or logged.
      if (current.searchParams.get('magic') === '1') {
        const t = String(current.searchParams.get('t') || '');
        magicToken = /^[A-Za-z0-9._~-]{16,2048}$/.test(t) ? t : '';
        current.searchParams.delete('magic');
        current.searchParams.delete('t');
        history.replaceState(null, '', current.pathname + current.search + current.hash);
      }
      // ?ahGoogle=1: another host (or Chrome opened from an in-app browser)
      // handed the Google sign-in over to admissionsky.pages.dev.
      googleHandoff = current.searchParams.get('ahGoogle') === '1';
      if (googleHandoff) {
        current.searchParams.delete('ahGoogle');
        history.replaceState(null, '', current.pathname + current.search + current.hash);
      }
      returnedFromEmail = current.searchParams.get('firebaseVerified') === '1' || current.searchParams.get('emailVerified') === '1';
      returnedFromPasswordReset = current.searchParams.get('passwordReset') === '1';
      if (returnedFromEmail || returnedFromPasswordReset) {
        current.searchParams.delete('firebaseVerified');
        current.searchParams.delete('emailVerified');
        current.searchParams.delete('passwordReset');
        history.replaceState(null, '', current.pathname + current.search + current.hash);
      }
    } catch (_) {}

    // Welcome and callback screens must never wait for a slow account-status request.
    if (returnedFromPasswordReset) {
      open();
      showView('login');
      message('Password বদলানো শেষ করে থাকলে নতুন Password দিয়ে Log In করো।', 'info');
    } else if (returnedFromEmail) {
      state.signupJourney = pendingSignup();
      state.verification = { email: '', emailMasked: 'তোমার Email-এ', emailSent: true, mode: 'email', resendUntil: 0 };
      open();
    } else if (!entryMode() && !pendingSignup()) {
      open({ forceWelcome: true });
    }

    const configReady = api(canaryConfigPath()).then(result => {
      applyCapabilities(result?.auth || {});
      const cooldown = Number(result?.auth?.verificationEmail?.resendCooldownSeconds);
      if (Number.isFinite(cooldown) && cooldown >= 1 && cooldown <= 86400) state.resendCooldownSeconds = Math.ceil(cooldown);
      return true;
    }).catch(() => { state.available = false; applyCapabilities({ available: false }); return false; });
    const sessionReady = refreshSession().then(session => {
      // Only the SERVER-verified session releases the startup hide. No cached
      // cookie, browser hint or guessed identity is accepted as authority.
      if (accountVerified(session) && pageHost.hidden) {
        document.documentElement.classList.remove('ah-pre');
      }
      return session;
    });
    Promise.allSettled([configReady, sessionReady]).then(async () => {
      await finishOAuthRedirect();
      await finishTelegramLogin();
      if (accountVerified(state.session)) return;
      if (magicToken) { const t = magicToken; magicToken = ''; await consumeMagicLink(t); return; }
      if (googleHandoff) { signInWithGoogle(); return; }
      if (returnedFromPasswordReset) {
        open();
        showView('login');
        message('Password বদলানো শেষ করে থাকলে নতুন Password দিয়ে Log In করো।', 'info');
        return;
      }
      await recoverPendingTelegram();
      if (returnedFromEmail) {
        state.signupJourney = pendingSignup();
        state.verification = state.verification || { email: '', emailMasked: 'তোমার Email-এ', emailSent: true, mode: 'email', resendUntil: 0 };
        open();
        const verified = await checkEmailVerification();
        if (!verified && !accountVerified(state.session)) message('Email-এর link খোলা হয়েছে। নিশ্চিত ফল দেখতে Check আবার চাপতে পারো।', 'info');
        return;
      }
      if (!state.telegram && !state.verification) await recoverPendingAccountVerification();
      if (accountVerified(state.session)) return;
      if (pageHost.hidden && (!entryMode() || state.telegram || state.verification)) {
        open({ forceWelcome: !state.telegram && !state.verification });
      }
    });
  };

  // Everything the Admission Sky flow needs, and nothing it does not. The flow
  // never touches cookies or fetch: it asks here, and this module decides. That
  // keeps one owner of the session and one owner of the verification ticket.
  const skyApi = async (path, options) => api(path, options);
  const rememberTicket = result => {
    // /signup and the login path hand back the pre-verification ticket. The
    // start endpoints read it from the cookie jar, so the flow's steps must run
    // inside this page, which they do.
    const selection = result && result.verification;
    if (!selection || selection.selectionRequired !== true) return false;
    state.signupJourney = state.signupJourney || pendingSignup() || true;
    state.verification = {
      email: state.verification?.email || '',
      emailMasked: selection.emailMasked || 'তোমার Email-এ',
      emailSent: false,
      mode: 'select',
      resendUntil: 0
    };
    return true;
  };
  const bindPendingProfile = async () => {
    // The ticket-scoped write is the only one available before the account is
    // verified, so it backs whichever verification method the student picks
    // first. A failed write leaves the in-memory details intact for a retry.
    if (state.pendingProfile && state.profileBound && !state.profileSynced) await syncPendingProfile({ pending: true });
  };
  const startEmailChallenge = async () => {
    await bindPendingProfile();
    const result = await skyApi('/email-ownership/start', { method: 'POST', body: { turnstileToken: await humanToken() } });
    if (result.alreadyVerified) { await checkEmailVerification(); return { resendAfter: 0, alreadyVerified: true }; }
    if (result.delivery?.method === 'firebase-link') {
      // Every OTP provider is out of quota: the Worker sent a Firebase link
      // instead of a 6-digit code. Report that to the flow so it shows the link
      // panel and never a code box the student cannot fill.
      state.verification.emailSent = true;
      state.verification.mode = 'email';
      startResendCooldown(Number(result.delivery?.resendAfter || state.resendCooldownSeconds));
      return { link: true, resendAfter: Number(result.delivery?.resendAfter || state.resendCooldownSeconds), emailMasked: result.delivery.emailMasked };
    }
    if (!setOwnershipChallenge(result.ownership)) throw new Error('Email যাচাই এখন পাওয়া যাচ্ছে না।');
    return { link: false, resendAfter: Number(result.ownership?.resendAfter || state.resendCooldownSeconds), emailMasked: result.ownership?.emailMasked };
  };
  const verifyEmailChallenge = async code => {
    if (!state.ownership) throw new Error('CHALLENGE_INVALID');
    const result = await skyApi('/email-ownership/verify', {
      method: 'POST', body: { attemptId: state.ownership.attemptId, code }
    });
    state.verificationLabel = 'Email';
    clearOwnershipTimer();
    state.ownership = null;
    await establishSession(result, 'তোমার Email মালিকানা যাচাই হয়েছে।');
    return result;
  };
  const startTelegramChallenge = async () => {
    await bindPendingProfile();
    const result = await skyApi('/telegram/verification/start', { method: 'POST', body: { turnstileToken: await humanToken() } });
    if (!setTelegramChallenge(result)) throw new Error('Telegram যাচাই এখন পাওয়া যাচ্ছে না।');
    if (state.signupJourney || pendingSignup()) rememberPendingSignup(true, 'telegram');
    return { resendAfter: telegramResendRemaining() || state.telegram?.resendAfter || 45 };
  };
  const verifyTelegramChallenge = async code => {
    if (!state.telegram) throw new Error('TELEGRAM_VERIFICATION_INVALID');
    const result = await skyApi('/telegram/verification/verify', {
      method: 'POST', body: { attemptId: state.telegram.attemptId, code }
    });
    await establishSession(result, 'Telegram account verification সফল। তোমার Admission Hub account সক্রিয় হয়েছে।');
    return result;
  };
  const skyBridge = Object.freeze({
    friendly: friendlyError,
    takeNotice() { const pending = state.skyPendingNotice; state.skyPendingNotice = null; return pending || null; },
    mount: skyMount,
    reveal(node) {
      if (state.oauthLanded && accountVerified(state.session)) return;
      const mount = skyMount();
      if (node && node !== mount) mount.append(node);
      mount.hidden = false;
      pageHost.dataset.skyFlow = 'on';
      pageHost.dataset.currentView = 'sky';
      setAccountPageActive(true);
    },
    conceal() {
      const mount = document.getElementById('ah-sky-flow');
      if (mount) mount.hidden = true;
      delete pageHost.dataset.skyFlow;
      close();
    },
    showSignup() { if (window.AdmissionSkyFlow) window.AdmissionSkyFlow.open('signup'); },
    showLogin() { if (window.AdmissionSkyFlow) window.AdmissionSkyFlow.open('login'); },
    welcome() {
      // The flow's own back button on its first step returns here: hide the
      // flow and re-show the welcome screen the student came from.
      const mount = document.getElementById('ah-sky-flow');
      if (mount) mount.hidden = true;
      delete pageHost.dataset.skyFlow;
      showWelcome();
    },
    continueGuest() {
      rememberEntry('guest');
      state.signupJourney = false;
      close();
      navigateDashboard();
      notify();
    },
    capabilities: async () => ({
      email: Boolean(state.capabilities.emailPassword.available),
      telegram: Boolean(state.capabilities.telegram.available),
      emailOwnership: Boolean(state.capabilities.emailOwnership.available),
      google: Boolean(state.capabilities.google.available),
      facebook: Boolean(state.capabilities.facebook?.available),
      telegramLogin: Boolean(state.capabilities.telegramLogin?.available),
      passkey: Boolean(state.capabilities.passkey.available && passkeyBrowserReady())
    }),
    institutions: async kind => {
      const wanted = kind === 'college' ? 'college' : 'school';
      const shape = rows => rows.map(item => ({ id: String(item.id || item.name), name: String(item.name || ''), district: String(item.district || '') }));
      // The curated offline index ships with the app and is the only source
      // that always answers. The institutions API is optional, so a 404 or an
      // empty list must fall back to it instead of leaving the school/college
      // search with no suggestions and the signup step stuck.
      const offline = () => shape(
        (Array.isArray(window.AdmissionHubInstitutionsV1) ? window.AdmissionHubInstitutionsV1 : [])
          .filter(item => item.type === wanted)
      );
      try {
        const response = await fetch(`/api/institutions/v1/${wanted}`, { headers: { Accept: 'application/json' } });
        const payload = await response.json();
        const rows = Array.isArray(payload?.items) ? payload.items : [];
        const mapped = shape(rows);
        return mapped.length ? mapped : offline();
      } catch (_) { return offline(); }
    },
    signup: async (email, password, profile) => {
      const result = await skyApi('/signup', {
        method: 'POST',
        signupFlow: true,
        body: { email, password, remember: true, turnstileToken: await humanToken() }
      });
      state.verification = state.verification || {};
      state.verification.email = email;
      // The signup handler discards any profile in the body, so the flow's own
      // details (name, DOB, school, college) must be carried to the
      // ticket-scoped /profile/pending write on the next step. Without this the
      // dashboard profile is always empty.
      state.pendingProfile = {
        fullName: profile.fullName,
        mobile: profile.mobile || '',
        dob: profile.dob,
        school: profile.school ? { id: profile.school.id, name: profile.school.name, district: profile.school.district || '' } : null,
        higherInstitution: profile.higherInstitution ? { id: profile.higherInstitution.id, name: profile.higherInstitution.name, district: profile.higherInstitution.district || '' } : null
      };
      state.profileBound = true;
      state.profileSynced = false;
      state.profilePendingAttempted = false;
      rememberTicket(result);
      return result;
    },
    login: async (email, password) => {
      const result = await skyApi('/login', { method: 'POST', body: { email, password, remember: true, turnstileToken: await humanToken() } });
      if (result.authenticated === true) {
        await establishSession(result, 'তোমার account-এ প্রবেশ হয়েছে।');
        return result;
      }
      state.verification = state.verification || {};
      state.verification.email = email;
      rememberTicket(result);
      return result;
    },
    google: async () => {
      // Full-page redirect only: the page leaves for Google and the sign-in
      // finishes in finishOAuthRedirect() when it comes back.
      try { await startGoogleRedirect(); } catch (error) {
        const text = googleErrorText(error);
        throw Object.assign(new Error(text), { userMessage: text });
      }
      return true;
    },
    facebook: async () => {
      let accessToken;
      try {
        accessToken = await facebookAccessToken();
      } catch (error) {
        const failure = new Error(error?.message || facebookMessage(error));
        failure.userMessage = error?.userMessage || error?.message || facebookMessage(error);
        throw failure;
      }
      if (accessToken === OAUTH_REDIRECT) return true;
      let result;
      try {
        result = await skyApi('/facebook', { method: 'POST', body: { accessToken } });
      } catch (error) {
        if (error?.code === 'EMAIL_NOT_VERIFIED') error.userMessage = 'তোমার Facebook অ্যাকাউন্টে নিশ্চিত করা কোনো ইমেইল নেই, ইমেইল দিয়ে সাইন আপ করো।';
        throw error;
      }
      await establishSession(result, 'Facebook \u09a6\u09bf\u09af\u09bc\u09c7 \u09a4\u09cb\u09ae\u09be\u09b0 \u098f\u0995\u0987 account-\u098f \u09aa\u09cd\u09b0\u09ac\u09c7\u09b6 \u09b9\u09af\u09bc\u09c7\u099b\u09c7\u0964');
      return true;
    },
    telegram: async () => signInWithTelegram(),
    passkey: async () => {
      if (!passkeyBrowserReady()) return false;
      try {
        const begin = await skyApi('/passkey/authentication/begin', { method: 'POST', body: {} });
        const credential = await navigator.credentials.get({ publicKey: publicKeyOptions(begin.options, false) });
        if (!credential) return false;
        const result = await skyApi('/passkey/authentication/finish', {
          method: 'POST', body: { challengeId: begin.challengeId, response: assertionPayload(credential) }
        });
        await establishSession(result, 'Passkey দিয়ে প্রবেশ হয়েছে।', { offerPasskey: false });
        return true;
      } catch (_) { return false; }
    },
    forgot: async email => skyApi('/password-reset', { method: 'POST', body: { email, turnstileToken: await humanToken() } }),
    startEmail: startEmailChallenge,
    checkEmail: () => checkEmailVerification({ silent: true }),
    verifyEmail: verifyEmailChallenge,
    startTelegram: startTelegramChallenge,
    verifyTelegram: verifyTelegramChallenge,
    finish: () => {
      const mount = document.getElementById('ah-sky-flow');
      if (mount) mount.hidden = true;
      delete pageHost.dataset.skyFlow;
      message();
      close();
      notify();
    }
  });
  window.AdmissionSkyBridge = skyBridge;

  window.AdmissionAccount = Object.freeze({
    open,
    refresh: refreshSession,
    getSession: () => state.session,
    getSessionState: () => getSessionState(),
    logout: async () => { setAccountPageActive(true); return performLogout(); },
    terminateAllSessions: async () => { setAccountPageActive(true); return performLogoutAll(); },
    getEntryMode: entryMode,
    isGuest: () => entryMode() === 'guest' && !accountVerified(state.session),
    isVerified: () => accountVerified(state.session),
    requireVerified() {
      const allowed = accountVerified(state.session);
      if (!allowed) {
        open();
        message(entryMode() === 'guest'
          ? 'এই কাজটি account-এর জন্য। Guest হিসেবেই পড়াশোনা চালাতে পারো, অথবা সুবিধাটি ব্যবহার করতে Sign Up/Log In করো।'
          : 'এই কাজের জন্য আগে Sign Up বা Log In করো।', 'info');
      }
      return allowed;
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();

/* Locked app surface (2026-10-16): no pull-down, drag, bounce or pinch while the
   account page (Welcome / Sign Up / Sign In) is on screen. Only a container that
   really can scroll (a legacy long form) keeps its own scrolling. */
;(function () {
  if (window.__ahLockInit) return;
  window.__ahLockInit = true;
  var d = document, startY = 0;
  function active() { return !!(d.body && d.body.classList.contains('ah-account-page-active')); }
  function canScroll(el, dy) {
    while (el && el !== d.body && el !== d.documentElement) {
      if (el.nodeType === 1) {
        var oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
          if (dy > 0 && el.scrollTop > 0) return true;
          if (dy < 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
        }
      }
      el = el.parentNode;
    }
    return false;
  }
  d.addEventListener('touchstart', function (e) { if (e.touches && e.touches[0]) startY = e.touches[0].clientY; }, { passive: true });
  d.addEventListener('touchmove', function (e) {
    if (!active()) return;
    if (e.touches.length > 1) { e.preventDefault(); return; }
    var dy = e.touches[0].clientY - startY;
    if (!canScroll(e.target, dy)) e.preventDefault();
  }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) {
    d.addEventListener(t, function (e) { if (active()) e.preventDefault(); }, { passive: false });
  });
  function pin() { if (active() && (window.scrollX || window.scrollY)) window.scrollTo(0, 0); }
  window.addEventListener('scroll', pin, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener('scroll', pin);
})();
