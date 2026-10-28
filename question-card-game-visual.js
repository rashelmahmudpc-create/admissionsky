/*
 * Question Card Game Visual, Admission Hub.
 * Design reminder: apply the Memorizing Match layered mint card language only to question/review surfaces;
 * preserve every existing data attribute, answer state, navigation path, and click handler.
 */
(() => {
  'use strict';

  const CARD_SELECTOR = [
    '.q-card-v2',
    '.question-card',
    '.p3-qb-question-card',
    '.exam-q-card',
    '.flash-q-card',
    '.result-review-card',
    '.saved-note-card',
    '.flash-card'
  ].join(',');

  const OPTION_SELECTOR = [
    '.q-opt-v2',
    '.bank-option',
    '.exam-q-card .opt',
    '.flash-opt',
    '.result-review-card .result-option',
    '.saved-note-card .note-option',
    '.p3-qb-question-card .p3-qb-options > span'
  ].join(',');

  const mark = (root = document) => {
    root.querySelectorAll?.(CARD_SELECTOR).forEach((card) => card.classList.add('ah-game-question-card'));
    root.querySelectorAll?.(OPTION_SELECTOR).forEach((option) => option.classList.add('ah-game-question-option'));
  };

  const style = document.createElement('style');
  style.id = 'question-card-game-visual-style-v1';
  style.textContent = `
    /* Shared Learning Arcade visual: card styling only, no layout or state-machine changes. */
    .ah-game-question-card,.q-card-v2,.p3-qb-question-card{position:relative;isolation:isolate;overflow:hidden;border:1.5px solid color-mix(in srgb,var(--emerald) 25%,var(--line))!important;border-left:1.5px solid color-mix(in srgb,var(--emerald) 25%,var(--line))!important;border-radius:22px!important;background:linear-gradient(145deg,var(--card) 0%,color-mix(in srgb,var(--mint) 40%,var(--card)) 100%)!important;box-shadow:0 7px 0 color-mix(in srgb,var(--emerald) 15%,var(--card)),0 15px 26px rgba(14,82,59,.09)!important}
    .ah-game-question-card::before,.q-card-v2::before,.p3-qb-question-card::before{position:absolute;z-index:-1;top:-46px;right:-35px;width:132px;height:132px;border:1px solid color-mix(in srgb,var(--emerald) 20%,transparent);border-radius:50%;background:radial-gradient(circle at 34% 34%,color-mix(in srgb,var(--mint) 90%,transparent),transparent 66%);box-shadow:0 0 0 16px color-mix(in srgb,var(--emerald) 4%,transparent);content:'';pointer-events:none}
    .ah-game-question-card::after,.q-card-v2::after,.p3-qb-question-card::after{position:absolute;z-index:-1;right:-39px;bottom:-45px;width:122px;height:122px;border:1px solid color-mix(in srgb,var(--emerald) 13%,transparent);border-radius:50%;content:'';pointer-events:none}
    .ah-game-question-card>*,.q-card-v2>*,.p3-qb-question-card>*{position:relative;z-index:1}
    .ah-game-question-card .q-card-num,.q-card-v2 .q-card-num,.ah-game-question-card .question-number,.ah-game-question-card .result-q-number,.ah-game-question-card .flash-badge,.ah-game-question-card .pill,.ah-game-question-card .p3-qb-qtop>b,.p3-qb-question-card .p3-qb-qtop>b{display:inline-grid;place-items:center;min-height:27px;padding:4px 9px;border:1px solid color-mix(in srgb,var(--emerald) 32%,var(--line));border-radius:9px;background:color-mix(in srgb,var(--card) 78%,var(--mint));color:var(--emerald-d);font-size:11px;font-weight:900;letter-spacing:.08em;box-shadow:0 3px 0 color-mix(in srgb,var(--emerald) 10%,var(--card))}
    .ah-game-question-card .q-text-v2,.q-card-v2 .q-text-v2,.ah-game-question-card .question-text,.ah-game-question-card .exam-question-text,.ah-game-question-card .flash-q-text,.ah-game-question-card .result-question,.ah-game-question-card.saved-note-card h3,.ah-game-question-card.p3-qb-question-card h3,.p3-qb-question-card h3{color:var(--text);font-size:clamp(17px,4.15vw,21px);font-weight:850;line-height:1.58;letter-spacing:-.02em}
    .ah-game-question-option,.q-card-v2 .q-opt-v2,.p3-qb-question-card .p3-qb-options>span{position:relative;overflow:hidden;border:1px solid color-mix(in srgb,var(--emerald) 18%,var(--line))!important;border-radius:15px!important;background:color-mix(in srgb,var(--card) 92%,var(--mint))!important;box-shadow:0 3px 0 color-mix(in srgb,var(--emerald) 10%,var(--card));transition:transform .15s cubic-bezier(.23,1,.32,1),box-shadow .15s ease,border-color .15s ease,background .15s ease!important}
    .ah-game-question-option::after,.q-card-v2 .q-opt-v2::after,.p3-qb-question-card .p3-qb-options>span::after{position:absolute;top:-24px;right:-21px;width:61px;height:61px;border:1px solid color-mix(in srgb,var(--emerald) 11%,transparent);border-radius:50%;content:'';pointer-events:none}
    .ah-game-question-option:not(:disabled):hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--emerald) 48%,var(--line))!important;box-shadow:0 6px 0 color-mix(in srgb,var(--emerald) 13%,var(--card)),0 10px 17px rgba(14,82,59,.09)}
    .ah-game-question-option:not(:disabled):active{transform:translateY(2px) scale(.99);box-shadow:0 2px 0 color-mix(in srgb,var(--emerald) 12%,var(--card))}
    .ah-game-question-card .q-options-v2,.ah-game-question-card .flash-options,.ah-game-question-card .result-options,.ah-game-question-card .saved-note-options{gap:12px}
    .ah-game-question-card .p3-qb-options{display:grid;gap:10px}
    .ah-game-question-card.exam-q-card .opt{margin-bottom:12px}.ah-game-question-card.exam-q-card .opt:last-child{margin-bottom:0}
    .ah-game-question-option{font-size:clamp(15.5px,4.25vw,17px)!important;line-height:1.45}
    .ah-game-question-option .let,.ah-game-question-option .q-opt-letter,.q-card-v2 .q-opt-v2 .q-opt-letter,.ah-game-question-option .flash-opt-let,.ah-game-question-option .result-option-letter,.ah-game-question-option.note-option b{display:grid;place-items:center;flex:0 0 29px;width:29px;height:29px;border:1px solid color-mix(in srgb,var(--emerald) 25%,var(--line));border-radius:9px!important;background:color-mix(in srgb,var(--card) 50%,var(--mint));color:var(--emerald-d);font-weight:900;box-shadow:0 2px 0 color-mix(in srgb,var(--emerald) 8%,var(--card))}
    .ah-game-question-option.selected{border-color:#278ce1!important;background:linear-gradient(145deg,#fff,#e4f4ff)!important;color:#165f9c!important;box-shadow:0 5px 0 #abd9fa,0 11px 20px rgba(39,140,225,.14)!important}
    .ah-game-question-option.selected .let,.ah-game-question-option.selected .q-opt-letter{border-color:#65b5ef;background:#e9f7ff;color:#176aa7}
    .ah-game-question-option.correct,.ah-game-question-option.is-correct,.q-card-v2 .q-opt-v2.correct,.q-card-v2 .q-opt-v2.is-correct{border-color:var(--green)!important;background:color-mix(in srgb,var(--green) 13%,var(--card))!important;color:color-mix(in srgb,var(--green) 78%,var(--text))!important;box-shadow:0 5px 0 color-mix(in srgb,var(--green) 34%,var(--card)),0 11px 20px color-mix(in srgb,var(--green) 14%,transparent)!important}
    .ah-game-question-option.correct .let,.ah-game-question-option.correct .q-opt-letter,.ah-game-question-option.is-correct .result-option-letter,.ah-game-question-option.is-correct.note-option b{border-color:var(--green);background:var(--green);color:#fff}
    .ah-game-question-option.wrong,.ah-game-question-option.is-wrong,.q-card-v2 .q-opt-v2.wrong,.q-card-v2 .q-opt-v2.is-wrong{border-color:var(--red)!important;background:color-mix(in srgb,var(--red) 10%,var(--card))!important;color:color-mix(in srgb,var(--red) 78%,var(--text))!important;box-shadow:0 5px 0 color-mix(in srgb,var(--red) 26%,var(--card)),0 11px 20px color-mix(in srgb,var(--red) 10%,transparent)!important}
    .ah-game-question-option.wrong .let,.ah-game-question-option.wrong .q-opt-letter,.ah-game-question-option.is-wrong.note-option b{border-color:var(--red);background:var(--red);color:#fff}
    .ah-game-question-card.result-review-card.correct{border-color:color-mix(in srgb,var(--green) 55%,var(--line))!important}.ah-game-question-card.result-review-card.wrong{border-color:color-mix(in srgb,var(--red) 48%,var(--line))!important}.ah-game-question-card.result-review-card.skipped{border-color:color-mix(in srgb,var(--orange) 52%,var(--line))!important}
    .ah-game-question-card.exam-q-card{contain:layout paint style}.ah-game-question-card.exam-q-card:active{opacity:1}
    body.ah-is-scrolling .ah-game-question-card,body.ah-is-scrolling .ah-game-question-option{box-shadow:none!important}
    @media(max-width:430px){.ah-game-question-card{border-radius:19px!important;box-shadow:0 5px 0 color-mix(in srgb,var(--emerald) 14%,var(--card)),0 11px 20px rgba(14,82,59,.08)!important}.ah-game-question-card::before{top:-50px;right:-43px;width:120px;height:120px}.ah-game-question-card .q-text-v2,.ah-game-question-card .question-text,.ah-game-question-card .exam-question-text,.ah-game-question-card .flash-q-text,.ah-game-question-card .result-question,.ah-game-question-card.saved-note-card h3,.ah-game-question-card.p3-qb-question-card h3{font-size:17px}.ah-game-question-option{border-radius:13px!important}}
    @media(prefers-reduced-motion:reduce){.ah-game-question-option{transition:none!important}}
  `;
  document.head.appendChild(style);

  const app = document.getElementById('app');
  if (app) new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
    if (node.nodeType !== 1) return;
    if (node.matches?.(CARD_SELECTOR)) node.classList.add('ah-game-question-card');
    if (node.matches?.(OPTION_SELECTOR)) node.classList.add('ah-game-question-option');
    mark(node);
  }))).observe(app, { childList:true, subtree:true });

  mark();
  window.addEventListener('hashchange', () => setTimeout(mark, 80));
  window.addEventListener('load', () => setTimeout(mark, 120));
})();
