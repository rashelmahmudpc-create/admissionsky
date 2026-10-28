/*
 * Vocabulary Master, native Admission Hub tool.
 * Design reminder: keep this an intentionally calm, mobile-first academic tool.
 * It owns structured vocabulary only; it delegates tests, history, progress and rewards to Admission Hub.
 */
(() => {
  'use strict';

  const ROUTE = 'vocabulary-master';
  const STORE = 'vocabularyMaster';
  const VIEW_KEY = 'admission-hub-vocabulary-view-v1';
  const EXAM_SUBJECT_NAME = 'Vocabulary Master';
  const EXAM_TOPIC_NAME = 'Vocabulary Test Bank';
  const state = {
    records: [],
    category: '',
    query: '',
    visible: 50,
    parser: { text: '', records: [], stage: 'input' },
    practice: null,
    cardFlash: null,
    mcq: null,
    cardAnchorId: '',
    cardAnchorTop: 0,
    pendingCardRestore: false,
    practiceSetup: defaultPracticeSetup(),
    practiceSetupRestored: false,
    test: { category: '', selectedIds: [], count: 10, duration: 10, negative: 0 },
  };

  const css = `
/* Vocabulary Master visual language: Admission Hub emerald academic, content-led, no decorative dashboard noise. */
.vm-page{max-width:560px;margin:0 auto;padding-bottom:calc(74px + env(safe-area-inset-bottom,0px))}.vm-kicker{margin:2px 0 4px;color:var(--emerald);font-size:11px;font-weight:800;letter-spacing:.1em}.vm-title{margin:0;font-size:26px;line-height:1.18;letter-spacing:-.6px}.vm-sub{margin:7px 0 0;color:var(--sub);font-size:13px;line-height:1.5}.vm-actions{display:grid;gap:9px;margin-top:22px}.vm-action{display:flex;align-items:center;gap:13px;width:100%;padding:15px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);color:var(--text);text-align:left;box-shadow:var(--shadow);cursor:pointer}.vm-action:active{transform:scale(.985)}.vm-action-mark{display:grid;place-items:center;width:39px;height:39px;border-radius:12px;background:var(--mint);font-size:20px;flex:0 0 39px}.vm-action b{display:block;font-size:15px}.vm-action small{display:block;margin-top:3px;color:var(--sub);font-size:11px;line-height:1.4}.vm-action-arrow{margin-left:auto;color:var(--sub);font-size:22px}.vm-section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:10px;margin:0 0 13px}.vm-section-head h2{margin:0;font-size:21px;letter-spacing:-.35px}.vm-count{color:var(--sub);font-size:12px;white-space:nowrap}.vm-az-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.vm-letter{min-height:82px;padding:11px 7px;border:1px solid var(--line);border-radius:13px;background:var(--card);color:var(--text);box-shadow:var(--shadow);font:inherit;cursor:pointer}.vm-letter:active{transform:scale(.97)}.vm-letter b{display:block;color:var(--emerald-d);font-size:25px;line-height:1}.vm-letter small{display:block;margin-top:8px;color:var(--sub);font-size:11px}.vm-tool-row{display:flex;gap:8px;align-items:center;margin:14px 0}.vm-tool-row .searchbar{flex:1;margin:0}.vm-filter{width:auto!important;max-width:125px;padding:10px!important;font-size:12px!important}.vm-category-intro{padding:14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);margin-bottom:12px}.vm-category-intro b{font-size:18px}.vm-category-intro span{display:block;margin-top:3px;color:var(--sub);font-size:12px}.vm-vocab-list{display:grid;gap:16px}.vm-load-sentinel{height:1px}.vm-word-card{width:100%;padding:0;overflow:hidden;text-align:left;border:1px solid var(--line);border-radius:24px;background:var(--card);color:var(--text);box-shadow:0 9px 26px rgba(10,74,54,.075);font:inherit}.vm-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:25px 25px 20px}.vm-card-word{display:flex;align-items:center;gap:7px;min-width:0}.vm-card-word h3{margin:0;color:#17372d;font-family:Georgia,'Noto Serif Bengali',serif;font-size:31px;line-height:1.14;letter-spacing:-1px;overflow-wrap:anywhere}.vm-card-ordinal{color:var(--emerald);font:700 19px/1 Georgia,'Noto Serif Bengali',serif}.vm-meaning{margin:8px 25px 20px;color:#274e41;font-family:'Noto Serif Bengali',Georgia,serif;font-size:23px;font-weight:700;line-height:1.38}.vm-card-section{padding:22px 25px;border-top:1px solid var(--line)}.vm-card-section-title{margin:0 0 13px;color:var(--emerald-d);font-size:12px;font-weight:900;letter-spacing:.16em}.vm-relation-items{display:grid;gap:9px}.vm-relation-item{display:grid;grid-template-columns:34px minmax(0,1fr) 34px;gap:11px;align-items:center;padding:12px;border:1px solid #dcece6;border-radius:14px;background:#f8fcfa}.vm-relation-number{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#dff2eb;color:var(--emerald-d);font-size:13px;font-weight:900}.vm-relation-copy{display:grid;gap:3px;min-width:0}.vm-relation-copy strong{font-size:19px;line-height:1.14;overflow-wrap:anywhere}.vm-relation-copy span{color:#4a6258;font-family:'Noto Serif Bengali',Georgia,serif;font-size:17px;line-height:1.35}.vm-relation-pair{display:grid;grid-template-columns:1fr 1fr;gap:13px;align-items:start}.vm-relation-col{min-width:0}.vm-relation-col .vm-card-section-title{margin-bottom:9px}.vm-relation-pair .vm-relation-item{grid-template-columns:minmax(0,1fr) 30px;gap:8px;padding:10px}.vm-relation-pair .vm-relation-number{display:none}.vm-relation-pair .vm-relation-copy strong{font-size:15px}.vm-relation-pair .vm-relation-copy span{font-size:13px}.vm-relation-pair .vm-pronounce{width:30px;height:30px;flex-basis:30px}.vm-pronounce{display:inline-grid;place-items:center;flex:0 0 34px;width:34px;height:34px;padding:0;border:1px solid #cfe7dc;border-radius:10px;background:#f0faf5;color:var(--emerald-d);cursor:pointer;vertical-align:middle;box-shadow:0 2px 7px rgba(15,107,79,.05);transition:transform .14s ease,background .14s ease}.vm-pronounce:active{transform:scale(.92);background:#dff3e9}.vm-pronounce svg{width:16px;height:16px;fill:currentColor}.vm-card-word .vm-pronounce{margin-left:5px}.vm-pronounce.loading{pointer-events:none;opacity:.55;border-style:dashed}.vm-pronounce.warn{color:#b7791f;border-color:#ecc98b;background:#fdf6e7}.vm-pronounce.error{color:#c0392b;border-color:#eebab3;background:#fdf1ef}.vm-tip{display:grid;grid-template-columns:30px minmax(0,1fr);gap:10px;margin:0;padding:19px 21px;border-left:4px solid var(--emerald);background:#eaf7f1;color:var(--text);font-size:17px;line-height:1.57}.vm-tip-icon{font-size:21px;line-height:1.2}.vm-tip b{display:block;margin-bottom:5px;color:var(--emerald-d);font-size:13px;letter-spacing:.13em}.vm-detail-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:18px}.vm-detail-actions .btn{min-height:46px;padding:9px 6px;font-size:12px}.vm-parser-area{min-height:280px;line-height:1.55}.vm-parser-preview{display:grid;gap:10px;margin-top:16px}.vm-preview-card{padding:14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card)}.vm-preview-card.invalid{border-color:var(--red)}.vm-preview-card.duplicate{border-color:var(--orange)}.vm-preview-meta{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}.vm-preview-meta span{padding:4px 7px;border-radius:7px;background:var(--mint);color:var(--emerald-d);font-size:10px;font-weight:700}.vm-preview-card.invalid .vm-preview-meta span{background:#fff0ef;color:var(--red)}.vm-parser-footer{display:grid;gap:9px;margin-top:16px}.vm-mode-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:16px}.vm-mode{min-height:112px;padding:14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);color:var(--text);font:inherit;text-align:left;cursor:pointer}.vm-mode:active{transform:scale(.98)}.vm-mode b{display:block;margin-top:11px;font-size:14px}.vm-mode small{display:block;margin-top:4px;color:var(--sub);font-size:11px;line-height:1.35}.vm-practice-card{padding:16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);box-shadow:var(--shadow)}.vm-practice-prompt{font-size:20px;font-weight:800;line-height:1.45}.vm-practice-options{display:grid;gap:8px;margin-top:16px}.vm-practice-option{padding:13px;border:1px solid var(--line);border-radius:11px;background:var(--card);color:var(--text);font:inherit;text-align:left;cursor:pointer}.vm-practice-option.correct{border-color:var(--green);background:color-mix(in srgb,var(--green) 12%,var(--card))}.vm-practice-option.wrong{border-color:var(--red);background:color-mix(in srgb,var(--red) 12%,var(--card))}.vm-match-columns{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:15px;align-items:start}.vm-match-columns>div{display:grid;gap:8px;align-content:start;min-width:0}.vm-match-choice{display:grid;align-content:center;min-width:0;width:100%;height:52px;min-height:52px;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--text);font:inherit;font-size:12px;line-height:1.25;text-align:left;cursor:pointer;overflow:hidden;overflow-wrap:anywhere;contain:layout}.vm-match-choice.selected{border-color:var(--emerald);background:var(--mint)}.vm-match-choice.done{opacity:.48;text-decoration:line-through;pointer-events:none}.vm-test-card{margin-top:16px;padding:16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card)}.vm-test-card label{display:block;margin:14px 0 5px;color:var(--sub);font-size:12px;font-weight:700}.vm-empty{padding:38px 18px;text-align:center;border:1px dashed var(--line);border-radius:var(--radius);color:var(--sub)}.vm-dashboard-entry{display:flex;align-items:center;gap:12px;width:100%;margin-top:10px;padding:14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);color:var(--text);text-align:left;box-shadow:var(--shadow);font:inherit;cursor:pointer}.vm-dashboard-entry:active{transform:scale(.985)}.vm-dashboard-entry i{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:var(--mint);font-style:normal;font-size:19px}.vm-dashboard-entry span{display:grid;gap:3px;min-width:0}.vm-dashboard-entry b{font-size:14px}.vm-dashboard-entry small{color:var(--sub);font-size:11px;line-height:1.35}.vm-dashboard-entry em{margin-left:auto;color:var(--sub);font-size:19px;font-style:normal}@media(max-width:360px){.vm-card-top{padding:21px 19px 17px}.vm-card-word h3{font-size:27px}.vm-meaning{margin:7px 19px 17px;font-size:21px}.vm-card-section{padding:19px}.vm-detail-actions{grid-template-columns:1fr}.vm-mode-grid{grid-template-columns:1fr}.vm-tool-row{align-items:stretch;flex-direction:column}.vm-filter{max-width:none;width:100%!important}.vm-match-columns{grid-template-columns:1fr}.vm-relation-pair{grid-template-columns:1fr}.vm-letter{min-height:72px}}
`;

  const style = document.createElement('style');
  style.setAttribute('data-vocabulary-master-style', 'true');
  style.textContent = css + `
    .vm-tool-row .searchbar{min-height:54px;padding:0 15px;border-radius:16px}
    .vm-tool-row .searchbar input{min-width:0;min-height:52px;font-size:16px;line-height:1.25}
    .vm-tool-row .searchbar span{font-size:18px}
    .vm-word-card{position:relative;overflow:visible;border:1px solid #d4e8df;border-radius:26px;background:linear-gradient(145deg,#ffffff 0%,#fbfffd 58%,#f3f8ff 100%);box-shadow:0 14px 32px rgba(21,91,72,.1);transition:transform .18s cubic-bezier(.23,1,.32,1),box-shadow .18s ease}
    .vm-word-card:hover{transform:translateY(-2px);box-shadow:0 18px 38px rgba(21,91,72,.14)}
    .vm-card-image-shell{position:relative;aspect-ratio:16/9;width:100%;overflow:hidden;border-radius:25px 25px 0 0;background:linear-gradient(135deg,#e9f8f1,#edf4ff 60%,#f9efff)}
    .vm-card-image{display:block;width:100%;height:100%;object-fit:cover}
    .vm-card-image-shell:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,49,43,.02),rgba(8,49,43,.16));pointer-events:none}
    .vm-card-image-empty{display:grid;place-items:center;align-content:center;gap:7px;height:100%;color:#5d8b83;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
    .vm-card-image-empty span:first-child{display:grid;place-items:center;width:39px;height:39px;border:1px solid #afd9c8;border-radius:13px;background:rgba(255,255,255,.66);font-size:20px}
    .vm-card-top{padding:18px 20px 14px}
    .vm-card-word{gap:8px}
    .vm-card-word h3{font-size:27px;line-height:1.18;overflow-wrap:normal;word-break:normal;hyphens:none}
    .vm-card-ordinal{font-size:15px}
    .vm-meaning{margin:5px 20px 17px;font-size:20px;line-height:1.42}
    .vm-card-section{padding:17px 20px;border-top-color:#e2eee9}
    .vm-relation-item{padding:10px;border-radius:15px}
    .vm-relation-copy strong{font-size:17px;overflow-wrap:normal;word-break:normal;hyphens:none}
    .vm-relation-copy span{font-size:15px}
    .vm-tip{padding:15px 17px;font-size:15px}
    .vm-card-menu{position:relative;flex:0 0 auto}
    .vm-card-menu>summary{display:grid;place-items:center;width:38px;height:38px;border:1px solid #c6e5da;border-radius:13px;background:linear-gradient(145deg,#effcf6,#eaf2ff);color:#347467;cursor:pointer;list-style:none;box-shadow:0 5px 12px rgba(15,107,79,.09);font-weight:900;letter-spacing:2px}
    .vm-card-menu>summary::-webkit-details-marker{display:none}
    .vm-card-menu>summary:active{transform:scale(.94)}
    .vm-card-menu-panel{position:absolute;z-index:12;right:0;top:45px;display:grid;gap:5px;width:228px;padding:8px;border:1px solid #cfe6dd;border-radius:16px;background:rgba(255,255,255,.98);box-shadow:0 16px 32px rgba(22,78,68,.18);backdrop-filter:blur(12px)}
    .vm-card-menu-panel button{display:flex;align-items:center;gap:9px;width:100%;padding:10px 9px;border:0;border-radius:10px;background:transparent;color:#234d42;font:inherit;font-size:12px;text-align:left;cursor:pointer}
    .vm-card-menu-panel button:hover{background:#eef8f3}
    .vm-card-menu-panel button>span:first-child{display:grid;place-items:center;width:24px;height:24px;border-radius:8px;background:#e6f5ef;color:#1a725f;font-weight:900}
    .vm-card-menu-panel button.danger{color:#a64d53}.vm-card-menu-panel button.danger>span:first-child{background:#fff0f0;color:#b85158}
    .vm-card-image-input{display:none}
    @media(max-width:520px){.vm-word-card{border-radius:22px}.vm-card-image-shell{border-radius:21px 21px 0 0}.vm-card-top{padding:16px 17px 13px}.vm-card-word h3{font-size:24px}.vm-meaning{margin-left:17px;margin-right:17px;font-size:18px}.vm-card-section{padding:15px 17px}    .vm-card-menu-panel{right:-3px;width:min(228px,calc(100vw - 48px))}}
    .vm-category-intro-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.vm-category-intro-copy{min-width:0}.vm-category-icon-tools{display:flex;gap:6px;flex:0 0 auto;flex-wrap:wrap;justify-content:flex-end}.vm-category-icon-tool{display:grid;place-items:center;width:36px;height:36px;padding:0;border:1px solid #c6e5da;border-radius:11px;background:linear-gradient(145deg,#effcf6,#eaf2ff);color:#26715f;font:inherit;font-size:16px;cursor:pointer;box-shadow:0 4px 10px rgba(15,107,79,.08)}.vm-category-icon-tool:active{transform:scale(.92)}.vm-category-icon-tool[disabled]{opacity:.5;cursor:not-allowed}.vm-category-import-row{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.vm-category-import-row .btn{min-height:38px;padding:7px 10px;font-size:11px}.vm-category-import-hint{margin:8px 0 0;color:var(--sub);font-size:10px;line-height:1.45}.vm-hidden-file{display:none}
  `;
  document.head.appendChild(style);

  const practiceSetupStyle = document.createElement('style');
  practiceSetupStyle.setAttribute('data-vocabulary-practice-setup-style', 'true');
  practiceSetupStyle.textContent = `
  /* Practice Setup: mobile-first academic selection flow, with only real local vocabulary evidence. */
  .vm-setup{display:grid;gap:14px;margin-top:18px}.vm-setup-card{padding:17px;border:1px solid var(--line);border-radius:18px;background:var(--card);box-shadow:var(--shadow)}.vm-step{display:flex;align-items:center;gap:9px;color:var(--emerald-d);font-size:11px;font-weight:900;letter-spacing:.11em}.vm-step i{display:grid;place-items:center;width:24px;height:24px;border-radius:8px;background:var(--mint);font-style:normal}.vm-setup-card h3{margin:9px 0 5px;font-size:20px;letter-spacing:-.35px}.vm-setup-card p{margin:0;color:var(--sub);font-size:12px;line-height:1.5}.vm-setup-card select,.vm-setup-card input{width:100%;min-height:48px;margin-top:13px;font:inherit}.vm-setup-note{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;padding:10px 11px;border-radius:11px;background:var(--mint);color:var(--emerald-d);font-size:12px;font-weight:800}.vm-presets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.vm-preset{min-height:64px;padding:8px;border:1px solid var(--line);border-radius:12px;background:#fbfefc;color:var(--text);font:inherit;text-align:left;cursor:pointer}.vm-preset b,.vm-preset small{display:block}.vm-preset b{font-size:12px}.vm-preset small{margin-top:3px;color:var(--sub);font-size:10px;line-height:1.3}.vm-count-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;align-items:center}.vm-count-row .btn{min-height:48px;padding:9px 12px;white-space:nowrap}.vm-setup-warning{margin-top:10px;padding:10px 11px;border-left:3px solid var(--orange);border-radius:9px;background:#fff9ee;color:#875417;font-size:12px;line-height:1.48}.vm-advanced{margin-top:2px;border:1px solid var(--line);border-radius:15px;background:var(--card)}.vm-advanced>summary{padding:14px 15px;color:var(--emerald-d);font-size:13px;font-weight:800;cursor:pointer}.vm-advanced-body{display:grid;gap:12px;padding:2px 15px 15px}.vm-checkline{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;font-weight:700}.vm-checkline input{width:20px;height:20px;margin:0;accent-color:var(--emerald)}.vm-summary{padding:17px;border:1px solid #cce4da;border-radius:18px;background:linear-gradient(145deg,#f7fcfa,#ecf8f3)}.vm-summary-kicker{color:var(--emerald-d);font-size:10px;font-weight:900;letter-spacing:.14em}.vm-summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:13px}.vm-summary-grid div{min-width:0}.vm-summary-grid small,.vm-summary-grid b{display:block}.vm-summary-grid small{color:var(--sub);font-size:10px}.vm-summary-grid b{margin-top:3px;font-size:14px;line-height:1.35;overflow-wrap:anywhere}.vm-custom-tools{display:flex;gap:8px;margin:12px 0}.vm-custom-tools .btn{flex:1;min-height:42px;padding:8px}.vm-custom-list{display:grid;gap:7px;max-height:350px;margin-top:11px;overflow:auto;overscroll-behavior:contain}.vm-custom-item{display:flex;align-items:center;gap:10px;padding:11px;border:1px solid var(--line);border-radius:12px;background:#fbfefc;cursor:pointer}.vm-custom-item input{width:19px;height:19px;min-height:auto;margin:0;accent-color:var(--emerald)}.vm-custom-item span{display:grid;gap:2px;min-width:0}.vm-custom-item b{font-size:14px}.vm-custom-item small{color:var(--sub);font-family:'Noto Serif Bengali',Georgia,serif;font-size:12px}.vm-custom-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:11px;color:var(--sub);font-size:12px}.vm-custom-foot .btn{min-height:39px;padding:7px 10px}.vm-time-custom{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.vm-time-custom label{display:grid;gap:4px;color:var(--sub);font-size:10px;font-weight:800}.vm-time-custom input{margin:0!important;text-align:center}.vm-timer{display:inline-flex;align-items:center;gap:6px;padding:6px 9px;border-radius:9px;background:#fff4e8;color:#9a581d;font-size:12px;font-weight:900}.vm-start{min-height:56px;font-size:15px!important}.vm-empty-setup{padding:26px 16px;text-align:center;border:1px dashed var(--line);border-radius:18px;background:var(--card)}@media(max-width:360px){.vm-presets,.vm-summary-grid{grid-template-columns:1fr}.vm-count-row{grid-template-columns:1fr}.vm-count-row .btn{width:100%}}
  `;
  document.head.appendChild(practiceSetupStyle);
  const mcqStyle = document.createElement('style');
  mcqStyle.setAttribute('data-vocabulary-mcq-style', 'true');
  mcqStyle.textContent = `.vm-mcq-page .vm-mcq-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.vm-mcq-page .vm-mcq-toolbar .btn{flex:1;min-width:130px;min-height:44px}.vm-mcq-card{padding:18px;border:1px solid var(--line);border-radius:20px;background:var(--card);box-shadow:var(--shadow)}.vm-mcq-meta{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;color:var(--sub);font-size:11px;font-weight:800}.vm-mcq-prompt{margin-top:18px;font-size:21px;font-weight:850;line-height:1.5;color:var(--text)}.vm-mcq-options{display:grid;gap:9px;margin-top:17px}.vm-mcq-option{display:flex;align-items:flex-start;gap:10px;width:100%;padding:13px;border:1px solid var(--line);border-radius:13px;background:var(--card);color:var(--text);font:inherit;font-size:14px;line-height:1.4;text-align:left;cursor:pointer}.vm-mcq-option-letter{display:grid;place-items:center;width:26px;height:26px;flex:0 0 26px;border-radius:8px;background:var(--mint);color:var(--emerald-d);font-weight:900}.vm-mcq-option.correct{border-color:var(--green);background:color-mix(in srgb,var(--green) 12%,var(--card))}.vm-mcq-option.wrong{border-color:var(--red);background:color-mix(in srgb,var(--red) 12%,var(--card))}.vm-mcq-option:disabled{cursor:default}.vm-mcq-feedback{margin-top:14px;padding:12px 13px;border-left:3px solid var(--green);border-radius:10px;background:color-mix(in srgb,var(--green) 10%,var(--card));color:var(--text);font-size:13px;line-height:1.5}.vm-mcq-feedback.wrong{border-left-color:var(--red);background:color-mix(in srgb,var(--red) 9%,var(--card))}.vm-mcq-nav{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-top:14px}.vm-mcq-nav button{min-height:42px;padding:8px 12px}.vm-mcq-empty{padding:28px 16px;border:1px dashed var(--line);border-radius:18px;background:var(--card);text-align:center;color:var(--sub);line-height:1.55}.vm-mcq-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin:16px 0}.vm-mcq-summary>div{padding:14px 8px;border-radius:14px;background:var(--mint);text-align:center}.vm-mcq-summary b,.vm-mcq-summary span{display:block}.vm-mcq-summary b{font-size:24px;color:var(--emerald-d)}.vm-mcq-summary span{margin-top:3px;color:var(--sub);font-size:11px}@media(max-width:360px){.vm-mcq-summary{grid-template-columns:1fr}.vm-mcq-toolbar .btn{min-width:100%}}`;
  document.head.appendChild(mcqStyle);
  const cardFlashStyle = document.createElement('style');
  cardFlashStyle.setAttribute('data-vocabulary-card-flash-style', 'true');
  cardFlashStyle.textContent = `
    .vm-card-flash{display:grid;place-items:center;width:38px;height:38px;flex:0 0 38px;border:1px solid #c6e5da;border-radius:13px;background:linear-gradient(145deg,#effcf6,#e5f4ff);color:#16715e;font:inherit;font-size:18px;cursor:pointer;box-shadow:0 5px 12px rgba(15,107,79,.1);transition:transform .16s ease,box-shadow .16s ease,background .16s ease}.vm-card-flash:hover{transform:translateY(-2px);box-shadow:0 8px 16px rgba(15,107,79,.14);background:#fff}.vm-card-flash:active{transform:scale(.92)}.vm-card-flash span{line-height:1}.vm-card-flash-page{padding-bottom:30px}.vm-card-flash-context{display:flex;align-items:center;gap:10px;margin:12px 0;padding:11px 13px;border:1px solid #cbe4da;border-radius:15px;background:linear-gradient(135deg,#f3fcf8,#f3f8ff);color:#315d68}.vm-card-flash-context strong{font-size:16px}.vm-card-flash-context small{display:block;color:#6d858b;font-size:11px;margin-top:2px}.vm-card-flash-context .vm-pronounce{margin-left:auto}.vm-card-flash-temporary{display:inline-flex;margin-left:auto;padding:5px 8px;border-radius:8px;background:#fff4d8;color:#89621e;font-size:9px;font-weight:900;letter-spacing:.06em;white-space:nowrap}.vm-card-flash-page .flash-q-card{border:1px solid #d7e8e3;background:var(--card)}.vm-card-flash-page .flash-q-text{font-size:18px}.vm-card-flash-page .flash-opt{font:inherit}.vm-card-flash-page .flash-feedback{line-height:1.55}.vm-card-flash-page .flash-explanation{font-size:13px}.vm-card-flash-actions{display:flex;gap:8px;margin-top:12px}.vm-card-flash-actions .btn{flex:1;min-height:46px}.vm-card-flash-note{margin:10px 0;padding:10px 12px;border-left:3px solid #e0a33a;border-radius:10px;background:#fff9e9;color:#765a21;font-size:11px;line-height:1.45}@media(max-width:390px){.vm-card-flash-context{align-items:flex-start}.vm-card-flash-temporary{font-size:8px}.vm-card-flash-page .flash-q-text{font-size:17px}}
  `;
  document.head.appendChild(cardFlashStyle);

  const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
  const safeJson = value => escape(JSON.stringify(value));
  const lower = value => String(value ?? '').trim().toLocaleLowerCase('en-US');
  const unique = values => [...new Set(values.filter(Boolean).map(value => String(value).trim()).filter(Boolean))];
  const shuffle = values => typeof shuffleArr === 'function' ? shuffleArr(values) : [...values].sort(() => Math.random() - .5);
  const route = path => `${ROUTE}${path ? `/${path}` : ''}`;
  const now = () => Date.now();
  const categoryOf = word => (String(word || '').trim().match(/[A-Za-z]/)?.[0] || '#').toUpperCase();

  function defaultPracticeSetup() {
    return { sourceType:'all', category:'', selectedIds:[], customQuery:'', customVisible:40, practiceType:'mixed', questionCount:10, countMode:'preset', customCount:10, timeValue:0, timeMode:'preset', customHours:0, customMinutes:0, customSeconds:0, randomize:true, repeatPolicy:'no-repeat', advancedOpen:false };
  }
  function savePracticeSetup(setup) {
    try { localStorage.setItem('admission-hub-vocabulary-practice-setup', JSON.stringify({ sourceType:setup.sourceType, category:setup.category, practiceType:setup.practiceType, questionCount:setup.questionCount, countMode:setup.countMode, customCount:setup.customCount, timeValue:setup.timeValue, timeMode:setup.timeMode, customHours:setup.customHours, customMinutes:setup.customMinutes, customSeconds:setup.customSeconds, randomize:setup.randomize, repeatPolicy:setup.repeatPolicy })); } catch (_) { /* local persistence is optional */ }
  }
  function restorePracticeSetup() {
    try { const saved = JSON.parse(localStorage.getItem('admission-hub-vocabulary-practice-setup') || 'null'); if (saved && typeof saved === 'object') state.practiceSetup = { ...defaultPracticeSetup(), ...saved, selectedIds:[] }; } catch (_) { /* ignore invalid local preference */ }
  }

  function relationItems(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(item => typeof item === 'string' ? { word:item, meaning:'' } : { word:String(item?.word || '').trim(), meaning:String(item?.meaning || '').trim() }).filter(item => item.word);
  }
  function relations(record, key) { return relationItems(record?.[key]); }
  function normalizeRecord(raw) {
    const word = String(raw?.word || '').trim();
    const meaning = String(raw?.meaning || '').trim();
    const rawAcronyms = raw?.acronyms ?? raw?.acronym ?? [];
    const acronyms = relationItems(Array.isArray(rawAcronyms) ? rawAcronyms : [rawAcronyms]);
    const imageDataUrl = String(raw?.imageDataUrl || raw?.image || raw?.thumbnail || '').trim();
    return {
      id: raw?.id || (typeof uid === 'function' ? uid() : `vm-${now()}-${Math.random().toString(36).slice(2,8)}`),
      tool: 'vocabulary-master',
      word,
      meaning,
      synonyms: relationItems(raw?.synonyms),
      antonyms: relationItems(raw?.antonyms),
      acronyms,
      imageDataUrl,
      tips: String(raw?.tips || '').trim(),
      category: /^[A-Z#]$/.test(String(raw?.category || '').trim()) ? String(raw.category).trim() : categoryOf(word),
      normalized: lower(word),
      order: Number.isFinite(Number(raw?.order)) ? Number(raw.order) : Number.isFinite(Number(raw?.sourceIndex)) ? Number(raw.sourceIndex) : Number(raw?.createdAt || now()),
      createdAt: Number(raw?.createdAt || now()),
      updatedAt: now(),
    };
  }
  let recordsLoaded = false;
  async function seedCategoryA() {
    const seed = window.AH_VOCAB_A_SEED;
    if (!Array.isArray(seed) || !seed.length) return;
    const present = new Set((state.records || []).filter(row => row.category === 'A').map(row => row.normalized));
    const added = seed.map(normalizeRecord).filter(row => row.word && !present.has(row.normalized));
    if (!added.length) return;
    for (const row of added) await dbPut(STORE, row);
    state.records = (state.records || []).concat(added).sort((a,b) => (Number(a.order) - Number(b.order)) || (Number(a.createdAt) - Number(b.createdAt)) || a.id.localeCompare(b.id));
  }
  async function loadRecords(force = false) {
    if (recordsLoaded && !force) return state.records;
    const rows = typeof dbGetAll === 'function' ? await dbGetAll(STORE) : [];
    /* The bank's own IDB store is dedicated to this tool, so a row without a
       `tool` marker is still a vocabulary row. The D1/KV cloud copy (and the
       P13 backfill) ships rows carrying no `tool` field at all; requiring it
       here dropped all 6,256 cloud rows and the bank rendered "0 words" on
       every device that had only ever pulled from the cloud. */
    state.records = (rows || []).filter(row => row && (!row.tool || row.tool === 'vocabulary-master')).map(normalizeRecord).sort((a,b) => (Number(a.order) - Number(b.order)) || (Number(a.createdAt) - Number(b.createdAt)) || a.id.localeCompare(b.id));
    /* The starter cards are off by default. On a device whose bank is still the
       30-card seed (a pre-cloud install), they used to be the only rows the bank
       ever saw, the cloud pull ran first and then the seed was added, so the
       device showed "30 words" for ever and never fetched the real 6,256. The
       bank is cloud-authoritative now: seed only when explicitly enabled. */
    if (window.AH_VOCAB_SEED_ENABLED === true) await seedCategoryA();
    recordsLoaded = true;
    return state.records;
  }
  function visibleCardId() {
    const cards = [...document.querySelectorAll('#vmCategoryResults [data-vm-record-id]')];
    if (!cards.length) return '';
    const guideY = Math.max(84, Math.min(window.innerHeight * .24, 190));
    const active = cards.find(card => { const rect = card.getBoundingClientRect(); return rect.top <= guideY && rect.bottom >= guideY; });
    if (active) return active.dataset.vmRecordId || '';
    const passed = cards.filter(card => card.getBoundingClientRect().top <= guideY);
    return (passed[passed.length - 1] || cards[0])?.dataset.vmRecordId || '';
  }
  let categoryScrollFrame = 0;
  let categoryScrollBound = false;
  function bindCategoryScrollTracking() {
    if (categoryScrollBound) return;
    categoryScrollBound = true;
    window.addEventListener('scroll', () => {
      if (categoryScrollFrame) return;
      categoryScrollFrame = requestAnimationFrame(() => { categoryScrollFrame = 0; if (String(Router?.path || '').startsWith(route('category/'))) { const id = visibleCardId(); if (id) state.cardAnchorId = id; } });
    }, { passive:true });
  }
  function restoreCategoryPosition() {
    if (!state.pendingCardRestore) return;
    const targetId = String(state.cardAnchorId || '');
    const fallbackTop = Math.max(0, Number(state.cardAnchorTop) || 0);
    const apply = () => {
      if (!state.pendingCardRestore || !String(Router?.path || '').startsWith(route('category/'))) return;
      const target = targetId ? [...document.querySelectorAll('#vmCategoryResults [data-vm-record-id]')].find(card => String(card.dataset.vmRecordId) === targetId) : null;
      const top = target ? Math.max(0, Math.round(target.getBoundingClientRect().top + window.scrollY - 16)) : fallbackTop;
      if (!target && !fallbackTop) return;
      window.scrollTo({ top, left:0, behavior:'auto' });
      state.pendingCardRestore = false;
    };
    [80, 300, 760].forEach(wait => window.setTimeout(apply, wait));
  }
  function snapshotResume(path = String(Router?.path || ''), top = window.scrollY || 0) {
    if (!String(path).startsWith(ROUTE)) return;
    const savedTop = Math.max(0, Number(top) || 0);
    const cardId = state.cardAnchorId || visibleCardId();
    state.cardAnchorTop = savedTop;
    try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ path:String(path), category:state.category, query:state.query, visible:state.visible, top:savedTop, cardId, savedAt:Date.now() })); } catch (_) {}
  }
  function restoreResume(path = String(Router?.path || '')) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null');
      if (!saved || saved.path !== String(path)) return;
      state.category = String(saved.category || state.category || '').toUpperCase();
      state.query = String(saved.query || '');
      state.visible = Math.max(50, Number(saved.visible) || 50);
      state.cardAnchorId = String(saved.cardId || '');
      state.cardAnchorTop = Math.max(0, Number(saved.top) || 0);
      state.pendingCardRestore = !!(state.cardAnchorId || state.cardAnchorTop);
    } catch (_) {}
  }
  function recordsFor(query = state.query, category = state.category) {
    const q = lower(query);
    return state.records.filter(record => {
      if (category && record.category !== category) return false;
      if (!q) return true;
      const haystack = [record.word, record.meaning, record.tips, ...record.synonyms.flatMap(item => [item.word, item.meaning]), ...record.antonyms.flatMap(item => [item.word, item.meaning]), ...record.acronyms.flatMap(item => [item.word, item.meaning])].join(' ').toLocaleLowerCase('en-US');
      return haystack.includes(q);
    });
  }
  function backButton(target = ROUTE) { return `<button class="backbtn" onclick="navigate('${target}')" aria-label="Back">←</button>`; }
  function emptyBank() { return `<div class="vm-empty"><div style="font-size:30px">📚</div><b style="display:block;margin-top:7px;color:var(--text)">Vocabulary Bank is empty.</b><p style="margin:7px 0 14px;font-size:12px;line-height:1.5">শব্দভাণ্ডার এখানে দেখা যাবে, প্র্যাকটিস আর MCQ চালু থাকবে।</p></div>`; }
  function heading(kicker, title, sub) { return `<div class="explorer-head"><div class="vm-kicker">${escape(kicker)}</div><h2 class="vm-title">${escape(title)}</h2>${sub ? `<p class="vm-sub">${escape(sub)}</p>` : ''}</div>`; }

  function renderLanding() {
    const body = `<main class="vm-page">${heading('VOCABULARY MASTER', 'Vocabulary Master', 'Synonyms • Antonyms • Bengali Meaning')}<div class="vm-actions"><button class="vm-action" onclick="navigate('${route('bank')}')"><span class="vm-action-mark">📚</span><span><b>Vocabulary Bank</b><small>Browse vocabulary A–Z</small></span><i class="vm-action-arrow">›</i></button><button class="vm-action" onclick="navigate('${route('practice')}')"><span class="vm-action-mark">🧠</span><span><b>Practice</b><small>Short learning activities with instant feedback</small></span><i class="vm-action-arrow">›</i></button><button class="vm-action" onclick="VocabularyMaster.startMcq('')"><span class="vm-action-mark">❓</span><span><b>Vocabulary MCQ</b><small>আলাদা MCQ page · instant feedback · reset anytime</small></span><i class="vm-action-arrow">›</i></button><button class="vm-action" onclick="navigate('${route('test')}')"><span class="vm-action-mark">📝</span><span><b>Test</b><small>Use the existing Mock Test and Flash Test engines</small></span><i class="vm-action-arrow">›</i></button></div></main>`;
    renderShell(body, { title:'Vocabulary Master', back:"navigate('dashboard')" });
  }

  function renderBank() {
    const counts = categoryCounts();
    ensureCloudCounts();
    const bankTotal = state.records.length || LETTERS.reduce((n, letter) => n + Number(counts[letter] || 0), 0);
    const grid = `<div class="vm-az-grid">${LETTERS.map(letter => `<button class="vm-letter" onclick="VocabularyMaster.openCategory('${letter}')"><b>${letter}</b><small>${counts[letter].toLocaleString()} words</small></button>`).join('')}</div>`;
    const empty = !bankTotal ? `<div class="vm-empty" style="margin-top:15px"><b style="display:block;color:var(--text)">Vocabulary Bank is empty.</b><p style="margin:7px 0 0;font-size:12px;line-height:1.5">A–Z থেকে category খুলে দেখতে পারেন, অথবা Parser ব্যবহার করে আপনার প্রথম vocabulary set যোগ করুন।</p></div>` : '';
    const body = `<main class="vm-page">${heading('VOCABULARY BANK', 'Browse A–Z', bankTotal ? 'একটি অক্ষর নির্বাচন করে সেই category-এর শব্দ দেখুন।' : 'A–Z category থেকে আপনার vocabulary library শুরু করুন।')}<div class="vm-section-head"><h2>Categories</h2><span class="vm-count">${bankTotal.toLocaleString()} words</span></div>${grid}${empty}</main>`;
    renderShell(body, { title:'Vocabulary Bank', back:`navigate('${ROUTE}')` });
  }

  function relationColumn(title, items) {
    if (!items.length) return '';
    return `<div class="vm-relation-col"><h4 class="vm-card-section-title">${escape(title)}</h4><div class="vm-relation-items">${items.map((item, index) => `<div class="vm-relation-item"><span class="vm-relation-number">${index + 1}</span><span class="vm-relation-copy"><strong>${escape(item.word)}</strong>${item.meaning ? `<span>${escape(item.meaning)}</span>` : ''}</span>${pronounceButton(item.word, `${item.word} pronunciation`)}</div>`).join('')}</div></div>`;
  }
  function relationSection(title, items) {
    if (!items.length) return '';
    return `<section class="vm-card-section"><h4 class="vm-card-section-title">${escape(title)}</h4><div class="vm-relation-items">${items.map((item, index) => `<div class="vm-relation-item"><span class="vm-relation-number">${index + 1}</span><span class="vm-relation-copy"><strong>${escape(item.word)}</strong>${item.meaning ? `<span>${escape(item.meaning)}</span>` : ''}</span>${pronounceButton(item.word, `${item.word} pronunciation`)}</div>`).join('')}</div></section>`;
  }
  function relationPair(synonyms, antonyms) {
    const left = relationColumn('SYNONYMS', synonyms);
    const right = relationColumn('ANTONYMS', antonyms);
    if (!left && !right) return '';
    return `<section class="vm-card-section vm-relation-pair">${left}${right}</section>`;
  }
  function pronounceButton(word, label) {
    const encoded = encodeURIComponent(String(word || '')).replace(/'/g, '%27');
    return `<button type="button" class="vm-pronounce" aria-label="${escape(label || `Pronounce ${word}`)}" title="Listen to pronunciation" onclick="event.preventDefault();event.stopPropagation();window.VocabularyPronunciation?.play(decodeURIComponent('${encoded}'), this)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10v4h4l5 4V6L7 10H3zm11.5 2c0-1.41-.81-2.63-2-3.22v6.44c1.19-.59 2-1.81 2-3.22zM12.5 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.5 7-8.77s-2.99-7.86-7-8.77z"/></svg></button>`;
  }
  function imagePromptFor(record) {
    const synonyms = relations(record, 'synonyms').map(item => `${item.word}${item.meaning ? ` (${item.meaning})` : ''}`).join(', ');
    const acronyms = relations(record, 'acronyms').map(item => `${item.word}${item.meaning ? ` (${item.meaning})` : ''}`).join(', ');
    return `Create one premium 16:9 visual-memory image for an English-learning vocabulary app.\n\nSemantic reference only, do not render any of this text inside the image:\nVocabulary word: ${record.word}\nBengali meaning: ${record.meaning}\nSynonyms: ${synonyms || 'None provided'}\nAcronym or abbreviation: ${acronyms || 'None provided'}\nContext or explanation: ${record.tips || 'Use the exact word meaning as the main context.'}\n\nCORE MEMORY DIRECTION:\nBuild one instantly recognizable mnemonic scene around the exact meaning. Use a single dominant action or visual metaphor, one distinctive anchor object, clear foreground/background separation, strong contrast, a surprising but natural association, and an emotionally noticeable moment that is easy to recall later. Do not make a collage, dictionary illustration, infographic, diagram, split-screen, or generic decorative scene. The meaning must be understandable from the visual action alone. Keep the composition uncluttered and mobile-friendly.\n\nART DIRECTION:\nUse polished 3D-realistic animation with natural human anatomy, believable materials, realistic light, cinematic depth of field, tactile detail, subtle expressive motion frozen in a single frame, and a premium educational-film look. It should feel like a high-end realistic animated movie frame: visually rich, attractive, natural and believable rather than plastic, childish or surreal. Use a YouTube-thumbnail-like 16:9 composition with a strong focal point, balanced negative space and clear silhouette.\n\nSTRICT OUTPUT RULES:\nThe generated image itself must contain absolutely no visible text of any kind: no English or Bengali letters, no words, captions, labels, subtitles, numbers, symbols, logos, watermarks, signs, UI, book pages, posters, screens, badges, speech bubbles or typographic marks. Do not place the vocabulary word or Bengali meaning in the image. Do not add unrelated objects or multiple competing scenes. Render only the clean visual story; all vocabulary metadata is reference for the scene and must remain outside the image.`;
  }
  function copyPlainText(text) {
    const value = String(text || '');
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value).then(() => toast('AI image prompt copy হয়েছে।')).catch(() => fallbackCopy(value));
    return fallbackCopy(value);
  }
  function fallbackCopy(value) {
    const area = document.createElement('textarea'); area.value = value; area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select();
    try { document.execCommand('copy'); toast('AI image prompt copy হয়েছে।'); } catch (_) { toast('Prompt copy করা যায়নি, লেখাটি manually copy করো।'); } finally { area.remove(); }
  }
  function imageDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || Error('Image read failed'));
      reader.onload = () => {
        const raw = String(reader.result || ''); const image = new Image();
        image.onload = () => {
          try {
            const width = 1280, height = 720, scale = Math.max(width / image.naturalWidth, height / image.naturalHeight), sw = Math.round(width / scale), sh = Math.round(height / scale), sx = Math.max(0, Math.round((image.naturalWidth - sw) / 2)), sy = Math.max(0, Math.round((image.naturalHeight - sh) / 2));
            const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(image, sx, sy, sw, sh, 0, 0, width, height); resolve(canvas.toDataURL('image/jpeg', .84));
          } catch (_) { resolve(raw); }
        };
        image.onerror = () => resolve(raw); image.src = raw;
      };
      reader.readAsDataURL(file);
    });
  }
  function card(record, number) {
    const synonyms = relations(record, 'synonyms'); const antonyms = relations(record, 'antonyms'); const acronyms = relations(record, 'acronyms'); const image = record.imageDataUrl;
    const menuId = `vm-card-menu-${String(record.id).replace(/[^A-Za-z0-9_-]/g, '-')}`; const inputId = `${menuId}-input`;
    return `<article class="vm-word-card" data-vm-record-id="${escape(record.id)}"><div class="vm-card-image-shell ${image ? 'has-image' : ''}">${image ? `<img class="vm-card-image" src="${escape(image)}" alt="Memory image for ${escape(record.word)}" loading="eager" decoding="async">` : `<div class="vm-card-image-empty"><span aria-hidden="true">▧</span><span>Memory image slot · 16:9</span></div>`}</div><div class="vm-card-top"><div class="vm-card-word"><span class="vm-card-ordinal">${number}</span><h3>${escape(record.word)}</h3>${pronounceButton(record.word, `${record.word} pronunciation`)}</div><details class="vm-card-menu" id="${menuId}"><summary aria-label="More actions for ${escape(record.word)}" title="More actions"><span aria-hidden="true">•••</span></summary><div class="vm-card-menu-panel"><button type="button" onclick="event.preventDefault();event.stopPropagation();VocabularyMaster.startCardFlash('${escape(record.id)}')"><span>⚡</span><span>Temporary Flash Test</span></button><button type="button" onclick="event.preventDefault();event.stopPropagation();document.getElementById('${inputId}')?.click()"><span>▣</span><span>${image ? 'Replace memory image' : 'Add memory image'}</span></button>${image ? `<button type="button" class="danger" onclick="event.preventDefault();event.stopPropagation();VocabularyMaster.removeCardImage('${escape(record.id)}')"><span>×</span><span>Remove image</span></button>` : ''}</div></details><input id="${inputId}" class="vm-card-image-input" type="file" accept="image/*" onchange="VocabularyMaster.attachCardImage('${escape(record.id)}', this)"></div><div class="vm-meaning">${escape(record.meaning)}</div>${relationPair(synonyms, antonyms)}${relationSection('ACRONYMS', acronyms)}${record.tips ? `<div class="vm-card-section"><div class="vm-tip"><span class="vm-tip-icon">✦</span><span><b>TIPS & EXPLANATION</b>${escape(record.tips)}</span></div></div>` : ''}</article>`;
  }
  function categoryRecords(category = state.category) {
    return state.records.filter(record => !category || record.category === category).slice().sort((a,b) => (Number(a.order) - Number(b.order)) || (Number(a.createdAt) - Number(b.createdAt)) || a.id.localeCompare(b.id));
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.rel = 'noopener'; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }
  function canvasWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 46) {
    let lineCount = 0;
    for (const paragraph of String(text || '').split('\n')) {
      const words = paragraph.split(/\s+/).filter(Boolean); let line = '';
      if (!words.length) { y += lineHeight; lineCount++; continue; }
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > maxWidth && line) { ctx.fillText(line, x, y); y += lineHeight; lineCount++; line = word; if (lineCount >= maxLines) return y; }
        else line = next;
      }
      if (line) { ctx.fillText(line, x, y); y += lineHeight; lineCount++; }
      if (lineCount >= maxLines) return y;
    }
    return y;
  }
  function jpegBytes(dataUrl) {
    const base64 = String(dataUrl || '').split(',')[1] || ''; const binary = atob(base64); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i); return bytes;
  }
  function asciiBytes(text) { return new TextEncoder().encode(text); }
  function buildImagePdf(images, width, height) {
    const parts = [asciiBytes('%PDF-1.4\n%\n')]; const offsets = [0]; let position = parts[0].length; const add = bytes => { parts.push(bytes); position += bytes.length; }; const addObject = (number, dictionary, streamBytes = null) => { offsets[number] = position; add(asciiBytes(`${number} 0 obj\n${dictionary}\n`)); if (streamBytes) { add(asciiBytes('stream\n')); add(streamBytes); add(asciiBytes('\nendstream\n')); } add(asciiBytes('endobj\n')); };
    const pageCount = images.length; const maxObject = 2 + pageCount * 3; addObject(1, '<< /Type /Catalog /Pages 2 0 R >>'); addObject(2, `<< /Type /Pages /Kids [${images.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${pageCount} >>`);
    images.forEach((dataUrl, i) => { const pageObject = 3 + i * 3, contentObject = pageObject + 1, imageObject = pageObject + 2, bytes = jpegBytes(dataUrl); const content = asciiBytes(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`); addObject(pageObject, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`); addObject(contentObject, `<< /Length ${content.length} >>`, content); addObject(imageObject, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>`, bytes); });
    const xrefPosition = position; add(asciiBytes(`xref\n0 ${maxObject + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefPosition}\n%%EOF\n`)); return new Blob(parts, { type:'application/pdf' });
  }
  function promptPage(record, index, total) {
    const width = 1240, height = 1754, canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); const margin = 78, usable = width - margin * 2; ctx.fillStyle = '#0f6b4f'; ctx.fillRect(margin, 70, 150, 8); ctx.fillStyle = '#102a23'; ctx.font = '800 36px "Noto Sans Bengali", "Noto Sans", sans-serif'; ctx.fillText('AI Image Prompt Pack', margin, 145); ctx.fillStyle = '#62756d'; ctx.font = '500 21px "Noto Sans Bengali", "Noto Sans", sans-serif'; ctx.fillText(`Vocabulary category: ${state.category || 'ALL'} · ${index + 1} / ${total}`, margin, 188); ctx.fillStyle = '#edf8f2'; ctx.fillRect(margin, 230, usable, 150); ctx.fillStyle = '#0f6b4f'; ctx.font = '800 30px "Noto Sans Bengali", "Noto Sans", sans-serif'; ctx.fillText(`Serial ${index + 1}`, margin + 28, 282); ctx.fillStyle = '#17372d'; ctx.font = '800 38px "Noto Sans Bengali", "Noto Sans", sans-serif'; ctx.fillText(String(record.word || ''), margin + 28, 335); ctx.fillStyle = '#4b6259'; ctx.font = '500 23px "Noto Sans Bengali", "Noto Sans", sans-serif'; canvasWrappedText(ctx, `Meaning: ${record.meaning || ''}`, margin + 28, 365, usable - 56, 31, 2); let y = 440; ctx.fillStyle = '#0f6b4f'; ctx.font = '800 22px "Noto Sans Bengali", "Noto Sans", sans-serif'; ctx.fillText('COPY-READY PROMPT', margin, y); y += 42; ctx.fillStyle = '#273d35'; ctx.font = '500 20px "Noto Sans Bengali", "Noto Sans", sans-serif'; canvasWrappedText(ctx, imagePromptFor(record), margin, y, usable, 30, 41); ctx.fillStyle = '#91a59c'; ctx.font = '500 16px "Noto Sans", sans-serif'; ctx.fillText('Generated from Admission Hub Vocabulary Master · Image must contain no text', margin, height - 48); return canvas.toDataURL('image/jpeg', .91);
  }
  function downloadCategoryPromptPdf(category) {
    const records = categoryRecords(String(category || '').toUpperCase()); if (!records.length) return toast('এই category-তে কোনো vocabulary নেই।'); toast('Category prompt PDF তৈরি হচ্ছে…'); window.setTimeout(() => { const images = records.map((record, index) => promptPage(record, index, records.length)); downloadBlob(buildImagePdf(images, 1240, 1754), `vocabulary-${String(category || 'all').toUpperCase()}-image-prompts.pdf`); toast(`${records.length} vocabulary-এর prompt PDF download হয়েছে।`); }, 30);
  }
  function categoryPromptText(category) {
    const target = !category || String(category).toUpperCase() === 'ALL' ? '' : String(category).toUpperCase();
    const records = categoryRecords(target);
    const label = target || 'ALL';
    const parts = records.map((record, index) => `--- ${index + 1}/${records.length} · ${record.word} ---\n${imagePromptFor(record)}`);
    return `AI IMAGE PROMPT PACK, Vocabulary category: ${label} (${records.length} words)\nপ্রতিটি প্রম্পট আলাদা একটি 16:9 ছবির জন্য। serial অনুযায়ী generated image গুলো category-র card-এ বসবে।\n\n${parts.join('\n\n')}`;
  }
  function copyCategoryPrompt(category) {
    const target = !category || String(category).toUpperCase() === 'ALL' ? '' : String(category).toUpperCase();
    const records = categoryRecords(target);
    if (!records.length) return toast('এই category-তে কোনো vocabulary নেই।');
    const done = () => toast(`${records.length}টি vocabulary-র image prompt কপি হয়েছে, image জেনারেটরে পেস্ট করো।`);
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(categoryPromptText(target)).then(done).catch(() => { fallbackCopy(categoryPromptText(target)); done(); });
    fallbackCopy(categoryPromptText(target)); done();
  }
  const vmVoiceKey = word => String(word || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  function categoryVoiceEntries(category) {
    const target = !category || String(category).toUpperCase() === 'ALL' ? '' : String(category).toUpperCase();
    const records = categoryRecords(target);
    const map = new Map();
    const add = (word, meaning, role, parent) => {
      const w = String(word || '').trim(); if (!w) return;
      const key = vmVoiceKey(w); if (!key) return;
      if (!map.has(key)) map.set(key, { key, word: w, meaning: String(meaning || ''), roles: [] });
      const entry = map.get(key);
      if (!entry.meaning && meaning) entry.meaning = String(meaning);
      entry.roles.push(role + (parent ? ` · ${parent}` : ''));
    };
    records.forEach(record => {
      add(record.word, record.meaning, 'main word', record.word);
      relations(record, 'synonyms').forEach(item => add(item.word, item.meaning, 'synonym', record.word));
      relations(record, 'antonyms').forEach(item => add(item.word, item.meaning, 'antonym', record.word));
    });
    return { target, records, entries: [...map.values()] };
  }
  function categoryVoicePromptText(category) {
    const { target, entries } = categoryVoiceEntries(category);
    const label = target || 'ALL';
    const lines = entries.map((entry, index) => `${index + 1}. ${entry.key}.mp3, ${entry.word}${entry.meaning ? ', ' + entry.meaning : ''} (${[...new Set(entry.roles)].join(', ')})`);
    return `VOICE PACK, Vocabulary category: ${label} (${entries.length} unique words)\nভয়েস ফরম্যাট: MP3, পরিষ্কার মোনো রেকর্ডিং, প্রতিটি ফাইলে শুধু ওই একটি শব্দ।\nভয়েস স্টাইল: একদম মানুষের মতো natural, native-like স্পষ্ট উচ্চারণ; প্রতিটি শব্দ প্রথমে ধীরে, তারপর স্বাভাবিক গতিতে, মোট ২ বার; কোনো মিউজিক বা নয়েজ নয়।\nফাইলের নাম হুবহু নিচের তালিকার মতো রাখো, অ্যাপ নাম মিলিয়ে সঠিক শব্দে ভয়েস বসাবে।\n\n${lines.join('\n')}`;
  }
  async function copyCategoryVoicePrompt(category) {
    const { entries } = categoryVoiceEntries(category);
    if (!entries.length) return toast('এই category-তে কোনো vocabulary নেই।');
    const text = categoryVoicePromptText(category);
    const done = () => toast(`${entries.length}টি শব্দের voice prompt কপি হয়েছে, AI agent-কে দাও।`);
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(done).catch(() => { fallbackCopy(text); done(); });
    fallbackCopy(text); done();
  }
  function voiceLib() { return window.__vmVoiceLib || {}; }
  function openVoiceUploader(category) {
    const { target, entries } = categoryVoiceEntries(category);
    if (!entries.length) return toast('এই category-তে কোনো vocabulary নেই।');
    const lib = voiceLib();
    const have = entries.filter(entry => lib[entry.key]).length;
    const safeCategory = escape(String(target || 'ALL'));
    openModal(`<h3>🎧 Category voices, ${safeCategory}</h3><p class="muted" style="margin-top:5px">এই category-র <b>${entries.length}</b>টি unique শব্দের মধ্যে <b>${have}</b>টিতে কাস্টম voice আছে।</p><p class="muted" style="margin-top:5px;font-size:12px">🎙 দিয়ে prompt কপি করে AI দিয়ে voice বানাও, তারপর নিচে আপলোড দাও। ফাইলের নাম হুবহু হতে হবে (যেমন <code>apple.mp3</code>, <code>prove-guilty.mp3</code>), অ্যাপ নাম মিলিয়ে সঠিক শব্দে বসাবে, অফলাইনেও বাজবে।</p><label class="flabel" style="margin-top:12px">Voice ফাইল আপলোড (একসাথে অনেকগুলো দেওয়া যাবে)</label><input id="vmVoiceInput" type="file" accept="audio/mpeg,audio/*,.mp3" multiple onchange="VocabularyMaster.uploadCategoryVoices('${safeCategory}',this)"><button class="btn ghost sm" style="margin-top:12px" onclick="VocabularyMaster.copyCategoryVoicePrompt('${safeCategory}')">🎙 এই category-র voice prompt কপি</button>`);
  }
  async function uploadCategoryVoices(category, input) {
    const files = [...(input?.files || [])];
    if (!files.length) return toast('কোনো voice ফাইল নির্বাচন করা হয়নি।');
    let saved = 0; const unmatched = [];
    for (const file of files) {
      const key = String(file.name || '').replace(/\.[a-z0-9]+$/i, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!key) { unmatched.push(file.name); continue; }
      try {
        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error || Error('read failed')); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
        await dbPut(STORE, { id: 'vmvoice-' + key, tool: 'vocabulary-master-voice', normalized: key, dataUrl, createdAt: now(), updatedAt: now() });
        saved++;
      } catch (_) { unmatched.push(file.name); }
    }
    try { window.VocabularyPronunciation?.reloadVoices?.(); } catch (_) {}
    try { input.value = ''; } catch (_) {}
    closeModal();
    toast(`${saved}টি voice সেভ হয়েছে${unmatched.length ? ` · ${unmatched.length}টি ফাইলের নাম মেলেনি` : ''}, এখন অফলাইনেও কাস্টম voice বাজবে।`);
  }
  let autoImageState = null;
  const autoImageSeed = word => { let hash = 7; const text = String(word || 'x'); for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0; return hash % 100000; };
  function autoImagePromptFor(word) { return `Educational vocabulary illustration for the English word "${word}". One clear simple scene showing the word's meaning, bright friendly colors, clean flat modern illustration style, centered composition, no text, no letters, no watermark`; }
  function autoCategoryImages(category) {
    const normalized = String(category || '').toUpperCase();
    if (!/^[A-Z]$/.test(normalized)) return toast('একটি নির্দিষ্ট vocabulary category নির্বাচন করুন।');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return toast('\ud83d\udcf4 অফলাইনে ছবি বানানো যায় না, internet চালু করে আবার চেষ্টা করো।');
    const pending = categoryRecords(normalized).filter(record => !record.imageDataUrl);
    if (!pending.length) return toast(`${normalized} category-র সব card-এই image আছে ✓`);
    confirmModal(
      `${normalized}, Auto AI image`,
      `${normalized} category-র ${pending.length}টি card-এ image নেই। এক ক্লিকে AI দিয়ে এক একটি ছবি বানিয়ে সঠিক card-এ বসে যাবে (প্রতিটায় কয়েক সেকেন্ড লাগে, internet লাগবে; আগে থেকে থাকা ছবি বদলাবে না)।`,
      () => startAutoImages(normalized, pending),
      '\u2702 ছবি বানাও',
      false
    );
  }
  async function startAutoImages(category, queue) {
    autoImageState = { category, total: queue.length, done: 0, failed: 0, stop: false };
    openModal(`<h3>\u2702 Auto image, ${escape(category)}</h3><p class="muted" id="vmAutoImgStatus" style="margin-top:6px">শুরু হচ্ছে…</p><div style="margin-top:12px;height:8px;border-radius:99px;background:var(--mint);overflow:hidden"><div id="vmAutoImgBar" style="height:100%;width:0%;background:var(--emerald);transition:width .3s"></div></div><button class="btn ghost sm" style="margin-top:14px" onclick="VocabularyMaster.stopAutoImages()">\u23f9 থামাও</button>`);
    for (const record of queue) {
      if (!autoImageState || autoImageState.stop) break;
      autoImageStatus(record.word);
      try {
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(autoImagePromptFor(record.word))}?width=768&height=432&nologo=true&model=flux&seed=${autoImageSeed(record.word)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('http-' + response.status);
        const blob = await response.blob();
        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
        if (!/^data:image\/(jpeg|png|webp)/.test(dataUrl)) throw new Error('not-image');
        const fresh = state.records.find(row => row.id === record.id) || record;
        await dbPut(STORE, normalizeRecord({ ...fresh, imageDataUrl: dataUrl, id: fresh.id, createdAt: fresh.createdAt }));
        autoImageState.done += 1;
      } catch (_) { if (autoImageState) autoImageState.failed += 1; }
      autoImageBar();
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
    const summary = autoImageState ? { ...autoImageState } : null;
    autoImageState = null;
    await loadRecords(true);
    closeModal();
    refreshCategoryResults();
    if (summary) toast(summary.stop
      ? `\u23f8 থামানো হলো, ${summary.done}টি ছবি বসানো হয়েছে${summary.failed ? `, ${summary.failed}টি ব্যর্থ` : ''}`
      : `\u2705 ${summary.done}টি ছবি বসানো হয়েছে${summary.failed ? `, \u26a0\ufe0f ${summary.failed}টি ব্যর্থ; আবার ✨ চাপলে শুধু ব্যর্থগুলোর চেষ্টা হবে` : ''}`);
  }
  function autoImageStatus(word) { const box = document.getElementById('vmAutoImgStatus'); if (box && autoImageState) box.textContent = `ছবি আঁকা হচ্ছে… ${autoImageState.done + 1}/${autoImageState.total}, ${word}`; }
  function autoImageBar() { const bar = document.getElementById('vmAutoImgBar'); if (bar && autoImageState) bar.style.width = `${Math.round((autoImageState.done / autoImageState.total) * 100)}%`; }
  function stopAutoImages() { if (autoImageState) { autoImageState.stop = true; toast('\u23f9 এই ছবির পরে থেমে যাবে…'); } }
  function openCategoryImageImporter(category) {
    const safeCategory = escape(String(category || '').toUpperCase()); const count = categoryRecords(category).length;
    openModal(`<h3>Import category images</h3><p class="muted" style="margin-top:5px">${safeCategory} category-এর ${count}টি card-এর জন্য image serial অনুযায়ী বসবে। PDF page order অথবা filename serial ব্যবহার করা হবে।</p><label class="flabel">PDF upload · প্রতি page = একটি image</label><input id="vmCategoryPdfInput" class="vm-parser-area" style="min-height:auto;padding:10px" type="file" accept="application/pdf" onchange="VocabularyMaster.importCategoryPdf('${safeCategory}',this)"><label class="flabel" style="margin-top:14px">Multiple image gallery/file upload</label><input id="vmCategoryImageInput" class="vm-parser-area" style="min-height:auto;padding:10px" type="file" accept="image/*" multiple onchange="VocabularyMaster.importCategoryImages('${safeCategory}',this)"><p class="muted" style="font-size:11px;line-height:1.5;margin:12px 0 0">001, 002 বা 01, 02 filename থাকলে সেই serial অনুযায়ী sort হবে। Serial না থাকলে browser selection order রাখা হবে। অতিরিক্ত file/card হলে matching count পর্যন্ত apply হবে।</p><button class="btn secondary" style="margin-top:15px" onclick="closeModal()">Close</button>`);
  }
  function orderedImageFiles(files) {
    const list = [...(files || [])].filter(file => String(file.type || '').startsWith('image/')); const withSerial = list.map((file, index) => ({ file, index, serial:Number((file.name.match(/(?:^|[^0-9])(\d{1,5})(?:[^0-9]|$)/) || [])[1] || NaN) })).filter(item => Number.isFinite(item.serial)); if (withSerial.length === list.length && list.length) return withSerial.sort((a,b) => a.serial - b.serial || a.index - b.index).map(item => item.file); return list;
  }
  async function imageDataUrls(files) { const ordered = orderedImageFiles(files); const images = []; for (const file of ordered) images.push(await imageDataUrl(file)); return images; }
  async function loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib; if (window.__vmPdfJsPromise) return window.__vmPdfJsPromise; window.__vmPdfJsPromise = new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'; script.onload = () => { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; resolve(window.pdfjsLib); } catch (error) { reject(error); } }; script.onerror = () => reject(new Error('PDF engine load failed')); document.head.appendChild(script); }); return window.__vmPdfJsPromise;
  }
  async function pdfPageImages(file) { const pdfjs = await loadPdfJs(); const data = await file.arrayBuffer(); const pdf = await pdfjs.getDocument({ data }).promise; const images = []; for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) { const page = await pdf.getPage(pageNumber); const viewport = page.getViewport({ scale:1.35 }); const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height); await page.render({ canvasContext:canvas.getContext('2d'), viewport }).promise; images.push(canvas.toDataURL('image/jpeg', .86)); } return images; }
  async function applyCategoryImages(category, images) { const records = categoryRecords(String(category || '').toUpperCase()); if (!records.length || !images.length) return toast('Import করার মতো category/image পাওয়া যায়নি।'); const total = Math.min(records.length, images.length); for (let index = 0; index < total; index += 1) { const record = records[index]; await dbPut(STORE, normalizeRecord({ ...record, id:record.id, order:record.order, imageDataUrl:images[index], createdAt:record.createdAt })); } await loadRecords(true); closeModal(); refreshCategoryResults(); toast(`${total}টি image serial অনুযায়ী card-এ বসানো হয়েছে।`); }
  async function importCategoryImages(category, input) { const files = [...(input?.files || [])]; if (!files.length) return; try { toast('Images serial অনুযায়ী প্রস্তুত হচ্ছে…'); await applyCategoryImages(category, await imageDataUrls(files)); } catch (_) { toast('Multiple image import করা যায়নি।'); } finally { if (input) input.value = ''; } }
  async function importCategoryPdf(category, input) { const file = input?.files?.[0]; if (!file) return; try { toast('PDF pages image হিসেবে পড়া হচ্ছে…'); await applyCategoryImages(category, await pdfPageImages(file)); } catch (_) { toast('PDF parse করা যায়নি। Internet connection থাকলে আবার চেষ্টা করো।'); } finally { if (input) input.value = ''; } }

  function openCategorySettings(category) {
    const normalized = String(category || '').toUpperCase();
    const records = categoryRecords(normalized);
    if (!/^[A-Z]$/.test(normalized)) return toast('একটি নির্দিষ্ট vocabulary category নির্বাচন করুন।');
    if (!records.length) return toast(`${normalized} category-তে কোনো vocabulary নেই।`);
    const voice = window.VocabularyElevenLabs;
    const voiceSection = voice?.settingsSection ? voice.settingsSection(normalized) : '';
    openModal(`<h3>⚙ ${escape(normalized)} category settings</h3>${voiceSection}<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)"><b style="color:var(--red);font-size:12px;letter-spacing:.1em">DANGER ZONE</b><p class="muted" style="margin:6px 0 10px;font-size:12px">${escape(normalized)} category-এর সব vocabulary একসাথে স্থায়ীভাবে মুছে ফেলা হবে।</p><button class="btn danger sm" onclick="VocabularyMaster.confirmDeleteCategory('${escape(normalized)}')">🗑 Delete all ${escape(normalized)} vocabulary</button></div>`);
    voice?.hydrateSettingsSection?.(normalized);
  }
  function confirmDeleteCategory(category) {
    const normalized = String(category || '').toUpperCase();
    const records = categoryRecords(normalized);
    confirmModal(
      `${normalized} category settings`,
      `${normalized} category-এর ${records.length.toLocaleString()}টি vocabulary স্থায়ীভাবে মুছে ফেলতে চান? এই কাজটি undo করা যাবে না।`,
      () => deleteCategoryVocabulary(normalized),
      `Delete all ${normalized} vocabulary`,
      true
    );
  }
  async function deleteCategoryVocabulary(category) {
    const normalized = String(category || '').toUpperCase();
    const records = categoryRecords(normalized);
    if (!records.length) return toast(`${normalized} category-তে কোনো vocabulary নেই।`);
    try {
      for (const record of records) await dbDel(STORE, record.id);
      await loadRecords(true);
      state.cardAnchorId = '';
      state.cardAnchorTop = 0;
      state.pendingCardRestore = false;
      if (state.category === normalized) refreshCategoryResults();
      toast(`${normalized} category-এর ${records.length.toLocaleString()}টি vocabulary মুছে ফেলা হয়েছে।`);
    } catch (_) {
      toast('Category-এর vocabulary মুছে ফেলা যায়নি। আবার চেষ্টা করুন।');
    }
  }

  function categoryResultsContent() {
    const all = recordsFor(state.query, state.category);
    const shown = all.slice(0, state.visible);
    if (shown.length) return `<div class="vm-vocab-list">${shown.map((record, index) => card(record, index + 1)).join('')}</div>${shown.length < all.length ? `<div id="vmLoadMoreSentinel" class="vm-load-sentinel"></div><button class="btn secondary" style="margin-top:12px" onclick="VocabularyMaster.loadMore()">Load 50 more words</button>` : ''}`;
    /* Before the bank lands there is nothing to list yet. Say so plainly instead
       of rendering "0 words", which read as an empty library (owner report). */
    if (state.category && !state.records.length) return `<div class="vm-empty"><b style="color:var(--text)">${state.category} category-র শব্দ আসছে…</b><p style="margin:7px 0 14px;font-size:12px">একটু অপেক্ষা করুন, ব্যাংক পেছনে পেছনে লোড হচ্ছে।</p></div>`;
    return `<div class="vm-empty"><b style="color:var(--text)">No vocabulary found${state.category ? ` in ${state.category}` : ''}.</b><p style="margin:7px 0 14px;font-size:12px">Search পরিবর্তন করে দেখুন।</p></div>`;
  }
  function refreshCategoryResults() {
    const target = document.getElementById('vmCategoryResults');
    if (!target) return renderCategory();
    target.innerHTML = categoryResultsContent();
    const found = document.getElementById('vmCategoryFound');
    if (found) found.textContent = `${categoryFoundCount().toLocaleString()} words found`;
    attachLoadMoreObserver();
  }
  /* Loading more as the student scrolls is what "50 at a time" means in practice;
     the button stays as a fallback for browsers without IntersectionObserver. */
  let vmLoadMoreObserver = null;
  function attachLoadMoreObserver() {
    const sentinel = document.getElementById('vmLoadMoreSentinel');
    if (!sentinel || typeof IntersectionObserver !== 'function') return;
    if (!vmLoadMoreObserver) {
      vmLoadMoreObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) api.loadMore();
      }, { rootMargin: '300px 0px' });
    }
    vmLoadMoreObserver.disconnect();
    vmLoadMoreObserver.observe(sentinel);
  }
  /* Per-category totals survive a cold open (bank not hydrated yet) because the
     last known counts are cached with the content signature, so the A–Z grid and
     the "words found" line show real numbers immediately instead of 0. */
  const COUNTS_KEY = 'vmCategoryCounts';
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  function zeroCounts() { return Object.fromEntries(LETTERS.map(letter => [letter, 0])); }
  function contentSig() { try { return String((JSON.parse(localStorage.getItem('ahCloudApplied') || 'null') || {}).sig || ''); } catch (_) { return ''; } }
  function categoryCounts() {
    if (state.records.length) {
      const counts = zeroCounts();
      state.records.forEach(record => { if (Object.prototype.hasOwnProperty.call(counts, record.category)) counts[record.category]++; });
      try { localStorage.setItem(COUNTS_KEY, JSON.stringify({ sig: contentSig(), at: Date.now(), counts })); } catch (_) {}
      return counts;
    }
    try { const saved = JSON.parse(localStorage.getItem(COUNTS_KEY) || 'null'); if (saved && saved.counts) return saved.counts; } catch (_) {}
    return zeroCounts();
  }
  function categoryFoundCount() {
    const all = recordsFor(state.query, state.category);
    if (all.length || state.query) return all.length;
    return state.category ? Number(categoryCounts()[state.category] || 0) : 0;
  }
  /* A device that has never opened the bank has no counts to fall back on, so a
     first-ever visitor would still see 0. The meta endpoint carries the
     per-category totals (a few hundred bytes), so fetch it once and show the
     real numbers immediately while the bank hydrates behind the scenes. */
  let countsFetchStarted = false;
  async function ensureCloudCounts() {
    if (countsFetchStarted) return;
    try { const saved = JSON.parse(localStorage.getItem(COUNTS_KEY) || 'null'); if (saved && saved.counts && saved.sig && saved.sig === contentSig()) return; } catch (_) {}
    countsFetchStarted = true;
    try {
      const res = await fetch('/api/content/meta', { headers: { 'X-AH-App': 'admission-hub' } });
      const meta = res.ok ? await res.json() : null;
      const cats = meta && meta.categories;
      if (!cats) return;
      const counts = zeroCounts();
      LETTERS.forEach(letter => { counts[letter] = Number(cats[letter] || 0); });
      const cloudTotal = LETTERS.reduce((n, letter) => n + counts[letter], 0);
      /* The server knows the whole bank; the device may hold only a slice. When
         the device has fewer rows than the server reports, the counts must come
         from the server, not from the partial bank, otherwise a bank stuck on
         the 30-card starter seed shows "30 words" for ever. */
      const stale = state.records.length < cloudTotal;
      try { localStorage.setItem(COUNTS_KEY, JSON.stringify({ sig: String(meta.sig || ''), at: Date.now(), counts })); } catch (_) {}
      if (stale) await refreshBankFromCloud();
      if (document.querySelector('.vm-az-grid')) renderBank();
      const found = document.getElementById('vmCategoryFound');
      if (found) found.textContent = `${categoryFoundCount().toLocaleString()} words found`;
    } catch (_) { /* offline or blocked, the cached/zero path still renders */ }
  }
  /* Pull the whole bank straight from the content endpoint, bypassing the
     signature short-circuit in cloud-content-sync: a device whose stored meta
     matches the server but whose rows are only the starter seed would otherwise
     never re-fetch. Guarded so two callers cannot race a second pull. */
  let bankRefresh = null;
  function refreshBankFromCloud() {
    if (bankRefresh) return bankRefresh;
    bankRefresh = (async () => {
      try {
        const res = await fetch('/api/content', { headers: { 'X-AH-App': 'admission-hub' } });
        const doc = res.ok ? await res.json() : null;
        const rows = doc && Array.isArray(doc.vocabularyMaster) ? doc.vocabularyMaster.filter(x => x && x.id) : [];
        if (!rows.length) return false;
        const written = window.dbPutMany ? await window.dbPutMany(STORE, rows) : false;
        if (written === false) return false;
        /* Drop the planted starter cards once the real bank is in. They were
           scaffolding for a pre-cloud install; keeping them would make category A
           report 468 + 10. */
        if (typeof dbDelRaw === 'function') {
          for (const record of state.records) {
            if (record.id.startsWith('vm-seed-a-')) { try { await dbDelRaw(STORE, record.id); } catch (_) {} }
          }
        }
        await loadRecords(true);
        try { localStorage.setItem('ahCloudApplied', JSON.stringify({ v: doc.v, at: doc.at, sig: doc.sig || '', pulledAt: Date.now() })); } catch (_) {}
        if (String(Router?.path || '').startsWith(route('category/'))) refreshCategoryResults();
        return true;
      } catch (_) { return false; } finally { bankRefresh = null; }
    })();
    return bankRefresh;
  }
  function prefetchCategoryVoices() {
    const lib = window.VocabularyElevenLabs;
    if (!lib || typeof lib.prefetchWords !== 'function') return;
    const rows = recordsFor(state.query, state.category).slice(0, 24);
    const words = [];
    for (const record of rows) {
      if (record.word) words.push(record.word);
      relations(record, 'synonyms').forEach(item => words.push(item.word));
      relations(record, 'antonyms').forEach(item => words.push(item.word));
      relations(record, 'acronyms').forEach(item => words.push(item.word));
    }
    const unique = [...new Set(words.filter(Boolean))];
    if (!unique.length) return;
    // Delayed so it never competes with the first paint; best-effort and silent.
    window.setTimeout(() => { try { lib.prefetchWords(unique, 24); } catch (_) {} }, 900);
  }
  function renderCategory() {
    const all = recordsFor(state.query, state.category);
    const category = escape(state.category || 'ALL');
    const categoryFileKey = escape(state.category || 'ALL');
    const body = `<main class="vm-page">${heading(`${state.category || 'ALL'} VOCABULARY`, `${state.category || 'Vocabulary'} Vocabulary`, `${categoryFoundCount().toLocaleString()} words found`)}<div class="vm-category-intro"><div class="vm-category-intro-head"><div class="vm-category-intro-copy"><b>${category} category</b><span>Search word, বাংলা অর্থ, synonym বা antonym থেকে খুঁজুন।</span></div><div class="vm-category-icon-tools" aria-label="Category tools"><button type="button" class="vm-category-icon-tool" title="Open category MCQ" aria-label="Open category MCQ" onclick="VocabularyMaster.startMcq('${categoryFileKey}')">❓</button></div></div></div><div class="vm-count" id="vmCategoryFound" style="margin:0 0 8px">${categoryFoundCount().toLocaleString()} words found</div><div class="vm-tool-row"><div class="searchbar"><span>🔍</span><input id="vmBankSearch" value="${escape(state.query)}" placeholder="Search vocabulary" autocomplete="off" oninput="VocabularyMaster.searchCategory(this.value)"></div><select class="vm-filter" onchange="VocabularyMaster.openCategory(this.value)"><option value="">All A–Z</option>${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => `<option value="${letter}" ${state.category === letter ? 'selected' : ''}>${letter}</option>`).join('')}</select></div><div id="vmCategoryResults">${categoryResultsContent()}</div></main>`;
    renderShell(body, { title:`${state.category || 'Vocabulary'} Vocabulary`, back:`navigate('${route('bank')}')` });
    bindCategoryScrollTracking();
    restoreCategoryPosition();
    prefetchCategoryVoices();
    attachLoadMoreObserver();
    ensureCloudCounts();
  }
  function renderWord(id) {
    const record = state.records.find(row => row.id === id);
    if (!record) { navigate(route('bank')); return; }
    navigate(route(`category/${record.category}`));
  }

  function sectionFromBlock(block, label, next) {
    const start = new RegExp(`(?:^|\\n)\\s*(?:\\*\\s*)?${label}\\s*:\\s*`, 'i').exec(block);
    if (!start) return '';
    const after = block.slice(start.index + start[0].length);
    const stop = next ? new RegExp(`(?:^|\\n)\\s*(?:\\*\\s*)?${next}\\s*:`, 'i').exec(after) : null;
    return (stop ? after.slice(0, stop.index) : after).trim();
  }
  function parsePairs(section) {
    return section.split('\n').map(line => line.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).map(line => {
      const parts = line.split(/\s*:\s*/, 2);
      return { word:String(parts[0] || '').trim(), meaning:String(parts[1] || '').trim() };
    }).filter(item => item.word && !/^synonyms?|antonyms?|tips?/i.test(item.word));
  }
  function parserSection(line) {
    const cleaned = String(line || '').replace(/^\s*(?:[-*•]|\d+[.)])?\s*/, '').trim();
    const match = cleaned.match(/^(.+?)\s*[:ঃ]\s*(.*)$/);
    if (!match) return null;
    const label = lower(match[1]).replace(/[\s._-]/g, '');
    const value = match[2].trim();
    if (/^(synonym|synonyms|similarword|similarwords|সমার্থক|সমার্থকশব্দ)$/.test(label)) return { kind:'synonyms', value };
    if (/^(antonym|antonyms|opposite|opposites|বিপরীত|বিপরীতশব্দ)$/.test(label)) return { kind:'antonyms', value };
    if (/^(acronym|acronyms|abbreviation|abbreviations|সংক্ষিপ্তরূপ|সংক্ষিপ্তরূপ)$/.test(label)) return { kind:'acronyms', value };
    if (/^(tip|tips|explanation|tips&explanation|tipsandexplanation|ব্যাখ্যা|টিপস)$/.test(label)) return { kind:'tips', value };
    return null;
  }
  function parserRelation(line) {
    const cleaned = String(line || '').replace(/^\s*(?:(?:[-*•])|(?:\d+[.)]))\s*/, '').trim();
    const match = cleaned.match(/^(.+?)\s*[:ঃ]\s*(.+)$/);
    return match ? { word:match[1].trim(), meaning:match[2].trim() } : null;
  }
  function splitParserRecords(text) {
    const lines = String(text || '').split('\n');
    const serialStart = /^\s*(?:\d+\s*[/.):\-।]\s*[A-Za-z]|[A-Za-z][A-Za-z0-9\s'’()-]{0,80}?\s*[:ঃ])/;
    const starts = lines.reduce((all, line, index) => serialStart.test(line) ? [...all, index] : all, []);
    if (!starts.length) return [lines];
    const blocks = starts.map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length));
    if (starts[0] > 0 && lines.slice(0, starts[0]).some(line => line.trim())) blocks.unshift(lines.slice(0, starts[0]));
    return blocks;
  }
  function parseVocabulary(text) {
    const normalizedText = String(text || '').replace(/\r/g, '').replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));
    const records = splitParserRecords(normalizedText);
    return records.map((lines, index) => {
      const first = lines.find(line => line.trim());
      const head = first?.match(/^\s*(?:\d+\s*[/.):\-।]\s*)?([A-Za-z][A-Za-z0-9\s'’()-]{0,80}?)\s*(?:[:ঃ]|\s-\s)\s*(.+?)\s*$/);
      if (!head) {
        const firstLine = lines.find(line => line.trim()) || '';
        const stripped = firstLine.replace(/^\s*\d+\s*[/.):\-।]\s*/, '');
        const parts = stripped.split(/\s*[:ঃ]\s*/);
        const word = String(parts[0] || '').trim().slice(0, 90);
        const meaning = parts.slice(1).join(': ').trim();
        return { raw:lines.join('\n'), word, meaning, synonyms:[], antonyms:[], acronyms:[], tips:'', valid:false, error: word ? 'Bengali meaning পাওয়া যায়নি, তবু সেভ হবে।' : 'Word এবং Bengali meaning পাওয়া যায়নি, তবু সেভ হবে।' };
      }
      const word = head[1].trim();
      const meaning = head[2].trim();
      const synonyms = [], antonyms = [], acronyms = [], tips = [];
      let section = '';
      let started = false;
      lines.forEach(line => {
        if (!started && line === first) { started = true; return; }
        const sectionHeader = parserSection(line);
        if (sectionHeader) {
          section = sectionHeader.kind;
          if (sectionHeader.value) {
            if (section === 'tips') tips.push(sectionHeader.value);
            else { const item = parserRelation(sectionHeader.value); if (item) (section === 'synonyms' ? synonyms : section === 'antonyms' ? antonyms : acronyms).push(item); }
          }
          return;
        }
        if (!line.trim()) return;
        if (section === 'tips') { tips.push(line.trim().replace(/^\s*[-*•]\s*/, '')); return; }
        if (section === 'synonyms' || section === 'antonyms' || section === 'acronyms') {
          const item = parserRelation(line);
          if (item) (section === 'synonyms' ? synonyms : section === 'antonyms' ? antonyms : acronyms).push(item);
        }
      });
      const record = normalizeRecord({ word, meaning, synonyms, antonyms, acronyms, tips:tips.join(' ').trim() });
      return { ...record, raw:lines.join('\n'), valid:!!(word && meaning), sourceIndex:index, order:index, error:word && meaning ? '' : 'Incomplete record' };
    });
  }
  function parserPreviewCard(record, index) {
    const duplicate = state.records.some(existing => existing.normalized === record.normalized);
    const status = !record.valid ? 'invalid' : '';
        return `<article class="vm-preview-card ${status}"><div class="row between"><div><b>${escape(record.word || 'Incomplete record')}</b><div class="muted" style="margin-top:3px">${escape(record.meaning || record.error || 'Missing Bengali meaning')}</div></div><button class="btn ghost sm" onclick="VocabularyMaster.editParsed(${index})">Edit</button></div><div class="vm-preview-meta"><span>${record.valid ? '✓ Valid' : '⚠ Incomplete · তবু সেভ হবে'}</span><span>Synonyms: ${relations(record, 'synonyms').length}</span><span>Antonyms: ${relations(record, 'antonyms').length}</span><span>Acronyms: ${relations(record, 'acronyms').length}</span><span>${record.tips ? 'Explanation: Available' : 'Explanation: -'}</span>${duplicate ? '<span>Duplicate will be kept</span>' : ''}</div></article>`;
  }
  function renderParser() {
    const preview = state.parser.stage === 'preview';
    const body = `<main class="vm-page">${heading('VOCABULARY PARSER', preview ? 'Review parsed vocabulary' : 'Paste vocabulary text', preview ? 'Save করার আগে প্রতিটি record যাচাই বা edit করুন।' : 'বাংলা বা English serial, word, Bengali meaning, synonyms, antonyms এবং tips detect করা হবে।')} ${preview ? `<section class="vm-parser-preview">${state.parser.records.length ? state.parser.records.map(parserPreviewCard).join('') : '<div class="vm-empty">No parsable vocabulary found.</div>'}</section><div class="vm-parser-footer"><p class="muted" style="margin:0;line-height:1.5">Duplicate vocabulary রাখা হবে, একই word একাধিকবার parse ও save করা যাবে। সব রেকর্ড (${state.parser.records.length}টি) সেভ হবে, কিছু বাদ যাবে না।</p><label class="flabel">সেভ হবে এই category-তে</label><select id="vmTargetCategory" onchange="VocabularyMaster.setParserTarget(this.value)"><option value="">Auto, শব্দের প্রথম অক্ষর অনুযায়ী (A–Z)</option>${'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').map(letter => `<option value="${letter}" ${state.parser.targetCategory === letter ? 'selected' : ''}>${letter === '#' ? '# (other/অন্য)' : letter}</option>`).join('')}</select><button class="btn" onclick="VocabularyMaster.saveParsed()">Save All (${state.parser.records.length})</button><button class="btn secondary" onclick="VocabularyMaster.backToPaste()">Edit Paste</button></div>` : `<textarea id="vmParserInput" class="vm-parser-area" placeholder="১/ Conjecture : অনুমান করা\n* Synonyms:\n    * Guess : অনুমান\n* Antonyms:\n    * Fact : সত্য / তথ্য\n* Tips & Explanation: মূল শব্দটির সাথে …">${escape(state.parser.text)}</textarea><div class="vm-parser-footer" style="margin-top:14px"><label class="flabel">সেভ করার category</label><select id="vmTargetCategory" onchange="VocabularyMaster.setParserTarget(this.value)"><option value="">Auto, শব্দের প্রথম অক্ষর অনুযায়ী (A–Z)</option>${'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').map(letter => `<option value="${letter}" ${state.parser.targetCategory === letter ? 'selected' : ''}>${letter === '#' ? '# (other/অন্য)' : letter}</option>`).join('')}</select></div><button class="btn" style="margin-top:14px" onclick="VocabularyMaster.parseInput()">Parse Vocabulary</button><p class="muted" style="margin:10px 2px 0;line-height:1.5">Nothing is saved until you review the parsed records and choose Save All.</p>`}</main>`;
    renderShell(body, { title:'Vocabulary Parser', back:`navigate('${ROUTE}')` });
  }

  const PRACTICE_TYPES = {
    match:{ label:'Matching', description:'Match vocabulary with the correct Bengali meaning.' },
    fill:{ label:'Fill in the Blank', description:'Choose the vocabulary that matches the meaning.' },
    synonym:{ label:'Synonym', description:'Choose the correct synonym.' },
    antonym:{ label:'Antonym', description:'Choose the correct antonym.' },
    meaning:{ label:'Bengali Meaning', description:'Choose the correct Bengali meaning.' },
    mixed:{ label:'Mixed Practice', description:'Practice different vocabulary skills together.' },
  };
  function sourceRecords(setup = state.practiceSetup) {
    if (setup.sourceType === 'custom') return state.records.filter(record => setup.selectedIds.includes(record.id));
    if (setup.sourceType === 'category') return state.records.filter(record => record.category === setup.category);
    return state.records;
  }
  function practiceCandidates(mode, source = state.records) {
    if (mode === 'synonym') return source.filter(record => relations(record, 'synonyms').length);
    if (mode === 'antonym') return source.filter(record => relations(record, 'antonyms').length);
    if (mode === 'mixed') return source.filter(record => record.meaning || relations(record, 'synonyms').length || relations(record, 'antonyms').length);
    return source.filter(record => record.word && record.meaning);
  }
  function configuredQuestionCount(setup = state.practiceSetup) { return Math.max(1, Number(setup.countMode === 'custom' ? setup.customCount : setup.questionCount) || 0); }
  function configuredTimeSeconds(setup = state.practiceSetup) { return setup.timeMode === 'custom' ? Math.max(0, (Number(setup.customHours) || 0) * 3600 + (Number(setup.customMinutes) || 0) * 60 + (Number(setup.customSeconds) || 0)) : Math.max(0, Number(setup.timeValue) || 0); }
  function prettyTime(seconds) { if (!seconds) return 'No Time'; const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60), remain = seconds % 60; return [hours && `${hours}h`, minutes && `${minutes}m`, remain && `${remain}s`].filter(Boolean).join(' '); }
  function practiceSourceLabel(setup = state.practiceSetup) { return setup.sourceType === 'custom' ? `Custom Selection (${setup.selectedIds.length})` : setup.sourceType === 'category' ? `${setup.category} Vocabulary` : 'All Vocabulary'; }
  function setupAvailability(setup = state.practiceSetup) { const source = sourceRecords(setup); const valid = practiceCandidates(setup.practiceType, source); return { source, valid, available:valid.length, requested:configuredQuestionCount(setup), time:configuredTimeSeconds(setup) }; }
  function practiceModeCard(icon, title, detail, mode) { return `<button class="vm-mode" onclick="VocabularyMaster.setPracticeType('${mode}')"><span style="font-size:21px">${icon}</span><b>${escape(title)}</b><small>${escape(detail)}</small></button>`; }
  function accuracy(session) { const total = session.correct + session.wrong; return total ? Math.round(session.correct / total * 100) : 0; }
  function renderPracticeHome() {
    const setup = state.practiceSetup, status = setupAvailability(setup), type = PRACTICE_TYPES[setup.practiceType] || PRACTICE_TYPES.mixed;
    const categoryCounts = Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => [letter, state.records.filter(record => record.category === letter).length]));
    const sourceOptions = `<option value="all" ${setup.sourceType === 'all' ? 'selected' : ''}>All Vocabulary (${state.records.length})</option>${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(letter => categoryCounts[letter]).map(letter => `<option value="${letter}" ${setup.sourceType === 'category' && setup.category === letter ? 'selected' : ''}>${letter}, ${categoryCounts[letter]} Words</option>`).join('')}<option value="custom" ${setup.sourceType === 'custom' ? 'selected' : ''}>Custom Selection</option>`;
    const countOptions = [5,10,15,20,25,30,50].filter(count => count <= status.available).map(count => `<option value="${count}" ${setup.countMode === 'preset' && Number(setup.questionCount) === count ? 'selected' : ''}>${count}</option>`).join('');
    const timeOptions = [[0,'No Time'],[60,'1 Minute'],[120,'2 Minutes'],[300,'5 Minutes'],[600,'10 Minutes'],[900,'15 Minutes'],[1200,'20 Minutes'],[1800,'30 Minutes']].map(([value,label]) => `<option value="${value}" ${setup.timeMode === 'preset' && Number(setup.timeValue) === value ? 'selected' : ''}>${label}</option>`).join('');
    const customFiltered = state.records.filter(record => { const query = lower(setup.customQuery); return !query || [record.word,record.meaning,...relations(record,'synonyms').flatMap(item => [item.word,item.meaning]),...relations(record,'antonyms').flatMap(item => [item.word,item.meaning])].join(' ').toLocaleLowerCase('en-US').includes(query); });
    const customShown = customFiltered.slice(0, setup.customVisible);
    const invalidCount = status.available > 0 && status.requested > status.available;
    const canStart = !!(status.available && status.requested <= status.available && PRACTICE_TYPES[setup.practiceType] && (setup.sourceType !== 'custom' || setup.selectedIds.length));
    const customSelector = setup.sourceType === 'custom' ? `<section class="vm-setup-card"><div class="vm-step"><i>2</i> CUSTOM SELECTION</div><h3>Select vocabulary</h3><p>Search করে শব্দ বাছুন। শুধু visible list-ই DOM-এ রাখা হয়।</p><div class="searchbar" style="margin-top:12px"><span>🔍</span><input value="${escape(setup.customQuery)}" placeholder="Search vocabulary" autocomplete="off" oninput="VocabularyMaster.searchPracticeCustom(this.value)"></div><div class="vm-custom-tools"><button class="btn secondary" onclick="VocabularyMaster.selectVisiblePractice()">Select visible</button><button class="btn ghost" onclick="VocabularyMaster.clearPracticeSelection()">Clear</button></div><div class="vm-custom-list">${customShown.map(record => `<label class="vm-custom-item"><input type="checkbox" ${setup.selectedIds.includes(record.id) ? 'checked' : ''} onchange="VocabularyMaster.togglePracticeRecord('${escape(record.id)}',this.checked)"><span><b>${escape(record.word)}</b><small>${escape(record.meaning)}</small></span></label>`).join('') || '<div class="vm-empty-setup">No vocabulary matches this search.</div>'}</div>${customShown.length < customFiltered.length ? `<button class="btn secondary" style="margin-top:10px" onclick="VocabularyMaster.loadMorePracticeCustom()">Load more</button>` : ''}<div class="vm-custom-foot"><b>${setup.selectedIds.length} Words Selected</b><span>${customFiltered.length.toLocaleString()} found</span></div></section>` : '';
    const body = `<main class="vm-page">${heading('PRACTICE', 'Choose what you want to practice', 'Select, configure, preview, then start. Practice results stay separate from Admission Hub exam history.')} ${!state.records.length ? `<div class="vm-empty-setup"><b style="display:block;color:var(--text);font-size:18px">No vocabulary available.</b><p style="margin:8px 0 15px;color:var(--sub);font-size:12px">নিচের preset থেকে প্র্যাকটিস বেছে নাও।</p></div>` : `<div class="vm-presets"><button class="vm-preset" onclick="VocabularyMaster.applyPracticePreset('quick')"><b>Quick</b><small>5 · No Time</small></button><button class="vm-preset" onclick="VocabularyMaster.applyPracticePreset('standard')"><b>Standard</b><small>10 · 5 Minutes</small></button><button class="vm-preset" onclick="VocabularyMaster.applyPracticePreset('focused')"><b>Focused</b><small>20 · 10 Minutes</small></button></div><div class="vm-setup"><section class="vm-setup-card"><div class="vm-step"><i>1</i> VOCABULARY SOURCE</div><h3>${escape(practiceSourceLabel(setup))}</h3><p>Available count শুধু local Vocabulary Bank থেকে আসে।</p><select onchange="VocabularyMaster.setPracticeSource(this.value)">${sourceOptions}</select><div class="vm-setup-note"><span>Available valid records</span><b>${status.available}</b></div></section>${customSelector}<section class="vm-setup-card"><div class="vm-step"><i>${setup.sourceType === 'custom' ? '3' : '2'}</i> PRACTICE TYPE</div><h3>${escape(type.label)}</h3><p>${escape(type.description)}</p><select onchange="VocabularyMaster.setPracticeType(this.value)">${Object.entries(PRACTICE_TYPES).map(([key,item]) => `<option value="${key}" ${setup.practiceType === key ? 'selected' : ''}>${escape(item.label)}</option>`).join('')}</select></section><section class="vm-setup-card"><div class="vm-step"><i>${setup.sourceType === 'custom' ? '4' : '3'}</i> NUMBER OF QUESTIONS</div><h3>${status.requested} questions</h3><p>${status.available} valid ${escape(type.label)} question${status.available === 1 ? '' : 's'} available. No repeat policy is active.</p><div class="vm-count-row"><select onchange="VocabularyMaster.setPracticeCount(this.value)">${countOptions}<option value="custom" ${setup.countMode === 'custom' ? 'selected' : ''}>Custom</option></select>${invalidCount ? `<button class="btn secondary" onclick="VocabularyMaster.useAvailablePracticeCount()">Use ${status.available}</button>` : ''}</div>${setup.countMode === 'custom' ? `<input type="number" min="1" max="${status.available}" value="${escape(setup.customCount)}" oninput="VocabularyMaster.setPracticeCustomCount(this.value)" aria-label="Custom question count">` : ''}${invalidCount ? `<div class="vm-setup-warning">Only ${status.available} valid questions are available for this practice. Use a lower count or change selection.</div>` : ''}</section><section class="vm-setup-card"><div class="vm-step"><i>${setup.sourceType === 'custom' ? '5' : '4'}</i> TIME LIMIT</div><h3>${escape(prettyTime(status.time))}</h3><p>এটি Practice Timer; exam timer বা negative marking নয়।</p><select onchange="VocabularyMaster.setPracticeTime(this.value)">${timeOptions}<option value="custom" ${setup.timeMode === 'custom' ? 'selected' : ''}>Custom Time</option></select>${setup.timeMode === 'custom' ? `<div class="vm-time-custom"><label>Hours<input type="number" min="0" value="${escape(setup.customHours)}" oninput="VocabularyMaster.setPracticeTimePart('customHours',this.value)"></label><label>Minutes<input type="number" min="0" max="59" value="${escape(setup.customMinutes)}" oninput="VocabularyMaster.setPracticeTimePart('customMinutes',this.value)"></label><label>Seconds<input type="number" min="0" max="59" value="${escape(setup.customSeconds)}" oninput="VocabularyMaster.setPracticeTimePart('customSeconds',this.value)"></label></div>` : ''}</section><details class="vm-advanced" ${setup.advancedOpen ? 'open' : ''} ontoggle="VocabularyMaster.setPracticeAdvanced(this.open)"><summary>Advanced Options</summary><div class="vm-advanced-body"><label class="vm-checkline"><span>Randomize question and option order</span><input type="checkbox" ${setup.randomize ? 'checked' : ''} onchange="VocabularyMaster.setPracticeRandom(this.checked)"></label><div class="vm-checkline"><span>Repeat policy</span><b>Do Not Repeat</b></div><p class="muted" style="margin:0;font-size:11px;line-height:1.45">Difficulty metadata নেই, তাই কোনো fake difficulty selector দেখানো হয়নি।</p></div></details><section class="vm-summary"><div class="vm-summary-kicker">PRACTICE SUMMARY</div><div class="vm-summary-grid"><div><small>Source</small><b>${escape(practiceSourceLabel(setup))}</b></div><div><small>Words available</small><b>${status.available}</b></div><div><small>Practice</small><b>${escape(type.label)}</b></div><div><small>Questions</small><b>${status.requested}</b></div><div><small>Time</small><b>${escape(prettyTime(status.time))}</b></div><div><small>Random</small><b>${setup.randomize ? 'ON' : 'OFF'}</b></div></div></section><button class="btn vm-start" ${canStart ? '' : 'disabled'} onclick="VocabularyMaster.startConfiguredPractice()">START PRACTICE →</button>${!canStart ? '<p class="muted" style="margin:0;text-align:center;font-size:12px">Source, practice type এবং valid question count ঠিক হলে Start সক্রিয় হবে।</p>' : ''}<button class="btn ghost" onclick="VocabularyMaster.resetPracticeSetup()">Reset Selection</button></div>`}</main>`;
    renderShell(body, { title:'Vocabulary Practice', back:`navigate('${ROUTE}')` });
  }
  function optionSet(correct, pool, randomize = true) {
    const values = unique([correct, ...shuffle(pool)]);
    const options = values.slice(0, 4);
    return randomize ? shuffle(options) : options;
  }
  function buildQuestion(mode, record, pool = state.records, randomize = state.practiceSetup.randomize) {
    const allMeanings = pool.map(row => row.meaning);
    const allWords = pool.map(row => row.word);
    if (mode === 'synonym') { const relation = shuffle(relations(record, 'synonyms'))[0]; return { prompt:`${record.word}-এর synonym কোনটি?`, correct:relation.word, options:optionSet(relation.word, pool.flatMap(row => relations(row, 'synonyms').map(item => item.word)).concat(allWords), randomize), explanation:`${relation.word}${relation.meaning ? `, ${relation.meaning}` : ''}` }; }
    if (mode === 'antonym') { const relation = shuffle(relations(record, 'antonyms'))[0]; return { prompt:`${record.word}-এর antonym কোনটি?`, correct:relation.word, options:optionSet(relation.word, pool.flatMap(row => relations(row, 'antonyms').map(item => item.word)).concat(allWords), randomize), explanation:`${relation.word}${relation.meaning ? `, ${relation.meaning}` : ''}` }; }
    if (mode === 'fill') return { prompt:`“${record.meaning}” অর্থ প্রকাশ করে এমন শব্দটি হলো ____।`, correct:record.word, options:optionSet(record.word, allWords, randomize), explanation:`${record.word}, ${record.meaning}` };
    return { prompt:`${record.word}-এর বাংলা অর্থ কী?`, correct:record.meaning, options:optionSet(record.meaning, allMeanings, randomize), explanation:`${record.word}, ${record.meaning}` };
  }
  function renderPracticeQuiz() {
    const session = state.practice;
    const question = session.questions[session.index];
    if (!question) return renderPracticeSummary();
    const selected = session.selected;
    const answerShown = selected !== null;
    const timer = session.timeLimit ? `<span class="vm-timer" data-vm-practice-timer>⏱ ${prettyTime(Math.max(0, session.remainingSeconds || 0))}</span>` : '';
    const body = `<main class="vm-page">${heading('PRACTICE', `${session.index + 1} of ${session.questions.length}`, `${session.correct} correct · ${session.wrong} wrong`)}${timer ? `<div style="margin:10px 0 0">${timer}</div>` : ''}<section class="vm-practice-card"><div class="vm-practice-prompt">${escape(question.prompt)}</div><div class="vm-practice-options">${question.options.map(option => { const cls = answerShown ? (option === question.correct ? 'correct' : option === selected ? 'wrong' : '') : ''; return `<button class="vm-practice-option ${cls}" ${answerShown ? 'disabled' : ''} onclick="VocabularyMaster.answerPractice(${safeJson(option)})">${escape(option)}</button>`; }).join('')}</div>${answerShown ? `<div class="vm-tip">${escape(question.explanation)}</div><button class="btn" style="margin-top:14px" onclick="VocabularyMaster.nextPractice()">${session.index === session.questions.length - 1 ? 'See Result' : 'Next Question →'}</button>` : ''}</section></main>`;
    renderShell(body, { title:'Vocabulary Practice', back:"VocabularyMaster.cancelPractice()" });
  }
  function renderMatching() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    const session = state.practice;
    const done = session.pairs.filter(pair => session.done.includes(pair.id)).length;
    const timer = session.timeLimit ? `<span class="vm-timer" data-vm-practice-timer>⏱ ${prettyTime(Math.max(0, session.remainingSeconds || 0))}</span>` : '';
    const body = `<main class="vm-page">${heading('MATCHING PRACTICE', `${done} of ${session.pairs.length} matched`, `${session.correct} correct · ${session.wrong} wrong`)}${timer ? `<div style="margin:10px 0 0">${timer}</div>` : ''}<section class="vm-practice-card"><p class="muted" style="margin-top:0">প্রথমে একটি word, তারপর তার Bengali meaning নির্বাচন করুন।</p><div class="vm-match-columns"><div>${session.pairs.map(pair => `<button class="vm-match-choice ${session.wordId === pair.id ? 'selected' : ''} ${session.done.includes(pair.id) ? 'done' : ''}" onclick="VocabularyMaster.pickMatchWord('${escape(pair.id)}')">${escape(pair.word)}</button>`).join('')}</div><div>${session.meanings.map(pair => `<button class="vm-match-choice ${session.done.includes(pair.id) ? 'done' : ''}" onclick="VocabularyMaster.pickMatchMeaning('${escape(pair.id)}')">${escape(pair.meaning)}</button>`).join('')}</div></div>${done === session.pairs.length ? `<div class="vm-tip">Matching complete. Accuracy: ${accuracy(session)}%</div><button class="btn" style="margin-top:14px" onclick="VocabularyMaster.finishPractice()">Back to Practice</button>` : ''}</section></main>`;
    renderShell(body, { title:'Matching Practice', back:"VocabularyMaster.cancelPractice()" });
    requestAnimationFrame(() => window.scrollTo({ top: scrollTop, left: 0, behavior: 'auto' }));
  }
  function renderPracticeSummary() {
    const session = state.practice;
    const body = `<main class="vm-page">${heading('PRACTICE COMPLETE', session.timedOut ? "Time's Up" : 'Session finished', 'This short practice session is not stored as a separate Vocabulary progress system.')}<section class="vm-practice-card"><div class="grid3"><div><b style="font-size:23px;color:var(--green)">${session.correct}</b><div class="muted">Correct</div></div><div><b style="font-size:23px;color:var(--red)">${session.wrong}</b><div class="muted">Wrong</div></div><div><b style="font-size:23px;color:var(--emerald)">${accuracy(session)}%</b><div class="muted">Accuracy</div></div></div><button class="btn" style="margin-top:18px" onclick="VocabularyMaster.finishPractice()">Back to Practice</button></section></main>`;
    renderShell(body, { title:'Practice Result', back:`navigate('${route('practice')}')` });
  }

  function testScopeRecords() { const ids = state.test.selectedIds; if (ids.length) return state.records.filter(record => ids.includes(record.id)); return recordsFor('', state.test.category); }
  function renderTest() {
    const scoped = testScopeRecords();
    const body = `<main class="vm-page">${heading('TEST', 'Use the existing exam engine', 'Vocabulary Master prepares questions; Admission Hub runs the real Mock Test or Flash Test, result and history.')}<section class="vm-test-card"><label>Vocabulary source</label><select onchange="VocabularyMaster.setTestCategory(this.value)"><option value="">All vocabulary (${state.records.length})</option>${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => `<option value="${letter}" ${state.test.category === letter ? 'selected' : ''}>${letter} Vocabulary (${state.records.filter(record => record.category === letter).length})</option>`).join('')}</select><label>Question count</label><select onchange="VocabularyMaster.setTestCount(this.value)">${[5,10,20,30,50].map(count => `<option value="${count}" ${state.test.count === count ? 'selected' : ''}>${count}</option>`).join('')}</select><label>Mock duration</label><select onchange="VocabularyMaster.setTestDuration(this.value)">${[5,10,20,30,60].map(minutes => `<option value="${minutes}" ${state.test.duration === minutes ? 'selected' : ''}>${minutes} minutes</option>`).join('')}</select><label>Negative marking (Mock only)</label><select onchange="VocabularyMaster.setTestNegative(this.value)">${[0,.25,.5,1].map(value => `<option value="${value}" ${state.test.negative === value ? 'selected' : ''}>${value ? `-${value}` : 'None'}</option>`).join('')}</select><p class="muted" style="margin:14px 0 0;line-height:1.5">${scoped.length ? `${scoped.length} vocabulary record selected. Compatible question set তৈরি করে existing engine-এ পাঠানো হবে।` : 'Test শুরু করতে vocabulary যোগ করুন।'}</p><button class="btn" style="margin-top:14px" ${scoped.length ? '' : 'disabled'} onclick="VocabularyMaster.beginTest('mock')">📝 Start Mock Test</button><button class="btn secondary" style="margin-top:9px" ${scoped.length ? '' : 'disabled'} onclick="VocabularyMaster.beginTest('flash')">⚡ Start Flash Test</button></section></main>`;
    renderShell(body, { title:'Vocabulary Test', back:`navigate('${ROUTE}')` });
  }

  async function ensureExamScope() {
    let subject = (CACHE.subjects || []).find(row => row.name === EXAM_SUBJECT_NAME);
    if (!subject) { subject = { id:uid(), name:EXAM_SUBJECT_NAME, icon:'📚', color:'#0f6b4f', order:(CACHE.subjects || []).length, createdAt:now(), source:'vocabulary-master' }; await dbPut('subjects', subject); }
    let topic = (CACHE.topics || []).find(row => row.subjectId === subject.id && row.name === EXAM_TOPIC_NAME);
    if (!topic) { topic = { id:uid(), subjectId:subject.id, name:EXAM_TOPIC_NAME, order:(CACHE.topics || []).filter(row => row.subjectId === subject.id).length, createdAt:now(), source:'vocabulary-master' }; await dbPut('topics', topic); }
    return { subject, topic };
  }
  function existingQuestion(id) { return (CACHE.questions || []).find(question => question.id === id); }
  function generatedOptions(correct, candidates) { const options = unique([correct, ...shuffle(candidates)]).slice(0, 4); return options.length === 4 ? shuffle(options) : null; }
  function generatedQuestion(record, scope, all) {
    let kind = 'meaning'; let correct = record.meaning; let prompt = `${record.word}-এর বাংলা অর্থ কী?`; let pool = all.map(row => row.meaning); let explanation = `${record.word}, ${record.meaning}`;
    if (relations(record, 'synonyms').length) { const item = relations(record, 'synonyms')[0]; kind = 'synonym'; correct = item.word; prompt = `${record.word}-এর synonym কোনটি?`; pool = all.flatMap(row => relations(row, 'synonyms').map(relation => relation.word)).concat(all.map(row => row.word)); explanation = `${item.word}${item.meaning ? `, ${item.meaning}` : ''}`; }
    else if (relations(record, 'antonyms').length) { const item = relations(record, 'antonyms')[0]; kind = 'antonym'; correct = item.word; prompt = `${record.word}-এর antonym কোনটি?`; pool = all.flatMap(row => relations(row, 'antonyms').map(relation => relation.word)).concat(all.map(row => row.word)); explanation = `${item.word}${item.meaning ? `, ${item.meaning}` : ''}`; }
    const options = generatedOptions(correct, pool);
    if (!options) return null;
    return { id:`vmq-${record.id}-${kind}`, subjectId:scope.subject.id, topicId:scope.topic.id, source:'vocabulary-master', vocabularyRecordId:record.id, question:prompt, options, answer:options.indexOf(correct), explanation, createdAt:now(), updatedAt:now(), stats:{ attempts:0, correct:0, wrong:0 } };
  }
  async function createExamQuestions(records) {
    const scope = await ensureExamScope();
    const generated = records.map(record => generatedQuestion(record, scope, state.records)).filter(Boolean);
    for (const question of generated) {
      const current = existingQuestion(question.id);
      await dbPut('questions', current ? { ...question, stats:current.stats || question.stats, createdAt:current.createdAt || question.createdAt } : question);
    }
    await loadCache();
    return generated.map(question => question.id);
  }

  function flashOptions(correct, pool) {
    const seen = new Set();
    const values = [correct, ...shuffle(pool || [])].map(value => String(value || '').trim()).filter(Boolean).filter(value => {
      const key = lower(value); if (seen.has(key)) return false; seen.add(key); return true;
    });
    return values.length >= 4 ? shuffle(values.slice(0, 4)) : null;
  }
  function cardFlashBanks(record) {
    const words = unique(state.records.map(row => row.word));
    const meanings = unique(state.records.map(row => row.meaning));
    const synonyms = unique(state.records.flatMap(row => relations(row, 'synonyms').map(item => item.word)));
    const synonymMeanings = unique(state.records.flatMap(row => relations(row, 'synonyms').map(item => item.meaning)));
    const antonyms = unique(state.records.flatMap(row => relations(row, 'antonyms').map(item => item.word)));
    const acronymWords = unique(state.records.flatMap(row => relations(row, 'acronyms').map(item => item.word)));
    const acronymMeanings = unique(state.records.flatMap(row => relations(row, 'acronyms').map(item => item.meaning)));
    const pairs = unique(state.records.map(row => `${row.word}, ${row.meaning}`));
    return { words, meanings, synonyms, synonymMeanings, antonyms, acronymWords, acronymMeanings, pairs, record };
  }
  function cardFlashQuestions(record) {
    const bank = cardFlashBanks(record), candidates = [], seen = new Set(), familyCounts = new Map();
    const add = (kind, prompt, correct, pool, explanation, family = kind, cap = 5, difficulty = 'standard', sourceData = '') => {
      if (candidates.length >= 180) return;
      const answer = String(correct || '').trim(); if (!answer) return;
      const options = flashOptions(answer, pool); if (!options) return;
      const signature = `${lower(prompt)}|${lower(answer)}`; if (seen.has(signature)) return;
      const used = familyCounts.get(`${family}|${lower(answer)}`) || 0; if (used >= cap) return;
      seen.add(signature); familyCounts.set(`${family}|${lower(answer)}`, used + 1);
      candidates.push({ id:`card-flash-${record.id}-${kind}-${candidates.length}`, prompt, options, correct:answer, explanation, type:family, difficulty, sourceWord:record.word, sourceData:sourceData || explanation });
    };
    const word = record.word, meaning = record.meaning, syn = relations(record, 'synonyms'), ant = relations(record, 'antonyms'), acr = relations(record, 'acronyms');
    const wordPool = bank.words.filter(item => lower(item) !== lower(word)), meaningPool = bank.meanings.filter(item => lower(item) !== lower(meaning)), pairPool = bank.pairs.filter(item => lower(item) !== lower(`${word}, ${meaning}`));
    const synonymPool = [...bank.synonyms, ...wordPool], antonymPool = [...bank.antonyms, ...wordPool], acronymPool = [...bank.acronymWords, ...wordPool];
    const context = String(record.tips || '').trim();
    const usableContext = context && !/^(qa sample only|none|n\/a|not available)$/i.test(context);

    // The card's primary Bengali meaning is deliberately asked only once.
    add('meaning-direct', `“${word}” শব্দটির সঠিক বাংলা meaning কোনটি?`, meaning, meaningPool, `${word}, ${meaning}`, 'main-meaning', 1, 'foundation', `Primary Bengali meaning: ${meaning}`);

    // Reverse meaning is a different skill: identify the English entry from a Bengali clue.
    if (meaning) {
      add('reverse-meaning-1', `“${meaning}” অর্থ প্রকাশ করে এমন English word কোনটি?`, word, wordPool, `${word}, ${meaning}`, 'reverse-meaning', 3, 'standard', `Bengali clue: ${meaning}`);
      add('reverse-meaning-2', `এই Bengali clue-এর matching vocabulary entry কোনটি: ${meaning}?`, word, wordPool, `${word}, ${meaning}`, 'reverse-meaning', 3, 'standard', `Bengali clue: ${meaning}`);
      add('reverse-meaning-3', `বাংলা অর্থ দেখে সঠিক English word নির্বাচন করো: “${meaning}”`, word, wordPool, `${word}, ${meaning}`, 'reverse-meaning', 3, 'challenge', `Bengali clue: ${meaning}`);
    }

    // Synonym questions receive the largest share when synonym data is available.
    syn.forEach((item, index) => {
      const relationNote = `${word} → synonym: ${item.word}${item.meaning ? `, ${item.meaning}` : ''}`;
      add(`synonym-choice-${index}`, `${word}-এর synonym কোনটি?`, item.word, synonymPool, relationNote, 'synonym-identification', 5, 'standard', relationNote);
      add(`synonym-near-${index}`, `নিচের কোন শব্দটি “${word}”-এর কাছাকাছি অর্থ প্রকাশ করে?`, item.word, synonymPool, relationNote, 'synonym-identification', 5, 'standard', relationNote);
      add(`synonym-card-${index}`, `Card data অনুযায়ী “${item.word}” কোন মূল word-এর synonym?`, word, wordPool, relationNote, 'synonym-relation', 4, 'challenge', relationNote);
      if (item.meaning) {
        const meaningNote = `${item.word}, ${item.meaning}`;
        add(`synonym-bengali-${index}`, `“${item.word}” synonym-এর বাংলা meaning কোনটি?`, item.meaning, [...bank.synonymMeanings, ...meaningPool], meaningNote, 'synonym-bengali', 3, 'standard', meaningNote);
        add(`synonym-gloss-${index}`, `“${item.meaning}” অর্থের সঙ্গে কোন synonym-টি মেলে?`, item.word, synonymPool, meaningNote, 'synonym-gloss', 3, 'challenge', meaningNote);
      }
    });

    // Antonym questions are balanced against synonym availability.
    ant.forEach((item, index) => {
      const relationNote = `${word} → antonym: ${item.word}${item.meaning ? `, ${item.meaning}` : ''}`;
      add(`antonym-choice-${index}`, `${word}-এর antonym কোনটি?`, item.word, antonymPool, relationNote, 'antonym-identification', 5, 'standard', relationNote);
      add(`antonym-opposite-${index}`, `“${item.word}” কোন word-এর বিপরীত অর্থ প্রকাশ করে?`, word, wordPool, relationNote, 'antonym-relation', 4, 'standard', relationNote);
      add(`antonym-card-${index}`, `Card data অনুযায়ী “${item.word}” কোন মূল word-এর antonym?`, word, wordPool, relationNote, 'antonym-relation', 4, 'challenge', relationNote);
      if (item.meaning) {
        const meaningNote = `${item.word}, ${item.meaning}`;
        add(`antonym-bengali-${index}`, `এই antonym-এর বাংলা meaning কোনটি? “${item.word}”`, item.meaning, [...bank.meanings, ...bank.synonymMeanings], meaningNote, 'antonym-bengali', 3, 'standard', meaningNote);
      }
    });

    // Acronym/abbreviation data is used only when the card actually contains it.
    acr.forEach((item, index) => {
      const relationNote = `${word} → acronym: ${item.word}${item.meaning ? `, ${item.meaning}` : ''}`;
      add(`acronym-choice-${index}`, `${word}-এর সঙ্গে যুক্ত acronym / short form কোনটি?`, item.word, acronymPool, relationNote, 'acronym-identification', 4, 'standard', relationNote);
      add(`acronym-card-${index}`, `Card data অনুযায়ী “${item.word}” কোন word-এর abbreviation?`, word, wordPool, relationNote, 'acronym-relation', 3, 'challenge', relationNote);
      if (item.meaning) {
        const meaningNote = `${item.word}, ${item.meaning}`;
        add(`acronym-expansion-${index}`, `“${item.word}” acronym-এর বাংলা meaning বা expansion কোনটি?`, item.meaning, [...bank.acronymMeanings, ...meaningPool], meaningNote, 'acronym-expansion', 3, 'standard', meaningNote);
      }
    });

    // Pair and source explanation questions add variety without inventing facts.
    add('pair-match', `নিচের কোন pair-টি এই card-এর সঙ্গে সঠিকভাবে মিলে?`, `${word}, ${meaning}`, pairPool, `সঠিক pair: ${word}, ${meaning}`, 'pair-matching', 3, 'standard', `Stored pair: ${word}, ${meaning}`);
    add('pair-recall', `Word ও বাংলা meaning-এর সম্পূর্ণ সঠিক pair কোনটি?`, `${word}, ${meaning}`, pairPool, `সঠিক pair: ${word}, ${meaning}`, 'pair-matching', 3, 'challenge', `Stored pair: ${word}, ${meaning}`);
    add('pair-entry', `শব্দ ও অর্থ মিলিয়ে correct entry নির্বাচন করো: “${word}”`, `${word}, ${meaning}`, pairPool, `সঠিক pair: ${word}, ${meaning}`, 'pair-matching', 3, 'standard', `Stored pair: ${word}, ${meaning}`);
    if (usableContext) {
      add('context-identification-1', `এই card-এর explanation অনুযায়ী কোন vocabulary word-টি সঠিক? “${context}”`, word, wordPool, `${word}, ${context}`, 'context-identification', 2, 'challenge', `Card explanation: ${context}`);
      add('context-identification-2', `“${context}” কোন word-এর সঙ্গে যুক্ত card explanation?`, word, wordPool, `${word}, ${context}`, 'context-identification', 2, 'challenge', `Card explanation: ${context}`);
    }

    // Dynamic refill: relation-rich cards get more relation variants; no new data is invented.
    const refill = [];
    syn.forEach((item, index) => {
      refill.push(['synonym-revision-a', `Revision: “${item.word}” কোন word-এর synonym?`, word, wordPool, `${item.word}, synonym of ${word}`, 'synonym-relation']);
      refill.push(['synonym-revision-b', `নিচের কোনটি “${word}”-এর recorded synonym?`, item.word, synonymPool, `${word} → synonym: ${item.word}`, 'synonym-identification']);
    });
    ant.forEach((item, index) => {
      refill.push(['antonym-revision-a', `Revision: “${item.word}” কোন word-এর antonym?`, word, wordPool, `${item.word}, antonym of ${word}`, 'antonym-relation']);
      refill.push(['antonym-revision-b', `নিচের কোনটি “${word}”-এর recorded antonym?`, item.word, antonymPool, `${word} → antonym: ${item.word}`, 'antonym-identification']);
    });
    acr.forEach(item => {
      refill.push(['acronym-revision-a', `“${item.word}” short form-টি কোন card word-এর সঙ্গে যুক্ত?`, word, wordPool, `${item.word}, acronym of ${word}`, 'acronym-relation']);
    });
    refill.push(['reverse-meaning-4', `Vocabulary revision-এ “${meaning}” clue-এর সঠিক entry কোনটি?`, word, wordPool, `${word}, ${meaning}`, 'reverse-meaning']);
    refill.push(['pair-review', `এই card-এর stored word–meaning pair শনাক্ত করো।`, `${word}, ${meaning}`, pairPool, `${word}, ${meaning}`, 'pair-matching']);
    for (const [kind, prompt, correct, pool, explanation, family] of refill) {
      if (candidates.length >= 180) break;
      add(kind, prompt, correct, pool, explanation, family, family === 'pair-matching' ? 4 : 5, 'challenge', explanation);
    }
    const byFamily = new Map();
    candidates.forEach(question => { if (!byFamily.has(question.type)) byFamily.set(question.type, []); byFamily.get(question.type).push(question); });
    const chosen = [], picked = new Set();
    const takeFamily = (family, count) => {
      const list = shuffle([...(byFamily.get(family) || [])]);
      for (const question of list) { if (chosen.length >= 20 || count <= 0) break; if (picked.has(question.id)) continue; picked.add(question.id); chosen.push(question); count--; }
    };
    // Stable anchors: one direct meaning question only; reverse meaning tests a different direction.
    takeFamily('main-meaning', 1);
    takeFamily('reverse-meaning', 2);
    takeFamily('pair-matching', 2);
    takeFamily('context-identification', usableContext ? 2 : 0);
    takeFamily('acronym-identification', acr.length ? 1 : 0);
    takeFamily('acronym-expansion', acr.length ? 1 : 0);

    // Dynamic relation rotation: distribute the remaining slots by available source data.
    const relationFamilies = [
      ['synonym-identification', syn.length * 2.2], ['synonym-bengali', syn.filter(item => item.meaning).length * 1.4], ['synonym-gloss', syn.filter(item => item.meaning).length * 1.2], ['synonym-relation', syn.length * 1.1],
      ['antonym-identification', ant.length * 1.8], ['antonym-bengali', ant.filter(item => item.meaning).length * 1.2], ['antonym-relation', ant.length * 1.1],
      ['acronym-identification', acr.length * 1.5], ['acronym-expansion', acr.filter(item => item.meaning).length * 1.4], ['acronym-relation', acr.length]
    ].filter(([family, weight]) => weight > 0 && (byFamily.get(family) || []).length).sort((a, b) => b[1] - a[1]);
    while (chosen.length < 20) {
      let progressed = false;
      for (const [family] of relationFamilies) {
        const before = chosen.length; takeFamily(family, 1); if (chosen.length > before) progressed = true;
        if (chosen.length >= 20) break;
      }
      if (!progressed) break;
    }

    // If a family has sparse data, use remaining valid candidates, never invented facts.
    if (chosen.length < 20) {
      for (const question of shuffle(candidates)) {
        if (chosen.length >= 20) break;
        if (!picked.has(question.id)) { picked.add(question.id); chosen.push(question); }
      }
    }
    return shuffle(chosen).slice(0, 20);
  }
  function createCardFlashSession(record) {
    const questions = cardFlashQuestions(record);
    if (questions.length < 20) return null;
    return { recordId:record.id, questions, index:0, selected:null, correct:0, wrong:0, complete:false, startedAt:now(), returnPath:route('bank') };
  }
  function renderCardFlashContext(record) {
    const syn = relations(record, 'synonyms').slice(0, 2).map(item => item.word).join(', ');
    const acr = relations(record, 'acronyms').slice(0, 2).map(item => item.word).join(', ');
    return `<div class="vm-card-flash-context"><div><strong>${escape(record.word)}</strong><small>${escape(record.meaning)}${syn ? ` · synonym: ${escape(syn)}` : ''}${acr ? ` · acronym: ${escape(acr)}` : ''}</small></div>${pronounceButton(record.word, `${record.word} pronunciation`)}<span class="vm-card-flash-temporary">TEMPORARY · NOT SAVED</span></div>`;
  }
  function renderCardFlashSummary() {
    const session = state.cardFlash, record = state.records.find(row => row.id === session?.recordId);
    if (!session || !record) { navigate(route('bank')); return ''; }
    const total = session.correct + session.wrong, score = total ? Math.round(session.correct / total * 100) : 0;
    const body = `<main class="vm-page vm-card-flash-page">${heading('FLASH TEST COMPLETE', `${record.word} · Result`, 'এই result শুধু এই temporary session-এর জন্য। কোথাও save করা হয়নি।')}${renderCardFlashContext(record)}<section class="flash-summary-hero"><div class="flash-summary-kicker">CARD-SPECIFIC FLASH TEST</div><h1>${escape(record.word)} revision complete</h1><p>${session.questions.length}টি standard MCQ-এর temporary result। Vocabulary progress, history বা app result-এ এটি যোগ হয়নি।</p></section><div class="flash-summary-grid"><div class="flash-summary-stat correct"><b>${session.correct}</b><span>Correct</span></div><div class="flash-summary-stat wrong"><b>${session.wrong}</b><span>Wrong</span></div><div class="flash-summary-stat"><b>${score}%</b><span>Accuracy</span></div><div class="flash-summary-stat"><b>${session.questions.length}</b><span>Questions</span></div></div><div class="vm-card-flash-actions"><button class="btn" onclick="VocabularyMaster.startCardFlash('${escape(record.id)}')">Retake 20</button><button class="btn secondary" onclick="VocabularyMaster.exitCardFlash()">Back to vocabulary</button></div><div class="vm-card-flash-note">Temporary privacy rule: এই score, answer, wrong list এবং attempt time localStorage, IndexedDB, Question Bank বা History-তে রাখা হয়নি। Page ছেড়ে বের হলে session clear হবে।</div></main>`;
    renderShell(body, { title:`${record.word} Flash Result`, back:`VocabularyMaster.exitCardFlash()` });
  }
  function renderCardFlash() {
    const session = state.cardFlash, record = state.records.find(row => row.id === session?.recordId), question = session?.questions?.[session.index];
    if (!session || !record) { navigate(route('bank')); return ''; }
    if (session.complete || !question) return renderCardFlashSummary();
    const answered = session.selected !== null, progress = Math.round((session.index / session.questions.length) * 100), selected = session.selected;
    const body = `<main class="vm-page vm-card-flash-page">${heading('CARD FLASH TEST', `Question ${session.index + 1} of ${session.questions.length}`, `${session.correct} correct · ${session.wrong} wrong · no history saved`)}${renderCardFlashContext(record)}<div class="flash-progress-section"><div class="flash-meta"><span>${progress}% complete</span></div><div class="progbar flash-prog"><div style="width:${progress}%"></div></div></div><section class="flash-q-card card"><div class="row between"><span class="flash-badge">Q ${String(session.index + 1).padStart(2, '0')} · ${escape(record.word)}</span><span class="flash-points">1 point</span></div><div class="flash-q-text">${escape(question.prompt)}</div><div class="flash-options">${question.options.map((option, index) => { const cls = answered ? (option === question.correct ? 'correct' : option === selected ? 'wrong' : '') : ''; return `<button type="button" class="flash-opt ${cls}" ${answered ? 'disabled' : ''} onclick="VocabularyMaster.answerCardFlash(${safeJson(option)})"><span class="flash-opt-let">${String.fromCharCode(65 + index)}</span><span class="flash-opt-text">${escape(option)}</span>${answered && option === question.correct ? '<span class="flash-opt-icon">✓</span>' : answered && option === selected ? '<span class="flash-opt-icon">×</span>' : ''}</button>`; }).join('')}</div>${answered ? `<div class="flash-feedback ${selected === question.correct ? 'correct' : 'wrong'}"><div class="flash-feedback-title">${selected === question.correct ? '✓ সঠিক উত্তর' : '✕ ভুল উত্তর'}</div><div class="flash-explanation">${escape(question.explanation)}</div></div><button class="btn" style="margin-top:14px" onclick="VocabularyMaster.nextCardFlash()">${session.index === session.questions.length - 1 ? 'See Temporary Result' : 'Next Question →'}</button>` : ''}</section><div class="vm-card-flash-actions"><button class="btn secondary" onclick="VocabularyMaster.exitCardFlash()">Exit test</button><button class="btn ghost" ${answered ? '' : 'disabled'} onclick="VocabularyMaster.nextCardFlash()">Skip to next</button></div></main>`;
    renderShell(body, { title:`${record.word} Flash Test`, back:`VocabularyMaster.exitCardFlash()` });
  }
  function createVocabularyMcqSession(category = '', returnPath = route('bank')) {
    const source = category ? state.records.filter(record => record.category === category) : [...state.records];
    const pool = state.records.length >= 4 ? state.records : source;
    const questions = shuffle(source).map((record, index) => {
      const mode = questionModeFor(record, 'mixed');
      const built = buildQuestion(mode, record, pool, true);
      return built?.options?.length === 4 ? { ...built, id:`vm-mcq-${record.id}-${index}`, sourceWord:record.word } : null;
    }).filter(Boolean);
    if (!questions.length) return null;
    return { category, returnPath, questions, index:0, selected:null, correct:0, wrong:0, complete:false };
  }
  function renderMcqEmpty(category = '') {
    const body = `<main class="vm-page vm-mcq-page">${heading('VOCABULARY MCQ', 'Vocabulary MCQ', category ? `${category} category` : 'All Vocabulary')}<div class="vm-mcq-toolbar"><button class="btn secondary" type="button" onclick="VocabularyMaster.exitMcq()">← Back</button></div><div class="vm-mcq-empty"><b>এই selection-এর জন্য MCQ তৈরি করা যাচ্ছে না।</b><p>কমপক্ষে ৪টি distinct vocabulary meaning/option data দরকার। Vocabulary Parser দিয়ে আরও শব্দ যোগ করো।</p></div></main>`;
    renderShell(body, { title:'Vocabulary MCQ', back:'VocabularyMaster.exitMcq()' });
  }
  function renderMcqPage() {
    const session = state.mcq;
    if (!session) return renderMcqEmpty('');
    if (session.complete) {
      const total = session.correct + session.wrong;
      const score = total ? Math.round(session.correct / total * 100) : 0;
      const body = `<main class="vm-page vm-mcq-page">${heading('VOCABULARY MCQ', 'MCQ Result', 'এই test session-এর result শুধু এই page-এর জন্য।')}<div class="vm-mcq-summary"><div><b>${session.correct}</b><span>Correct</span></div><div><b>${session.wrong}</b><span>Wrong</span></div><div><b>${score}%</b><span>Accuracy</span></div></div><div class="vm-mcq-card"><p class="vm-sub" style="margin:0">এই Vocabulary MCQ result global exam history বা Question Bank-এ save করা হয়নি।</p><div class="vm-mcq-toolbar"><button class="btn" type="button" onclick="VocabularyMaster.resetMcq()">↺ Reset Test</button><button class="btn secondary" type="button" onclick="VocabularyMaster.exitMcq()">← Back to Vocabulary</button></div></div></main>`;
      renderShell(body, { title:'Vocabulary MCQ Result', back:'VocabularyMaster.exitMcq()' });
      return;
    }
    const question = session.questions[session.index];
    if (!question) { session.complete = true; return renderMcqPage(); }
    const answered = session.selected !== null;
    const options = question.options.map((option, index) => {
      const cls = answered ? (option === question.correct ? 'correct' : option === session.selected ? 'wrong' : '') : '';
      const icon = answered && option === question.correct ? ' ✓' : answered && option === session.selected ? ' ✕' : '';
      return `<button class="vm-mcq-option ${cls}" type="button" ${answered ? 'disabled' : ''} onclick="VocabularyMaster.answerMcq(${safeJson(option)})"><span class="vm-mcq-option-letter">${String.fromCharCode(65 + index)}</span><span>${escape(option)}${icon}</span></button>`;
    }).join('');
    const feedback = answered ? `<div class="vm-mcq-feedback ${session.selected === question.correct ? '' : 'wrong'}"><b>${session.selected === question.correct ? '✓ সঠিক উত্তর' : '✕ ভুল উত্তর'}</b><div>সঠিক উত্তর: ${escape(question.correct)}</div><div>${escape(question.explanation || '')}</div></div>` : '';
    const body = `<main class="vm-page vm-mcq-page">${heading('VOCABULARY MCQ', `${session.index + 1} of ${session.questions.length}`, `${session.correct} correct · ${session.wrong} wrong · session only`)}<div class="vm-mcq-toolbar"><button class="btn secondary" type="button" onclick="VocabularyMaster.exitMcq()">← Back</button><button class="btn ghost" type="button" onclick="VocabularyMaster.resetMcq()">↺ Reset Test</button></div><section class="vm-mcq-card"><div class="vm-mcq-meta"><span>${escape(question.sourceWord || 'Vocabulary')}</span><span>Question ${session.index + 1}/${session.questions.length}</span></div><div class="vm-mcq-prompt">${escape(question.prompt)}</div><div class="vm-mcq-options">${options}</div>${feedback}${answered ? `<div class="vm-mcq-nav"><span class="vm-sub">${session.selected === question.correct ? 'Correct' : 'Review the explanation'}</span><button class="btn" type="button" onclick="VocabularyMaster.nextMcq()">${session.index === session.questions.length - 1 ? 'See Result' : 'Next Question →'}</button></div>` : ''}</section></main>`;
    renderShell(body, { title:'Vocabulary MCQ', back:'VocabularyMaster.exitMcq()' });
  }
  function practiceRouteActive() {
    const path = String(window.Router?.path || location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard');
    return path === route('practice');
  }
  function updatePracticeTimer(session) {
    const timer = document.querySelector('[data-vm-practice-timer]');
    if (timer) timer.textContent = `⏱ ${prettyTime(Math.max(0, Number(session?.remainingSeconds || 0)))}`;
  }
  function stopPracticeTimer() {
    if (state.practice?.timerId) clearInterval(state.practice.timerId);
    if (state.practice) state.practice.timerId = null;
  }
  function pausePracticeTimer(session = state.practice) {
    if (!session?.timeLimit || session.complete) return;
    session.remainingSeconds = Math.max(0, Math.ceil((session.deadline - Date.now()) / 1000));
    session.timerPaused = true;
    stopPracticeTimer();
    updatePracticeTimer(session);
  }
  function startPracticeTimer(session, resume = false) {
    stopPracticeTimer();
    if (!session?.timeLimit || session.complete) return;
    if (resume) session.deadline = Date.now() + Math.max(0, Number(session.remainingSeconds || 0)) * 1000;
    else { session.deadline = Date.now() + session.timeLimit * 1000; session.remainingSeconds = session.timeLimit; }
    session.timerPaused = false;
    updatePracticeTimer(session);
    session.timerId = setInterval(() => {
      if (!state.practice || state.practice !== session) return stopPracticeTimer();
      if (!practiceRouteActive() || document.visibilityState !== 'visible') return pausePracticeTimer(session);
      session.remainingSeconds = Math.max(0, Math.ceil((session.deadline - Date.now()) / 1000));
      updatePracticeTimer(session);
      if (!session.remainingSeconds) { stopPracticeTimer(); session.complete = true; session.timedOut = true; if (session.type === 'quiz') session.index = session.questions.length; return api.render(); }
    }, 1000);
  }
  function syncPracticeTimer() {
    const session = state.practice;
    if (!session?.timeLimit || session.complete) return;
    if (practiceRouteActive() && document.visibilityState === 'visible') {
      if (!session.timerId && session.timerPaused) startPracticeTimer(session, true);
    } else if (session.timerId) pausePracticeTimer(session);
  }
  window.addEventListener('hashchange', syncPracticeTimer, { passive:true });
  document.addEventListener('visibilitychange', syncPracticeTimer, { passive:true });
  function questionModeFor(record, type) {
    if (type !== 'mixed') return type;
    const modes = ['meaning','fill']; if (relations(record, 'synonyms').length) modes.push('synonym'); if (relations(record, 'antonyms').length) modes.push('antonym'); return shuffle(modes)[0];
  }
  const api = {
    /* Number of rows the bank actually loaded. The vocabulary store is its own
       IDB store, so this is the honest count a screen can trust. */
    async bankCount() {
      await loadRecords(true);
      return state.records.length;
    },
    /* Called after the background cloud hydration finishes: re-read the store so
       the bank shows the freshly written words without a manual refresh. */
    async reload() {
      await loadRecords(true);
      if (document.getElementById('vmCategoryResults')) refreshCategoryResults();
      else if (document.querySelector('.vm-az-grid')) renderBank();
    },
    async render() {
      await loadRecords();
      restoreResume(String(Router?.path || ''));
      if (!state.practiceSetupRestored) { restorePracticeSetup(); state.practiceSetupRestored = true; }
      const current = String(Router?.path || '');
      const parts = current.split('/');
      if (current === ROUTE) return renderLanding();
      if (current === route('bank')) return renderBank();
      if (parts[1] === 'mcq') {
        const category = parts[2] && parts[2] !== 'all' ? String(parts[2]).toUpperCase() : '';
        if (!state.mcq || state.mcq.category !== category) {
          state.mcq = createVocabularyMcqSession(category, category ? route(`category/${category}`) : route('bank'));
        }
        return state.mcq ? renderMcqPage() : renderMcqEmpty(category);
      }
      if (parts[1] === 'flash') {
        const recordId = decodeURIComponent(parts.slice(2).join('/'));
        if (!state.cardFlash || state.cardFlash.recordId !== recordId) {
          const record = state.records.find(row => row.id === recordId);
          const session = record && createCardFlashSession(record);
          if (!session) { toast('এই card-এর জন্য 20টি distinct option তৈরি করা যাচ্ছে না। Vocabulary Bank-এ আরও valid words যোগ করো।'); navigate(route('bank')); return; }
          state.cardFlash = session;
        }
        return renderCardFlash();
      }
      if (parts[1] === 'category') { const nextCategory = String(parts[2] || '').toUpperCase(); if (state.category !== nextCategory) { state.category = nextCategory; state.query = ''; state.visible = 50; state.cardAnchorId = ''; state.cardAnchorTop = 0; state.pendingCardRestore = false; } return renderCategory(); }
      if (parts[1] === 'word') return renderWord(decodeURIComponent(parts.slice(2).join('/')));
      if (current === route('parser')) return renderParser();
      if (current === route('practice')) { if (!state.practice) return renderPracticeHome(); if (state.practice.type === 'match') return renderMatching(); if (state.practice.complete) return renderPracticeSummary(); return renderPracticeQuiz(); }
      if (current === route('test')) return renderTest();
      return renderLanding();
    },
    openCategory(letter) { state.category = String(letter || '').toUpperCase(); state.query = ''; state.visible = 50; state.cardAnchorId = ''; state.cardAnchorTop = 0; state.pendingCardRestore = false; navigate(route(`category/${state.category}`)); },
    searchCategory(query) { const next = String(query || ''); clearTimeout(state.searchTimer); state.searchTimer = window.setTimeout(() => { state.query = next; state.visible = 50; state.cardAnchorId = ''; state.cardAnchorTop = 0; state.pendingCardRestore = false; snapshotResume(); refreshCategoryResults(); }, 120); },
    loadMore() { state.visible += 50; snapshotResume(); refreshCategoryResults(); },
    setParserTarget(value) { const ta = document.getElementById('vmParserInput'); if (ta) state.parser.text = ta.value; state.parser.targetCategory = String(value || '').slice(0, 2).toUpperCase(); renderParser(); },
    parseInput() { state.parser.text = document.getElementById('vmParserInput')?.value || ''; state.parser.records = parseVocabulary(state.parser.text); state.parser.stage = 'preview'; renderParser(); },
    backToPaste() { state.parser.stage = 'input'; renderParser(); },
    skipParsed(index) { state.parser.records.splice(index, 1); renderParser(); },
    editParsed(index) {
      const record = state.parser.records[index]; if (!record) return;
      openModal(`<h3>Edit vocabulary</h3><label class="flabel">Word</label><input id="vmEditWord" value="${escape(record.word)}"><label class="flabel">Bengali Meaning</label><input id="vmEditMeaning" value="${escape(record.meaning)}"><label class="flabel">Synonyms (one per line: word : meaning)</label><textarea id="vmEditSyn">${escape((record.synonyms || []).map(item => `${item.word} : ${item.meaning}`).join('\n'))}</textarea><label class="flabel">Antonyms (one per line: word : meaning)</label><textarea id="vmEditAnt">${escape((record.antonyms || []).map(item => `${item.word} : ${item.meaning}`).join('\n'))}</textarea><label class="flabel">Acronyms / Abbreviations (one per line: short form : meaning)</label><textarea id="vmEditAcr">${escape((record.acronyms || []).map(item => `${item.word} : ${item.meaning}`).join('\n'))}</textarea><label class="flabel">Tips & Explanation</label><textarea id="vmEditTips">${escape(record.tips)}</textarea><button class="btn" style="margin-top:14px" onclick="VocabularyMaster.saveParsedEdit(${index})">Save changes</button>`);
    },
    saveParsedEdit(index) { const current = state.parser.records[index]; if (!current) return; const parseLines = id => parsePairs(document.getElementById(id)?.value || ''); const updated = normalizeRecord({ ...current, word:document.getElementById('vmEditWord')?.value || '', meaning:document.getElementById('vmEditMeaning')?.value || '', synonyms:parseLines('vmEditSyn'), antonyms:parseLines('vmEditAnt'), acronyms:parseLines('vmEditAcr'), tips:document.getElementById('vmEditTips')?.value || '' }); state.parser.records[index] = { ...updated, raw:current.raw, valid:!!(updated.word && updated.meaning), error:updated.word && updated.meaning ? '' : 'Incomplete record' }; closeModal(); renderParser(); },
    async saveParsed() { const records = state.parser.records.filter(record => String(record.raw || '').trim()); if (!records.length) return toast('সেভ করার মতো কিছু পাওয়া যায়নি।'); const target = String(state.parser.targetCategory || '').toUpperCase(); let saved = 0; for (const source of records) { const record = normalizeRecord({ ...source, word: source.word || '', meaning: source.meaning || '' }); if (target && /^[A-Z#]$/.test(target)) record.category = target; await dbPut(STORE, record); saved++; } await loadRecords(true); state.parser = { text:'', records:[], stage:'input', targetCategory: target }; toast(`সব ${saved}টি vocabulary সেভ হয়েছে · duplicates kept`); navigate(route('bank')); },
    setPracticeSource(value) { const setup = state.practiceSetup; if (value === 'custom') setup.sourceType = 'custom'; else if (/^[A-Z]$/.test(value)) { setup.sourceType = 'category'; setup.category = value; } else { setup.sourceType = 'all'; setup.category = ''; } renderPracticeHome(); },
    setPracticeType(value) { if (PRACTICE_TYPES[value]) state.practiceSetup.practiceType = value; renderPracticeHome(); },
    setPracticeCount(value) { const setup = state.practiceSetup; if (value === 'custom') setup.countMode = 'custom'; else { setup.countMode = 'preset'; setup.questionCount = Number(value) || 10; } renderPracticeHome(); },
    setPracticeCustomCount(value) { state.practiceSetup.customCount = Math.max(1, Number(value) || 1); renderPracticeHome(); },
    useAvailablePracticeCount() { const available = setupAvailability().available; state.practiceSetup.countMode = 'custom'; state.practiceSetup.customCount = Math.max(1, available); renderPracticeHome(); },
    setPracticeTime(value) { const setup = state.practiceSetup; if (value === 'custom') setup.timeMode = 'custom'; else { setup.timeMode = 'preset'; setup.timeValue = Number(value) || 0; } renderPracticeHome(); },
    setPracticeTimePart(key, value) { if (['customHours','customMinutes','customSeconds'].includes(key)) state.practiceSetup[key] = Math.max(0, Number(value) || 0); renderPracticeHome(); },
    setPracticeRandom(value) { state.practiceSetup.randomize = !!value; },
    setPracticeAdvanced(value) { state.practiceSetup.advancedOpen = !!value; },
    searchPracticeCustom(value) { state.practiceSetup.customQuery = String(value || ''); state.practiceSetup.customVisible = 40; renderPracticeHome(); },
    togglePracticeRecord(id, checked) { const selected = new Set(state.practiceSetup.selectedIds); checked ? selected.add(id) : selected.delete(id); state.practiceSetup.selectedIds = [...selected]; renderPracticeHome(); },
    selectVisiblePractice() { const setup = state.practiceSetup, query = lower(setup.customQuery); const visible = state.records.filter(record => !query || [record.word,record.meaning].join(' ').toLocaleLowerCase('en-US').includes(query)).slice(0, setup.customVisible); state.practiceSetup.selectedIds = unique([...setup.selectedIds, ...visible.map(record => record.id)]); renderPracticeHome(); },
    clearPracticeSelection() { state.practiceSetup.selectedIds = []; renderPracticeHome(); },
    loadMorePracticeCustom() { state.practiceSetup.customVisible += 40; renderPracticeHome(); },
    applyPracticePreset(name) { const preset = name === 'quick' ? { questionCount:5,timeValue:0 } : name === 'focused' ? { questionCount:20,timeValue:600 } : { questionCount:10,timeValue:300 }; state.practiceSetup = { ...state.practiceSetup, ...preset, countMode:'preset', timeMode:'preset' }; renderPracticeHome(); },
    resetPracticeSetup() { state.practiceSetup = defaultPracticeSetup(); renderPracticeHome(); },
    startConfiguredPractice() { const setup = state.practiceSetup, status = setupAvailability(setup); if (!status.available || status.requested > status.available) return renderPracticeHome(); const source = setup.randomize ? shuffle(status.valid) : [...status.valid]; const selected = source.slice(0, status.requested); if (setup.practiceType === 'match') { if (selected.length < 2) return toast('Matching-এর জন্য অন্তত 2টি valid vocabulary দরকার'); const pairs = selected.map(record => ({ id:record.id, word:record.word, meaning:record.meaning })); state.practice = { type:'match', pairs, meanings:setup.randomize ? shuffle(pairs) : [...pairs], wordId:null, done:[], correct:0, wrong:0, complete:false, timeLimit:status.time, remainingSeconds:status.time, config:{...setup} }; } else { const questions = selected.map(record => buildQuestion(questionModeFor(record, setup.practiceType), record, status.source)).filter(question => question?.options?.length === 4); if (questions.length < status.requested) return toast('Practice could not be prepared. অন্য source, কম question বা অন্য practice type বেছে নিন।'); state.practice = { type:'quiz', mode:setup.practiceType, questions, index:0, selected:null, correct:0, wrong:0, complete:false, timeLimit:status.time, remainingSeconds:status.time, config:{...setup} }; }
      savePracticeSetup(setup); startPracticeTimer(state.practice); api.render(); },
    startPractice(mode) { state.practiceSetup.practiceType = mode; state.practiceSetup.sourceType = 'all'; state.practiceSetup.selectedIds = []; navigate(route('practice')); },
    startMcq(category = '') { const nextCategory = String(category || '').toUpperCase(); const returnPath = nextCategory ? route(`category/${nextCategory}`) : route('bank'); const session = createVocabularyMcqSession(nextCategory, returnPath); if (!session) return toast('MCQ শুরু করতে অন্তত ৪টি valid vocabulary দরকার।'); state.mcq = session; navigate(route(`mcq/${nextCategory || 'all'}`)); },
    openCategorySettings: (category) => openCategorySettings(category),
    practiceRecord(id) { state.practiceSetup.sourceType = 'custom'; state.practiceSetup.selectedIds = [id]; navigate(route('practice')); },
    answerMcq(value) { const session = state.mcq, question = session?.questions?.[session.index]; if (!question || session.selected !== null) return; session.selected = String(value); if (session.selected === question.correct) session.correct++; else session.wrong++; renderMcqPage(); },
    nextMcq() { const session = state.mcq; if (!session || session.selected === null) return; session.index += 1; session.selected = null; if (session.index >= session.questions.length) session.complete = true; renderMcqPage(); },
    resetMcq() { const session = state.mcq; if (!session) return; const fresh = createVocabularyMcqSession(session.category, session.returnPath); state.mcq = fresh || session; if (state.mcq) renderMcqPage(); },
    exitMcq() { const returnPath = state.mcq?.returnPath || route('bank'); state.mcq = null; navigate(returnPath); },
    answerPractice(value) { const session = state.practice; if (!session || session.selected !== null) return; session.selected = String(value); if (session.selected === session.questions[session.index].correct) session.correct++; else session.wrong++; renderPracticeQuiz(); },
    nextPractice() { const session = state.practice; if (!session) return; session.index++; session.selected = null; if (session.index >= session.questions.length) session.complete = true; api.render(); },
    pickMatchWord(id) { const session = state.practice; if (!session || session.done.includes(id)) return; session.wordId = id; renderMatching(); },
    pickMatchMeaning(id) { const session = state.practice; if (!session || !session.wordId || session.done.includes(id)) return; if (session.wordId === id) { session.done.push(id); session.correct++; toast('Correct'); } else { session.wrong++; toast('Try again'); } session.wordId = null; renderMatching(); },
    cancelPractice() { stopPracticeTimer(); state.practice = null; navigate(route('practice')); },
    finishPractice() { stopPracticeTimer(); state.practice = null; navigate(route('practice')); },
    testRecord(id) { state.test.selectedIds = [id]; state.test.category = ''; navigate(route('test')); },
    startCardFlash(id) { const record = state.records.find(row => row.id === id); const current = String(Router?.path || location.hash.replace(/^#\/?/, '').split('?')[0] || route('bank')); const returnPath = state.cardFlash?.recordId === id && state.cardFlash.returnPath ? state.cardFlash.returnPath : (current.startsWith(route('category/')) ? current : route('bank')); const session = record && createCardFlashSession(record); if (!session) return toast('এই card-এর জন্য 20টি distinct option তৈরি করা যাচ্ছে না। Vocabulary Bank-এ আরও valid words যোগ করো।'); session.returnPath = returnPath; state.cardFlash = session; navigate(route(`flash/${encodeURIComponent(id)}`)); },
    copyImagePrompt(id) { const record = state.records.find(row => row.id === id); if (!record) return toast('Vocabulary card পাওয়া যায়নি।'); return copyPlainText(imagePromptFor(record)); },
    downloadCategoryPromptPdf(category) { return downloadCategoryPromptPdf(category); },
    copyCategoryPrompt(category) { return copyCategoryPrompt(category); },
    categoryPromptText(category) { return categoryPromptText(category); },
    copyCategoryVoicePrompt(category) { return copyCategoryVoicePrompt(category); },
    categoryVoicePromptText(category) { return categoryVoicePromptText(category); },
    openVoiceUploader(category) { return openVoiceUploader(category); },
    uploadCategoryVoices(category, input) { return uploadCategoryVoices(category, input); },
    voiceKey: word => vmVoiceKey(word),
    categoryVoiceEntries: category => categoryVoiceEntries(category),
    confirmDeleteCategory: category => confirmDeleteCategory(category),
    autoCategoryImages(category) { return autoCategoryImages(category); },
    stopAutoImages() { return stopAutoImages(); },
    openCategoryImageImporter(category) { return openCategoryImageImporter(category); },
    importCategoryImages(category, input) { return importCategoryImages(category, input); },
    importCategoryPdf(category, input) { return importCategoryPdf(category, input); },
    async attachCardImage(id, input) { const record = state.records.find(row => row.id === id), file = input?.files?.[0]; if (!record || !file) return; if (!String(file.type || '').startsWith('image/')) return toast('শুধু image file যোগ করা যাবে।'); try { const dataUrl = await imageDataUrl(file); const updated = normalizeRecord({ ...record, imageDataUrl:dataUrl, id:record.id, createdAt:record.createdAt }); await dbPut(STORE, updated); await loadRecords(true); toast('Vocabulary memory image offline save হয়েছে।'); refreshCategoryResults(); } catch (_) { toast('Image save করা যায়নি।'); } finally { if (input) input.value = ''; } },
    async removeCardImage(id) { const record = state.records.find(row => row.id === id); if (!record || !record.imageDataUrl) return; const updated = normalizeRecord({ ...record, imageDataUrl:'', id:record.id, createdAt:record.createdAt }); await dbPut(STORE, updated); await loadRecords(true); toast('Memory image remove হয়েছে।'); refreshCategoryResults(); },
    answerCardFlash(value) { const session = state.cardFlash, question = session?.questions?.[session.index]; if (!question || session.selected !== null) return; session.selected = String(value); if (session.selected === question.correct) session.correct++; else session.wrong++; renderCardFlash(); },
    nextCardFlash() { const session = state.cardFlash; if (!session || session.selected === null) return; session.index++; session.selected = null; if (session.index >= session.questions.length) session.complete = true; renderCardFlash(); },
    exitCardFlash() { const returnPath = state.cardFlash?.returnPath || route('bank'); state.cardFlash = null; navigate(returnPath); },
    setTestCategory(value) { state.test.category = String(value || ''); state.test.selectedIds = []; renderTest(); },
    setTestCount(value) { state.test.count = Number(value) || 10; renderTest(); },
    setTestDuration(value) { state.test.duration = Number(value) || 10; renderTest(); },
    setTestNegative(value) { state.test.negative = Number(value) || 0; renderTest(); },
    async beginTest(mode) { const records = testScopeRecords(); if (!records.length) return toast('Vocabulary selection empty'); const ids = await createExamQuestions(records); if (!ids.length) return toast('4টি distinct option তৈরির জন্য আরো vocabulary data দরকার'); ExamSetup = freshSetup(); ExamSetup.mode = mode; ExamSetup.onlyQuestionIds = ids; ExamSetup.totalCount = Math.min(state.test.count, ids.length); ExamSetup.duration = state.test.duration; ExamSetup.negative = state.test.negative; ExamSetup.randomizeQ = true; ExamSetup.randomizeOpt = true; ExamSetup.selectionMode = 'random'; ExamSetup.revisionKind = ''; await beginExam(); },
  };

  api.snapshotResume = snapshotResume;
  window.VocabularyMaster = api;
  const previousRouteRenderer = window.__admissionRenderRoute;
  window.__admissionRenderRoute = function vocabularyMasterRouteRenderer() {
    const path = String(window.Router?.path || location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard');
    if (path === ROUTE || path.startsWith(`${ROUTE}/`)) return api.render();
    return typeof previousRouteRenderer === 'function' ? previousRouteRenderer.apply(this, arguments) : window.render?.();
  };
  function injectDashboardEntry() {
    const page = document.querySelector('#app .page');
    if (!page || page.querySelector('[data-vocabulary-master-entry]')) return;
    const entry = document.createElement('button');
    entry.type = 'button'; entry.className = 'vm-dashboard-entry'; entry.dataset.vocabularyMasterEntry = 'true';
    entry.innerHTML = '<i aria-hidden="true">📚</i><span><b>Vocabulary Master</b><small>Synonym · Antonym · Bengali Meaning</small></span><em aria-hidden="true">›</em>';
    entry.onclick = () => navigate(ROUTE);
    const tools = page.querySelector('[data-unified-study-tools-list]');
    if (!tools) return;
    tools.appendChild(entry);
  }
  const previousDashboard = window.renderDashboard;
  if (typeof previousDashboard === 'function') {
      window.renderDashboard = function vocabularyMasterDashboard() {
      const result = previousDashboard.apply(this, arguments);
      injectDashboardEntry();
      return result;
    };
  }
  window.addEventListener('load', () => {
    window.setTimeout(() => {
      const path = String(window.Router?.path || location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard');
      if (path === ROUTE || path.startsWith(`${ROUTE}/`)) { api.render(); return; }
      if (path === 'dashboard' || path === 'home') injectDashboardEntry();
    }, 420);
  }, { once:true });
  const appRoot = document.getElementById('app');
  if (appRoot && window.MutationObserver) {
    new MutationObserver(() => {
      const path = String(window.Router?.path || location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard');
      if (path === 'dashboard' || path === 'home') injectDashboardEntry();
    }).observe(appRoot, { childList:true, subtree:true });
  }
})();
