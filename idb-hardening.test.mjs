// IndexedDB crash-safety + fast-loading regression.
import { readFileSync } from 'node:fs';
let pass = 0, fail = 0;
const test = (name, ok) => { if (ok) { pass++; console.log('  ✓', name); } else { fail++; console.error('  ✗', name); } };
const H = readFileSync('index.html', 'utf8');
const SW = readFileSync('sw.js', 'utf8');
const CLOUD = readFileSync('cloud-content-sync.js', 'utf8');
const DP = readFileSync('data-protection.js', 'utf8');
const WF = readFileSync('.github/workflows/cf-pages.yml', 'utf8');

test('reopenDb is exposed for safe connection recovery', H.includes('function reopenDb()') && H.includes('window.__ahReopenDb = reopenDb'));
const versionAt = H.split('\n').findIndex(line => line.includes('DB.onversionchange='));
const versionBlock = H.split('\n').slice(versionAt, versionAt + 3).join(' ');
test('version changes reopen rather than showing a blocking recovery screen', versionBlock.includes('reopenDb()') && !versionBlock.includes('showStorageRecovery'));
test('database operations retry after stale/closing connections', H.includes('if(!DB||window.__ahDbStale){') && H.includes('reopenDb().then(()=>{ if(DB) attempt();'));
/* The console copy uses a comma since the shipped-copy typography pass
   (29a1ac7) rewrote interstitial dashes; match the wording, not the punctuation. */
test('failed persistent boot falls back to memory without deleting records',
  /Data load failed[,:—–-]? ?memory fallback/i.test(H) && H.includes('useMemoryStorage(err)') && !H.includes("deleteDatabase(DB_NAME)"));
test('batched cloud writes retry a closing database using the fresh connection', CLOUD.includes('window.__ahReopenDb') && CLOUD.includes('const liveDb = () =>') && /closing\|InvalidState\|not active\|connection/i.test(CLOUD));

const deferCount = (H.match(/<script defer src=/g) || []).length;
test('optional internal modules remain deferred', deferCount >= 40);
test('boot-critical local scripts remain parser-ordered', /src="\.\/session-persist\.js/.test(H) && /src="data-protection\.js/.test(H));
/* The 650KB analysis pack and the mock seed used to ride the boot path as
   `defer`, which still executes before the first paint. They are now fetched
   only when their screen needs them and warmed at idle, so the guard checks
   they are off the boot path AND still reachable through the lazy loader. */
test('heavy app seed and result analysis stay off the boot path but remain loadable',
  /app-seed\.js[^>]*defer/.test(H) &&
  !/<script[^>]*src="\.\/result-analysis-500\.js/.test(H) &&
  !/<script[^>]*src="\.\/one-time-mock-seed\.js/.test(H) &&
  /admissionLoadPack/.test(H) &&
  H.includes("'result-analysis-500'") &&
  H.includes("'one-time-mock-seed'") &&
  /result-analysis-500\.js\?v=/.test(H) &&
  /one-time-mock-seed\.js\?v=/.test(H));
// Guard the retired assets by name, not by substring: a bare onboarding\.js also
// matches the live welcome-onboarding.js, so the pattern is anchored on the
// path boundary to keep catching a real regression without flagging the current asset.
test('retired identity/onboarding scripts are no longer boot-critical or loaded', !/premium-auth|(?<![\w-])onboarding\.js|curriculum-config|accounts\.google\.com/.test(H));


test('service-worker build marker is synchronized',
  SW.includes("const BUILD_ID = 'v364-sky-goal'") &&
  H.includes("const expectedSwVersion = 'v364-sky-goal'") &&
  H.includes('admission-hub-shell-v364-sky-goal'));
test('data protection summarizes stores with count rather than full reads', DP.includes('tx.objectStore(name).count()'));
test('unprotected automatic Pages deploy stays retired', WF.includes('Cloudflare Pages Bundle Guard (No Deploy)') && !WF.includes('wrangler-action') && !WF.includes('pages deploy dist --project-name admissionhub'));

console.log(`\nIDB HARDENING: ${pass} pass / ${fail} fail`);
if (fail) process.exit(1);
