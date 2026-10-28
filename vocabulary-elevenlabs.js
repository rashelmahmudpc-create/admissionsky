/* v111, Voice pipeline for Vocabulary (provider = Cartesia, ElevenLabs fallback).
   Generate once → save binary audio bytes in IndexedDB (voiceCache) → instant offline playback.
   API key কখনো client-side থাকে না: অ্যাপ শুধু নিজের Cloudflare Worker proxy-তে কথা বলে।
   Worker Main = Cartesia (CARTESIA_API_KEY); key না থাকলে বা Cartesia ব্যর্থ হলে
   স্বয়ংক্রিয়ভাবে ElevenLabs-এ ফিরে যায়, তাই audio কখনো ভাঙে না।
   Priority: custom uploaded voice → provider audio (cache → generate) → Web Speech TTS fallback. */
(() => {
  'use strict';

  // ── Central configuration (এক জায়গা থেকেই সব পরিবর্তন) ──────────────────────
  const VOICE_CONFIG = Object.freeze({
    provider: 'cartesia',                  // worker default; ElevenLabs stays the automatic fallback
    voiceId: '',                            // খালি = worker-এর Cartesia default (Daniel, en) / বাংলায় Skylar
    modelId: '',                            // খালি = worker-এর sonic-3.6
    outputFormat: "mp3_22050_32",
    lang: 'en-US',                          // accent/locale, এক জায়গা থেকে বদলাও
    voiceSettings: Object.freeze({ stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1.0 }),
    speed: 0.95,                           // calmer/clearer reading
    settingsVersion: 5,                     // voice/model বদলালে এই সংখ্যা বাড়ালেই পুরনো cache conflict-মুক্ত
    maxWordLength: 60,
    timeoutMs: 20000,
    errorCooldownMs: 60000                  // ব্যর্থ word-এ এই সময় পর্যন্ত আবার API চেষ্টা হয় না
  });
  const LS_ENDPOINT = 'ahVoiceProxyUrl';
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10v4h4l5 4V6L7 10H3zm11.5 2c0-1.41-.81-2.63-2-3.22v6.44c1.19-.59 2-1.81 2-3.22zM12.5 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.5 7-8.77s-2.99-7.86-7-8.77z"/></svg>';

  const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // ── Deterministic cache identity: hash(word + voice + model + settings) ──────
  // Must keep Bengali code points (\u0980-\u09FF): an ASCII-only class stripped a
  // Bengali word to empty, which made the whole app skip the cache for Bengali.
  const normalizeWord = word => String(word || '').trim().toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]+/gu, '-').replace(/^-+|-+$/g, '');
  const fnv = text => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); };
  const djb = text => { let h = 5381; for (let i = 0; i < text.length; i++) { h = (((h << 5) + h) + text.charCodeAt(i)) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); };
  const configTag = () => [VOICE_CONFIG.voiceId, VOICE_CONFIG.modelId, VOICE_CONFIG.settingsVersion, VOICE_CONFIG.lang].join('|');
  const cacheKey = word => {
    const n = normalizeWord(word);
    if (!n) return '';
    const digest = fnv(n + '|' + configTag()) + djb(n + '|' + configTag());
    return 'vc-' + digest + '-' + n.slice(0, 40);
  };

  // ── Storage: IndexedDB uses binary bytes; in-memory fallback stays supported ──
  const mem = new Map();
  let cacheResetting = false, cacheResetDepth = 0, cacheWriteEpoch = 0;
  const dbReady = () => typeof dbGet === 'function' && typeof dbPut === 'function' && typeof dbGetAll === 'function' && typeof dbDelRaw === 'function';
  const cacheWritePermit = () => ({ allowed: !cacheResetting, epoch: cacheWriteEpoch });
  const canCache = permit => !!permit && permit.allowed && !cacheResetting && permit.epoch === cacheWriteEpoch;
  const beginUserDataReset = () => { cacheResetDepth++; cacheResetting = true; cacheWriteEpoch++; };
  const endUserDataReset = () => { cacheResetDepth = Math.max(0, cacheResetDepth - 1); cacheResetting = cacheResetDepth > 0; cacheWriteEpoch++; };
  const bytesFromBlob = blob => {
    if (blob && typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
      if (typeof FileReader !== 'function') { reject(new Error('ArrayBuffer audio storage is unavailable')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('Could not read audio bytes'));
      reader.onload = () => resolve(reader.result);
      reader.readAsArrayBuffer(blob);
    });
  };
  const blobFromRow = row => {
    if (!row) return null;
    const bytes = row.audioBytes;
    const isArrayBuffer = bytes && Object.prototype.toString.call(bytes) === '[object ArrayBuffer]';
    if (isArrayBuffer || (bytes && ArrayBuffer.isView(bytes))) {
      try { return new Blob([bytes], { type: row.audioType || 'audio/mpeg' }); } catch (_) { return null; }
    }
    // Read-only compatibility for voice rows written by earlier app versions.
    return row.audioBlob && typeof row.audioBlob.size === 'number' ? row.audioBlob : null;
  };
  const persistAudio = async (row, blob, permit) => {
    if (!canCache(permit)) return false;
    const audioBytes = await bytesFromBlob(blob);
    if (!canCache(permit)) return false;
    await putRow({ ...row, audioBytes, audioType: blob.type || 'audio/mpeg', size: blob.size });
    return true;
  };
  const getRow = key => dbReady() ? Promise.resolve(dbGet('voiceCache', key)).catch(() => undefined) : Promise.resolve(mem.get(key));
  const putRow = row => { if (!dbReady()) { mem.set(row.id, row); return Promise.resolve(row); } return Promise.resolve(dbPut('voiceCache', row)).catch(error => { throw error; }); };
  const allRows = () => dbReady() ? Promise.resolve(dbGetAll('voiceCache')).catch(() => [...mem.values()]) : Promise.resolve([...mem.values()]);
  const delRow = key => dbReady() ? Promise.resolve(dbDelRaw('voiceCache', key)).catch(() => false) : (mem.delete(key), Promise.resolve(true));

  // ── Secure endpoint (worker URL, secret নয়, key নয়) ────────────────────────
  /* P20 (v204), ডিফল্ট এখন same-origin: pages._worker.js /api/voice → admission-voice worker।
     কেন: ① মালিক-নেটে *.workers.dev ব্লক (P15-প্রমাণ); ② voice-worker-এর CORS-allowlist-এ pages.dev ছিল না
     (শুধু github.io/localhost) → সরাসরি-ডাকে ব্রাউজার "Failed to fetch"; ③ hub-অ্যাপের পুরনো
     এন্ডপয়েন্ট-মৃত (DNS-নেই); ④ পাইরেট-কপিতে অন্য-এন্ডপয়েন্ট-সেভ-থাকতে-পারে। same-origin-পথে সব পার। */
  const DEFAULT_ENDPOINT = ''; /* '' = same-origin (/api/voice), পছন্দের পথ */
  let proxyUrl = DEFAULT_ENDPOINT;
  let voiceOff = false;
  try {
    let saved = String(localStorage.getItem(LS_ENDPOINT) || '').trim();
    if (saved && saved.includes('.workers.dev')) saved = ''; /* মাইগ্রেশন: পুরনো workers.dev → same-origin */
    voiceOff = saved === 'off';
    proxyUrl = saved === '' ? DEFAULT_ENDPOINT : saved;
    try { if (saved === '' && localStorage.getItem(LS_ENDPOINT)) localStorage.removeItem(LS_ENDPOINT); } catch (_) {}
  } catch (_) {}
  const saveEndpoint = url => {
    const value = String(url || '').trim().replace(/\/+$/, '');
    voiceOff = value === 'off';
    proxyUrl = value === '' ? DEFAULT_ENDPOINT : value;
    try { localStorage.setItem(LS_ENDPOINT, value); } catch (_) {}
    return proxyUrl;
  };
  const configured = () => !voiceOff;

  // ── Duplicate-request protection + global audio manager ─────────────────────
  const pending = new Map();   // cacheKey → in-flight generate promise
  const cooldown = new Map();  // cacheKey → retry-after timestamp
  let apiCalls = 0;
  let audioEl = null, currentUrl = '';
  const stopAudio = () => {
    try { audioEl?.pause(); } catch (_) {}
    try { window.speechSynthesis?.cancel?.(); } catch (_) {}
    if (currentUrl) { try { URL.revokeObjectURL(currentUrl); } catch (_) {} currentUrl = ''; }
  };
  const playUrl = url => {
    stopAudio();
    try { audioEl = audioEl || new Audio(); } catch (_) { return false; }
    audioEl.src = url;
    try { audioEl.currentTime = 0; } catch (_) {}
    currentUrl = url;
    const played = audioEl.play();
    if (played && played.catch) played.catch(() => {});
    return true;
  };
  const playBlob = blob => {
    let url = '';
    try { url = URL.createObjectURL(blob); } catch (_) { return false; }
    return playUrl(url);
  };

  const generateAudio = async word => {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { try { ctrl?.abort(); } catch (_) {} }, VOICE_CONFIG.timeoutMs);
    try {
      const response = await fetch(proxyUrl + '/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-AH-App': 'admission-hub' },
        body: JSON.stringify({
          word: String(word).trim(),
          provider: VOICE_CONFIG.provider,
          voiceId: VOICE_CONFIG.voiceId,
          modelId: VOICE_CONFIG.modelId,
          output_format: VOICE_CONFIG.outputFormat,
          lang: VOICE_CONFIG.lang,
          voice_settings: VOICE_CONFIG.voiceSettings,
          speed: VOICE_CONFIG.speed
        }),
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!response.ok) {
        let message = '';
        try { message = (await response.json())?.error || ''; } catch (_) {}
        throw new Error(message || 'voice-http-' + response.status);
      }
      const blob = await response.blob();
      if (!blob || !blob.size || /json|text/i.test(blob.type || '')) throw new Error('malformed-audio');
      return blob;
    } finally { clearTimeout(timer); }
  };

  // ── Button UX states: 🔊 / ◌ generating / ⚠ error ────────────────────────────
  const btnState = (btn, state) => {
    if (!btn || !btn.classList) return;
    btn.classList.remove('loading', 'error', 'warn');
    clearTimeout(btn.__voiceTimer);
    if (state === 'loading') { btn.classList.add('loading'); btn.innerHTML = '◌'; return; }
    if (state === 'error' || state === 'warn') {
      btn.classList.add(state);
      btn.innerHTML = '⚠';
      btn.__voiceTimer = setTimeout(() => { btn.innerHTML = ICON; btn.classList.remove(state); }, 2600);
      return;
    }
    btn.innerHTML = ICON;
  };

  const fallbackTts = (word, btn, reason, warn) => {
    if (warn) window.toast?.('📴 অফলাইন, এই word-এর ElevenLabs voice এখনো নামেনি। Internet-এ থাকলে একবার ক্লিকেই নেমে যাবে।');
    const tts = window.VocabularyPronunciation?.speakTtsOnly;
    if (typeof tts === 'function') { try { tts(word); } catch (_) {} }
    if (warn) btnState(btn, 'warn');
    return done('fallback:' + reason, word, 0);
  };
  const done = (mode, word, used) => {
    window.__lastVoiceResult = { word, mode, apiCalls };
    return mode + (used ? '+api' : '');
  };

  // ── Orchestrator: custom → cache → generate-once → TTS fallback ─────────────
  const speakWord = async (raw, btn) => {
    const word = String(raw || '').trim();
    if (!word) return done('empty', '', 0);
    const customLib = window.__vmVoiceLib, customKey = normalizeWord(word);
    if (customLib && customKey && customLib[customKey]) { playUrl(customLib[customKey]); return done('custom', word, 0); }
    const cachePermit = cacheWritePermit();
    if (!cachePermit.allowed) return fallbackTts(word, btn, 'data-reset-in-progress');
    const key = cacheKey(word);
    if (!key) return fallbackTts(word, btn, 'invalid-word');
    try {
      const row = await getRow(key);
      const cachedBlob = blobFromRow(row);
      if (cachedBlob) { playBlob(cachedBlob); return done('cache', word, 0); }
    } catch (_) { /* cache read ব্যর্থ হলেও চলবে */ }
    if (!canCache(cachePermit)) return fallbackTts(word, btn, 'data-reset-in-progress');
    if (pending.has(key)) {
      try { const blob = await pending.get(key); playBlob(blob); return done('cache-dedup', word, 0); }
      catch (_) { return fallbackTts(word, btn, 'error'); }
    }
    if ((cooldown.get(key) || 0) > Date.now()) return fallbackTts(word, btn, 'cooldown');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return fallbackTts(word, btn, 'offline', true);
    if (!configured()) return fallbackTts(word, btn, 'unconfigured');
    btnState(btn, 'loading');
    const job = generateAudio(word);
    pending.set(key, job);
    apiCalls++;
    try {
      const blob = await job;
      let cached = false;
      try { cached = await persistAudio({
        id: key, wordKey: customKey, word: word.slice(0, VOICE_CONFIG.maxWordLength), type: 'vocabulary',
        voiceId: VOICE_CONFIG.voiceId, modelId: VOICE_CONFIG.modelId,
        settingsVersion: VOICE_CONFIG.settingsVersion, lang: VOICE_CONFIG.lang,
        createdAt: Date.now()
      }, blob, cachePermit); } catch (storageError) { window.__lastVoiceError = String(storageError?.message || 'voice-cache-save-failed').slice(0, 90); }
      playBlob(blob);
      btnState(btn, cached ? 'ok' : 'warn');
      if (cached) window.toast?.('✓ Voice saved, এখন অফলাইনেও বাজবে');
      else if (canCache(cachePermit)) window.toast?.('Voice বাজছে, তবে offline cache save হয়নি।');
      return done(cached ? 'generated' : 'generated-uncached', word, 1);
    } catch (err) {
      cooldown.set(key, Date.now() + VOICE_CONFIG.errorCooldownMs);
      btnState(btn, 'error');
      const why = String((err && err.message) || '').slice(0, 90);
      window.__lastVoiceError = why || 'unknown';
      window.toast?.('⚠ Voice হয়নি (' + (why || 'অজানা') + '), বিল্ট-ইন voice চলছে');
      return fallbackTts(word, btn, 'error');
    } finally { pending.delete(key); }
  };

  // ── Stats + cache management (vocabulary ডেটা কখনো ধরে না) ───────────────────
  // ── Prefetch: warm the shared cache in the background ──────────────────────
  // A category's words (and their synonyms/antonyms) are generated once, quietly,
  // so a student's first tap plays from cache instead of waiting on the provider.
  // Deduped against in-flight work and the local cache; capped concurrency.
  const prefetchWords = async (words, limit = 12) => {
    const list = [...new Set((Array.isArray(words) ? words : []).map(w => String(w || '').trim()).filter(Boolean))].slice(0, limit);
    if (!list.length || !configured() || cacheResetting) return 0;
    const customLib = window.__vmVoiceLib;
    let warmed = 0;
    const run = async word => {
      const cachePermit = cacheWritePermit();
      const key = cacheKey(word);
      if (!key || pending.has(key) || !cachePermit.allowed) return;
      if (customLib && customLib[normalizeWord(word)]) return;
      try { const row = await getRow(key); if (blobFromRow(row)) return; } catch (_) { /* fall through */ }
      if (!canCache(cachePermit)) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      const job = generateAudio(word);
      pending.set(key, job);
      apiCalls++;
      try {
        const blob = await job;
        const saved = await persistAudio({
          id: key, wordKey: normalizeWord(word), word: word.slice(0, VOICE_CONFIG.maxWordLength), type: 'vocabulary',
          voiceId: VOICE_CONFIG.voiceId, modelId: VOICE_CONFIG.modelId,
          settingsVersion: VOICE_CONFIG.settingsVersion, lang: VOICE_CONFIG.lang,
          createdAt: Date.now()
        }, blob, cachePermit);
        if (saved) warmed++;
      } catch (_) { /* prefetch is best-effort, never surfaced */ }
      finally { pending.delete(key); }
    };
    for (let i = 0; i < list.length; i += 3) await Promise.all(list.slice(i, i + 3).map(run));
    return warmed;
  };

  const stats = async () => {
    const rows = await allRows();
    return { count: rows.length, bytes: rows.reduce((sum, row) => sum + (Number(row.size) || (row.audioBlob && row.audioBlob.size) || 0), 0) };
  };
  const clearAll = async () => {
    beginUserDataReset();
    try {
      if (dbReady() && typeof dbClear === 'function') { const count = await dbClear('voiceCache'); mem.clear(); return Number(count) || 0; }
      const rows = await allRows();
      for (const row of rows) await delRow(row.id);
      mem.clear();
      return rows.length;
    } finally { endUserDataReset(); }
  };
  const categoryKeys = category => {
    try {
      const entries = window.VocabularyMaster?.categoryVoiceEntries?.(category)?.entries || [];
      return [...new Set(entries.map(entry => cacheKey(entry.word)).filter(Boolean))];
    } catch (_) { return []; }
  };
  const clearCategory = async category => {
    const keys = categoryKeys(category);
    for (const key of keys) await delRow(key);
    return keys.length;
  };
  const categoryStatus = async category => {
    const keys = categoryKeys(category);
    const rows = await allRows();
    const have = new Set(rows.map(row => row.id));
    const ready = keys.filter(key => have.has(key)).length;
    return { total: keys.length, ready, missing: keys.length - ready };
  };
  const confirmBox = (title, message, action) => {
    if (typeof window.confirmModal === 'function') return window.confirmModal(title, message, action, 'Clear voices', true);
    if (window.confirm(message)) action();
  };
  const confirmClearAll = () => confirmBox('Clear all vocabulary voices', 'সব cached ElevenLabs voice মুছে ফেলতে চান? Vocabulary ডেটা ও custom uploaded voice অক্ষত থাকবে, পরে কোনো word চাইলে আবার একবার generate হবে।', async () => {
    try {
      const count = await clearAll();
      window.toast?.(`🗑 ${count}টি voice cache মুছে গেছে (vocabulary অক্ষত)`);
    } catch (error) {
      window.__lastVoiceError = String(error?.message || 'voice-cache-clear-failed').slice(0, 90);
      window.toast?.('Voice cache clear failed, আবার চেষ্টা করুন।');
    } finally { hydrateSettingsSection().catch(() => {}); }
  });
  const confirmClearCategory = category => {
    const label = String(category || '').toUpperCase() || 'ALL';
    confirmBox(`Clear ${label} voices`, `${label} category-র cached voice মুছে ফেলতে চান? Vocabulary ডেটা অক্ষত থাকবে।`, async () => {
      const count = await clearCategory(label);
      window.toast?.(`🗑 ${count}টি voice cache মুছে গেছে (vocabulary অক্ষত)`);
      hydrateSettingsSection(label);
    });
  };

  // ── Settings UI (⚙ Category settings → Vocabulary Voices) ────────────────────
  const fmtBytes = bytes => bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B';
  const settingsSection = category => `
    <div class="vm-voice-section" style="padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--card)">
      <b style="font-size:13px">🔊 Vocabulary Voices <span style="color:var(--sub);font-weight:400;font-size:11px">(ElevenLabs · generate once → offline playback)</span></b>
      <div id="vmVoiceStatus" style="margin-top:8px;color:var(--sub);font-size:12px;line-height:1.7">…লোড হচ্ছে…</div>
      <label style="display:block;margin-top:12px;font-size:11px;font-weight:700;color:var(--sub)">Secure worker endpoint (API key worker secret-এ, অ্যাপে কখনো নয়)</label>
      <input id="vmVoiceEndpoint" style="width:100%;margin-top:5px" placeholder="https://your-voice-worker.workers.dev" autocomplete="off" onchange="VocabularyElevenLabs.saveEndpoint(this.value);window.toast?.('Voice endpoint save হয়েছে');VocabularyElevenLabs.hydrateSettingsSection('${escape(category)}')">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button type="button" class="btn ghost sm" onclick="VocabularyElevenLabs.confirmClearCategory('${escape(category)}')">🧹 এই category-র voice cache</button>
        <button type="button" class="btn ghost sm" onclick="VocabularyElevenLabs.confirmClearAll()">🗑 সব voice cache</button>
      </div>
      <small style="display:block;margin-top:9px;color:var(--sub);font-size:11px;line-height:1.5">Cached voice অফলাইনেও বাজে। Clear করলে শুধু audio যায়, vocabulary ডেটা ও 🎧 custom voice অক্ষত। ডিফল্ট worker চলছে; বন্ধ করতে চাইলে ঘরে লেখো <code>off</code>।</small>
    </div>`;
  const hydrateSettingsSection = async category => {
    const box = document.getElementById('vmVoiceStatus');
    if (!box) return;
    const summary = await stats();
    let statusLine = '';
    try {
      const status = await categoryStatus(category);
      if (status.total) statusLine = `<br>${escape(String(category || 'ALL'))} category: Total <b>${status.total}</b> · Voice Ready <b>${status.ready}</b> · Not generated <b>${status.missing}</b>`;
    } catch (_) {}
    const endpointLabel = voiceOff ? 'বন্ধ (off)' : (proxyUrl ? escape(proxyUrl) : 'same-origin (অ্যাপ-প্রক্সি), ডিফল্ট');
    box.innerHTML = `Endpoint: <code style="font-size:11px">${endpointLabel}</code><br>Saved voices: <b>${summary.count}</b> · Storage: <b>${fmtBytes(summary.bytes)}</b>${statusLine}${voiceOff ? '<br>⚠ Voice generation বন্ধ আছে, cached ও বিল্ট-ইন voice চলবে।' : ''}`;
    const input = document.getElementById('vmVoiceEndpoint');
    if (input && proxyUrl && !input.value) input.value = proxyUrl;
  };

  window.VocabularyElevenLabs = {
    speakWord, playUrl, stopAudio, cacheKey, normalizeWord, prefetchWords, beginUserDataReset, endUserDataReset,
    stats, clearAll, clearCategory, categoryStatus,
    confirmClearAll, confirmClearCategory,
    settingsSection, hydrateSettingsSection, saveEndpoint,
    getConfig: () => ({ ...VOICE_CONFIG, voiceSettings: { ...VOICE_CONFIG.voiceSettings } }),
    apiCallCount: () => apiCalls
  };
})();
