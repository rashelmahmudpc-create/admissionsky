/* Admission Hub, P13 API compression.
 *
 * Large JSON replies travel gzipped when the client asks for it. The decision
 * is separated from the compression so it is testable, and compression itself
 * uses the platform CompressionStream (no dependency, no bundle weight).
 */
export const MIN_COMPRESS_BYTES = 1024;

/* Compress only when it is both wanted and worth it: a tiny body gains nothing
   and costs CPU on every request. */
export function shouldCompress({ acceptEncoding = '', method = 'GET', length = 0, status = 200 } = {}) {
  if (method === 'HEAD' || status < 200 || status >= 300) return false;
  if (!/\bbr\b|\bgzip\b/.test(String(acceptEncoding))) return false;
  return Number(length) >= MIN_COMPRESS_BYTES;
}

export function preferEncoding(acceptEncoding = '') {
  if (/\bbr\b/.test(String(acceptEncoding))) return 'br';
  if (/\bgzip\b/.test(String(acceptEncoding))) return 'gzip';
  return null;
}

/* Returns a compressed Response (or the original when the platform stream is
   unavailable, e.g. an older runtime). Never throws on a compression failure -
   an uncompressed 200 beats a 500. */
export async function compressResponse(request, response, threshold = MIN_COMPRESS_BYTES) {
  try {
    const acceptEncoding = request && request.headers ? (request.headers.get('Accept-Encoding') || '') : '';
    if (typeof CompressionStream !== 'function') return response;
    const buf = await response.clone().arrayBuffer();
    if (!shouldCompress({ acceptEncoding, method: request.method, length: buf.byteLength, status: response.status })) return response;
    const encoding = preferEncoding(acceptEncoding);
    const stream = new Blob([buf]).stream().pipeThrough(new CompressionStream(encoding === 'br' ? 'deflate' : 'gzip'));
    const body = await new Response(stream).arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set('Content-Encoding', encoding === 'br' ? 'deflate' : 'gzip');
    headers.set('Vary', 'Accept-Encoding');
    headers.set('Content-Length', String(body.byteLength));
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  } catch (_) {
    return response;
  }
}
