import express from "express";
import ExcelJS from "exceljs";
import { callOdooAPI, getOdooConfig } from "../odoo-helper.js";

// Note: Environment variables are already loaded in server/index.js
// We can access them directly via process.env

const router = express.Router();

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
          "Server configuration error. Please check .env file and restart the server.",
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
          "Server configuration error. Please check .env file and restart the server.",
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

// GET /api/abc-analysis/export-excel - Export Excel with all Wood & Chair products + Sỹ Thông Stock + Reorder Calculations
router.get("/abc-analysis/export-excel", async (req, res, next) => {
  try {
    const config = getOdooConfig();
    if (!config.url || !config.db || !config.uid || !config.apikey) {
      return res.status(500).json({ error: "Server configuration error" });
    }

    const { startDate, endDate, productName } = req.query;
    const leadtimeDays = parseInt(req.query.leadtime || "45", 10);
    const reviewPeriodDays = parseInt(req.query.reviewPeriod || "45", 10);

    console.log(`[Excel Export] Starting export with params: startDate=${startDate}, endDate=${endDate}, productName=${productName}, leadtime=${leadtimeDays}, reviewPeriod=${reviewPeriodDays}`);

    const batchSize = 1000;

    // 1. Sỹ Thông internal locations
    const stLocations = await callOdooAPI(
      "stock.location",
      "search_read",
      [["complete_name", "ilike", "ORDST%"], ["usage", "=", "internal"]],
      { fields: ["id", "name", "complete_name"] }
    );
    const stLocationIds = stLocations ? stLocations.map((l) => l.id) : [];

    // 2. Categories for Wood & Chairs (Vietnam ORD only, exclude ORD CAM)
    const categs = await callOdooAPI(
      "product.category",
      "search_read",
      [["complete_name", "=ilike", "ORD / %"]],
      { fields: ["id", "complete_name"] }
    );

    const woodAndChairCategs = (categs || []).filter(
      (c) =>
        /WOOD|DINING CHAIR|ARMCHAIR|TABLE|SOLID SURFACE|SHELF/i.test(c.complete_name) &&
        !/FABRIC|LIGHTING|RUG|VAISOFA/i.test(c.complete_name) &&
        !/SOLID SURFACE \/ DINING TABLE/i.test(c.complete_name) &&
        !/UPHOLSTERY \/ SOFA/i.test(c.complete_name)
    );
    const categIds = woodAndChairCategs.map((c) => c.id);

    // 3. Tag "Furniture Stock"
    const tags = await callOdooAPI(
      "product.tag",
      "search_read",
      [["name", "=", "Furniture Stock"]],
      { fields: ["id", "name"] }
    );
    const furnitureTagId = tags?.[0]?.id;

    // 4. Fetch all product variants in batches (exclude ORDINAIRE CAMBODIA - company_id 9)
    const productDomain = [
      "&",
      ["company_id", "!=", 9],
      "|",
      ["categ_id", "in", categIds],
      ["all_product_tag_ids", "in", furnitureTagId ? [furnitureTagId] : []],
    ];

    let products = [];
    for (let offset = 0; ; offset += batchSize) {
      const batch = await callOdooAPI("product.product", "search_read", productDomain, {
        fields: [
          "id",
          "name",
          "default_code",
          "company_id",
          "product_tmpl_id",
          "product_template_attribute_value_ids",
          "lst_price",
          "standard_price",
          "categ_id",
        ],
        offset,
        limit: batchSize,
      });
      if (!batch || batch.length === 0) break;
      products.push(...batch);
      if (batch.length < batchSize) break;
    }

    console.log(`[Excel Export] Discovered ${products.length} wood & chair variants total`);

    // 5. Attribute values map
    const allAttrValueIds = [
      ...new Set(products.flatMap((v) => v.product_template_attribute_value_ids || [])),
    ];
    const attrValueNames = {};
    if (allAttrValueIds.length > 0) {
      for (let i = 0; i < allAttrValueIds.length; i += 1000) {
        const chunk = allAttrValueIds.slice(i, i + 1000);
        const avList = await callOdooAPI(
          "product.template.attribute.value",
          "search_read",
          [["id", "in", chunk]],
          { fields: ["id", "name"] }
        );
        (avList || []).forEach((av) => {
          attrValueNames[av.id] = av.name;
        });
      }
    }

    // 6. Sỹ Thông On-hand stock
    const allVariantIds = products.map((p) => p.id);
    const stockMap = {};
    if (stLocationIds.length > 0 && allVariantIds.length > 0) {
      for (let i = 0; i < allVariantIds.length; i += 1000) {
        const chunk = allVariantIds.slice(i, i + 1000);
        const quants = await callOdooAPI(
          "stock.quant",
          "search_read",
          [["location_id", "in", stLocationIds], ["product_id", "in", chunk]],
          { fields: ["product_id", "quantity"] }
        );
        (quants || []).forEach((q) => {
          const pId = q.product_id[0];
          stockMap[pId] = (stockMap[pId] || 0) + (q.quantity || 0);
        });
      }
    }

    // 7. Sales data
    const saleDomain = [
      ["product_id", "in", allVariantIds],
      ["state", "=", "sale"],
      ["order_id.state", "=", "sale"],
    ];
    if (startDate) saleDomain.push(["order_id.date_order", ">=", startDate + " 00:00:00"]);
    if (endDate) saleDomain.push(["order_id.date_order", "<=", endDate + " 23:59:59"]);

    let allSaleLines = [];
    for (let offset = 0; ; offset += batchSize) {
      const batch = await callOdooAPI("sale.order.line", "search_read", saleDomain, {
        fields: ["id", "product_id", "product_uom_qty", "price_subtotal", "company_id", "order_id"],
        offset,
        limit: batchSize,
      });
      if (!batch || batch.length === 0) break;
      allSaleLines.push(...batch);
      if (batch.length < batchSize) break;
    }

    // 8. MO consumption
    const moveDomain = [
      ["product_id", "in", allVariantIds],
      ["state", "=", "done"],
      ["raw_material_production_id", "!=", false],
    ];
    if (startDate) moveDomain.push(["date", ">=", startDate + " 00:00:00"]);
    if (endDate) moveDomain.push(["date", "<=", endDate + " 23:59:59"]);

    let moMoves = [];
    for (let offset = 0; ; offset += batchSize) {
      const batch = await callOdooAPI("stock.move", "search_read", moveDomain, {
        fields: ["id", "product_id", "product_uom_qty", "company_id"],
        offset,
        limit: batchSize,
      });
      if (!batch || batch.length === 0) break;
      moMoves.push(...batch);
      if (batch.length < batchSize) break;
    }

    // Build Product Map
    const productMap = {};
    products.forEach((variant) => {
      const tmplName = variant.product_tmpl_id?.[1] || variant.name;
      const variantAttrs = (variant.product_template_attribute_value_ids || [])
        .map((aid) => attrValueNames[aid] || "")
        .filter(Boolean)
        .join(", ");
      const companyName = variant.company_id?.[1] || "Bonario";
      const unitPrice =
        (variant.lst_price > 0 ? variant.lst_price : variant.standard_price) || 0;

      productMap[variant.id] = {
        id: variant.id,
        name: tmplName,
        product_name: tmplName,
        default_code: variant.default_code || "",
        variant: variantAttrs || "",
        category: variant.categ_id?.[1] || "",
        company: companyName,
        unit_price: unitPrice,
        quantity_sold: 0,
        quantity_in_mo: 0,
        total_sales: 0,
        on_hand_st: stockMap[variant.id] || 0,
      };
    });

    allSaleLines.forEach((line) => {
      const vId = line.product_id?.[0];
      const qty = line.product_uom_qty || 0;
      if (vId && productMap[vId] && qty > 0) {
        productMap[vId].quantity_sold += qty;
      }
    });

    moMoves.forEach((move) => {
      const vId = move.product_id?.[0];
      const qty = move.product_uom_qty || 0;
      if (vId && productMap[vId] && qty > 0) {
        productMap[vId].quantity_in_mo += qty;
        productMap[vId].quantity_sold += qty;
      }
    });

    // Recalculate total_sales
    Object.values(productMap).forEach((p) => {
      p.total_sales = p.quantity_sold * p.unit_price;
    });

    // Determine days in analysis period
    let daysInPeriod = 149;
    if (startDate && endDate) {
      const diffMs = new Date(endDate) - new Date(startDate);
      daysInPeriod = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1);
    } else if (startDate) {
      const diffMs = new Date() - new Date(startDate);
      daysInPeriod = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1);
    }

    // Convert to list & filter out any Cambodia items & excluded categories
    const rawList = Object.values(productMap).filter(
      (p) =>
        !/cambodia/i.test(p.company || "") &&
        !/ord cam/i.test(p.category || "") &&
        !/solid surface \/ dining table/i.test(p.category || "") &&
        !/upholstery \/ sofa/i.test(p.category || "")
    );

    // Group/Merge by (product_name + variant) across companies
    const mergedMap = new Map();
    rawList.forEach((p) => {
      const key = `${p.product_name || p.name}___${p.variant || ""}`.trim().toLowerCase();
      if (!mergedMap.has(key)) {
        mergedMap.set(key, {
          id: p.id,
          ids: [p.id],
          name: p.name,
          product_name: p.product_name,
          default_code: p.default_code || "",
          codes: p.default_code ? [p.default_code] : [],
          variant: p.variant || "",
          category: p.category || "",
          companies: p.company ? [p.company] : [],
          unit_price: p.unit_price || 0,
          quantity_sold: p.quantity_sold || 0,
          quantity_in_mo: p.quantity_in_mo || 0,
          total_sales: p.total_sales || 0,
          on_hand_st: p.on_hand_st || 0,
        });
      } else {
        const item = mergedMap.get(key);
        item.ids.push(p.id);
        if (p.default_code && !item.codes.includes(p.default_code)) {
          item.codes.push(p.default_code);
        }
        if (p.company && !item.companies.includes(p.company)) {
          item.companies.push(p.company);
        }
        if (p.unit_price > item.unit_price) {
          item.unit_price = p.unit_price;
        }
        if (!item.category && p.category) {
          item.category = p.category;
        }
        item.quantity_sold += p.quantity_sold || 0;
        item.quantity_in_mo += p.quantity_in_mo || 0;
        item.total_sales += p.total_sales || 0;
        item.on_hand_st += p.on_hand_st || 0;
      }
    });

    let productList = Array.from(mergedMap.values()).map((item) => ({
      ...item,
      default_code: item.codes.join(", ") || "",
      company: item.companies.join(" / ") || "Bonario",
    }));

    if (productName) {
      const search = productName.toLowerCase();
      productList = productList.filter(
        (p) =>
          p.name.toLowerCase().includes(search) ||
          p.product_name.toLowerCase().includes(search) ||
          p.variant.toLowerCase().includes(search) ||
          p.default_code.toLowerCase().includes(search) ||
          p.category.toLowerCase().includes(search)
      );
    }

    // Sort by sales descending
    productList.sort(
      (a, b) => b.total_sales - a.total_sales || b.quantity_sold - a.quantity_sold
    );

    const totalRevenue = productList.reduce((sum, p) => sum + p.total_sales, 0);
    let cumulativeSales = 0;

    productList.forEach((p, idx) => {
      p.rank = idx + 1;
      p.sales_percent = totalRevenue > 0 ? (p.total_sales / totalRevenue) * 100 : 0;
      cumulativeSales += p.total_sales;
      p.cumulative_percent = totalRevenue > 0 ? (cumulativeSales / totalRevenue) * 100 : 0;

      if (p.total_sales > 0) {
        if (p.cumulative_percent <= 80) p.abc_class = "A";
        else if (p.cumulative_percent <= 95) p.abc_class = "B";
        else p.abc_class = "C";
      } else {
        p.abc_class = "C (Không phát sinh)";
      }

      // Reorder Calculations
      p.avg_daily = Number((p.quantity_sold / daysInPeriod).toFixed(4));
      p.leadtime = leadtimeDays;
      p.safety_stock =
        p.quantity_sold > 0
          ? p.avg_daily * leadtimeDays < 1
            ? 1
            : Number((p.avg_daily * leadtimeDays * 0.5).toFixed(2))
          : 0;
      p.demand_leadtime = Number((p.avg_daily * leadtimeDays).toFixed(2));
      p.min_stock = Number((p.demand_leadtime + p.safety_stock).toFixed(2));
      p.max_stock = Number((p.min_stock + p.avg_daily * reviewPeriodDays).toFixed(2));
      p.moq = "Dựa theo NCC yêu cầu";
      p.reorder_qty =
        p.quantity_sold > 0 && p.on_hand_st <= p.min_stock
          ? Number(Math.max(0, p.max_stock - p.on_hand_st).toFixed(2))
          : 0;
    });

    // Build Excel Workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Bonario System";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Doanh Số & Reorder Đồ Gỗ - Ghế", {
      views: [{ state: "frozen", ySplit: 4 }],
    });

    // Title Block
    worksheet.mergeCells("A1:T1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = "BÁO CÁO DOANH SỐ VÀ TÍNH TOÁN REORDER SẢN PHẨM ĐỒ GỖ & GHẾ";
    titleCell.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    worksheet.getRow(1).height = 32;

    // Subtitle / Info
    worksheet.mergeCells("A2:T2");
    const infoCell = worksheet.getCell("A2");
    const dateRangeStr =
      startDate || endDate
        ? `Kỳ: ${startDate || "Từ đầu"} đến ${endDate || "Hiện tại"} (${daysInPeriod} ngày)`
        : `Kỳ phân tích: ${daysInPeriod} ngày`;
    infoCell.value = `Kho: Sĩ Thông (ORDST) | ${dateRangeStr} | Leadtime: ${leadtimeDays} ngày | Review Period: ${reviewPeriodDays} ngày | Ngày xuất: ${new Date().toLocaleDateString("vi-VN")}`;
    infoCell.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF475569" } };
    infoCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    infoCell.alignment = { horizontal: "center", vertical: "middle" };
    worksheet.getRow(2).height = 22;

    worksheet.getRow(3).height = 8;

    // Headers
    const headers = [
      { header: "STT", key: "rank", width: 6 },
      { header: "Phân loại Class", key: "abc_class", width: 18 },
      { header: "Mã SKU", key: "default_code", width: 18 },
      { header: "Tên Sản Phẩm", key: "product_name", width: 36 },
      { header: "Biến thể / Quy cách", key: "variant", width: 28 },
      { header: "Danh mục Odoo", key: "category", width: 26 },
      { header: "Công ty", key: "company", width: 16 },
      { header: "Đơn giá (VND)", key: "unit_price", width: 16 },
      { header: "SL Bán (kỳ)", key: "quantity_sold", width: 14 },
      { header: "Doanh số (VND)", key: "total_sales", width: 18 },
      { header: "Tỷ lệ %", key: "sales_percent", width: 10 },
      { header: "Tích lũy %", key: "cumulative_percent", width: 12 },
      { header: "Tồn kho Sĩ Thông", key: "on_hand_st", width: 18 },
      { header: "Bán TB/Ngày (Avg Daily)", key: "avg_daily", width: 22 },
      { header: "Leadtime (Ngày)", key: "leadtime", width: 14 },
      { header: "Safety Stock", key: "safety_stock", width: 14 },
      { header: "Điểm đặt lại (Min)", key: "min_stock", width: 18 },
      { header: "Tồn tối đa (Max)", key: "max_stock", width: 18 },
      { header: "MOQ", key: "moq", width: 20 },
      { header: "Đề xuất đặt thêm", key: "reorder_qty", width: 18 },
    ];

    worksheet.columns = headers;

    const headerRow = worksheet.getRow(4);
    headerRow.height = 28;
    headerRow.values = headers.map((h) => h.header);

    headerRow.eachCell((cell) => {
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = {
        top: { style: "thin", color: { argb: "FFCBD5E1" } },
        left: { style: "thin", color: { argb: "FFCBD5E1" } },
        bottom: { style: "medium", color: { argb: "FF1E40AF" } },
        right: { style: "thin", color: { argb: "FFCBD5E1" } },
      };
    });

    // Populate Rows
    productList.forEach((p, idx) => {
      const row = worksheet.addRow([
        p.rank,
        p.abc_class,
        p.default_code || "N/A",
        p.product_name,
        p.variant || "-",
        p.category,
        p.company,
        p.unit_price,
        p.quantity_sold,
        p.total_sales,
        p.sales_percent / 100,
        p.cumulative_percent / 100,
        p.on_hand_st,
        p.avg_daily,
        p.leadtime,
        p.safety_stock,
        p.min_stock,
        p.max_stock,
        p.moq,
        p.reorder_qty,
      ]);

      row.height = 20;

      const isEven = idx % 2 === 0;
      const bgArgb = isEven ? "FFFFFFFF" : "FFF8FAFC";

      row.eachCell((cell, colNumber) => {
        cell.font = { name: "Arial", size: 9 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgArgb } };
        cell.border = {
          top: { style: "thin", color: { argb: "FFE2E8F0" } },
          left: { style: "thin", color: { argb: "FFE2E8F0" } },
          bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
          right: { style: "thin", color: { argb: "FFE2E8F0" } },
        };

        if ([1, 2, 15, 19].includes(colNumber)) {
          cell.alignment = { horizontal: "center", vertical: "middle" };
        } else if ([8, 10].includes(colNumber)) {
          cell.numFmt = '#,##0 "₫"';
          cell.alignment = { horizontal: "right", vertical: "middle" };
        } else if ([11, 12].includes(colNumber)) {
          cell.numFmt = "0.00%";
          cell.alignment = { horizontal: "right", vertical: "middle" };
        } else if ([9, 13].includes(colNumber)) {
          cell.numFmt = "#,##0";
          cell.alignment = { horizontal: "right", vertical: "middle" };
        } else if ([14].includes(colNumber)) {
          cell.numFmt = "0.0000";
          cell.alignment = { horizontal: "right", vertical: "middle" };
        } else if ([16, 17, 18, 20].includes(colNumber)) {
          cell.numFmt = "#,##0.00";
          cell.alignment = { horizontal: "right", vertical: "middle" };
        } else {
          cell.alignment = { horizontal: "left", vertical: "middle" };
        }

        // Highlight Class A, B, C
        if (colNumber === 2) {
          cell.font = { name: "Arial", size: 9, bold: true };
          if (p.abc_class === "A") {
            cell.font.color = { argb: "FF15803D" };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
          } else if (p.abc_class === "B") {
            cell.font.color = { argb: "FFB45309" };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
          } else if (p.abc_class === "C") {
            cell.font.color = { argb: "FF475569" };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
          }
        }

        // Highlight Reorder alert
        if (colNumber === 20 && p.reorder_qty > 0) {
          cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFDC2626" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
        }
      });
    });

    const nowStr = new Date().toISOString().slice(0, 10);
    const fileName = `Bao_Cao_Doanh_So_Reorder_Do_Go_Ghe_${nowStr}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("[Excel Export Error]:", error.message);
    next(error);
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
