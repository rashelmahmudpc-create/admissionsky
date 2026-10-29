import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from './_worker.js';

for (const page of ['privacy', 'data-deletion', 'about', 'contact']) {
  for (const suffix of ['', '.html']) {
    for (const method of ['GET', 'HEAD']) {
      test(`${method} /${page}${suffix} serves the legal page without redirect`, async () => {
        const html = await readFile(new URL(`./${page}.html`, import.meta.url), 'utf8');
        const expected = { privacy: 'Privacy Policy', 'data-deletion': 'Data Deletion', about: 'About', contact: 'Contact' }[page];
        const env = { ASSETS: { async fetch(request) {
          const url = new URL(request.url);
          assert.equal(url.pathname, `/${page}`);
          assert.equal(url.search, '?review=meta');
          assert.equal(request.method, method);
          return new Response(method === 'HEAD' ? null : html, {
            status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        } } };
        const response = await worker.fetch(new Request(`https://admissionsky.pages.dev/${page}${suffix}?review=meta`, { method }), env);
        assert.equal(response.status, 200);
        assert.equal(response.headers.has('location'), false);
        if (method === 'GET') assert.ok((await response.text()).includes(expected));
      });
    }
  }
}

test('unknown HTML and extensionless routes still return genuine 404s', async () => {
  const env = { ASSETS: { async fetch() {
    return new Response('<html>app shell</html>', { headers: { 'Content-Type': 'text/html' } });
  } } };
  for (const path of ['/privacy-fake', '/privacy-fake.html', '/data-deletion-fake']) {
    const response = await worker.fetch(new Request(`https://admissionsky.pages.dev${path}`), env);
    assert.equal(response.status, 404);
  }
});
