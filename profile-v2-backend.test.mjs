import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const PAGE = readFileSync(new URL('./profile-v2.html', import.meta.url), 'utf8');
const BUILDER = readFileSync(new URL('./scripts/build-profile-v2.mjs', import.meta.url), 'utf8');

/* The owner's original file must stay untouched: the build reads it and never
   writes it. Guard that the demo identity lives only in the source backup. */
test('the demo identity is stripped from the built page', () => {
  assert.doesNotMatch(PAGE, /Zayan Rashel/);
  assert.doesNotMatch(PAGE, /AH-MUDWXS/);
  assert.doesNotMatch(PAGE, /rashelzayan3@gmail\.com/);
  assert.doesNotMatch(PAGE, /solved:266/);
  assert.match(PAGE, /var SAMPLE=window\.PROFILE_STATS/);
});

test('the built page boots and renders honest empty state with no session', async () => {
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = () => Promise.reject(new Error('offline'));
    },
  });
  const win = dom.window;
  await new Promise((r) => setTimeout(r, 60));

  // No session, no cache: nothing fake may appear.
  // The empty-state placeholder is a dash; the shipped-copy typography pass
  // (29a1ac7) turned the em dash into a hyphen, so accept either.
  assert.match(win.document.querySelector('#nm').textContent, /^[—–-]$/);
  assert.equal(win.document.querySelector('#ahid').textContent, '');
  assert.ok(win.ProfileV2, 'adapter exposes its API');
  // Compare fields: the object comes from the jsdom realm, so a structural
  // deep-equal would trip on prototype identity rather than on a real value.
  const stats = win.ProfileV2.stats();
  assert.equal(stats.solved, 0);
  assert.equal(stats.mockDone, false);
  dom.window.close();
});

/* The heart of the owner's request: real, per-student data. Two different
   students must render their own values, never a shared or sample one. */
test('each student renders their own real profile, never another student', async () => {
  const students = [
    {
      publicId: 'AH-AAA222',
      email: 'rahim@example.com',
      profile: {
        fullName: 'রহিম উদ্দিন', mobile: '01711111111', dob: '2007-03-04',
        bio: 'ঢাবি-তে CSE পড়তে চাই', school: { name: 'নটর ডেম কলেজ' },
        higherInstitution: null, targets: [{ name: 'DU', unit: 'A' }], subjects: ['পদার্থ'],
        admissionSession: '২০২৫-২৬', academicGoal: 'DU A Unit', visibility: 'public', version: 3,
      },
      avatar: { present: false },
    },
    {
      publicId: 'AH-BBB333',
      email: 'karim@example.com',
      profile: {
        fullName: 'করিম মিয়া', mobile: '01822222222', dob: '2006-11-19',
        bio: '', school: { name: 'ঢাকা কলেজ' },
        higherInstitution: { name: 'বুয়েট' }, targets: [], subjects: [],
        admissionSession: '২০২৪-২৫', academicGoal: '', visibility: 'private', version: 9,
      },
      avatar: { present: false },
    },
  ];

  for (const student of students) {
    const dom = new JSDOM(PAGE, {
      url: 'https://admissionhub.pages.dev/profile-v2.html',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      beforeParse(win) {
        win.fetch = (path) => {
          if (String(path).includes('/profile/patch')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, saved: true, profile: student.profile }) });
          }
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, ...student }) });
        };
      },
    });
    const win = dom.window;
    await new Promise((r) => setTimeout(r, 80));

    const doc = win.document;
    assert.equal(doc.querySelector('#nm').textContent, student.profile.fullName,
      `${student.publicId} shows its own name`);
    assert.equal(doc.querySelector('#ahid').textContent, student.publicId,
      `${student.publicId} shows its own AH-ID`);

    // The other student's identity must not leak in.
    const other = students.find((s) => s.publicId !== student.publicId);
    assert.doesNotMatch(doc.body.textContent, new RegExp(other.profile.fullName));
    assert.doesNotMatch(doc.body.textContent, new RegExp(other.publicId));
    assert.doesNotMatch(doc.body.textContent, new RegExp(other.email));

    dom.window.close();
  }
});

test('a saved edit is sent to the backend under the backend field names', async () => {
  const sent = [];
  const student = {
    publicId: 'AH-CCC444',
    email: 's@example.com',
    profile: {
      fullName: 'শিক্ষার্থী', mobile: '', dob: '', bio: '', school: null,
      higherInstitution: null, targets: [], subjects: [], admissionSession: '',
      academicGoal: '', visibility: 'private', version: 1,
    },
    avatar: { present: false },
  };
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = (path, opts) => {
        if (String(path).includes('/profile/patch')) {
          sent.push(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, saved: true, profile: { ...student.profile, version: 2 } }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, ...student }) });
      };
    },
  });
  const win = dom.window;
  await new Promise((r) => setTimeout(r, 80));

  // Exactly what the owner's UI emits on an edit.
  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'name', value: 'নতুন নাম' },
  }));
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(sent.length, 1, 'one patch sent');
  assert.deepEqual(sent[0].fields, { fullName: 'নতুন নাম' });
  assert.equal(sent[0].expectVersion, 1, 'optimistic version carried');
  dom.window.close();
});

test('visibility toggle maps to the backend visibility field', async () => {
  const sent = [];
  const student = {
    publicId: 'AH-DDD555', email: 'd@example.com',
    profile: { fullName: 'ঘ', mobile: '', dob: '', bio: '', school: null, higherInstitution: null, targets: [], subjects: [], admissionSession: '', academicGoal: '', visibility: 'private', version: 4 },
    avatar: { present: false },
  };
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = (path, opts) => {
        if (String(path).includes('/profile/patch')) {
          sent.push(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, saved: true, profile: student.profile }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, ...student }) });
      };
    },
  });
  await new Promise((r) => setTimeout(r, 80));
  dom.window.document.dispatchEvent(new dom.window.CustomEvent('app:action', {
    detail: { action: 'profile.public', value: true },
  }));
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].fields, { visibility: 'public' });
  dom.window.close();
});

test('the build is reproducible and the source stays read-only', () => {
  // The builder must read the owner's file and never write to it.
  assert.match(BUILDER, /readFileSync\(SRC/);
  assert.doesNotMatch(BUILDER, /writeFileSync\(SRC/);
  assert.match(BUILDER, /writeFileSync\(join\(root, 'profile-v2\.html'\)/);
});

/* ---- the shapes the backend refused, and the avatar it never received ---- */
const baseProfile = {
  fullName: 'ক', mobile: '', dob: '', bio: '', school: null,
  higherInstitution: null, targets: [], subjects: [],
  admissionSession: '', academicGoal: '', visibility: 'private', version: 1,
};

function mount({ student, calls, onPatch }) {
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      if (student.persisted) {
        win.localStorage.setItem('as.profile.v4', JSON.stringify(student.persisted));
      }
      win.fetch = (path, opts) => {
        const method = (opts && opts.method) || 'GET';
        calls.push({ path: String(path), method, body: opts && opts.body });
        if (String(path).includes('/profile/patch')) {
          const patch = onPatch && onPatch(JSON.parse(opts.body));
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, saved: true, profile: patch || student.profile }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, ...student }) });
      };
    },
  });
  return dom;
}

test('session: a year is sent as-is, the "not decided" label clears the field', async () => {
  const calls = [];
  const student = { publicId: 'AH-E1', email: 'e@example.com', profile: baseProfile, avatar: { present: false } };
  const dom = mount({ student, calls });
  const win = dom.window;
  await new Promise((r) => setTimeout(r, 80));
  calls.length = 0;

  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'session', value: '2026' },
  }));
  await new Promise((r) => setTimeout(r, 40));
  const patches = calls.filter((c) => c.path.includes('/profile/patch'));
  assert.deepEqual(JSON.parse(patches[0].body).fields, { admissionSession: '2026' });

  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'session', value: 'এখনো ঠিক করিনি' },
  }));
  await new Promise((r) => setTimeout(r, 40));
  const patches2 = calls.filter((c) => c.path.includes('/profile/patch'));
  assert.deepEqual(JSON.parse(patches2[1].body).fields, { admissionSession: '' });
  dom.window.close();
});

test('targets: bare names are converted to the backend object shape', async () => {
  const calls = [];
  const student = { publicId: 'AH-F1', email: 'f@example.com', profile: baseProfile, avatar: { present: false } };
  const dom = mount({ student, calls });
  const win = dom.window;
  await new Promise((r) => setTimeout(r, 80));
  calls.length = 0;

  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'targets', value: ['ঢাকা বিশ্ববিদ্যালয়', 'BUET'] },
  }));
  await new Promise((r) => setTimeout(r, 40));
  const patches = calls.filter((c) => c.path.includes('/profile/patch'));
  assert.deepEqual(JSON.parse(patches[0].body).fields, {
    targets: [
      { name: 'ঢাকা বিশ্ববিদ্যালয়', unit: '', year: '' },
      { name: 'BUET', unit: '', year: '' },
    ],
  });
  dom.window.close();
});

test('avatar: a chosen photo is uploaded, base64 payload without the data: prefix', async () => {
  const calls = [];
  const photo = 'data:image/jpeg;base64,' + Buffer.from('hello-avatar').toString('base64');
  const student = {
    publicId: 'AH-G1', email: 'g@example.com', profile: baseProfile,
    avatar: { present: true, updatedAt: 1234 },
  };
  const dom = mount({ student, calls });
  const win = dom.window;
  await new Promise((r) => setTimeout(r, 80));
  calls.length = 0;

  /* The real order: the design's commit() persists the crop to its own store and
     only then raises the action. */
  win.localStorage.setItem('as.profile.v4', JSON.stringify({ photo }));
  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'avatar', value: 0 },
  }));
  await new Promise((r) => setTimeout(r, 60));

  const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/profile/avatar'));
  assert.ok(post, 'the photo reached the avatar endpoint');
  const body = JSON.parse(post.body);
  assert.equal(body.mime, 'image/jpeg');
  assert.equal(body.data, Buffer.from('hello-avatar').toString('base64'));
  dom.window.close();
});

test('avatar: choosing a mascot colour with no photo deletes the stored avatar', async () => {
  const calls = [];
  const student = {
    publicId: 'AH-H1', email: 'h@example.com', profile: baseProfile,
    avatar: { present: false },
  };
  const dom = mount({ student, calls });
  const win = dom.window;
  await new Promise((r) => setTimeout(r, 80));
  calls.length = 0;

  win.localStorage.setItem('as.profile.v4', JSON.stringify({ photo: '' }));
  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'avatar', value: 2 },
  }));
  await new Promise((r) => setTimeout(r, 60));

  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/profile/avatar')));
  dom.window.close();
});

test('a refused save shows the student an error instead of a success toast', async () => {
  const calls = [];
  const student = { publicId: 'AH-I1', email: 'i@example.com', profile: baseProfile, avatar: { present: false } };
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = (path, opts) => {
        calls.push({ path: String(path), method: (opts && opts.method) || 'GET' });
        if (String(path).includes('/profile/patch')) {
          return Promise.resolve({
            ok: false, status: 400,
            json: () => Promise.resolve({ ok: false, error: { code: 'INVALID_INPUT', message: 'তথ্যটি সঠিক নয়' } }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, ...student }) });
      };
    },
  });
  const win = dom.window;
  await new Promise((r) => setTimeout(r, 80));

  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'name', value: 'ঠিক আছে' },
  }));
  await new Promise((r) => setTimeout(r, 60));

  const toast = win.document.getElementById('toast');
  assert.equal(toast.textContent, 'তথ্যটি সঠিক নয়');
  assert.ok(toast.classList.contains('on'), 'the error toast is visible');
  dom.window.close();
});

/* The patch validator REQUIRES mobile to match a phone pattern, so '' is
   rejected — but signup treats mobile as optional. A student who signed up
   without a number therefore had every save refused, and because the edit-all
   form sends the whole profile in one patch, one empty mobile silently lost
   every other edit with it. The adapter must omit the key instead. */
test('an empty mobile never poisons a single-field save', async () => {
  const calls = [];
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = (path, opts) => {
        calls.push({ path: String(path), method: (opts && opts.method) || 'GET', body: opts && opts.body });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, ...student }) });
      };
    },
  });
  const win = dom.window;
  await new Promise((r) => setTimeout(r, 80));

  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: { action: 'profile.update', field: 'mobile', value: '' },
  }));
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(calls.filter((c) => c.path.includes('/profile/patch')).length, 0,
    'no doomed patch is sent for an empty mobile');
  dom.window.close();
});

test('an empty mobile does not block a bulk save of the other fields', async () => {
  const calls = [];
  const dom = new JSDOM(PAGE, {
    url: 'https://admissionhub.pages.dev/profile-v2.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = (path, opts) => {
        calls.push({ path: String(path), method: (opts && opts.method) || 'GET', body: opts && opts.body });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, ...student }) });
      };
    },
  });
  const win = dom.window;
  await new Promise((r) => setTimeout(r, 80));

  win.document.dispatchEvent(new win.CustomEvent('app:action', {
    detail: {
      action: 'profile.save',
      profile: { name: 'রাশেল জায়ান', mobile: '', bio: 'ভালো ছেলে', dob: '', school: '', college: '', session: '', goal: '', targets: [], subjects: [] },
    },
  }));
  await new Promise((r) => setTimeout(r, 60));

  const patch = calls.filter((c) => c.path.includes('/profile/patch')).pop();
  assert.ok(patch, 'the bulk save still reaches the backend');
  const fields = JSON.parse(patch.body).fields;
  assert.equal(fields.fullName, 'রাশেল জায়ান');
  assert.equal(fields.bio, 'ভালো ছেলে');
  assert.ok(!('mobile' in fields), 'the empty mobile is omitted, not sent');
  dom.window.close();
});
