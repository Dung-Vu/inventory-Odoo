import express from "express";
import { randomBytes } from "crypto";
import { OdooLoginError } from "./odoo-web-login.js";

// Odoo-account login for the whole app.
// - Only internal Odoo users (share = false, active) with 2FA enabled can log in.
// - App session lasts SESSION_DAYS (cookie `lb_session`); the user is re-checked
//   against Odoo once a day so archived accounts lose access.

export const SESSION_COOKIE = "lb_session";
export const PENDING_COOKIE = "lb_login_pending";

const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_TOTP_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGINS_PER_WINDOW = 10;

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) {
      const key = part.slice(0, eq).trim();
      try {
        cookies[key] = decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        cookies[key] = part.slice(eq + 1).trim();
      }
    }
  }
  return cookies;
}

// Static build assets (JS/CSS/fonts/images) stay public so the login page can render.
export function isPublicRequest(req) {
  const path = req.path;
  if (path === "/health" || path === "/login") return true;
  if (path.startsWith("/api/auth/")) return true;
  if (path.startsWith("/api/")) return false;
  return (
    req.method === "GET" &&
    /\.[a-z0-9]+$/i.test(path) &&
    !/\.html?$/i.test(path)
  );
}

const isInternalUser = (user) => Boolean(user && user.active && !user.share);

export function createAuth({
  sessions,
  webLogin,
  getUser,
  now = () => Date.now(),
}) {
  const pending = new Map(); // id → { jar, login, createdAt, attempts }
  const loginAttempts = new Map(); // ip → [timestamps]

  function cookieOptions(req, maxAge) {
    return {
      httpOnly: true,
      sameSite: "lax",
      secure: Boolean(req.secure),
      path: "/",
      maxAge,
    };
  }

  function cleanupPending() {
    for (const [id, entry] of pending) {
      if (now() - entry.createdAt > PENDING_TTL_MS) pending.delete(id);
    }
  }

  function tooManyLogins(ip) {
    const recent = (loginAttempts.get(ip) || []).filter(
      (t) => now() - t < LOGIN_WINDOW_MS,
    );
    recent.push(now());
    loginAttempts.set(ip, recent);
    return recent.length > MAX_LOGINS_PER_WINDOW;
  }

  function sendOdooError(res, error) {
    if (!(error instanceof OdooLoginError)) {
      console.error("[Auth] unexpected error:", error.message);
      return res
        .status(502)
        .json({
          error: "Không kết nối được Odoo, vui lòng thử lại sau.",
          code: "odoo_error",
        });
    }
    const status =
      {
        invalid_credentials: 401,
        invalid_totp: 401,
        session_expired: 401,
        cooldown: 429,
        rate_limited: 429,
      }[error.code] || 502;
    return res.status(status).json({ error: error.message, code: error.code });
  }

  const router = express.Router();

  router.post("/login", async (req, res) => {
    const login =
      typeof req.body?.login === "string" ? req.body.login.trim() : "";
    const password =
      typeof req.body?.password === "string" ? req.body.password : "";
    if (!login || !password || login.length > 200 || password.length > 500) {
      return res
        .status(400)
        .json({
          error: "Vui lòng nhập email và mật khẩu Odoo.",
          code: "invalid_input",
        });
    }
    if (tooManyLogins(req.ip)) {
      return res
        .status(429)
        .json({
          error: "Thử đăng nhập quá nhiều lần, vui lòng chờ 15 phút.",
          code: "too_many_attempts",
        });
    }

    try {
      const result = await webLogin.startLogin(login, password);
      if (!result.mfaRequired) {
        return res.status(403).json({
          error:
            "Tài khoản này chưa bật xác thực 2 lớp (2FA) trên Odoo. Vào Odoo → ảnh đại diện → Hồ sơ của tôi → Bảo mật tài khoản → bật Xác thực hai yếu tố, rồi đăng nhập lại.",
          code: "totp_not_enabled",
        });
      }

      cleanupPending();
      const id = randomBytes(24).toString("base64url");
      pending.set(id, {
        jar: result.jar,
        login,
        createdAt: now(),
        attempts: 0,
      });
      res.cookie(PENDING_COOKIE, id, cookieOptions(req, PENDING_TTL_MS));
      return res.json({ step: "totp" });
    } catch (error) {
      return sendOdooError(res, error);
    }
  });

  router.post("/totp", async (req, res) => {
    const id = parseCookies(req.headers.cookie)[PENDING_COOKIE];
    const entry = id && pending.get(id);
    if (!entry || now() - entry.createdAt > PENDING_TTL_MS) {
      if (id) pending.delete(id);
      return res
        .status(401)
        .json({
          error: "Phiên đăng nhập đã hết hạn, vui lòng nhập lại mật khẩu.",
          code: "pending_expired",
        });
    }

    const code = String(req.body?.code || "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) {
      return res
        .status(400)
        .json({ error: "Mã xác thực gồm 6 chữ số.", code: "invalid_input" });
    }

    entry.attempts += 1;
    if (entry.attempts > MAX_TOTP_ATTEMPTS) {
      pending.delete(id);
      res.clearCookie(PENDING_COOKIE, { path: "/" });
      return res
        .status(429)
        .json({
          error: "Nhập sai mã quá nhiều lần, vui lòng đăng nhập lại.",
          code: "too_many_attempts",
        });
    }

    try {
      const uid = await webLogin.verifyTotp(entry.jar, code);
      pending.delete(id);
      res.clearCookie(PENDING_COOKIE, { path: "/" });

      const user = await getUser(uid);
      if (!isInternalUser(user)) {
        return res
          .status(403)
          .json({
            error: "Chỉ nhân viên nội bộ mới được dùng hệ thống này.",
            code: "not_internal",
          });
      }

      const token = sessions.create({
        uid,
        login: user.login,
        name: user.name,
        userAgent: req.headers["user-agent"],
      });
      res.cookie(SESSION_COOKIE, token, cookieOptions(req, sessions.maxAgeMs));
      console.log(`[Auth] login ok uid=${uid}`);
      return res.json({ user: { name: user.name, login: user.login } });
    } catch (error) {
      if (error instanceof OdooLoginError && error.code !== "invalid_totp")
        pending.delete(id);
      return sendOdooError(res, error);
    }
  });

  router.get("/me", (req, res) => {
    const row = sessions.get(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    if (!row)
      return res
        .status(401)
        .json({ error: "Chưa đăng nhập", code: "auth_required" });
    return res.json({
      user: { name: row.name, login: row.login },
      expiresAt: row.expires_at,
    });
  });

  router.post("/logout", (req, res) => {
    sessions.destroy(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return res.json({ ok: true });
  });

  async function gate(req, res, next) {
    if (isPublicRequest(req)) return next();

    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const row = sessions.get(token);

    if (row && sessions.needsRecheck(row)) {
      try {
        const user = await getUser(row.uid);
        if (!isInternalUser(user)) {
          sessions.destroyAllForUid(row.uid);
          console.log(
            `[Auth] uid=${row.uid} no longer active internal user, sessions revoked`,
          );
          return deny(req, res);
        }
        sessions.markChecked(row);
      } catch (error) {
        // Odoo unreachable: keep the user in, retry the check on the next request.
        console.warn("[Auth] daily user check skipped:", error.message);
      }
    }

    if (!row) return deny(req, res);
    req.user = { uid: row.uid, login: row.login, name: row.name };
    return next();
  }

  function deny(req, res) {
    if (req.path.startsWith("/api/")) {
      return res
        .status(401)
        .json({
          error: "Cần đăng nhập để sử dụng hệ thống",
          code: "auth_required",
        });
    }
    return res.redirect(
      302,
      `/login?next=${encodeURIComponent(req.originalUrl)}`,
    );
  }

  return { router, gate };
}
