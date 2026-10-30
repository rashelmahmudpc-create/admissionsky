/* CF-001 (2026-10-30 audit): run the Cloudflare inventory drift check.
 * Exit 0 when every live resource is tracked or waived, 1 on drift, and 2 when
 * credentials are missing so a silent pass is impossible. Never mutates. */
import { readFileSync } from 'node:fs';
import { liveInventory, diffInventory, formatDrift } from '../cloudflare-drift.mjs';

const token = process.env.CLOUDFLARE_API_TOKEN || '';
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
if (!token || !accountId) {
  console.error('CF-001: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID missing; cannot verify the inventory.');
  process.exit(2);
}

const inventory = JSON.parse(readFileSync(new URL('../.github/cloudflare-inventory.json', import.meta.url), 'utf8'));
const live = await liveInventory({ token, accountId });
const drift = diffInventory(inventory, live);

console.log(`live: ${live.workers.length} workers, ${live.pages_projects.length} pages projects`);
if (drift.length) {
  console.error('::error title=Cloudflare drift::resources exist that the committed inventory does not cover (CF-001).');
  console.error(formatDrift(drift));
  process.exit(1);
}
console.log('no drift: every live resource is tracked or explicitly waived.');
