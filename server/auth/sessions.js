import { createHash, randomBytes } from "crypto";

// App login sessions (SQLite). Only a SHA-256 hash of the cookie token is stored,
// so a copy of qc.db cannot be replayed as a login.

export const SESSION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function createSessionStore(
  db,
  { now = () => Date.now(), sessionDays = SESSION_DAYS } = {},
) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_sessions (
      token_hash TEXT PRIMARY KEY,
      uid INTEGER NOT NULL,
      login TEXT NOT NULL,
      name TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_checked_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_sessions_expires ON app_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_app_sessions_uid ON app_sessions(uid);
  `);

  const insert = db.prepare(`
    INSERT INTO app_sessions (token_hash, uid, login, name, user_agent, created_at, expires_at, last_checked_at)
    VALUES (@token_hash, @uid, @login, @name, @user_agent, @created_at, @expires_at, @last_checked_at)
  `);
  const selectByHash = db.prepare(
    "SELECT * FROM app_sessions WHERE token_hash = ?",
  );
  const deleteByHash = db.prepare(
    "DELETE FROM app_sessions WHERE token_hash = ?",
  );
  const deleteByUid = db.prepare("DELETE FROM app_sessions WHERE uid = ?");
  const deleteExpired = db.prepare(
    "DELETE FROM app_sessions WHERE expires_at <= ?",
  );
  const touchChecked = db.prepare(
    "UPDATE app_sessions SET last_checked_at = ? WHERE token_hash = ?",
  );

  return {
    maxAgeMs: sessionDays * DAY_MS,

    create({ uid, login, name, userAgent }) {
      const token = randomBytes(32).toString("base64url");
      const createdAt = now();
      insert.run({
        token_hash: hashToken(token),
        uid,
        login,
        name: name || null,
        user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
        created_at: createdAt,
        expires_at: createdAt + sessionDays * DAY_MS,
        last_checked_at: createdAt,
      });
      return token;
    },

    // Returns the session row, or null when missing/expired.
    get(token) {
      if (!token) return null;
      const row = selectByHash.get(hashToken(token));
      if (!row) return null;
      if (row.expires_at <= now()) {
        deleteByHash.run(row.token_hash);
        return null;
      }
      return row;
    },

    needsRecheck(row, intervalMs = DAY_MS) {
      return now() - row.last_checked_at >= intervalMs;
    },

    markChecked(row) {
      touchChecked.run(now(), row.token_hash);
    },

    destroy(token) {
      if (token) deleteByHash.run(hashToken(token));
    },

    destroyAllForUid(uid) {
      deleteByUid.run(uid);
    },

    purgeExpired() {
      return deleteExpired.run(now()).changes;
    },
  };
}
