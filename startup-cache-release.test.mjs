import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const build=readFileSync('scripts/build-welcome-pages.mjs','utf8');
test('deployed HTML and service worker use the same build identifier',()=>{
 assert.match(build,/const buildId=`welcome-\$\{release\}`/);
 assert.ok(build.includes("const expectedSwVersion = '${buildId}';"));
 assert.ok(build.includes("const cur = 'admission-hub-shell-${buildId}';"));
 assert.ok(build.includes("const BUILD_ID = '${buildId}';"));
 assert.ok(build.includes('Cache version contract missing'));
});

test('the welcome version token survives extra segments (sky-flow-<date>-<infix>-vN)', () => {
 // The old /sky-flow-\\d{8}-v\\d+/ matched only the two-part form. Once the
 // token gained an infix (sky-flow-20261116-inv-v14, added with the invisible
 // human check) the build threw 'app-seed.js sky-flow version missing' and
 // Deploy Profile V2 failed on every push. The regex must accept the infix.
 const m = build.match(/match\(\/(sky-flow[^/]+)\/\)/);
 assert.ok(m, 'the build still extracts the sky-flow version with a regex');
 const re = new RegExp(m[1]);
 assert.equal('sky-flow-20261116-inv-v14'.match(re)?.[0], 'sky-flow-20261116-inv-v14',
   'a token with an infix segment is matched whole');
 assert.equal('sky-flow-20261018-v12'.match(re)?.[0], 'sky-flow-20261018-v12',
   'the original two-part token still matches');
});
