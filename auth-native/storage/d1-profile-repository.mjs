// Phase 7, Avatar storage on Cloudflare D1 (blueprint §9, §11).
// Provider-agnostic interface: the engine only sees AvatarStore
// (save/getMeta/get/delete). Swapping to R2/MinIO later = a new
// implementation of the same interface + one-time blob copy; no
// API/UI change.
//
// Security model:
// - Object keys are server-derived (userId + validated extension only).
//   Client filenames are never trusted or stored (blueprint §11).
// - No public bucket access; reads flow through the authenticated API.
// - Max 1 row per user (primary key), replace = overwrite.

const TABLE = `CREATE TABLE IF NOT EXISTS avatars (
  user_id TEXT PRIMARY KEY,
  data BLOB NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

export class D1ProfileStore {
  #ready = false;

  constructor(d1) {
    this.d1 = d1 || null;
  }

  available() {
    return Boolean(this.d1);
  }

  async #ensureTable() {
    if (this.#ready) return;
    await this.d1.prepare(TABLE).run();
    this.#ready = true;
  }

  async saveAvatar({ userId, data, mime, now }) {
    await this.#ensureTable();
    const bytes = new Uint8Array(data);
    await this.d1.prepare(
      `INSERT INTO avatars(user_id,data,mime,bytes,updated_at) VALUES(?,?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,mime=excluded.mime,bytes=excluded.bytes,updated_at=excluded.updated_at`
    ).bind(userId, bytes, mime, bytes.byteLength, now).run();
    return { saved: true, mime, bytes: bytes.byteLength, updatedAt: now };
  }

  async getAvatarMeta(userId) {
    await this.#ensureTable();
    const row = await this.d1
      .prepare('SELECT mime,bytes,updated_at FROM avatars WHERE user_id=?')
      .bind(userId)
      .first();
    if (!row) return { present: false };
    return { present: true, mime: row.mime, bytes: Number(row.bytes), updatedAt: Number(row.updated_at) };
  }

  async getAvatar(userId) {
    await this.#ensureTable();
    const row = await this.d1
      .prepare('SELECT data,mime,bytes,updated_at FROM avatars WHERE user_id=?')
      .bind(userId)
      .first();
    if (!row) return { present: false };
    return {
      present: true,
      data: row.data,
      mime: row.mime,
      bytes: Number(row.bytes),
      updatedAt: Number(row.updated_at)
    };
  }

  async deleteAvatar(userId) {
    await this.#ensureTable();
    await this.d1.prepare('DELETE FROM avatars WHERE user_id=?').bind(userId).run();
    return { deleted: true };
  }
}

// Deterministic default avatar (blueprint §10, zero-raster owner rule):
// initials + hue derived from the user id. Pure function, no storage.
export function defaultAvatarSpec(userId) {
  let hash = 0;
  const value = String(userId || '');
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const letters = Array.from(String(value || '?').replace(/[^a-zA-Z0-9]/g, ' ').trim().split(/\s+/))
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase());
  return {
    kind: 'generated-svg',
    initials: letters.join('') || 'A',
    hue,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="46" fill="hsl(${hue},45%,88%)"/><circle cx="48" cy="48" r="46" fill="none" stroke="hsl(${hue},40%,60%)" stroke-width="2"/><text x="48" y="60" font-family="system-ui,-apple-system,sans-serif" font-size="38" font-weight="700" text-anchor="middle" fill="hsl(${hue},45%,32%)">${escapeSvg(letters.join('') || 'A')}</text></svg>`
  };
}

function escapeSvg(value) {
  return String(value).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[char]));
}
