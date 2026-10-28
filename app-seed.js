/* D-V189: Seed removed, সব content এখন server (cloud) থেকে sync হয়।
   app-seed.js খালি, fallback seed নেই। শুধু cloud-content-sync.js দিয়ে data আসবে। */
window.AH_SEED = { subjects: [], topics: [], questions: [], vocabulary: [], vocabularyMaster: [] };

/* Welcome UI loader only. The empty content seed and all authentication code stay unchanged. */
(() => {
  if (document.getElementById('ah-sky-ui-style')) return;
  const base = new URL('.', document.currentScript.src);
  const version = 'sky-flow-20261018-v12';
  const style = document.createElement('link');
  style.id = 'ah-sky-ui-style'; style.rel = 'stylesheet';
  style.href = new URL(`sky-onboarding.css?v=${version}`, base);
  style.onload = () => {
    const script = document.createElement('script');
    script.src = new URL(`sky-onboarding.js?v=${version}`, base);
    script.defer = true; document.head.append(script);
  };
  document.head.append(style);
})();
