/* Build-time frontend cache refresh. Never writes backend sources or deploys a Worker. */
import {readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(process.argv[2]||'dist');
/* The welcome version comes from app-seed.js (the file that actually loads sky-onboarding), so the
   deployed ?v= tokens can never fall behind the source again (a pinned v6 here shipped stale assets). */
/* The version token can carry extra segments between the date and the final
   -vN (e.g. sky-flow-20261116-inv-v14, added with the invisible human check).
   The old /sky-flow-\d{8}-v\d+/ matched only the two-part form, so once the
   infix appeared the welcome build threw 'app-seed.js sky-flow version
   missing' and Deploy Profile V2 failed on every push. Accept any run of
   [a-z0-9-] segments after the date, still ending in -vN. */
const version=(readFileSync(join(root,'app-seed.js'),'utf8').match(/sky-flow-\d{8}(?:-[a-z0-9]+)*-v\d+/)||[])[0];
if(!version)throw Error('app-seed.js sky-flow version missing');
const release=(process.env.GITHUB_SHA||'local-preview').slice(0,12);
const buildId=`welcome-${release}`;
const indexPath=join(root,'index.html');
let html=readFileSync(indexPath,'utf8');
const matches=html.match(/app-seed\.js\?v=[^"']+/g)||[];
if(matches.length!==1)throw Error('Expected exactly one existing app-seed loader');
html=html.replace(matches[0],`app-seed.js?v=${version}`);
/* Keep preload versions in step with the loader to prevent duplicate downloads. */
html=html.replace(/sky-onboarding\.(css|js)\?v=[^"']+/g,(m,ext)=>`sky-onboarding.${ext}?v=${version}`);
if((html.match(/sky-onboarding\.(css|js)\?v=/g)||[]).length<2)throw Error('Expected the welcome preload hints in index.html');
// The page must retain the actual DEPLOYED shell cache, not a source-only ID.
// Otherwise every reopen deletes the very cache installed by this release.
const expected=/const expectedSwVersion = '[^']*';/;
const cache=/const cur = 'admission-hub-shell-[^']*';/;
if(!expected.test(html)||!cache.test(html))throw Error('Cache version contract missing');
html=html.replace(expected,`const expectedSwVersion = '${buildId}';`)
 .replace(cache,`const cur = 'admission-hub-shell-${buildId}';`);
writeFileSync(indexPath,html);
const swPath=join(root,'sw.js');
let sw=readFileSync(swPath,'utf8');
sw=sw.replace(/const BUILD_ID = '[^']*';/,`const BUILD_ID = '${buildId}';`);
const additions=['app-seed.js','sky-onboarding.css','sky-onboarding.js'];
sw=sw.replace('const APP_SHELL = [','const APP_SHELL = [\n'+additions.map(path=>`  './${path}?v=${version}',`).join('\n'));
writeFileSync(swPath,sw);
const result=spawnSync(process.execPath,[join(root,'scripts/sw-manifest.mjs')],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
console.log(`Admission Sky frontend build: versioned welcome and matching ${buildId} offline cache.`);
