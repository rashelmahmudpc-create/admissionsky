/* CF-001 (2026-10-30 audit): the Cloudflare account holds 19 Workers and 5 Pages
 * projects, but wrangler.toml defines only the admission-gk family. Untracked
 * resources get no secret rotation, no dependency updates and no review, and the
 * audit found two Workers modified the same day they were discovered.
 *
 * This module turns that into a check: it reads the live resource list and diffs
 * it against the committed inventory (.github/cloudflare-inventory.json). A
 * resource that is neither tracked nor explicitly waived is drift and is
 * reported. It never deletes or modifies anything — retiring a resource is an
 * owner decision (CF-001), so the job only reports.
 *
 * The Cloudflare calls are injected (fetchImpl) so the diff logic is testable
 * without network access or credentials.
 */

export const CF_API = 'https://api.cloudflare.com/client/v4';

async function cfGet(fetchImpl, token, path) {
  const res = await fetchImpl(`${CF_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    const detail = (body.errors || []).map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare GET ${path} failed: ${detail}`);
  }
  return body.result;
}

export async function liveInventory({ token, accountId, fetchImpl = fetch }) {
  const workers = await cfGet(fetchImpl, token, `/accounts/${accountId}/workers/scripts`);
  const pages = await cfGet(fetchImpl, token, `/accounts/${accountId}/pages/projects`);
  return {
    workers: (workers || []).map((w) => w.id || w.name).filter(Boolean).sort(),
    pages_projects: (pages || []).map((p) => p.name).filter(Boolean).sort(),
  };
}

const known = (inventory, kind) => new Set([
  ...(inventory[kind]?.tracked || []),
  ...(inventory[kind]?.waived || []).map((w) => w.name),
]);

export function diffInventory(inventory, live) {
  const drift = [];
  for (const kind of ['workers', 'pages_projects']) {
    const allowed = known(inventory, kind);
    for (const name of live[kind] || []) {
      if (!allowed.has(name)) drift.push({ kind, name });
    }
  }
  return drift;
}

export function formatDrift(drift) {
  return drift
    .map(({ kind, name }) => `  - ${kind}: ${name}`)
    .join('\n');
}
