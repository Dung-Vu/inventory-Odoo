import express from "express";
import axios from "axios";

// Note: Environment variables are already loaded in server/index.js
// We can access them directly via process.env

const router = express.Router();

// Function to get Odoo configuration (loads lazily when called)
function getOdooConfig() {
  return {
    url: process.env.ODOO_URL,
    db: process.env.ODOO_DB,
    uid: parseInt(process.env.ODOO_UID, 10),
    apikey: process.env.ODOO_APIKEY,
  };
}

// Helper function to call Odoo API
async function callOdooAPI(model, method, domain, fields, kwargs) {
  // Handle case where fields is actually a kwargs object (when called with offset/limit)
  if (!kwargs && fields && typeof fields === 'object' && !Array.isArray(fields)) {
    kwargs = fields;
    fields = kwargs.fields || [];
    delete kwargs.fields;
  }
  const config = getOdooConfig();

  // Validate config before making API call
  if (!config.url || !config.db || !config.uid || !config.apikey) {
    console.error("❌ ODOO configuration is incomplete!");
    console.error("Config:", {
      url: config.url || "MISSING",
      db: config.db || "MISSING",
      uid: config.uid || "MISSING",
      apikey: config.apikey ? "***" : "MISSING",
    });
    throw new Error(
      "ODOO configuration is incomplete. Please check server/.env file.",
    );
  }

  try {
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
            [domain],
            { fields, ...kwargs },
          ],
        },
        id: Math.floor(Math.random() * 1000),
      },
      {
        timeout: 30000,
      },
    );

    if (response.data.error) {
      console.error(
        "[Odoo Error]:",
        JSON.stringify(response.data.error, null, 2),
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
        JSON.stringify(error.response.data.error, null, 2),
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

// GET /api/picking/:code - Fetch picking data
// Note: Using * wildcard to capture full path including slashes
router.get("/picking/*", async (req, res, next) => {
  try {
    // Check if Odoo config is valid
    const config = getOdooConfig();
    if (!config.url || !config.db || !config.uid || !config.apikey) {
      console.error("[API] Odoo configuration is incomplete");
      return res.status(500).json({
        error:
          "Server configuration error. Please check server/.env file and restart the server.",
      });
    }

    // Get everything after /picking/
    const pickingCode = decodeURIComponent(req.params[0]);

    if (!pickingCode) {
      return res.status(400).json({ error: "Vui lòng nhập mã phiếu hoặc ID" });
    }

    // 1. Fetch picking info - Support search by ID or name
    // Check if input is a number (ID) or string (name)
    const isNumeric = /^\d+$/.test(pickingCode.trim());
    let searchDomain;

    if (isNumeric) {
      // Search by ID
      const pickingId = parseInt(pickingCode.trim(), 10);
      searchDomain = [["id", "=", pickingId]];
      console.log(`[API] Tìm kiếm phiếu theo ID: ${pickingId}`);
    } else {
      // Search by name
      searchDomain = [["name", "=", pickingCode]];
      console.log(`[API] Tìm kiếm phiếu theo tên: ${pickingCode}`);
    }

    const pickingData = await callOdooAPI(
      "stock.picking",
      "search_read",
      searchDomain,
      [
        "name",
        "state",
        "picking_type_id",
        "partner_id",
        "scheduled_date",
        "date_done",
        "origin",
      ],
    );

    if (!pickingData || pickingData.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy phiếu nhập kho" });
    }

    // Nếu có nhiều phiếu trùng tên, chọn phiếu mới nhất
    // Tiêu chí: scheduled_date lớn hơn = mới hơn; nếu bằng nhau thì dùng id lớn hơn
    let picking = pickingData[0];
    if (pickingData.length > 1) {
      picking = pickingData.reduce((best, current) => {
        const bestDate = best.scheduled_date ? new Date(best.scheduled_date).getTime() : 0;
        const currentDate = current.scheduled_date ? new Date(current.scheduled_date).getTime() : 0;

        if (currentDate !== bestDate) {
          return currentDate > bestDate ? current : best;
        }
        // Tie-breaker: ID lớn hơn = tạo sau = mới hơn
        return current.id > best.id ? current : best;
      });

      console.log(
        `[API] Tìm thấy ${pickingData.length} phiếu trùng tên "${pickingCode}". Chọn phiếu mới nhất: scheduled_date="${picking.scheduled_date}" (ID: ${picking.id})`,
      );
    }

    // 2. Fetch moves
    const moveData = await callOdooAPI(
      "stock.move",
      "search_read",
      [["picking_id", "=", picking.id]],
      ["product_id", "product_uom_qty", "product_uom"],
    );

    // 3. Fetch move lines
    const moveLineData = await callOdooAPI(
      "stock.move.line",
      "search_read",
      [["picking_id", "=", picking.id]],
      ["product_id", "lot_id", "lot_name", "qty_done", "move_id"],
    );

    // 4. Get product IDs
    const productIds = [...new Set(moveData.map((m) => m.product_id[0]))];

    // 5. Fetch products with variant attributes
    const productData = await callOdooAPI(
      "product.product",
      "search_read",
      [["id", "in", productIds]],
      [
        "name",
        "product_tmpl_id",
        "default_code",
        "product_template_attribute_value_ids",
      ],
    );

    // 6. Get all product template attribute value IDs from products
    const productTemplateAttrValueIds = [];
    productData.forEach((product) => {
      if (
        product &&
        product.product_template_attribute_value_ids &&
        Array.isArray(product.product_template_attribute_value_ids) &&
        product.product_template_attribute_value_ids.length > 0
      ) {
        productTemplateAttrValueIds.push(
          ...product.product_template_attribute_value_ids,
        );
      }
    });

    // 7. Fetch product template attribute values
    let productTemplateAttrValueData = [];
    if (productTemplateAttrValueIds.length > 0) {
      productTemplateAttrValueData = await callOdooAPI(
        "product.template.attribute.value",
        "search_read",
        [["id", "in", productTemplateAttrValueIds]],
        ["product_attribute_value_id", "attribute_id"],
      );
    }

    // 8. Get product attribute value IDs
    const productAttributeValueIds = productTemplateAttrValueData
      .filter(
        (av) =>
          av &&
          av.product_attribute_value_id &&
          av.product_attribute_value_id[0],
      )
      .map((av) => av.product_attribute_value_id[0]);

    // 9. Fetch product attribute values
    let productAttributeValueData = [];
    if (productAttributeValueIds.length > 0) {
      productAttributeValueData = await callOdooAPI(
        "product.attribute.value",
        "search_read",
        [["id", "in", productAttributeValueIds]],
        ["name", "attribute_id"],
      );
    }

    // 10. Get attribute IDs
    const attributeIds = [
      ...new Set(
        productTemplateAttrValueData
          .filter((av) => av && av.attribute_id && av.attribute_id[0])
          .map((av) => av.attribute_id[0]),
      ),
    ];

    // 11. Fetch attributes
    let attributeData = [];
    if (attributeIds.length > 0) {
      attributeData = await callOdooAPI(
        "product.attribute",
        "search_read",
        [["id", "in", attributeIds]],
        ["name"],
      );
    }

    // 14. Get lot IDs from move lines
    const lotIds = moveLineData
      .filter((line) => line.lot_id && line.lot_id[0])
      .map((line) => line.lot_id[0]);

    // 15. Fetch lots
    let lotData = [];
    if (lotIds.length > 0) {
      lotData = await callOdooAPI(
        "stock.lot",
        "search_read",
        [["id", "in", lotIds]],
        ["name"],
      );
    }

    // 16. Build attribute map
    const attributeMap = {};
    attributeData.forEach((attr) => {
      attributeMap[attr.id] = attr.name;
    });

    const attributeValueMap = {};
    productAttributeValueData.forEach((av) => {
      attributeValueMap[av.id] = {
        name: av.name,
        attribute: attributeMap[av.attribute_id[0]] || "Unknown",
      };
    });

    const productTemplateAttrValueMap = {};
    productTemplateAttrValueData.forEach((ptav) => {
      productTemplateAttrValueMap[ptav.id] = {
        attribute_id: ptav.attribute_id[0],
        attribute_name: attributeMap[ptav.attribute_id[0]] || "Unknown",
        value_id: ptav.product_attribute_value_id[0],
      };
    });

    // 17. Build lot map
    const lotMap = {};
    lotData.forEach((lot) => {
      lotMap[lot.id] = lot.name;
    });

    // 18. Combine data
    const products = moveData.map((move) => {
      const product = productData.find((p) => p && p.id === move.product_id[0]);

      // 如果找不到产品数据，跳过或使用默认值
      if (!product) {
        console.warn(
          `[API] Không tìm thấy product với ID: ${move.product_id[0]}`,
        );
        return {
          product_id: move.product_id[0]?.toString() || "N/A",
          product_name: "Không tìm thấy sản phẩm",
          quantity: move.product_uom_qty || 0,
          uom: move.product_uom?.[1] || "Unit",
          variant: null,
          lots: [],
        };
      }

      // Get variant attributes for this specific product
      const variantAttributes = [];
      if (
        product.product_template_attribute_value_ids &&
        Array.isArray(product.product_template_attribute_value_ids) &&
        product.product_template_attribute_value_ids.length > 0
      ) {
        product.product_template_attribute_value_ids.forEach((ptavId) => {
          const ptav = productTemplateAttrValueMap[ptavId];
          if (ptav) {
            const attrValue = attributeValueMap[ptav.value_id];
            if (attrValue) {
              variantAttributes.push({
                attribute: attrValue.attribute,
                value: attrValue.name,
              });
            }
          }
        });
      }

      // Format variant string
      const variantString =
        variantAttributes.length > 0
          ? variantAttributes
              .map((va) => `${va.attribute}: ${va.value}`)
              .join(" | ")
          : null;

      // Get lots for this product and calculate total qty_done
      const productLots = [];
      let totalQtyDone = 0;
      moveLineData
        .filter(
          (line) =>
            line.product_id[0] === product.id && (line.lot_id || line.lot_name),
        )
        .forEach((line) => {
          const lotId = line.lot_id ? line.lot_id[0] : null;
          const lotName = lotId
            ? lotMap[lotId] || line.lot_id[1] || `Lot-${lotId}`
            : line.lot_name || "N/A";
          const qtyDone = line.qty_done || 0;
          totalQtyDone += qtyDone;
          productLots.push({
            lot_id: lotId,
            lot_name: lotName,
            qty_done: qtyDone,
          });
        });

      // Use total qty_done from move lines, fallback to demand if no lines
      const actualQuantity =
        totalQtyDone > 0 ? totalQtyDone : move.product_uom_qty || 0;

      return {
        product_id: product.default_code || product.id.toString(),
        product_name: product.name,
        quantity: actualQuantity,
        uom: move.product_uom[1] || "Unit",
        variant: variantString,
        lots: productLots,
      };
    });

    // Format picking response
    const formattedPicking = {
      id: picking.id,
      name: picking.name,
      state: picking.state,
      partner: picking.partner_id ? picking.partner_id[1] : "N/A",
      scheduled_date: picking.scheduled_date,
      date_done: picking.date_done,
      origin: picking.origin,
      picking_type: picking.picking_type_id
        ? picking.picking_type_id[1]
        : "N/A",
    };

    res.json({
      picking: formattedPicking,
      products,
    });
  } catch (error) {
    if (error.message.includes("timeout")) {
      return res
        .status(504)
        .json({ error: "Request timeout - Odoo server không phản hồi" });
    }
    if (
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("ENOTFOUND")
    ) {
      return res
        .status(503)
        .json({ error: "Không thể kết nối đến Odoo server" });
    }

    next(error);
  }
});

// GET /api/delivery-info/:code - Fetch delivery info for recipient slip
router.get("/delivery-info/*", async (req, res, next) => {
  try {
    // Check if Odoo config is valid
    const config = getOdooConfig();
    if (!config.url || !config.db || !config.uid || !config.apikey) {
      console.error("[API] Odoo configuration is incomplete");
      return res.status(500).json({
        error:
          "Server configuration error. Please check server/.env file and restart the server.",
      });
    }

    // Get everything after /delivery-info/
    const pickingCode = decodeURIComponent(req.params[0]);

    if (!pickingCode) {
      return res.status(400).json({ error: "Vui lòng nhập mã phiếu hoặc ID" });
    }

    // Search for picking by ID or name
    const isNumeric = /^\d+$/.test(pickingCode.trim());
    let searchDomain;

    if (isNumeric) {
      const pickingId = parseInt(pickingCode.trim(), 10);
      searchDomain = [["id", "=", pickingId]];
      console.log(`[API] Tìm kiếm phiếu giao hàng theo ID: ${pickingId}`);
    } else {
      searchDomain = [["name", "=", pickingCode]];
      console.log(`[API] Tìm kiếm phiếu giao hàng theo tên: ${pickingCode}`);
    }

    const pickingData = await callOdooAPI(
      "stock.picking",
      "search_read",
      searchDomain,
      [
        "name",
        "state",
        "partner_id",
        "scheduled_date",
        "origin",
        "picking_type_id",
      ],
    );

    if (!pickingData || pickingData.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy phiếu giao hàng" });
    }

    let picking = pickingData[0];
    if (pickingData.length > 1) {
      picking = pickingData.reduce((best, current) => {
        const bestDate = best.scheduled_date ? new Date(best.scheduled_date).getTime() : 0;
        const currentDate = current.scheduled_date ? new Date(current.scheduled_date).getTime() : 0;

        if (currentDate !== bestDate) {
          return currentDate > bestDate ? current : best;
        }
        // Tie-breaker: ID lớn hơn = tạo sau = mới hơn
        return current.id > best.id ? current : best;
      });

      console.log(
        `[API] Tìm thấy ${pickingData.length} phiếu trùng tên. Chọn phiếu mới nhất: scheduled_date="${picking.scheduled_date}" (ID: ${picking.id})`,
      );
    }

    // Get partner (recipient) info
    let recipient = {
      name: "N/A",
      address: "N/A",
      phone: "N/A",
    };

    if (picking.partner_id && picking.partner_id[0]) {
      const partnerId = picking.partner_id[0];
      const partnerData = await callOdooAPI(
        "res.partner",
        "search_read",
        [["id", "=", partnerId]],
        [
          "name",
          "street",
          "street2",
          "city",
          "state_id",
          "country_id",
          "phone",
        ],
      );

      if (partnerData && partnerData.length > 0) {
        const partner = partnerData[0];

        // Build full address
        const addressParts = [];
        if (partner.street) addressParts.push(partner.street);
        if (partner.street2) addressParts.push(partner.street2);
        if (partner.city) addressParts.push(partner.city);
        if (partner.state_id) addressParts.push(partner.state_id[1]);
        if (partner.country_id) addressParts.push(partner.country_id[1]);

        recipient = {
          name: partner.name || "N/A",
          address: addressParts.join(", ") || "N/A",
          phone: partner.phone || "N/A",
        };
      }
    }

    // Get sender info (company info)
    // In most cases, the sender is the company running Odoo
    const sender = {
      name: "CTY BONARIO VN",
      address: "22/12a Vĩnh Phú 33, Vĩnh Phú, Thuận An, Bình Dương",
      phone: "0862229805 - Mai Hương",
    };

    // Try to get actual company info from Odoo
    try {
      const companyData = await callOdooAPI(
        "res.company",
        "search_read",
        [["id", "=", 1]], // Typically company ID 1 is the main company
        [
          "name",
          "street",
          "street2",
          "city",
          "state_id",
          "country_id",
          "phone",
        ],
      );

      if (companyData && companyData.length > 0) {
        const company = companyData[0];

        // Build full address
        const addressParts = [];
        if (company.street) addressParts.push(company.street);
        if (company.street2) addressParts.push(company.street2);
        if (company.city) addressParts.push(company.city);
        if (company.state_id) addressParts.push(company.state_id[1]);
        if (company.country_id) addressParts.push(company.country_id[1]);

        if (company.name) sender.name = company.name;
        if (addressParts.length > 0) sender.address = addressParts.join(", ");
        if (company.phone) sender.phone = company.phone;
      }
    } catch (error) {
      console.warn(
        "[API] Could not fetch company info, using default sender info",
      );
    }

    res.json({
      picking: {
        id: picking.id,
        name: picking.name,
        state: picking.state,
        scheduled_date: picking.scheduled_date,
        origin: picking.origin,
        picking_type: picking.picking_type_id
          ? picking.picking_type_id[1]
          : "N/A",
      },
      sender,
      recipient,
    });
  } catch (error) {
    console.error("[API Error - delivery-info]:", error.message);
    console.error("[API Error Stack]:", error.stack);

    if (error.message.includes("timeout")) {
      return res
        .status(504)
        .json({ error: "Request timeout - Odoo server không phản hồi" });
    }
    if (
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("ENOTFOUND")
    ) {
      return res
        .status(503)
        .json({ error: "Không thể kết nối đến Odoo server" });
    }

    // Return detailed error message
    return res
      .status(500)
      .json({ error: error.message || "Lỗi server khi xử lý yêu cầu" });
  }
});

// GET /api/abc-analysis - ABC Analysis for products filtered by variant tag
router.get("/abc-analysis", async (req, res, next) => {
  try {
    const config = getOdooConfig();
    if (!config.url || !config.db || !config.uid || !config.apikey) {
      return res.status(500).json({ error: "Server configuration error" });
    }

    // Helper function to format percentage
    const formatPercent = (value) => {
      return (value || 0).toFixed(2);
    };

    // Parse query params
    const { startDate, endDate, productName } = req.query;
    const variantTag = (req.query.variantTag || "Furniture Stock").trim();

    console.log(`[Sales Report] Params: startDate=${startDate}, endDate=${endDate}, productName=${productName}, variantTag=${variantTag}`);

    // Validate date range
    if (startDate && endDate && startDate > endDate) {
      return res.status(400).json({ error: "Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc" });
    }

    const isStockFabricsReport = variantTag.toLowerCase() === "stock fabrics";
    const fetchSaleOrderLines = async (domain, fields, logLabel) => {
      const batchSize = 1000;
      const records = [];

      for (let offset = 0; ; offset += batchSize) {
        const batch = await callOdooAPI(
          "sale.order.line",
          "search_read",
          domain,
          {
            fields,
            offset,
            limit: batchSize,
          }
        );

        if (!batch || batch.length === 0) {
          break;
        }

        records.push(...batch);
        console.log(`[Sales Report] ${logLabel}: fetched ${records.length} sale lines so far`);

        if (batch.length < batchSize) {
          break;
        }
      }

      return records;
    };

    // Step 1: Resolve variant tag dynamically
    console.log(`[Sales Report] Step 1: Finding "${variantTag}" tag...`);

    const tags = await callOdooAPI(
      "product.tag",
      "search_read",
      [["name", "=", variantTag]],
      ["id", "name"]
    );

    if (!tags || tags.length === 0) {
      console.log(`[Sales Report] Tag "${variantTag}" not found in Odoo`);
      return res.json({
        products: [],
        summary: { totalProducts: 0, totalRevenue: 0, classA_count: 0, classB_count: 0, classC_count: 0, classA_revenue: 0, classB_revenue: 0, classC_revenue: 0, classA_percent: 0, classB_percent: 0, classC_percent: 0 },
        filters: { startDate, endDate, productName, variantTag },
        message: `Không tìm thấy tag '${variantTag}' trong Odoo.`
      });
    }

    const variantTagId = tags[0].id;
    console.log(`[Sales Report] Found tag "${tags[0].name}" with ID: ${variantTagId}`);

    // Step 2: Fetch product variants that carry the requested tag.
    // We then resolve each variant's template and expand to ALL siblings so that
    // newer variants (not yet tagged) are also included in the sales calculation.
    console.log(`[Sales Report] Step 2: Fetching products with tag "${variantTag}" (ID: ${variantTagId})...`);

    const productsWithTag = [];
    
    try {
      // Fetch tagged product variants with attribute values and pricing for display
      const taggedProducts = await callOdooAPI(
        'product.product',
        'search_read',
        [['all_product_tag_ids', 'in', [variantTagId]]],
        ['id', 'name', 'default_code', 'company_id', 'product_tmpl_id', 'product_template_attribute_value_ids', 'lst_price', 'standard_price']
      );
      
      productsWithTag.push(...taggedProducts);
    } catch (tagErr) {
      console.warn(`[Sales Report] Could not fetch products with tag:`, tagErr.message);
    }

    console.log(`[Sales Report] Found ${productsWithTag.length} tagged variants for tag "${variantTag}"`);
    
    if (productsWithTag.length === 0) {
      return res.json({ 
        products: [], 
        summary: { totalProducts: 0, totalRevenue: 0, classA_count: 0, classB_count: 0, classC_count: 0, classA_revenue: 0, classB_revenue: 0, classC_revenue: 0, classA_percent: 0, classB_percent: 0, classC_percent: 0 },
        filters: { startDate, endDate, productName, variantTag },
        message: `Không có sản phẩm nào với tag '${variantTag}'. Vui lòng gắn tag này cho các sản phẩm trong Odoo trước.` 
      });
    }

    // Step 2b: Resolve variant attribute value names for display (e.g. "400", "AMES 902")
    console.log('[Sales Report] Step 2b: Fetching variant attribute values...');
    const attrValueNames = {};  // ptav_id → name
    try {
      const allAttrValueIds = [...new Set(
        productsWithTag.flatMap((v) => v.product_template_attribute_value_ids || [])
      )];
      if (allAttrValueIds.length > 0) {
        const attrValues = await callOdooAPI(
          'product.template.attribute.value',
          'search_read',
          [['id', 'in', allAttrValueIds]],
          ['id', 'name']
        );
        attrValues.forEach((av) => { attrValueNames[av.id] = av.name; });
      }
    } catch (err) {
      console.warn('[Sales Report] Could not fetch attribute values:', err.message);
    }

    // Step 2c: Build productMap keyed by VARIANT ID (one row per tagged variant)
    const productMap = {};   // variantId → product entry
    const odooBaseUrl = (config.url || '').replace('/jsonrpc', '').replace(/\/$/, '');

    productsWithTag.forEach((variant) => {
      const tmplName = variant.product_tmpl_id?.[1] || variant.name;
      const tmplId = variant.product_tmpl_id?.[0];
      const variantAttrs = (variant.product_template_attribute_value_ids || [])
        .map((aid) => attrValueNames[aid] || '')
        .filter(Boolean)
        .join(', ');
      const companyName = variant.company_id?.[1] || null;
      // Use lst_price if available, fallback to standard_price (cost)
      const unitPrice = (variant.lst_price > 0 ? variant.lst_price : variant.standard_price) || 0;

      productMap[variant.id] = {
        id: variant.id,
        name: tmplName,
        product_name: tmplName,
        default_code: variant.default_code || 'N/A',
        variant: variantAttrs || null,
        unit_price: unitPrice,
        total_sales: 0,
        quantity_sold: 0,
        quantity_in_mo: 0,
        company: companyName || 'N/A',
        _companyNames: companyName ? [companyName] : [],
        odoo_url: tmplId ? `${odooBaseUrl}/odoo/inventory/products/${tmplId}` : null,
      };
    });

    const allVariantIds = productsWithTag.map((v) => v.id);
    console.log(`[Sales Report] Querying sales for ${allVariantIds.length} tagged variant IDs`);

    // Step 3: Build sale order domain with date filter applied directly in Odoo.
    // This replaces the old 2-step approach (fetch all → filter by order date in JS).
    // Using order_id.date_order for date filtering (confirmed order date, not create_date).
    console.log("[Sales Report] Step 3: Fetching sales data...");

    const saleDomain = [
      ["product_id", "in", allVariantIds],
      ["state", "=", "sale"],
      ["order_id.state", "=", "sale"],
    ];

    // Push date range into Odoo domain to avoid post-fetch filtering
    if (startDate) {
      saleDomain.push(["order_id.date_order", ">=", startDate + " 00:00:00"]);
    }
    if (endDate) {
      saleDomain.push(["order_id.date_order", "<=", endDate + " 23:59:59"]);
    }

    const saleLineFields = [
      "id",
      "product_id",
      "product_uom_qty",
      "price_subtotal",
      "company_id",
    ];

    let allSaleLines = [];
    try {
      allSaleLines = await fetchSaleOrderLines(saleDomain, saleLineFields, "All variants of tagged templates");
    } catch (err) {
      console.warn("[Sales Report] Could not fetch sale lines:", err.message);
    }

    console.log(`[Sales Report] Found ${allSaleLines.length} valid sale order lines`);

    // Aggregate by VARIANT ID (one row per tagged variant)
    let totalLinesProcessed = 0;
    let skippedLines = 0;

    allSaleLines.forEach((line) => {
      const qty = line.product_uom_qty || 0;
      if (qty <= 0) {
        skippedLines++;
        return;
      }

      const variantId = line.product_id?.[0];

      if (!variantId || !productMap[variantId]) {
        skippedLines++;
        return;
      }

      // Don't accumulate total_sales here — it will be recalculated as qty * unit_price after all quantities are collected
      productMap[variantId].quantity_sold += qty;

      const lineCompany = line.company_id?.[1];
      if (lineCompany && !productMap[variantId]._companyNames.includes(lineCompany)) {
        productMap[variantId]._companyNames.push(lineCompany);
      }

      totalLinesProcessed++;
    });

    console.log(
      `[Sales Report] Processed ${totalLinesProcessed} direct sale lines, skipped ${skippedLines}`
    );

    // Step 3b: Add Manufacturing Order (MO) raw material consumption.
    // Fabric variants are used as BOM components in production orders.
    // We count done stock.moves linked to an MO and add the qty to quantity_sold.
    console.log('[Sales Report] Step 3b: Fetching MO consumption (stock.move)...');
    try {
      const moveDomain = [
        ['product_id', 'in', allVariantIds],
        ['state', '=', 'done'],
        ['raw_material_production_id', '!=', false],
      ];
      if (startDate) moveDomain.push(['date', '>=', startDate + ' 00:00:00']);
      if (endDate) moveDomain.push(['date', '<=', endDate + ' 23:59:59']);

      // Paginate stock.move separately (fetchSaleOrderLines is hardcoded to sale.order.line)
      const moMoves = [];
      for (let offset = 0; ; offset += 1000) {
        const batch = await callOdooAPI('stock.move', 'search_read', moveDomain, {
          fields: ['id', 'product_id', 'product_uom_qty', 'company_id'],
          offset,
          limit: 1000,
        });
        if (!batch || batch.length === 0) break;
        moMoves.push(...batch);
        if (batch.length < 1000) break;
      }

      moMoves.forEach((move) => {
        const variantId = move.product_id?.[0];
        const qty = move.product_uom_qty || 0;
        if (!variantId || !productMap[variantId] || qty <= 0) return;

        productMap[variantId].quantity_in_mo += qty;
        productMap[variantId].quantity_sold += qty;

        const moveCompany = move.company_id?.[1];
        if (moveCompany && !productMap[variantId]._companyNames.includes(moveCompany)) {
          productMap[variantId]._companyNames.push(moveCompany);
        }
      });

      console.log(`[Sales Report] Added ${moMoves.length} MO consumption moves`);
    } catch (moErr) {
      console.warn('[Sales Report] Could not fetch MO consumption:', moErr.message);
    }

    // Step 3c: Recalculate total_sales = total quantity consumed × unit price
    Object.values(productMap).forEach((p) => {
      p.total_sales = p.quantity_sold * p.unit_price;
    });

    // Finalize company display for each template entry
    Object.values(productMap).forEach((product) => {
      const companyNames = [...new Set(product._companyNames || [])].filter(Boolean);
      product.company = companyNames.length > 0 ? companyNames.join(", ") : "N/A";
      delete product._companyNames;
    });

    // Step 4: Filter by product name if provided
    let filteredProducts = isStockFabricsReport
      ? Object.values(productMap)
      : Object.values(productMap).filter(
          (product) => (product.total_sales || 0) > 0 || (product.quantity_sold || 0) > 0
        );

    if (productName) {
      const searchTerm = productName.toLowerCase();
      filteredProducts = filteredProducts.filter(p =>
        p.name.toLowerCase().includes(searchTerm) ||
        (p.product_name && p.product_name.toLowerCase().includes(searchTerm)) ||
        (p.variant && p.variant.toLowerCase().includes(searchTerm)) ||
        (p.company && p.company.toLowerCase().includes(searchTerm)) ||
        (p.default_code && p.default_code.toLowerCase().includes(searchTerm))
      );
      console.log(`[Sales Report] Filtered to ${filteredProducts.length} products by name "${productName}"`);
    }

    // Step 5: Sort by total_sales descending
    filteredProducts.sort((a, b) => b.total_sales - a.total_sales);

    // Step 6: Calculate total revenue
    const totalRevenue = filteredProducts.reduce((sum, p) => sum + p.total_sales, 0);

    console.log(`[Sales Report] Total products after filter: ${filteredProducts.length}, Total revenue: ${totalRevenue.toFixed(0)} VND`);

    // Step 7: Calculate cumulative percentage
    // PHÂN LOẠI ABC THEO DOANH SỐ (Pareto 80/15/5):
    // - Class A: Những sản phẩm có cumulative revenue ≤ 80% (top ~20% sản phẩm)
    // - Class B: Những sản phẩm có cumulative revenue từ 80% đến 95% (next ~30% sản phẩm)
    // - Class C: Những sản phẩm còn lại (bottom ~50% sản phẩm)
    let cumulativeSales = 0;
    filteredProducts.forEach((product, index) => {
      cumulativeSales += product.total_sales;
      product.cumulative_percent = totalRevenue > 0 ? (cumulativeSales / totalRevenue) * 100 : 0;
      product.rank = index + 1;
      product.sales_percent = totalRevenue > 0 ? (product.total_sales / totalRevenue) * 100 : 0;
    });

    // Step 8: Assign ABC class based on CUMULATIVE REVENUE (Pareto Principle)
    let classA_revenue = 0, classB_revenue = 0, classC_revenue = 0;
    let classA_count = 0, classB_count = 0, classC_count = 0;

    filteredProducts.forEach((product) => {
      // Class A: cumulative ≤ 80%
      if (product.cumulative_percent <= 80) {
        product.abc_class = 'A';
        classA_revenue += product.total_sales;
        classA_count++;
      }
      // Class B: cumulative > 80% and ≤ 95%
      else if (product.cumulative_percent <= 95) {
        product.abc_class = 'B';
        classB_revenue += product.total_sales;
        classB_count++;
      }
      // Class C: cumulative > 95%
      else {
        product.abc_class = 'C';
        classC_revenue += product.total_sales;
        classC_count++;
      }
    });

    const totalProducts = filteredProducts.length;

    console.log(`[Sales Report] Class A: ${classA_count} products (${formatPercent((classA_revenue / totalRevenue) * 100)} revenue)`);
    console.log(`[Sales Report] Class B: ${classB_count} products (${formatPercent((classB_revenue / totalRevenue) * 100)} revenue)`);
    console.log(`[Sales Report] Class C: ${classC_count} products (${formatPercent((classC_revenue / totalRevenue) * 100)} revenue)`);
    console.log(`[Sales Report] Total: ${totalProducts} products, Total Revenue: ${totalRevenue.toFixed(0)} VND`);

    res.json({
      products: filteredProducts,
      summary: {
        totalProducts,
        totalRevenue,
        classA_count: classA_count,
        classB_count: classB_count,
        classC_count: classC_count,
        classA_revenue,
        classB_revenue,
        classC_revenue,
        classA_percent: totalRevenue > 0 ? (classA_revenue / totalRevenue) * 100 : 0,
        classB_percent: totalRevenue > 0 ? (classB_revenue / totalRevenue) * 100 : 0,
        classC_percent: totalRevenue > 0 ? (classC_revenue / totalRevenue) * 100 : 0,
      },
      filters: {
        startDate,
        endDate,
        productName,
        variantTag,
      }
    });

  } catch (error) {
    console.error("[ABC Analysis Error]:", error.message);
    if (error.message.includes("timeout")) {
      return res.status(504).json({ error: "Request timeout - Odoo server không phản hồi" });
    }
    if (error.message.includes("ECONNREFUSED") || error.message.includes("ENOTFOUND")) {
      return res.status(503).json({ error: "Không thể kết nối đến Odoo server" });
    }
    next(error);
  }
});

export default router;
