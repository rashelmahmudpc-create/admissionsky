import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync('index.html','utf8');
const auth=readFileSync('account-access.js','utf8');
test('startup runtime occurs at the real document end, never inside inline strings',()=>{
 const at=html.indexOf('<script id="ah-idle-features">');
 assert.ok(at>html.lastIndexOf('<script>'));
 assert.equal((html.match(/id="ah-idle-features"/g)||[]).length,1);
 const code=html.slice(at).match(/^<script[^>]*>([\s\S]*?)<\/script>/)[1];
 new vm.Script(code);
 assert.ok(html.slice(at).trim().endsWith('</html>'));
});
test('optional feature scripts do not block initial parsing, order preserved',()=>{
 const tags=[...html.matchAll(/<script type="application\/x-ah-idle" data-ah-src="([^"]+)"><\/script>/g)].map(x=>x[1]);
 assert.equal(tags.length,22);
 assert.ok(tags.findIndex(x=>x.includes('sky-faq.js'))<tags.findIndex(x=>x.includes('ai-agent-chat')));
 assert.ok(tags.findIndex(x=>x.includes('experience-studio-store'))<tags.findIndex(x=>x.includes('experience-studio-shell')));
 assert.ok(tags.findIndex(x=>x.includes('notification-hub'))<tags.findIndex(x=>x.includes('notification-fcm')));
 assert.match(html,/await window\.__admissionBootPromise/);
 assert.match(html,/requestAnimationFrame\(\(\)=>requestAnimationFrame\(r\)\)/);
});
test('welcome loader is prioritized and logged-in gate still requires verified server session',()=>{
 assert.ok(html.indexOf('src="./app-seed.js')<html.indexOf('src="./dashboard-v2.js'));
 assert.match(auth,/const sessionReady = refreshSession\(\)\.then\(session =>/);
 assert.match(auth,/if \(accountVerified\(session\) && pageHost.hidden\)/);
 assert.match(auth,/session\?\.authenticated && \(session\?\.accountVerified/);
 assert.match(html,/account-access\.js\?v=20261018-allowlist-v1&startup=fast1/);
});
test('empty account host does not dismiss loading and warm packs wait until after load',()=>{
 assert.match(html,/el\.innerText\|\|''\)\.trim\(\)\.length>20/);
 assert.match(html,/window\.addEventListener\('load',queueWarmPacks,\{once:true\}\)/);
 assert.match(html,/document\.querySelector\('#app \.dv3-frame'\)/);
});
