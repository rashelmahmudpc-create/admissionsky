(() => {
  'use strict';

  const state = window.ExamDropdownState || (window.ExamDropdownState = { subjectId: '', topicId: '', subtopicId: '' });
  const escH = value => {
    if (typeof window.esc === 'function') return window.esc(value);
    const node = document.createElement('div'); node.textContent = String(value ?? ''); return node.innerHTML;
  };
  const cache = () => (typeof CACHE !== 'undefined' ? CACHE : { subjects: [], topics: [] });
  const rootsFor = subjectId => (window.topicHierarchy?.topicRoots?.(subjectId) || []).slice();
  const childrenFor = topicId => (window.topicHierarchy?.topicChildren?.(topicId) || []).slice();
  const subjectName = id => cache().subjects.find(s => s.id === id)?.name || '';

  const currentState = () => {
    const st = typeof ExamSetup !== 'undefined' ? ExamSetup : null;
    if (!st) return null;
    const subjects = cache().subjects || [];
    const topics = cache().topics || [];
    const selectedTopic = topics.find(t => t.id === st.topicIds?.[0]);
    const parent = selectedTopic?.parentTopicId ? topics.find(t => t.id === selectedTopic.parentTopicId) : selectedTopic;
    if (!state.subjectId && st.subjectIds?.length === 1) state.subjectId = st.subjectIds[0];
    if (!state.topicId && parent?.id) state.topicId = parent.id;
    if (!state.subtopicId && selectedTopic?.parentTopicId) state.subtopicId = selectedTopic.id;
    return { st, subjects, topics, subjectId: state.subjectId, topicId: state.topicId, subtopicId: state.subtopicId };
  };

  const options = (items, placeholder, selected, labelFor) => `<option value="">${placeholder}</option>${items.map(item => `<option value="${escH(item.value)}" ${item.value === selected ? 'selected' : ''}>${escH(labelFor(item))}</option>`).join('')}`;
  const field = (label, id, html, hint) => `<label class="exam-dropdown-field"><span>${escH(label)}</span><select id="${id}" onchange="window.examDropdownChange('${id}', this.value)">${html}</select>${hint ? `<small>${escH(hint)}</small>` : ''}</label>`;

  function renderDropdowns() {
    if (!(window.Router?.path || location.hash.slice(1)).startsWith('exam/setup')) return;
    const current = currentState();
    if (!current) return;
    const { st, subjects, topics, subjectId, topicId, subtopicId } = current;
    const subjectSection = [...document.querySelectorAll('.setup-section')].find(node => node.textContent.includes('Step 2'));
    const topicSection = [...document.querySelectorAll('.setup-section')].find(node => node.textContent.includes('Step 3'));
    if (!subjectSection || !topicSection) return;

    const subjectItems = subjects.map(s => ({ value: s.id, name: `${s.icon || '📘'} ${s.name}` }));
    const selectedSubject = subjectId || (st.subjectIds?.length === 1 ? st.subjectIds[0] : '');
    subjectSection.innerHTML = `${subjectSection.querySelector('h3')?.outerHTML || '<h3>Step 2, Subjects</h3>'}<div class="exam-dropdown-grid">${field('Subject', 'examSubjectSelect', options(subjectItems, 'All Subjects', selectedSubject, item => item.name), 'Choose one subject or keep all subjects selected.')}</div><div class="muted exam-dropdown-summary">${st.subjectIds?.length ? `${st.subjectIds.length} subject selected` : 'All subjects included'}</div>`;

    const topicItems = (selectedSubject ? rootsFor(selectedSubject).map(t => ({ value: t.id, name: t.name })) : rootsForAll(subjects, rootsFor).map(t => ({ value: t.id, name: `${subjectName(t.subjectId)} · ${t.name}` })));
    const selectedTopic = topicItems.some(item => item.value === topicId) ? topicId : '';
    const topicChildren = selectedTopic ? childrenFor(selectedTopic) : [];
    const subtopicItems = topicChildren.map(t => ({ value: t.id, name: t.name }));
    topicSection.innerHTML = `${topicSection.querySelector('h3')?.outerHTML || '<h3>Step 3, Topics</h3>'}<div class="exam-dropdown-grid exam-dropdown-grid-topics">${field('Topic', 'examTopicSelect', options(topicItems, 'All Topics', selectedTopic, item => item.name), 'Choose a parent topic.')}${field('Sub-topic', 'examSubtopicSelect', options(subtopicItems, subtopicItems.length ? 'All sub-topics' : 'No sub-topics for this topic', subtopicId, item => item.name), 'Optional: narrow the exam to one sub-topic.')}</div><div class="muted exam-dropdown-summary">${st.topicIds?.length ? 'A topic filter is active' : 'All topics included'}</div>`;
  }

  function rootsForAll(subjects, rootGetter) {
    return subjects.flatMap(subject => rootGetter(subject.id));
  }

  window.examDropdownChange = function(id, value) {
    const st = typeof ExamSetup !== 'undefined' ? ExamSetup : null;
    if (!st) return;
    if (id === 'examSubjectSelect') {
      state.subjectId = value;
      state.topicId = '';
      state.subtopicId = '';
      st.subjectIds = value ? [value] : [];
      st.topicIds = [];
    } else if (id === 'examTopicSelect') {
      state.topicId = value;
      state.subtopicId = '';
      st.topicIds = value ? [value] : [];
    } else if (id === 'examSubtopicSelect') {
      state.subtopicId = value;
      st.topicIds = value ? [value] : (state.topicId ? [state.topicId] : []);
    }
    render();
  };

  const originalRender = window.render;
  if (typeof originalRender === 'function') {
    window.render = function(...args) {
      const result = originalRender.apply(this, args);
      requestAnimationFrame(renderDropdowns);
      return result;
    };
  }
  window.addEventListener('hashchange', () => requestAnimationFrame(renderDropdowns), false);
  requestAnimationFrame(renderDropdowns);

  if (!document.getElementById('exam-dropdown-styles')) {
    const style = document.createElement('style');
    style.id = 'exam-dropdown-styles';
    style.textContent = `
      .exam-dropdown-grid { display:grid; grid-template-columns:minmax(0,1fr); gap:12px; }
      .exam-dropdown-grid-topics { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .exam-dropdown-field { display:flex; flex-direction:column; gap:7px; min-width:0; }
      .exam-dropdown-field > span { font-size:12px; font-weight:800; letter-spacing:.02em; color:var(--text); }
      .exam-dropdown-field select { appearance:none; width:100%; min-height:48px; padding:12px 42px 12px 14px; border:1px solid color-mix(in srgb,var(--emerald) 24%,var(--line)); border-radius:14px; background:linear-gradient(135deg,var(--card),var(--mint)); color:var(--text); font:inherit; font-size:14px; font-weight:700; box-shadow:0 5px 14px rgba(15,107,79,.08); background-image:linear-gradient(45deg,transparent 50%,var(--emerald) 50%),linear-gradient(135deg,var(--emerald) 50%,transparent 50%); background-position:calc(100% - 18px) 20px,calc(100% - 12px) 20px; background-size:6px 6px,6px 6px; background-repeat:no-repeat; }
      .exam-dropdown-field select:focus { outline:none; border-color:var(--emerald); box-shadow:0 0 0 4px color-mix(in srgb,var(--emerald) 16%,transparent),0 8px 20px rgba(15,107,79,.12); }
      .exam-dropdown-field small { color:var(--sub); font-size:11px; line-height:1.35; }
      .exam-dropdown-summary { margin-top:9px; font-size:12px; }
      @media(max-width:430px) { .exam-dropdown-grid-topics { grid-template-columns:1fr; } }
    `;
    document.head.appendChild(style);
  }
})();

//# sourceURL=exam-dropdowns.js
