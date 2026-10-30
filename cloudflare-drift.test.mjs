/* CF-001 (2026-10-30): the drift check must catch an untracked resource and
 * must not fire on one that is tracked or waived. Both directions are tested so
 * a green run means the diff really looked, not that it was empty. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { liveInventory, diffInventory, formatDrift } from './cloudflare-drift.mjs';

const ok = (result) => ({ ok: true, status: 200, json: async () => ({ success: true, result }) });

const fetchImpl = (workers, pages) => async (url) => {
  const u = String(url);
  if (u.endsWith('/workers/scripts')) return ok(workers);
  if (u.endsWith('/pages/projects')) return ok(pages);
  throw new Error(`Unexpected request: ${u}`);
};

const INVENTORY = {
  workers: { tracked: ['admission-gk'], waived: [{ name: 'mail-vault', reason: 'x' }] },
  pages_projects: { tracked: ['admissionhub'], waived: [] },
};

test('liveInventory reads worker ids and page names', async () => {
  const live = await liveInventory({
    token: 't', accountId: 'acct',
    fetchImpl: fetchImpl([{ id: 'admission-gk' }, { id: 'mesh-chat' }], [{ name: 'admissionhub' }]),
  });
  assert.deepEqual(live.workers, ['admission-gk', 'mesh-chat']);
  assert.deepEqual(live.pages_projects, ['admissionhub']);
});

test('an untracked worker or page is drift', async () => {
  const live = await liveInventory({
    token: 't', accountId: 'acct',
    fetchImpl: fetchImpl([{ id: 'admission-gk' }, { id: 'mesh-chat' }], [{ name: 'admissionhub' }, { name: 'ghost-pages' }]),
  });
  const drift = diffInventory(INVENTORY, live);
  assert.deepEqual(drift, [
    { kind: 'workers', name: 'mesh-chat' },
    { kind: 'pages_projects', name: 'ghost-pages' },
  ]);
  assert.match(formatDrift(drift), /mesh-chat/);
});

test('tracked and waived resources are not drift (the check is not vacuous)', async () => {
  const live = await liveInventory({
    token: 't', accountId: 'acct',
    fetchImpl: fetchImpl([{ id: 'admission-gk' }, { id: 'mail-vault' }], [{ name: 'admissionhub' }]),
  });
  assert.deepEqual(diffInventory(INVENTORY, live), []);
});

test('a Cloudflare API error is raised, never silently read as "no drift"', async () => {
  await assert.rejects(
    () => liveInventory({ token: 't', accountId: 'acct', fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ success: false, errors: [{ message: 'no access' }] }) }) }),
    /no access/,
  );
});

test('the committed inventory covers every resource the audit named', () => {
  const inv = JSON.parse(readFileSync(new URL('./.github/cloudflare-inventory.json', import.meta.url), 'utf8'));
  const waived = new Set(inv.workers.waived.map((w) => w.name));
  for (const w of ['ah-public', 'ah-admin', 'sky-control', 'oh-bot-guard', 'openclaw-keepalive', 'mesh-chat', 'opencode-bot-keepalive', 'study-pal']) {
    assert.ok(waived.has(w), `${w} must be recorded in the inventory so the drift check stays meaningful`);
  }
  const tracked = new Set(inv.workers.tracked);
  for (const w of ['admission-gk', 'admission-gk-staging', 'admission-auth', 'admission-voice', 'admission-notify', 'admission-hub-ai-proxy', 'sky-ai']) {
    assert.ok(tracked.has(w), `${w} is deployed by a workflow and must stay tracked`);
  }
  // Retired on 2026-10-30 by owner order. study-pal is deliberately NOT here: it
  // was retired by mistake and restored the same day, so it must stay listed.
  const retired = new Set([...inv.workers.tracked, ...waived]);
  for (const w of ['otp-tester', 'mail-vault', 'permission-test']) {
    assert.ok(!retired.has(w), `${w} was retired and must not remain in the inventory`);
  }
  const waivedPages = new Set(inv.pages_projects.waived.map((p) => p.name));
  assert.ok(waivedPages.has('rashel-study-hub'), 'rashel-study-hub was explicitly kept by the owner');
  const allPages = new Set([...inv.pages_projects.tracked, ...waivedPages]);
  for (const p of ['sky-control-preview', 'admission-hub-ai']) {
    assert.ok(!allPages.has(p), `${p} was retired and must not remain in the inventory`);
  }
});
