export const AUTH_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  // A failed Turnstile check is not "bad input" any more than a weak password is:
  // reporting it as INVALID_INPUT told the student the form was wrong when the
  // real problem was the human check (owner report 2026-10-24).
  HUMAN_CHECK_FAILED: 'HUMAN_CHECK_FAILED',
  CLIENT_UPDATE_REQUIRED: 'CLIENT_UPDATE_REQUIRED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  RATE_LIMITED: 'RATE_LIMITED',
  RESEND_COOLDOWN: 'RESEND_COOLDOWN',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_LOCKED: 'OTP_LOCKED',
  OTP_USED: 'OTP_USED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_ALREADY_IN_USE: 'EMAIL_ALREADY_IN_USE',
  DISPOSABLE_EMAIL: 'DISPOSABLE_EMAIL',
  ACCOUNT_LINK_REQUIRED: 'ACCOUNT_LINK_REQUIRED',
  ACCOUNT_CONFLICT: 'ACCOUNT_CONFLICT',
  GOOGLE_UNAVAILABLE: 'GOOGLE_UNAVAILABLE',
  TELEGRAM_VERIFICATION_UNAVAILABLE: 'TELEGRAM_VERIFICATION_UNAVAILABLE',
  TELEGRAM_VERIFICATION_PENDING: 'TELEGRAM_VERIFICATION_PENDING',
  TELEGRAM_VERIFICATION_INVALID: 'TELEGRAM_VERIFICATION_INVALID',
  PASSKEY_UNAVAILABLE: 'PASSKEY_UNAVAILABLE',
  PASSKEY_INVALID: 'PASSKEY_INVALID',
  PASSKEY_NOT_FOUND: 'PASSKEY_NOT_FOUND',
  PASSKEY_REGISTRATION_REQUIRED: 'PASSKEY_REGISTRATION_REQUIRED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  ACCOUNT_STATE_INVALID: 'ACCOUNT_STATE_INVALID',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  SESSION_INVALID: 'SESSION_INVALID',
  VERIFICATION_UNAVAILABLE: 'VERIFICATION_UNAVAILABLE',
  BACKUP_UNAVAILABLE: 'BACKUP_UNAVAILABLE',
  STEP_UP_REQUIRED: 'STEP_UP_REQUIRED',
  CHALLENGE_INVALID: 'CHALLENGE_INVALID',
  PROFILE_VERSION_CONFLICT: 'PROFILE_VERSION_CONFLICT',
  PUBLIC_PROFILE_NOT_FOUND: 'PUBLIC_PROFILE_NOT_FOUND',
  AUTH_PROVIDER_UNAVAILABLE: 'AUTH_PROVIDER_UNAVAILABLE',
  DELIVERY_UNAVAILABLE: 'DELIVERY_UNAVAILABLE',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
});

const DEFAULTS = Object.freeze({
  [AUTH_ERROR_CODES.INVALID_INPUT]: Object.freeze({ status: 400, message: 'তথ্যটি সঠিকভাবে লিখুন।' }),
  [AUTH_ERROR_CODES.HUMAN_CHECK_FAILED]: Object.freeze({ status: 400, message: 'মানব যাচাই সম্পন্ন হয়নি। পেজটি একবার রিফ্রেশ করে আবার চেষ্টা করুন।' }),
  [AUTH_ERROR_CODES.CLIENT_UPDATE_REQUIRED]: Object.freeze({ status: 409, message: 'Admission Hub-এর নতুন সংস্করণ চালু হয়েছে, পেজটি একবার রিফ্রেশ করে আবার চেষ্টা করুন।' }),
  [AUTH_ERROR_CODES.NOT_CONFIGURED]: Object.freeze({ status: 503, message: 'অ্যাকাউন্ট সেবা এখনো প্রস্তুত নয়।' }),
  [AUTH_ERROR_CODES.RATE_LIMITED]: Object.freeze({ status: 429, message: 'অনেকবার চেষ্টা হয়েছে, একটু পরে আবার চেষ্টা করুন।' }),
  [AUTH_ERROR_CODES.RESEND_COOLDOWN]: Object.freeze({ status: 429, message: 'নতুন কোড পাঠাতে একটু অপেক্ষা করুন।' }),
  [AUTH_ERROR_CODES.OTP_INVALID]: Object.freeze({ status: 401, message: 'কোডটি সঠিক নয়।' }),
  [AUTH_ERROR_CODES.OTP_EXPIRED]: Object.freeze({ status: 410, message: 'কোডের সময় শেষ হয়েছে, নতুন কোড নিন।' }),
  [AUTH_ERROR_CODES.OTP_LOCKED]: Object.freeze({ status: 429, message: 'অনেকবার ভুল কোড দেওয়া হয়েছে, অপেক্ষার সময় শেষ হলে নতুন কোড নিন।' }),
  [AUTH_ERROR_CODES.OTP_USED]: Object.freeze({ status: 409, message: 'এই কোডটি ইতিমধ্যে ব্যবহার হয়েছে।' }),
  [AUTH_ERROR_CODES.INVALID_CREDENTIALS]: Object.freeze({ status: 401, message: 'ইমেইল বা পাসওয়ার্ড সঠিক নয়।' }),
  [AUTH_ERROR_CODES.EMAIL_ALREADY_IN_USE]: Object.freeze({ status: 409, message: 'এই ইমেইলে অ্যাকাউন্ট আছে, লগইন করুন।' }),
  [AUTH_ERROR_CODES.DISPOSABLE_EMAIL]: Object.freeze({ status: 400, message: 'এই ইমেইলে কোড পাঠানো সম্ভব না। শুধু Gmail, Yahoo, iCloud, Hotmail বা Outlook ইমেইল ব্যবহার করো।' }),
  [AUTH_ERROR_CODES.ACCOUNT_LINK_REQUIRED]: Object.freeze({ status: 409, message: 'একই ইমেইলের আগের অ্যাকাউন্টে একবার পাসওয়ার্ড দিয়ে Google যুক্ত করুন।' }),
  [AUTH_ERROR_CODES.ACCOUNT_CONFLICT]: Object.freeze({ status: 409, message: 'এই পরিচয়টি অন্য একটি অ্যাকাউন্টের সঙ্গে যুক্ত, নিরাপত্তার জন্য লগইন বন্ধ রাখা হয়েছে।' }),
  [AUTH_ERROR_CODES.GOOGLE_UNAVAILABLE]: Object.freeze({ status: 503, message: 'Google দিয়ে প্রবেশ এখন পাওয়া যাচ্ছে না, ইমেইল দিয়ে চেষ্টা করুন।' }),
  [AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_UNAVAILABLE]: Object.freeze({ status: 503, message: 'Telegram যাচাই এখন পাওয়া যাচ্ছে না, ইমেইল যাচাই ব্যবহার করুন।' }),
  [AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_PENDING]: Object.freeze({ status: 409, message: 'Telegram-এ পরিচয় নিশ্চিত হওয়ার অপেক্ষা চলছে।' }),
  [AUTH_ERROR_CODES.TELEGRAM_VERIFICATION_INVALID]: Object.freeze({ status: 401, message: 'অ্যাকাউন্ট যাচাইয়ের session সঠিক নয় বা সময় শেষ হয়েছে, আবার লগইন অথবা সাইনআপ করুন।' }),
  [AUTH_ERROR_CODES.PASSKEY_UNAVAILABLE]: Object.freeze({ status: 503, message: 'এই ডিভাইসে Passkey এখন পাওয়া যাচ্ছে না, অন্য পদ্ধতি ব্যবহার করুন।' }),
  [AUTH_ERROR_CODES.PASSKEY_INVALID]: Object.freeze({ status: 401, message: 'Passkey যাচাই হয়নি, আবার চেষ্টা করুন।' }),
  [AUTH_ERROR_CODES.PASSKEY_NOT_FOUND]: Object.freeze({ status: 404, message: 'এই Passkey-এর সঙ্গে কোনো অ্যাকাউন্ট পাওয়া যায়নি।' }),
  [AUTH_ERROR_CODES.PASSKEY_REGISTRATION_REQUIRED]: Object.freeze({ status: 409, message: 'আগে অ্যাকাউন্টে ঢুকে এই ডিভাইসে Passkey যোগ করুন।' }),
  [AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED]: Object.freeze({ status: 403, message: 'ইমেইলে পাঠানো যাচাইয়ের লিংকে ক্লিক করে তারপর লগইন করুন।' }),
  [AUTH_ERROR_CODES.WEAK_PASSWORD]: Object.freeze({ status: 400, message: 'কমপক্ষে ৮ অক্ষরের শক্তিশালী পাসওয়ার্ড দিন।' }),
  [AUTH_ERROR_CODES.ACCOUNT_DISABLED]: Object.freeze({ status: 403, message: 'এই অ্যাকাউন্টটি এখন ব্যবহার করা যাচ্ছে না।' }),
  [AUTH_ERROR_CODES.ACCOUNT_STATE_INVALID]: Object.freeze({ status: 409, message: 'অ্যাকাউন্টের অবস্থা পরিবর্তন করা যায়নি, আবার চেষ্টা করুন।' }),
  [AUTH_ERROR_CODES.ACCOUNT_NOT_FOUND]: Object.freeze({ status: 404, message: 'অ্যাকাউন্টটি খুঁজে পাওয়া যায়নি।' }),
  [AUTH_ERROR_CODES.SESSION_INVALID]: Object.freeze({ status: 401, message: 'নিরাপদ সেশন পাওয়া যায়নি।' }),
  [AUTH_ERROR_CODES.VERIFICATION_UNAVAILABLE]: Object.freeze({ status: 503, message: 'যাচাইয়ের ইমেইল এখন পাঠানো যাচ্ছে না, একটু পরে আবার চেষ্টা করুন।' }),
  [AUTH_ERROR_CODES.BACKUP_UNAVAILABLE]: Object.freeze({ status: 503, message: 'বিকল্প যাচাই এখন পাওয়া যাচ্ছে না, অন্য পদ্ধতি ব্যবহার করুন।' }),
  [AUTH_ERROR_CODES.STEP_UP_REQUIRED]: Object.freeze({ status: 409, message: 'এই গুরুত্বপূর্ণ কাজটি নিশ্চিত করতে একটি fresh security verification দরকার।' }),
  [AUTH_ERROR_CODES.CHALLENGE_INVALID]: Object.freeze({ status: 409, message: 'Security verification সঠিক নয় বা সময় শেষ হয়ে গেছে, আবার চেষ্টা করুন।' }),
  [AUTH_ERROR_CODES.PROFILE_VERSION_CONFLICT]: Object.freeze({ status: 409, message: 'Profile-এ একই সময়ে অন্য জায়গা থেকে পরিবর্তন হয়েছে, আবার দেখে সংরক্ষণ করুন।' }),
  [AUTH_ERROR_CODES.PUBLIC_PROFILE_NOT_FOUND]: Object.freeze({ status: 404, message: 'এই public profile পাওয়া যায়নি।' }),
  [AUTH_ERROR_CODES.AUTH_PROVIDER_UNAVAILABLE]: Object.freeze({ status: 503, message: 'অ্যাকাউন্ট সেবা সাময়িকভাবে পাওয়া যাচ্ছে না, একটু পরে চেষ্টা করুন।' }),
  [AUTH_ERROR_CODES.DELIVERY_UNAVAILABLE]: Object.freeze({ status: 503, message: 'ইমেইল এখন সাময়িকভাবে পাঠানো যাচ্ছে না, একটু পরে চেষ্টা করুন।' }),
  [AUTH_ERROR_CODES.STORAGE_UNAVAILABLE]: Object.freeze({ status: 503, message: 'অ্যাকাউন্ট সেবা সাময়িকভাবে ব্যস্ত, একটু পরে চেষ্টা করুন।' }),
  [AUTH_ERROR_CODES.INTERNAL_ERROR]: Object.freeze({ status: 500, message: 'অপ্রত্যাশিত সমস্যা হয়েছে, আবার চেষ্টা করুন।' })
});

export class NativeAuthError extends Error {
  constructor(code, options = {}) {
    const fallback = DEFAULTS[code] || DEFAULTS[AUTH_ERROR_CODES.INTERNAL_ERROR];
    super(String(options.message || fallback.message));
    this.name = 'NativeAuthError';
    this.code = DEFAULTS[code] ? code : AUTH_ERROR_CODES.INTERNAL_ERROR;
    this.status = Number(options.status || fallback.status);
    this.retryAfter = Math.max(0, Math.ceil(Number(options.retryAfter || 0)));
    this.safe = true;
  }

  toPublic() {
    return Object.freeze({
      code: this.code,
      message: this.message,
      ...(this.retryAfter ? { retryAfter: this.retryAfter } : {})
    });
  }
}

export const failAuth = (code, options) => { throw new NativeAuthError(code, options); };

export function asNativeAuthError(error) {
  if (error instanceof NativeAuthError) return error;
  return new NativeAuthError(AUTH_ERROR_CODES.INTERNAL_ERROR);
}

export function errorFromRepository(result) {
  if (!result || !result.error) return result;
  throw new NativeAuthError(result.error, { retryAfter: result.retryAfter });
}
