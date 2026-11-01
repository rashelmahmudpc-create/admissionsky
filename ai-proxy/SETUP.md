# Admission Sky AI Proxy

This Worker is a server-side proxy for the Result Analysis button. It keeps the Browser Use API key outside the GitHub Pages frontend.

## Required configuration

1. Create a Cloudflare Worker named `admission-hub-ai-proxy`.
2. Upload `worker.js` and use `wrangler.toml.example` as the configuration template.
3. Create a KV namespace and set its production ID in the configuration. The KV binding is required for the one-request-per-day guard.
4. Set the secret without committing it:

```bash
wrangler secret put BROWSER_USE_API_KEY
```

Paste the Browser Use key only into the secure secret prompt. Never put it in `index.html`, `result-ai-analysis.js`, this repository, a screenshot, or chat.

5. Deploy the Worker and note its HTTPS URL. The frontend endpoint must be the URL ending in `/analyze`.
6. Configure the frontend endpoint through a deployment-specific non-secret setting:

```js
window.ADMISSION_HUB_AI_ENDPOINT = 'https://YOUR-WORKER.workers.dev/analyze';
```

The endpoint URL is not the secret; the Browser Use key remains only in the Worker secret store.

## Test flow

First call `GET /health`. Then run one small analysis from a real Result page. The Worker creates a Browser Use V4 run, returns a `runId`, polls `/runs/{id}/status` until terminal, then fetches `/runs/{id}` once for the final result. The frontend caches the completed response per result.

The Worker rejects oversized payloads, rejects requests from origins other than the configured GitHub Pages origin, requires the KV quota binding, and limits each client IP to one analysis request per UTC day. Keep the first test to one request so the Browser Use balance can be checked.

## Important limitation

Browser Use V4 is a hosted Agent API. It can produce the narrative analysis, but it may be slower and more expensive than a direct text model API. The app does not embed a Browser Use agent UI; it only calls the secure proxy when the user presses the Analysis button.
