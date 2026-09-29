import axios from "axios";

// Shared Odoo JSON-RPC helper. Originally lived inside routes/api.js;
// extracted so that any new route module (e.g. generate-lots) can reuse the
// exact same call shape (model, method, domain, fields, kwargs) that the
// rest of the app already speaks.
//
// Environment variables (ODOO_URL, ODOO_DB, ODOO_UID, ODOO_APIKEY) are
// loaded in server/index.js before any router is imported, so it is safe to
// read them lazily inside getOdooConfig().

function getOdooConfig() {
  return {
    url: process.env.ODOO_URL,
    db: process.env.ODOO_DB,
    uid: parseInt(process.env.ODOO_UID, 10),
    apikey: process.env.ODOO_APIKEY,
  };
}

// Module-level concurrency limiter for Odoo JSON-RPC requests
let activeRequests = 0;
const waitingQueue = [];

function getMaxConcurrency() {
  const raw = process.env.ODOO_MAX_CONCURRENCY;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return 2;
  }
  const parsed = parseInt(String(raw).trim(), 10);
  if (Number.isNaN(parsed)) {
    return 2;
  }
  return Math.max(1, parsed);
}

function pumpQueue() {
  const maxConcurrency = getMaxConcurrency();
  while (waitingQueue.length > 0 && activeRequests < maxConcurrency) {
    activeRequests++;
    const nextResolve = waitingQueue.shift();
    nextResolve();
  }
}

function acquireSlot() {
  return new Promise((resolve) => {
    waitingQueue.push(resolve);
    pumpQueue();
  });
}

function releaseSlot() {
  activeRequests = Math.max(0, activeRequests - 1);
  pumpQueue();
}

async function withConcurrencySlot(fn) {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

function getRetryDelay(error, retryIndex) {
  const baseDelays = [1000, 2000, 4000];
  let delay = baseDelays[retryIndex] ?? 4000;

  const headers = error.response?.headers;
  if (headers) {
    let rawHeader;
    if (typeof headers.get === "function") {
      rawHeader = headers.get("retry-after");
    }
    if (rawHeader === undefined && typeof headers === "object") {
      const headerKey = Object.keys(headers).find(
        (k) => k.toLowerCase() === "retry-after"
      );
      if (headerKey) {
        rawHeader = headers[headerKey];
      }
    }
    if (rawHeader !== undefined && rawHeader !== null) {
      const strVal = Array.isArray(rawHeader)
        ? String(rawHeader[0])
        : String(rawHeader);
      const parsedSeconds = Number(strVal.trim());
      if (Number.isFinite(parsedSeconds) && parsedSeconds >= 0) {
        delay = Math.min(parsedSeconds, 10) * 1000;
      }
    }
  }

  return delay;
}

/**
 * Call Odoo via JSON-RPC using the execute_kw convention.
 *
 * @param {string} model                - e.g. "stock.picking", "stock.lot"
 * @param {string} method               - e.g. "search_read", "create", "write"
 * @param {Array}  domain               - Odoo domain (array of leaves)
 * @param {Array|Object} [fields]       - Either an array of field names (for
 *                                       read-style calls) OR an object
 *                                       containing kwargs (when fields is
 *                                       omitted and kwargs is the 5th arg).
 * @param {Object} [kwargs]             - Extra kwargs (limit, offset, ...)
 *
 * The previous api.js helper accepted the call as
 *   callOdooAPI(model, method, domain, fields, kwargs)
 * which means `fields` can sometimes actually be a kwargs object. We
 * preserve that overload to avoid breaking the original api.js call sites.
 */
export async function callOdooAPI(model, method, domain, fields, kwargs) {
  if (!kwargs && fields && typeof fields === "object" && !Array.isArray(fields)) {
    kwargs = fields;
    fields = kwargs.fields || [];
    delete kwargs.fields;
  }

  const config = getOdooConfig();

  if (!config.url || !config.db || !config.uid || !config.apikey) {
    console.error("❌ ODOO configuration is incomplete!");
    console.error("Config:", {
      url: config.url || "MISSING",
      db: config.db || "MISSING",
      uid: config.uid || "MISSING",
      apikey: config.apikey ? "***" : "MISSING",
    });
    throw new Error(
      "ODOO configuration is incomplete. Please check .env file."
    );
  }

  let positionalArgs;
  let trailingKwargs = {};
  if (Array.isArray(kwargs?.positionalArgs)) {
    positionalArgs = kwargs.positionalArgs;
    trailingKwargs = { ...kwargs };
    delete trailingKwargs.positionalArgs;
  } else {
    // Standard search_read / search_count: callers pass `domain`
    // already in Odoo format `[[leaf1], [leaf2], …]`.
    //
    // Odoo 19 JSON-RPC `execute_kw` unpacks `args[5]` (the
    // `args_list` parameter of execute_kw) into the called method's
    // positional args. So for search_read(domain, fields=None, ...) we
    // must send `args[5]` = `[domain]` — i.e. wrap the domain in one
    // level. Because our outer array uses JS spread (`...positionalArgs,
    // trailingKwargs`) to build the JSON-RPC args list, we need the
    // value placed at `args[5]` to be one of those spread items. We
    // therefore nest once more here: `positionalArgs = [[domain]]`,
    // which spreads into `args[5] = [domain]`. The trailing dict
    // (kwarg options like `fields`) goes into `args[6]`.
    positionalArgs = [[domain]];
    trailingKwargs = { ...kwargs };
    if (fields && !Array.isArray(fields)) {
      // fields can be either an array (search_read) or an object
      // (caller passed the kwargs here by mistake). Only merge
      // non-array values into trailingKwargs to avoid double-passing
      // the `fields` keyword.
      Object.assign(trailingKwargs, fields);
    } else if (Array.isArray(fields)) {
      trailingKwargs.fields = fields;
    }
  }

  const MAX_RETRIES = 3;
  let retryCount = 0;

  while (true) {
    try {
      return await withConcurrencySlot(async () => {
        const response = await axios.post(
          config.url,
          {
            jsonrpc: "2.0",
            method: "call",
            params: {
              service: "object",
              method: "execute_kw",
              args: [
                config.db,
                config.uid,
                config.apikey,
                model,
                method,
                ...positionalArgs,
                ...(Array.isArray(kwargs?.positionalArgs) ? [] : [trailingKwargs]),
              ],
            },
            id: Math.floor(Math.random() * 1000),
          },
          {
            timeout: 30000,
          }
        );

        if (response.data.error) {
          console.error(
            "[Odoo Error]:",
            JSON.stringify(response.data.error, null, 2)
          );
          const errorMsg =
            response.data.error.data?.message ||
            response.data.error.message ||
            "Lỗi khi gọi Odoo API";
          throw new Error(errorMsg);
        }

        return response.data.result;
      });
    } catch (error) {
      if (error.response?.status === 429 && retryCount < MAX_RETRIES) {
        const delay = getRetryDelay(error, retryCount);
        console.warn(
          `[Odoo Rate Limit] HTTP 429 received. Retrying attempt ${retryCount + 1}/${MAX_RETRIES} in ${delay}ms...`
        );
        retryCount++;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (error.response?.status === 429) {
        throw error;
      }

      if (error.response?.data?.error) {
        console.error(
          "[Odoo Response Error]:",
          JSON.stringify(error.response.data.error, null, 2)
        );
        const errorMsg =
          error.response.data.error.data?.message ||
          error.response.data.error.message ||
          "Lỗi Odoo API";
        throw new Error(errorMsg);
      }
      if (error.code === "ECONNABORTED") {
        throw new Error("Request timeout - Odoo server không phản hồi");
      }
      if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
        throw new Error(`Không thể kết nối đến Odoo: ${config.url}`);
      }
      throw error;
    }
  }
}

export { getOdooConfig };
