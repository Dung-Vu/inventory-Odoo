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
      "ODOO configuration is incomplete. Please check server/.env file."
    );
  }

  try {
    // Build args for execute_kw. Most Odoo methods take
    //   [db, uid, password, model, method, *args, **kwargs]
    // where *args is method-specific.
    //
    // Callers pass `domain` as a standard Odoo domain (already wrapped
    // as `[[leaf1], [leaf2], …]`) and `fields` as an array of names.
    //
    // For search_read / search_count style calls we pass
    //   args = [..., domain, {fields, ...kwargs}]
    // where domain is the first positional arg and `fields` + extra
    // kwargs go into the trailing kwargs dict.
    //
    // For methods that don't take a domain (create, write, unlink,
    // action_apply_inventory, …) the caller passes
    //   kwargs.positionalArgs = [arg1, arg2, …]
    // and we send
    //   args = [..., arg1, arg2, …, {rest_kwargs}]
    // so the method's positional signature is satisfied exactly.
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
  } catch (error) {
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

export { getOdooConfig };
