// Verifies an Odoo user's password + 2FA code by replaying the standard Odoo 19
// web login flow server-side:
//   1. POST /web/session/authenticate  → {uid: null} when 2FA is pending
//   2. GET  /web/login/totp            → csrf_token for the 2FA form
//   3. POST /web/login/totp            → redirect when the code is accepted
//   4. /web/session/get_session_info   → confirm uid, then log the Odoo session out
// The Odoo session only lives for the duration of the login and is never stored.

export class OdooLoginError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function odooBaseUrl(odooUrl) {
  return String(odooUrl || "")
    .replace(/\/jsonrpc\/?$/, "")
    .replace(/\/$/, "");
}

// Minimal cookie jar: Odoo only needs `session_id` between steps.
export function createCookieJar() {
  const cookies = {};
  return {
    store(response) {
      const raw =
        typeof response.headers.getSetCookie === "function"
          ? response.headers.getSetCookie()
          : [response.headers.get("set-cookie")].filter(Boolean);
      for (const line of raw) {
        const [pair] = line.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0)
          cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
      }
    },
    header() {
      return Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    },
  };
}

function mapAuthError(error) {
  const message = error?.data?.message || error?.message || "";
  if (/too many login failures|cooldown/i.test(message)) {
    return new OdooLoginError(
      "cooldown",
      "Đăng nhập sai quá nhiều lần, vui lòng chờ 1 phút rồi thử lại.",
    );
  }
  if (
    /AccessDenied|access denied|wrong login|password/i.test(
      `${error?.data?.name || ""} ${message}`,
    )
  ) {
    return new OdooLoginError(
      "invalid_credentials",
      "Sai email hoặc mật khẩu Odoo.",
    );
  }
  return new OdooLoginError(
    "odoo_error",
    "Odoo không phản hồi đúng, vui lòng thử lại sau.",
  );
}

function extractCsrf(html) {
  return html.match(/name="csrf_token"\s+value="([^"]+)"/)?.[1] || null;
}

function extractFormError(html) {
  const raw = html.match(
    /class="alert alert-danger[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/,
  )?.[1];
  return raw
    ? raw
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim()
    : null;
}

export function createOdooWebLogin({ baseUrl, db, fetchImpl = fetch }) {
  async function request(jar, path, init = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      redirect: "manual",
      ...init,
      headers: { ...(init.headers || {}), Cookie: jar.header() },
    });
    jar.store(response);
    if (response.status === 429) {
      throw new OdooLoginError(
        "rate_limited",
        "Odoo đang bận, vui lòng thử lại sau ít phút.",
      );
    }
    return response;
  }

  async function jsonrpc(jar, path, params) {
    const response = await request(jar, path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params,
        id: Date.now(),
      }),
    });
    const body = await response.json().catch(() => null);
    if (!body)
      throw new OdooLoginError(
        "odoo_error",
        "Odoo không phản hồi đúng, vui lòng thử lại sau.",
      );
    if (body.error) throw mapAuthError(body.error);
    return body.result;
  }

  async function logout(jar) {
    try {
      await request(jar, "/web/session/logout");
    } catch {
      // Best effort: the Odoo session expires on its own anyway.
    }
  }

  // Step 1. Returns { mfaRequired: true, jar } or { mfaRequired: false, uid }.
  async function startLogin(login, password) {
    const jar = createCookieJar();
    const result = await jsonrpc(jar, "/web/session/authenticate", {
      db,
      login,
      password,
    });
    if (result?.uid) {
      await logout(jar);
      return { mfaRequired: false, uid: result.uid };
    }
    if (result && result.uid === null) return { mfaRequired: true, jar };
    throw new OdooLoginError(
      "odoo_error",
      "Odoo không phản hồi đúng, vui lòng thử lại sau.",
    );
  }

  // Step 2. Returns the Odoo uid once the 2FA code is accepted.
  async function verifyTotp(jar, code) {
    const formPage = await request(jar, "/web/login/totp");
    if (formPage.status >= 300 && formPage.status < 400) {
      throw new OdooLoginError(
        "session_expired",
        "Phiên đăng nhập đã hết hạn, vui lòng nhập lại mật khẩu.",
      );
    }
    const csrf = extractCsrf(await formPage.text());
    if (!csrf)
      throw new OdooLoginError(
        "odoo_error",
        "Không đọc được form 2FA của Odoo.",
      );

    const submit = await request(jar, "/web/login/totp", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        csrf_token: csrf,
        totp_token: code,
      }).toString(),
    });

    const location = submit.headers.get("location") || "";
    if (
      !(submit.status >= 300 && submit.status < 400) ||
      /\/web\/login/.test(location)
    ) {
      const html = submit.status === 200 ? await submit.text() : "";
      throw new OdooLoginError(
        "invalid_totp",
        extractFormError(html) || "Mã xác thực không đúng.",
      );
    }

    const info = await jsonrpc(jar, "/web/session/get_session_info", {});
    await logout(jar);
    if (!info?.uid)
      throw new OdooLoginError(
        "odoo_error",
        "Odoo không xác nhận được phiên đăng nhập.",
      );
    return info.uid;
  }

  return { startLogin, verifyTotp };
}
