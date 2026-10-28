/* Admission Sky, Welcome Story v5 (owner's preview).
 *
 * Ported from Admission_Sky___Welcome_Story_v5__preview_.html. The preview's
 * buttons only showed a toast; here Sign Up / Sign In / Google / Facebook /
 * Guest call window.AdmissionSkyBridge, which account-access.js owns. The story
 * never talks to the API itself.
 */

(()=>{
const TEMPLATE=`<main class="app splash" id="app">
<i class="deskbg"></i><i class="cl"></i><i class="cl"></i>
<div class="top" id="top"><span class="mk"><svg><use href="#mk"/></svg></span><span>Admission <em>Sky</em></span></div>
<div class="band" id="band"><div class="fit" id="fit">
<div class="sc" id="sp"></div><div class="sc" id="a"></div>
<div class="td" id="td">
<i class="tdi b" style="left:6px;top:40px;width:150px;height:100px;--r:-14deg;--c:#9DB7FF;--d:.1s"></i><i class="tdi b" style="left:236px;top:24px;width:150px;height:96px;--r:10deg;--c:#FFB59E;--d:.2s"></i>
<i class="tdi pp" style="left:20px;top:190px;width:92px;height:124px;--r:8deg;--d:.3s"></i><i class="tdi" style="left:300px;top:170px;width:62px;height:62px;--r:-8deg;background:#FFE08A;--d:.4s"></i>
<i class="tdi b" style="left:290px;top:260px;width:96px;height:130px;--r:-10deg;--c:#C9E8E0;--d:.35s"></i><i class="tdi mug2" style="left:300px;top:450px;width:72px;height:72px;--r:0deg;--d:.5s"></i>
<i class="tdi b" style="left:-20px;top:440px;width:160px;height:96px;--r:12deg;--c:#D5CCFF;--d:.45s"></i><i class="tdi" style="left:130px;top:566px;width:130px;height:12px;--r:-20deg;background:#FF7A59;border-radius:6px;--d:.6s"></i>
<i class="tdi pp" style="left:230px;top:540px;width:100px;height:70px;--r:14deg;--d:.55s"></i></div>
<div class="cam" id="cam"><b class="hp"></b><b class="hf" style="top:380px"></b><b class="hf" style="top:424px"></b><b class="hf" style="top:468px"></b><b class="hb"></b>
<div class="dev"><div class="scr" id="scr"><i class="isl"></i><div class="sbar"><span>৯:৪১</span><i></i></div>
<div class="sc vw" id="msg"></div><div class="sc vw" id="hm"></div><div class="sc vw" id="b"></div><div class="sc vw" id="d"></div><div class="sc vw" id="c"></div>
<div class="tb" id="tb"><i><svg viewBox="0 0 24 24"><path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/></svg>হোম</i><i><svg viewBox="0 0 24 24"><path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2Z"/></svg>AI</i><i><svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="m9 12 2 2 4-4"/></svg>পরীক্ষা</i><i><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>রুটিন</i></div>
<div class="lnc" id="lnc"><div class="lnt"><svg width="62" height="62" viewBox="0 0 120 120"><use href="#mk"/></svg></div></div>
<div class="fing" id="fing"><svg viewBox="0 0 44 100"><rect x="4" y="0" width="36" height="110" rx="18" fill="#EDBE96"/><rect x="11" y="8" width="22" height="20" rx="10" fill="#F8DCC4"/></svg></div>
</div></div></div>
<div class="sc" id="fin"></div>
<div class="tag" id="tag"></div><div class="pip" id="pip"></div>
</div></div>
<div class="cta" id="cta"><button class="go" id="go" type="button">Get Started <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button></div>
<i class="rip"></i><i class="rip"></i>
<section class="auth" id="auth">
<button class="bk2" id="bk" type="button" aria-label="back"><svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg></button>
<div class="hd"><div class="tile"><svg viewBox="0 0 120 120"><path class="chv" d="M30 94 60 54 90 94"/><g class="cap"><path class="cf" d="M60 16 92 29 60 42 28 29Z"/><path d="M42 36v9c0 5 36 5 36 0v-9M92 29v16"/></g><path class="str" d="M100 14l3 8 8 3-8 3-3 8-3-8-8-3 8-3Z"/></svg></div><div class="nm">Admission <em>Sky</em></div><div class="tg">শুরু করো তোমার ভর্তি-যাত্রা</div></div>
<div class="bt">
<button class="b p rv" style="--i:0" type="button"><span class="gi"><svg viewBox="0 0 24 24"><circle cx="10" cy="8" r="4"/><path d="M3 20c0-4 3-6 7-6M17 9v6M14 12h6"/></svg></span><span class="tt2"><b>সাইন আপ</b><small>নতুন অ্যাকাউন্ট, বিনামূল্যে</small></span><span class="ar"><svg viewBox="0 0 24 24"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></span></button>
<button class="b s rv" style="--i:1" type="button"><span class="gi"><svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l3 3M14 9l2 2"/></svg></span><span class="tt2"><b>সাইন ইন</b><small>আগের অ্যাকাউন্টে ফিরে এসো</small></span><span class="ar"><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></span></button>
<div class="dv rv" style="--i:2">অথবা</div>
<div class="so rv" style="--i:3"><button class="b" type="button"><i><svg viewBox="0 0 24 24"><path fill="#4285F4" d="M23 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.4Z"/><path fill="#34A853" d="M12 23.5c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3A11.5 11.5 0 0 0 12 23.5Z"/><path fill="#FBBC05" d="M5.6 14.2a6.9 6.9 0 0 1 0-4.4v-3H1.8a11.5 11.5 0 0 0 0 10.4l3.8-3Z"/><path fill="#EA4335" d="M12 5.4c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.5 11.5 0 0 0 1.8 6.8l3.8 3C6.5 7.4 9 5.4 12 5.4Z"/></svg></i>Google</button><button class="b" type="button"><i><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#29A9EB"/><path fill="#fff" d="M5.4 11.8l11.6-4.5c.5-.2 1 .1.8.9l-2 9.3c-.1.6-.5.8-1.1.5l-3-2.2-1.4 1.4c-.2.2-.3.3-.6.3l.2-3.1 5.6-5.1c.2-.2 0-.3-.4-.1l-6.9 4.4-3-.9c-.6-.2-.6-.6.2-.9z"/></svg></i>Telegram</button></div>
<button class="b g rv" style="--i:4" type="button">গেস্ট হিসেবে ঘুরে দেখি</button>
</div>
</section>
<div class="toast" id="toast">প্রিভিউ, পরের ধাপে যুক্ত হবে</div>
</main><svg width="0" height="0" style="position:absolute"><symbol id="mk" viewBox="0 0 120 120"><g fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M30 94 60 54 90 94"/><path d="M60 16 92 29 60 42 28 29Z" fill="#fff" stroke-width="4"/><path d="M42 36v9c0 5 36 5 36 0v-9M92 29v16" stroke-width="4"/></g><path d="M100 14l3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="#FFB020" stroke="none"/></symbol></svg>`;
const host=document.getElementById('ah-welcome-story');if(!host)return;host.innerHTML=TEMPLATE;
const $=id=>host.querySelector('[id="'+id+'"]'),app=$('app'),fit=$('fit'),band=$('band'),top=$('top'),go=$('go'),auth=$('auth'),cam=$('cam'),tag=$('tag'),fg=$('fing'),root=host,meta=document.querySelector('meta[name=theme-color]');
const face=h=>`<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="28" fill="#F3C7A0"/><path d="M6 28C4 8 22 2 32 3c16 1 24 12 22 25-5-10-13-14-24-14S10 18 6 28Z" fill="#1E2A4A"/><circle cx="21" cy="32" r="2.6" fill="#1E2A4A"/><circle cx="39" cy="32" r="2.6" fill="#1E2A4A"/>${h?'<path d="M20 40q10 11 20 0Z" fill="#B4443C"/>':'<path d="M22 45q8-5 16 0" fill="none" stroke="#1E2A4A" stroke-width="2.4" stroke-linecap="round"/>'}</svg>`;
const friend=`<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="28" fill="#F0B98E"/><path d="M4 30C0 6 24 0 34 2c16 2 26 14 22 30-2-8-4-12-8-14-10 2-26 2-34-2-2 3-4 8-6 14Z" fill="#3A2A22"/><circle cx="21" cy="33" r="2.6" fill="#2A1E1A"/><circle cx="39" cy="33" r="2.6" fill="#2A1E1A"/><path d="M20 41q10 10 20 0Z" fill="#B4443C"/></svg>`;
const stu=t=>`<svg viewBox="0 0 300 300" class="stu${t?' tidy':''}"><ellipse cx="150" cy="292" rx="134" ry="7" fill="rgba(11,27,58,.14)"/><g class="bd"><path d="M60 236C60 176 98 148 150 148s90 28 90 88Z" fill="var(--p)"/><path d="M82 174 96 218M218 174 204 218" stroke="var(--p)" stroke-width="30" stroke-linecap="round"/><path d="M124 150c6 16 46 16 52 0" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="5" stroke-linecap="round"/></g><g class="hd2"><rect x="136" y="122" width="28" height="32" rx="12" fill="#E8B48A"/><circle cx="150" cy="96" r="42" fill="#F3C7A0"/><path d="M106 94C102 52 138 44 156 46c26 0 44 20 38 50-8-18-22-26-44-26s-36 8-44 24Z" fill="#1E2A4A"/><g class="gz"><g class="ey"><circle cx="136" cy="102" r="4" fill="#1E2A4A"/><circle cx="164" cy="102" r="4" fill="#1E2A4A"/></g></g><path class="br" d="M127 91q9-6 18 0M155 91q9-6 18 0" fill="none" stroke="#1E2A4A" stroke-width="3" stroke-linecap="round"/><path class="mf" d="M138 126q12-10 24 0" fill="none" stroke="#1E2A4A" stroke-width="3.2" stroke-linecap="round"/><ellipse class="mo" cx="150" cy="122" rx="5" ry="6" fill="#B4443C"/><path class="ms" d="M134 116q16 18 32 0Z" fill="#B4443C"/><circle class="ck" cx="126" cy="116" r="6" fill="#FF9AA2" opacity=".6"/><circle class="ck" cx="174" cy="116" r="6" fill="#FF9AA2" opacity=".6"/></g><rect x="12" y="214" width="276" height="76" rx="18" fill="#fff"/><rect x="12" y="214" width="276" height="9" rx="4" fill="#E6EAF4"/><circle class="h1" cx="98" cy="217" r="11" fill="#F3C7A0"/><circle class="h2" cx="202" cy="217" r="11" fill="#F3C7A0"/>${t?'<rect x="24" y="192" width="70" height="16" rx="3" fill="#9DB7FF"/><rect x="28" y="176" width="62" height="16" rx="3" fill="var(--q)"/><rect x="32" y="160" width="54" height="16" rx="3" fill="#fff" stroke="#DDE3F0"/><rect x="206" y="192" width="70" height="16" rx="3" fill="#FF9F85"/><rect x="210" y="176" width="62" height="16" rx="3" fill="var(--p)"/><rect x="116" y="188" width="68" height="46" rx="7" fill="#16264A"/><rect x="121" y="193" width="58" height="36" rx="4" fill="var(--q)"/><path d="m139 211 8 8 14-16" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>':'<g class="drift"><rect x="40" y="186" width="46" height="58" rx="3" fill="#fff" stroke="#DDE3F0" transform="rotate(14 63 215)"/></g><rect x="20" y="204" width="86" height="22" rx="4" fill="#9DB7FF" transform="rotate(-10 63 215)"/><rect x="190" y="198" width="88" height="24" rx="4" fill="#FF9F85" transform="rotate(9 234 210)"/><g class="drift" style="animation-delay:-2s"><rect x="214" y="174" width="40" height="52" rx="3" fill="#fff" stroke="#DDE3F0" transform="rotate(-16 234 200)"/></g><rect x="114" y="208" width="46" height="34" rx="3" fill="#fff" stroke="#DDE3F0" transform="rotate(-7 137 225)"/><rect x="160" y="208" width="46" height="34" rx="3" fill="#F7F9FF" stroke="#DDE3F0" transform="rotate(7 183 225)"/><rect x="246" y="186" width="26" height="26" rx="3" fill="#FFE08A" transform="rotate(10 259 199)"/><rect class="phn" x="136" y="228" width="22" height="40" rx="5" fill="#16264A" transform="rotate(-8 147 248)"/>'}</svg>`;
const spk=(l,t,d,x,y)=>`<i class="spk" style="left:${l}px;top:${t}px;--d:${d}s;--x:${x}px;--y:${y}px"></i>`;
$('a').innerHTML=`<span class="qm" style="left:96px;top:128px;--d:.8s">?</span><span class="qm" style="left:262px;top:112px;--d:1.1s">!</span><span class="qm" style="left:70px;top:190px;--d:1.4s;font-size:22px">?</span>${stu(false)}<div class="line">পড়া অনেক, সময় কম, শুরু করব কীভাবে?</div>`;
$('b').innerHTML=`<div class="chd"><div class="orb"></div><div><b>AI এজেন্ট</b><small><i></i>অনলাইন</small></div></div><div class="msgs"><div class="m me" style="--d:.8s">ভাই, ভর্তি পরীক্ষার প্রস্তুতি কীভাবে শুরু করব?<span class="fa">${face(0)}</span></div><div class="m ai" style="--d:1.8s"><div class="dt"><i></i><i></i><i></i></div><div class="tx">চিন্তা নেই! আগে তোমার লক্ষ্য ঠিক করি, তারপর সময় অনুযায়ী পুরো প্ল্যান বানিয়ে দেব।</div></div><div class="m me" style="--d:4s">দারুণ! এখনই শুরু করি<span class="fa">${face(1)}</span></div></div>${spk(300,330,4.2,20,-30)}${spk(250,380,4.3,-10,-40)}${spk(330,400,4.4,10,-36)}${spk(210,340,4.5,-16,-30)}<div class="line">প্রশ্ন করো, AI বুঝিয়ে দেবে</div>`;
const days=['শ','র','সো','ম','বু','বৃ','শু'],pat=[[44,30,0],[30,52,34],[56,24,40],[34,48,0],[50,36,30],[26,56,40],[40,32,0]];
$('c').innerHTML=`<div class="hdr">রুটিন তৈরি করি</div><div class="lab" style="top:48px">তোমার লক্ষ্য</div><div class="chs"><i>বিশ্ববিদ্যালয়</i><i>মেডিকেল</i><i>গুচ্ছ</i></div><div class="lab" style="top:136px">প্রতিদিন কত ঘণ্টা পড়তে পারবে?</div><div class="sld"><u></u><s></s><span class="hv"><em style="--i:0">২</em><em style="--i:1">৩</em><em style="--i:2">৪</em><em style="--i:3">৫</em><span>ঘণ্টা</span></span></div><button class="gob" type="button">রুটিন বানাও</button><div class="tap tp1"></div><div class="tap tp2"></div><div class="ldg">AI রুটিন সাজাচ্ছে…</div><div class="tt"><div class="th">তোমার সাপ্তাহিক রুটিন<span class="pl">প্রস্তুত</span></div><div class="gr">${days.map((d,i)=>`<div class="cn">${pat[i].filter(h=>h).map((h,j)=>`<i class="bl ${'cdc'[j]}" style="--h:${h}px;--k:${i*3+j}"></i>`).join('')}${d}</div>`).join('')}</div></div><div class="line">নিজের মতো রুটিন, এক মিনিটে</div>`;
$('d').innerHTML=`<div class="eh"><b>মডেল টেস্ট ০৩</b><span class="tm" id="tm">২৪:৫৯</span></div><div class="pg"><u></u></div><div class="qt">প্রশ্ন ৮ / ২০</div><div class="qq">বাংলাদেশের জাতীয় ফুল কোনটি?</div><div class="ops"><div class="op"><i>ক</i>গোলাপ</div><div class="op w1"><i>খ</i>জবা</div><div class="op r1"><i>গ</i>শাপলা</div><div class="op"><i>ঘ</i>কাঁঠালচাঁপা</div></div><div class="tap tp4"></div><div class="ex"><div class="orb"></div><div>ভুল হয়েছে! জাতীয় ফুল শাপলা। পানির ফুল, তাই মনে রাখা সহজ।</div></div><button class="sub" type="button">পরীক্ষা জমা দাও</button><div class="tap tp3"></div><div class="rs"><div class="rr"><svg viewBox="0 0 150 150"><defs><linearGradient id="g2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2563EB"/><stop offset="1" stop-color="#F43F5E"/></linearGradient></defs><circle class="a" cx="75" cy="75" r="60"/><circle class="b" cx="75" cy="75" r="60"/></svg><b>১৮/২০</b></div><strong>খুব ভালো করেছ!</strong><small>AI বিশ্লেষণ: ব্যাকরণে আরেকটু অনুশীলন করলেই ১০০%</small></div>`;
$('fin').innerHTML=`<div class="fl">ভর্তির স্বপ্ন,<br>এবার সহজে।</div>${stu(true)}${spk(60,150,.9,-20,-30)}${spk(320,170,1.1,16,-30)}${spk(40,300,1.3,-14,-24)}${spk(340,320,1.5,14,-30)}`;
$('sp').innerHTML=`<div class="spw"><div class="halo"></div><svg class="ring" viewBox="0 0 236 236"><defs><linearGradient id="rgr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--p)"/><stop offset="1" style="stop-color:var(--q)"/></linearGradient></defs><circle class="rb" cx="118" cy="118" r="110"/><circle class="rf" cx="118" cy="118" r="110"/></svg><div class="tile big"><svg viewBox="0 0 120 120"><path class="trl" d="M20 100C44 92 76 70 100 26"/><path class="chv" d="M30 94 60 54 90 94"/><g class="cap"><path class="cf" d="M60 16 92 29 60 42 28 29Z"/><path d="M42 36v9c0 5 36 5 36 0v-9M92 29v16"/></g><path class="str" d="M100 14l3 8 8 3-8 3-3 8-3-8-8-3 8-3Z"/></svg></div></div>`;
$('msg').innerHTML=`<div class="mh"><div class="av">${friend}</div><div><b>রাফি</b><small>সক্রিয় আছেন</small></div></div><div class="mb f" style="top:84px;--d:.4s">ভাই, ভর্তির প্রস্তুতি কেমন চলছে?</div><div class="mb m" style="top:160px;--d:1.2s">আর বলিস না, কোথা থেকে শুরু করব বুঝতেছি না</div><div class="mb f ty" style="top:256px"><div class="dt"><i></i><i></i><i></i></div></div><div class="mb f" style="top:256px;--d:2.6s">Admission Sky ট্রাই কর! AI সব গুছিয়ে দেয়</div><div class="lk"><div class="lnt"><svg width="34" height="34" viewBox="0 0 120 120"><use href="#mk"/></svg></div><div><b>Admission Sky</b><small>AI দিয়ে ভর্তির প্রস্তুতি</small></div><em>খুলুন</em></div>`;
const ic={ai:'<svg viewBox="0 0 24 24"><path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2Z"/></svg>',ex:'<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="m9 12 2 2 4-4"/></svg>',rt:'<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>'};
$('hm').innerHTML=`<div class="hmg" style="--i:0">শুভ সকাল</div><div class="hmn" style="--i:0">রাহিম</div><div class="hmp" style="--i:1"><small>আজকের লক্ষ্য</small><b>৩ / ৫ সম্পন্ন</b><u></u></div><div class="hmt t1" id="t1" style="--i:2"><div class="orb"></div><div>AI এজেন্ট<small>প্রশ্ন করো, AI বুঝিয়ে দেবে</small></div></div><div class="hmt t2" style="--i:3"><div class="ito">${ic.ex}</div>মডেল টেস্ট<small>পরীক্ষা দাও</small></div><div class="hmt t3" style="--i:4"><div class="ito">${ic.rt}</div>রুটিন<small>প্ল্যান বানাও</small></div>`;
$('pip').innerHTML=face(0).replace('<svg','<svg class="n"')+face(1).replace('<svg','<svg class="h"');
// Same palette as the sky flow's SIGNUP_PAL, stage for stage. The story runs
// eight scenes and the wizard runs eight steps, so mapping them one to one
// makes the colour that lands on the app also the colour onboarding starts
// with -- without that the seam between the two screens is visible.
const P={sp:['#E6F0FF','#2F6BFF','#FF9F1C'],a:['#F3E8FF','#8B3DFF','#FF4DA6'],td:['#DDF8EE','#00B386','#FFC233'],hm:['#FFEDE3','#FF5A36','#FFB020'],b:['#FFE8F1','#E02D7B','#7A3CFF'],d:['#E8E6FF','#5B3DF5','#00C2FF'],rt:['#DFF6FF','#0A8CFF','#00D68F'],fin:['#FFF3D6','#FF9F1C','#2F6BFF']};
const T=[
{p:'sp',ms:2000,sc:'sp'},
{p:'a',ms:3700,sc:'a'},
{p:'td',ms:4600,sc:'td',v:'msg',cam:'c-td',desk:1,tag:'বন্ধুর মেসেজ',ev:[[2800,()=>tap(168,440)]]},
{p:'hm',ms:4400,v:'hm',cam:'c-hand',held:1,tab:0,tag:'অ্যাপে ঢুকলাম',lnc:1,ev:[[2200,()=>tap(195,326)],[2800,()=>$('t1').classList.add('pr')]]},
{p:'b',ms:5100,v:'b',cam:'c-flat',held:1,tab:1,tag:'AI এজেন্ট',rate:1.15,pip:1,ev:[[2500,()=>$('pip').classList.add('hap')],[3500,()=>tap(244,648)]]},
{p:'d',ms:5500,v:'d',cam:'c-tr',held:1,tab:2,tag:'পরীক্ষা',rate:1.3,ev:[[100,()=>tap(195,286)],[2700,()=>tap(195,565)],[4300,()=>tap(341,648)]]},
{p:'rt',ms:5800,v:'c',cam:'c-dn',held:1,tab:3,tag:'রুটিন',rate:1.3,ev:[[300,()=>tap(195,134)],[1900,()=>tap(195,288)]]},
{p:'fin',ms:3600,sc:'fin'}];
let timers=[],open=false;
const at=(m,f)=>timers.push(setTimeout(f,m)),clr=()=>{timers.forEach(clearTimeout);timers=[]};
function tap(x,y){fg.style.setProperty('--fx',(x-22)+'px');fg.style.setProperty('--fy',(y-4)+'px');fg.classList.add('show');at(700,()=>fg.classList.add('press'));at(950,()=>fg.classList.remove('press'));at(1600,()=>{fg.classList.remove('show');fg.style.setProperty('--fy','780px')})}
function pal(id){const c=P[id];root.style.setProperty('--t',c[0]);root.style.setProperty('--p',c[1]);root.style.setProperty('--q',c[2]);meta.setAttribute('content',c[0])}
function play(i){if(open)return;clr();const s=T[i];
 ['sp','a','fin','td'].forEach(id=>$(id).classList.toggle('on',id===s.sc));
 ['msg','hm','b','d','c'].forEach(id=>$(id).classList.toggle('on',id===s.v));
 pal(s.p);app.classList.toggle('desk',!!s.desk);app.classList.toggle('splash',i===0);
 cam.className='cam'+(s.cam?' show '+s.cam:'')+(s.held?' held':'');
 $('tb').classList.toggle('on',s.tab!==undefined);[...$('tb').children].forEach((e,j)=>e.classList.toggle('act',j===s.tab));
 tag.textContent=s.tag||'';tag.classList.toggle('vis',!!s.tag);top.classList.toggle('vis',i>0);
 $('pip').classList.toggle('vis',!!s.pip);if(!s.pip)$('pip').classList.remove('hap');
 if(i!==3)$('t1').classList.remove('pr');
 if(s.lnc){const l=$('lnc');l.classList.remove('go');void l.offsetWidth;l.classList.add('go')}
 if(s.rate)setTimeout(()=>{$(s.v).getAnimations({subtree:true}).forEach(a=>a.playbackRate=s.rate)},40);
 (s.ev||[]).forEach(([m,f])=>at(m,f));
 at(s.ms,()=>play(i+1<T.length?i+1:1))}
function size(){const r=band.getBoundingClientRect();fit.style.setProperty('--s',Math.min(r.width/390,r.height/668).toFixed(3))}
size();addEventListener('resize',size);play(0);setTimeout(()=>go.classList.add('lit'),7000);
go.addEventListener('click',()=>{const r=go.getBoundingClientRect(),x=(r.left+r.width/2)+'px',y=(r.top+r.height/2)+'px';[app,auth].forEach(e=>{e.style.setProperty('--ox',x);e.style.setProperty('--oy',y)});
 open=true;clr();app.classList.remove('desk');root.style.setProperty('--t','#E6F0FF');root.style.setProperty('--p','#2F6BFF');root.style.setProperty('--q','#FF9F1C');meta.setAttribute('content','#E6F0FF');app.classList.add('open');setTimeout(()=>{if(!open)return;auth.querySelectorAll('.rv').forEach(e=>{if(getComputedStyle(e).opacity==='0'){e.style.animation='none';e.style.opacity='1';e.style.translate='0 0'}})},2600)});
$('bk').addEventListener('click',()=>{app.classList.remove('open');open=false;setTimeout(()=>play(1),800)});
const bridge=()=>window.AdmissionSkyBridge||null;
function flash(msg){const t=$('toast');t.textContent=msg;t.classList.add('s');setTimeout(()=>t.classList.remove('s'),1600)}
$('auth').querySelector('.b.p').addEventListener('click',()=>{const b=bridge();if(b)b.showSignup();else flash('প্রিভিউ, পরের ধাপে যুক্ত হবে')});
$('auth').querySelector('.b.s').addEventListener('click',()=>{const b=bridge();if(b)b.showLogin();else flash('প্রিভিউ, পরের ধাপে যুক্ত হবে')});
const so=$('auth').querySelector('.so');
so.children[0].addEventListener('click',async()=>{const b=bridge();if(!b)return flash('প্রিভিউ, পরের ধাপে যুক্ত হবে');try{const ok=await b.google();if(!ok)flash('Google এখন প্রস্তুত নয়')}catch(_){flash('Google দিয়ে প্রবেশ করা গেল না')}});
so.children[1].addEventListener('click',async()=>{const b=bridge();if(!b)return flash('প্রিভিউ, পরের ধাপে যুক্ত হবে');try{const ok=b.telegram?await b.telegram():false;if(!ok)flash('Telegram এখন প্রস্তুত নয়')}catch(_){flash('Telegram দিয়ে প্রবেশ করা গেল না')}});
$('auth').querySelector('.b.g').addEventListener('click',()=>{const b=bridge();if(b&&b.continueGuest)b.continueGuest();else flash('প্রিভিউ, পরের ধাপে যুক্ত হবে')});
window.AdmissionWelcomeStory=Object.freeze({open(){app.classList.remove('open');open=false;size();play(1)},close(){app.classList.remove('open');open=false},resize:size,el:()=>host});
})();

