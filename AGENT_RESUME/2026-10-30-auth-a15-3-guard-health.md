# 2026-10-30 — A1.5 ③ গার্ড স্বাস্থ্য + ১৫ মিনিটের চেক

**মডিউল:** AU-OB-03 (নিরীক্ষণ ও অ্যালার্ট) · **ফেজ:** A1.5 ③

**কী হলো:** `.github/workflows/guard-health.yml` যোগ করা হলো। প্রতি ১৫ মিনিটে
main-এর ৮টা গার্ডের (App Shell, Cloudflare Native Auth, Auth Foundation, Auth
Identity, Email Gateway, Account Retirement, Voice Agent, visual-guard) সর্বশেষ
run দেখে; একটা লাল হলে Telegram-এ খবর যায়, সব সবুজ হলে চুপ থাকে। আগে শুধু রাতে
একবার ২৪ ঘণ্টার রিপোর্ট হতো — একটা গার্ড লাল হলে সারাদিন কেউ জানত না।

**নিরাপত্তা:** নিজের secret জোড়া (`GUARD_TELEGRAM_*`) আগে দেখে, তারপর generic;
OTP বট (AdmissionHubVerifyBot) থেকে পাঠানো হলে থেমে যায় — ছাত্ররা যে অ্যাকাউন্ট
থেকে কোড পায় সেখান থেকে গার্ড-অ্যালার্ট গেলে বিভ্রান্তি হতো।

**শেষ হওয়ার শর্ত:** token ছাড়া ৭টা endpoint 4xx ✅ (আগেই) · preview origin ব্লক ✅
· staging-এ secret সরালে অ্যালার্ট ⬜ (লাইভ যাচাই বাকি)।

**Rollback:** ফাইলটা মুছে দিলেই পুরোনো অবস্থায় ফেরত; কোনো কোড বা deploy ছোঁয়া হয়নি।
