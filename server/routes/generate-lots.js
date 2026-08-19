import crypto from "crypto";
import express from "express";
import { callOdooAPI, getOdooConfig } from "../odoo-helper.js";

const router = express.Router();
const RECEIPT_TYPE_CODE = "incoming";
const ALLOWED_STATES = new Set([
  "draft",
  "confirmed",
  "waiting",
  "assigned",
  "partially_available",
]);
const applyingPickings = new Set();
const QTY_EPSILON = 0.000001;

export function normalizeLotSegment(rawValue, fallback = "PRODUCT") {
  if (!rawValue) return fallback;
  const value = String(rawValue)
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[Đđ]/g, "D")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-");
  return value.replace(/-+/g, "-").replace(/^-+|-+$/g, "") || fallback;
}

export function slugifyProductName(rawName) {
  if (!rawName) return "PRODUCT";
  let value = String(rawName).trim();
  if (value.toUpperCase().startsWith("ORD-")) value = value.slice(4);
  const parenIndex = value.indexOf("(");
  if (parenIndex >= 0) value = value.slice(0, parenIndex);
  return normalizeLotSegment(value);
}

function pad3(number) {
  return String(number).padStart(3, "0");
}

function asQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? quantity : 0;
}

function isOneUnit(value) {
  return Math.abs(asQuantity(value) - 1) < QTY_EPSILON;
}

function moveLineQuantity(line) {
  return asQuantity(line.quantity ?? line.qty_done);
}

function toId(value) {
  return Array.isArray(value) ? value[0] : value || false;
}

function pickingSummary(picking) {
  return {
    id: picking.id,
    name: picking.name,
    state: picking.state,
    origin: picking.origin,
    company_id: toId(picking.company_id),
    picking_type: picking.picking_type_id?.[1] || null,
    scheduled_date: picking.scheduled_date,
  };
}

function planHash(pickingId, lots) {
  const body = lots
    .map(
      (lot) =>
        `${lot.move_line_id}:${lot.product_id}:${lot.name}:${lot.id || "new"}:${lot.previous_name || ""}:${lot.subcontract_mo_id || ""}`
    )
    .join("|");
  return crypto.createHash("sha256").update(`${pickingId}|${body}`).digest("hex");
}

export async function resolveSourceDocumentCode(picking, call) {
  const rows = await call("stock.picking", "read", [picking.id], {
    positionalArgs: [[picking.id]],
    fields: ["purchase_id"],
  });
  const purchaseId = toId(rows?.[0]?.purchase_id);
  if (purchaseId) {
    const purchases = await call("purchase.order", "read", [purchaseId], {
      positionalArgs: [[purchaseId]],
      fields: ["name"],
    });
    if (purchases?.[0]?.name) return normalizeLotSegment(purchases[0].name, "PURCHASE");
  }

  const moves = await call(
    "stock.move",
    "search_read",
    [["picking_id", "=", picking.id], ["production_id", "!=", false]],
    ["production_id"]
  );
  const productionIds = [...new Set(moves.map((move) => toId(move.production_id)).filter(Boolean))];
  if (productionIds.length === 1) {
    const productions = await call("mrp.production", "read", [productionIds[0]], {
      positionalArgs: [[productionIds[0]]],
      fields: ["name"],
    });
    if (productions?.[0]?.name) return normalizeLotSegment(productions[0].name, "MANUFACTURING");
  }
  if (productionIds.length > 1) {
    const error = new Error(
      `Phiếu "${picking.name}" có nhiều lệnh sản xuất nguồn. Không thể chọn một mã đầu lot duy nhất.`
    );
    error.status = 422;
    throw error;
  }

  // Some customized receipt flows do not propagate production_id to the move.
  // Accept an origin only when it exactly matches one PO or one MO name.
  const origin = String(picking.origin || "").trim();
  if (origin) {
    const [purchases, productions] = await Promise.all([
      call("purchase.order", "search_read", [["name", "=", origin]], ["name"]),
      call("mrp.production", "search_read", [["name", "=", origin]], ["name"]),
    ]);
    const candidates = [...(purchases || []), ...(productions || [])];
    if (candidates.length === 1) return normalizeLotSegment(candidates[0].name, "SOURCE");
    if (candidates.length > 1) {
      const error = new Error(
        `Source Document "${origin}" khớp nhiều PO/MO. Không thể chọn một mã đầu lot duy nhất.`
      );
      error.status = 422;
      throw error;
    }
  }

  const error = new Error(
    `Không tìm được Purchase Order hoặc Manufacturing Order nguồn của phiếu "${picking.name}". Không tạo lot để tránh dùng mã đầu sai.`
  );
  error.status = 422;
  throw error;
}

/**
 * Collect serial-tracked detail lines. A completed subcontracting receipt is
 * deliberately blocked: changing its Detail can make Odoo reprocess and try
 * to cancel its already-done subcontracting MO.
 */
export async function collectSerialTargets(pickingId, pickingCompanyId, call) {
  const moves = await call(
    "stock.move",
    "search_read",
    [["picking_id", "=", pickingId]],
    ["id", "product_id", "product_uom_qty", "is_subcontract"]
  );
  if (!moves?.length) return { products: [], blockingIssues: [] };

  const moveLines = await call(
    "stock.move.line",
    "search_read",
    [["picking_id", "=", pickingId]],
    ["id", "product_id", "move_id", "quantity", "qty_done", "lot_id", "lot_name"]
  );
  const productIds = [...new Set(moves.map((move) => toId(move.product_id)).filter(Boolean))];
  const products = productIds.length
    ? await call(
        "product.product",
        "search_read",
        [["id", "in", productIds]],
        ["id", "name", "tracking", "company_id"]
      )
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));
  const grouped = new Map();

  for (const move of moves) {
    const productId = toId(move.product_id);
    const product = productById.get(productId);
    if (!product || product.tracking !== "serial") continue;
    if (!grouped.has(productId)) {
      grouped.set(productId, {
        product_id: productId,
        product_name: product.name,
        slug: slugifyProductName(product.name),
        company_id: pickingCompanyId || toId(product.company_id) || false,
        is_subcontract: false,
        moves: [],
      });
    }
    const group = grouped.get(productId);
    group.moves.push(move);
    group.is_subcontract ||= Boolean(move.is_subcontract);
  }

  const result = [];
  const blockingIssues = [];
  for (const group of grouped.values()) {
    const moveIds = new Set(group.moves.map((move) => move.id));
    const lines = moveLines.filter(
      (line) => toId(line.product_id) === group.product_id && moveIds.has(toId(line.move_id))
    );
    const expectedQty = group.moves.reduce((sum, move) => sum + asQuantity(move.product_uom_qty), 0);
    const lineDetails = lines.map((line) => ({
      line,
      quantity: moveLineQuantity(line),
      hasLot: Boolean(line.lot_id || line.lot_name),
    }));
    const detailedQty = lineDetails.reduce((sum, detail) => sum + detail.quantity, 0);
    const existingLots = lineDetails
      .filter((detail) => detail.hasLot)
      .map(({ line }) => ({
        move_line_id: line.id,
        id: toId(line.lot_id) || null,
        name: line.lot_id?.[1] || line.lot_name,
        reason: "Đã được gắn trên Detail của phiếu nhập.",
      }));
    const invalidLines = lineDetails.filter((detail) => !isOneUnit(detail.quantity));
    const plannableLines = lineDetails
      .filter((detail) => !detail.hasLot && isOneUnit(detail.quantity))
      .map(({ line, quantity }) => ({ id: line.id, quantity }));

    if (!lines.length && expectedQty > 0) {
      blockingIssues.push({
        product_id: group.product_id,
        product_name: group.product_name,
        code: "missing_detailed_operations",
        message: "Chưa có dòng Detail để gán serial. Hãy tạo Detailed Operations theo từng đơn vị trước.",
      });
    }
    if (lines.length && Math.abs(detailedQty - expectedQty) >= QTY_EPSILON) {
      blockingIssues.push({
        product_id: group.product_id,
        product_name: group.product_name,
        code: "serial_detail_quantity_mismatch",
        message: `Tổng số lượng Detail (${detailedQty}) không khớp số lượng yêu cầu (${expectedQty}). Hãy đồng bộ Detailed Operations trước khi Apply.`,
      });
    }
    if (invalidLines.length) {
      blockingIssues.push({
        product_id: group.product_id,
        product_name: group.product_name,
        code: "serial_line_quantity_not_one",
        message: "Mọi dòng Detail của sản phẩm tracking serial phải có số lượng đúng bằng 1, kể cả dòng đã có lot. Hãy tách các dòng sai trước khi Apply.",
        move_line_ids: invalidLines.map(({ line }) => line.id),
      });
    }

    result.push({
      product_id: group.product_id,
      product_name: group.product_name,
      slug: group.slug,
      company_id: group.company_id,
      is_subcontract: group.is_subcontract,
      total_qty: expectedQty,
      need_lots: plannableLines.length,
      plannable_lines: plannableLines,
      invalid_lines: invalidLines.map(({ line, quantity }) => ({ id: line.id, quantity })),
      move_lines: lines.map((line) => ({
        id: line.id,
        qty: moveLineQuantity(line),
        lot_id: toId(line.lot_id) || null,
        lot_name: line.lot_name || null,
      })),
      existing_lots: existingLots,
    });
  }

  return { products: result, blockingIssues };
}

/**
 * Match every missing subcontract Detail line to exactly one source MO. The
 * source MO's Lot/Serial Number is linked before its receipt Detail changes,
 * which avoids any reset or cancellation of a completed MO.
 */
export async function resolveSubcontractAssignments(pickingId, products, call) {
  const serialProducts = products.filter(
    (product) => product.is_subcontract && product.plannable_lines?.length
  );
  if (!serialProducts.length) return { byMoveLine: new Map(), blockingIssues: [] };

  const productIds = serialProducts.map((product) => product.product_id);
  const sourceMOs = await call(
    "mrp.production",
    "search_read",
    [["incoming_picking", "=", pickingId], ["product_id", "in", productIds]],
    ["id", "name", "state", "product_id", "product_qty", "lot_producing_ids"]
  );
  const sourceLotIds = [
    ...new Set(sourceMOs.flatMap((mo) => mo.lot_producing_ids || []).filter(Boolean)),
  ];
  const sourceLots = sourceLotIds.length
    ? await call("stock.lot", "search_read", [["id", "in", sourceLotIds]], ["id", "name"])
    : [];
  const lotById = new Map(sourceLots.map((lot) => [lot.id, lot]));
  const byMoveLine = new Map();
  const blockingIssues = [];

  for (const product of serialProducts) {
    const lines = product.plannable_lines || [];
    const mos = sourceMOs
      .filter((mo) => toId(mo.product_id) === product.product_id)
      .sort((left, right) => left.id - right.id);
    const invalidQuantity = mos.filter((mo) => !isOneUnit(mo.product_qty));
    const ambiguous = mos.some(
      (mo) => mo.state === "cancel" || (mo.lot_producing_ids || []).length > 1
    );
    if (invalidQuantity.length || mos.length !== lines.length || ambiguous) {
      blockingIssues.push({
        product_id: product.product_id,
        product_name: product.product_name,
        code: "subcontract_source_mo_mismatch",
        message:
          "Không thể ghép an toàn từng serial với Subcontracting MO nguồn. Mỗi Detail serial phải có đúng một MO nguồn, số lượng 1 và tối đa một lot.",
      });
      continue;
    }

    lines.forEach((line, index) => {
      const mo = mos[index];
      const lotId = mo.lot_producing_ids?.[0] || null;
      const lot = lotId ? lotById.get(lotId) : null;
      byMoveLine.set(line.id, {
        subcontract_mo_id: mo.id,
        subcontract_mo_name: mo.name,
        existing_lot_id: lotId,
        existing_lot_name: lot?.name || null,
      });
    });
  }

  return { byMoveLine, blockingIssues };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function lotSequenceNamespace(poCode, product) {
  return `${product.company_id || 0}:${poCode}-${product.slug}-`;
}

export function isGeneratedLotName(poCode, product, lotName) {
  const prefix = `${poCode}-${product.slug}-`;
  return new RegExp(`^${escapeRegExp(prefix)}\\d+$`).test(String(lotName || ""));
}

export async function nextSequences(poCode, products, call) {
  const productsByNamespace = new Map();
  for (const product of products) {
    const namespace = lotSequenceNamespace(poCode, product);
    if (!productsByNamespace.has(namespace)) productsByNamespace.set(namespace, product);
  }

  const sequenceByNamespace = new Map();
  for (const [namespace, product] of productsByNamespace) {
    const prefix = `${poCode}-${product.slug}-`;
    const rows = await call(
      "stock.lot",
      "search_read",
      [["company_id", "=", product.company_id || false], ["name", "=ilike", `${prefix}%`]],
      ["name"]
    );
    const matcher = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`);
    const max = rows.reduce((highest, lot) => {
      const match = matcher.exec(String(lot.name || ""));
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    sequenceByNamespace.set(namespace, max + 1);
  }
  return sequenceByNamespace;
}

export function buildLotPlan(poCode, products, sequenceByNamespace) {
  const lots = [];
  const nextByNamespace = new Map(sequenceByNamespace);
  const plannedNames = new Set();
  for (const product of products) {
    const namespace = lotSequenceNamespace(poCode, product);
    let sequence = nextByNamespace.get(namespace) || 1;
    for (const line of product.plannable_lines || []) {
      const name = `${poCode}-${product.slug}-${pad3(sequence)}`;
      const uniqueKey = `${product.company_id || 0}:${name}`;
      if (plannedNames.has(uniqueKey)) {
        throw new Error(`Kế hoạch tạo lot bị trùng mã "${name}" trong cùng công ty.`);
      }
      plannedNames.add(uniqueKey);
      lots.push({
        name,
        product_id: product.product_id,
        product_name: product.product_name,
        company_id: product.company_id || false,
        sequence,
        move_line_id: line.id,
      });
      sequence += 1;
    }
    nextByNamespace.set(namespace, sequence);
  }
  return lots;
}

async function findPicking(pickingName, call) {
  const value = String(pickingName || "").trim();
  if (!value) return null;
  const numeric = /^\d+$/.test(value);
  const rows = await call(
    "stock.picking",
    "search_read",
    [numeric ? ["id", "=", Number(value)] : ["name", "=", value]],
    ["id", "name", "state", "origin", "company_id", "picking_type_id", "scheduled_date"]
  );
  if (!rows?.length) return null;
  return rows.reduce((latest, row) => {
    const latestTime = latest.scheduled_date ? new Date(latest.scheduled_date).getTime() : 0;
    const rowTime = row.scheduled_date ? new Date(row.scheduled_date).getTime() : 0;
    return rowTime > latestTime || (rowTime === latestTime && row.id > latest.id) ? row : latest;
  });
}

function assertOdooConfiguration() {
  const config = getOdooConfig();
  if (!config.url || !config.db || !config.uid || !config.apikey) {
    const error = new Error("Server configuration error. Please check server/.env file and restart the server.");
    error.status = 500;
    throw error;
  }
}

async function assertIncomingReceipt(picking, call) {
  const typeId = toId(picking.picking_type_id);
  if (!typeId) return;
  const typeRows = await call("stock.picking.type", "read", [typeId], {
    positionalArgs: [[typeId]],
    fields: ["code", "use_create_lots", "use_existing_lots"],
  });
  const type = typeRows?.[0];
  if (type?.code && type.code !== RECEIPT_TYPE_CODE) {
    const error = new Error(`Phiếu "${picking.name}" không phải phiếu nhập kho. Chỉ hỗ trợ Receipts (incoming).`);
    error.status = 400;
    throw error;
  }
}

async function writeMoveLine(moveLineId, values, call) {
  // `execute_kw` receives one positional-argument list.  Sending the ids and
  // values as two top-level JSON-RPC items makes Odoo treat `values` as
  // keyword arguments ("unexpected keyword argument 'lot_id'").
  await call("stock.move.line", "write", [], {
    positionalArgs: [[[moveLineId], values]],
  });
}

async function writeLot(lotId, values, call) {
  await call("stock.lot", "write", [], {
    positionalArgs: [[[lotId], values]],
  });
}

async function removeUnlinkedLot(lotId, call) {
  await call("stock.lot", "unlink", [], { positionalArgs: [[[lotId]]] });
}

/**
 * First assign the concrete stock.lot. If this environment blocks lot_id
 * writes, clean the new lot back up and use Odoo's native pending lot_name
 * field. Odoo creates that lot during Validate; no move line is deleted.
 */
async function linkLotToSubcontractMO(moId, lotId, call) {
  await call("mrp.production", "write", [], {
    positionalArgs: [[[moId], { lot_producing_ids: [[4, lotId]] }]],
  });
}

export async function createAndAssignLot(item, call) {
  if (item.id) {
    if (item.rename_source_lot) {
      const rows = await call("stock.lot", "read", [item.id], {
        positionalArgs: [[item.id]],
        fields: ["id", "name", "product_id", "company_id"],
      });
      const current = rows?.[0];
      if (
        !current ||
        current.name !== item.previous_name ||
        toId(current.product_id) !== item.product_id ||
        toId(current.company_id) !== (item.company_id || false)
      ) {
        const error = new Error("Lot nguồn đã thay đổi sau Preview. Vui lòng Preview lại.");
        error.status = 409;
        throw error;
      }
      const collisions = await call(
        "stock.lot",
        "search_read",
        [["company_id", "=", item.company_id || false], ["name", "=", item.name]],
        ["id", "name", "product_id"]
      );
      if ((collisions || []).some((lot) => lot.id !== item.id)) {
        const error = new Error(`Mã lot "${item.name}" vừa được sử dụng. Vui lòng Preview lại.`);
        error.status = 409;
        throw error;
      }

      await writeLot(item.id, { name: item.name }, call);
      try {
        await writeMoveLine(item.move_line_id, { lot_id: item.id }, call);
      } catch (lineError) {
        try {
          await writeLot(item.id, { name: item.previous_name }, call);
        } catch (rollbackError) {
          throw new Error(
            `Đã đổi tên lot nhưng không gán được vào Detail (${lineError.message}); rollback tên lot cũng lỗi (${rollbackError.message}).`
          );
        }
        throw lineError;
      }
      return {
        ...item,
        created: false,
        renamed: true,
        assign_method: "source_lot_renamed_then_lot_id",
        pending_lot: false,
      };
    }

    await writeMoveLine(item.move_line_id, { lot_id: item.id }, call);
    return {
      ...item,
      created: false,
      renamed: false,
      assign_method: item.subcontract_mo_id ? "subcontract_mo_then_lot_id" : "lot_id",
      pending_lot: false,
    };
  }
  const createdId = await call(
    "stock.lot",
    "create",
    [[{ name: item.name, product_id: item.product_id, company_id: item.company_id || false }]],
    { positionalArgs: [[{ name: item.name, product_id: item.product_id, company_id: item.company_id || false }]] }
  );
  const lotId = Array.isArray(createdId) ? createdId[0] : createdId;

  if (item.subcontract_mo_id) {
    try {
      await linkLotToSubcontractMO(item.subcontract_mo_id, lotId, call);
    } catch (error) {
      await removeUnlinkedLot(lotId, call);
      throw error;
    }
  }

  try {
    const lineValues = { lot_id: lotId };
    await writeMoveLine(item.move_line_id, lineValues, call);
    return {
      ...item,
      id: lotId,
      created: true,
      assign_method: item.subcontract_mo_id ? "subcontract_mo_then_lot_id" : "lot_id",
      pending_lot: false,
    };
  } catch (lotWriteError) {
    if (item.subcontract_mo_id) throw lotWriteError;
    try {
      await removeUnlinkedLot(lotId, call);
    } catch (cleanupError) {
      throw new Error(
        `Không thể gán lot_id (${lotWriteError.message}) và cũng không thể xoá lot vừa tạo (${cleanupError.message}). Dừng để tránh lot mồ côi.`
      );
    }
    throw lotWriteError;
  }
}

async function verifyAssignments(items, call) {
  if (!items.length) return new Set();
  const rows = await call(
    "stock.move.line",
    "search_read",
    [["id", "in", items.map((item) => item.move_line_id)]],
    ["id", "lot_id", "lot_name"]
  );
  const lineById = new Map(rows.map((line) => [line.id, line]));
  const verified = new Set();
  for (const item of items) {
    const line = lineById.get(item.move_line_id);
    const lotName = line?.lot_id?.[1] || line?.lot_name;
    if (lotName === item.name) verified.add(item.move_line_id);
  }
  return verified;
}

async function makePlan(pickingName, call) {
  const picking = await findPicking(pickingName, call);
  if (!picking) {
    const error = new Error(`Không tìm thấy phiếu "${pickingName}" trên Odoo`);
    error.status = 404;
    throw error;
  }
  await assertIncomingReceipt(picking, call);
  if (!ALLOWED_STATES.has(picking.state)) {
    const error = new Error(`Phiếu "${picking.name}" đang ở trạng thái "${picking.state}" nên không thể tạo serial.`);
    error.status = 400;
    throw error;
  }

  const analysis = await collectSerialTargets(picking.id, toId(picking.company_id), call);
  const subcontract = await resolveSubcontractAssignments(picking.id, analysis.products, call);
  const blockingIssues = [...analysis.blockingIssues, ...subcontract.blockingIssues];
  const productPlans = analysis.products
    .map((product) => ({
      ...product,
      plannable_lines: (product.plannable_lines || []).filter((line) => {
        if (!product.is_subcontract) return true;
        return subcontract.byMoveLine.has(line.id);
      }),
    }))
    .filter((product) => product.plannable_lines.length);
  const poCode = productPlans.length ? await resolveSourceDocumentCode(picking, call) : null;
  const productsNeedingGeneratedNames = productPlans
    .map((product) => ({
      ...product,
      plannable_lines: product.plannable_lines.filter((line) => {
        const source = subcontract.byMoveLine.get(line.id);
        return (
          !source?.existing_lot_id ||
          !isGeneratedLotName(poCode, product, source.existing_lot_name)
        );
      }),
    }))
    .filter((product) => product.plannable_lines.length);
  const sequenceByNamespace = productsNeedingGeneratedNames.length
    ? await nextSequences(poCode, productsNeedingGeneratedNames, call)
    : new Map();
  const generatedLots = buildLotPlan(
    poCode,
    productsNeedingGeneratedNames,
    sequenceByNamespace
  );
  const generatedByMoveLine = new Map(generatedLots.map((lot) => [lot.move_line_id, lot]));
  const lots = [];
  for (const product of productPlans) {
    for (const line of product.plannable_lines) {
      const source = subcontract.byMoveLine.get(line.id);
      const generated = generatedByMoveLine.get(line.id);
      if (source?.existing_lot_id) {
        const desiredName = generated?.name || source.existing_lot_name;
        const renameSourceLot = desiredName !== source.existing_lot_name;
        lots.push({
          name: desiredName,
          id: source.existing_lot_id,
          previous_name: renameSourceLot ? source.existing_lot_name : null,
          rename_source_lot: renameSourceLot,
          sequence: generated?.sequence,
          product_id: product.product_id,
          product_name: product.product_name,
          company_id: product.company_id,
          move_line_id: line.id,
          subcontract_mo_id: source.subcontract_mo_id,
          subcontract_mo_name: source.subcontract_mo_name,
          existing_source_lot: true,
        });
      } else if (generated) {
        lots.push({
          ...generated,
          subcontract_mo_id: source?.subcontract_mo_id || null,
          subcontract_mo_name: source?.subcontract_mo_name || null,
        });
      }
    }
  }

  return {
    picking,
    poCode,
    products: analysis.products,
    blockingIssues,
    lots,
    hash: planHash(picking.id, lots),
  };
}

function previewResponse(plan) {
  const lotsByProduct = new Map();
  for (const lot of plan.lots) {
    if (!lotsByProduct.has(lot.product_id)) lotsByProduct.set(lot.product_id, []);
    lotsByProduct.get(lot.product_id).push({
      name: lot.name,
      sequence: lot.sequence,
      move_line_id: lot.move_line_id,
      existing_source_lot: Boolean(lot.existing_source_lot),
      rename_source_lot: Boolean(lot.rename_source_lot),
      previous_name: lot.previous_name || null,
      subcontract_mo_name: lot.subcontract_mo_name || null,
    });
  }
  const canApply = plan.lots.length > 0 && plan.blockingIssues.length === 0;
  const totalSkipped = plan.products.reduce(
    (total, product) => total + (product.existing_lots?.length || 0),
    0
  );
  return {
    picking: pickingSummary(plan.picking),
    po_code: plan.poCode,
    plan_hash: plan.hash,
    can_apply: canApply,
    blocking_issues: plan.blockingIssues,
    products: plan.products.map((product) => ({
      product_id: product.product_id,
      product_name: product.product_name,
      slug: product.slug,
      is_subcontract: product.is_subcontract,
      total_qty: product.total_qty,
      need_lots: product.need_lots,
      lots: lotsByProduct.get(product.product_id) || [],
      skipped: product.existing_lots || [],
      failed: [],
    })),
    total_to_assign: plan.lots.length,
    total_to_create: plan.lots.filter((lot) => !lot.id).length,
    total_existing_source_lots: plan.lots.filter((lot) => lot.existing_source_lot).length,
    total_to_rename: plan.lots.filter((lot) => lot.rename_source_lot).length,
    total_skipped: totalSkipped,
    applied: false,
    message: plan.blockingIssues.length
      ? "Cần xử lý các dòng Detail được cảnh báo trước khi Apply."
      : plan.lots.length
        ? "Preview — chưa tạo hoặc ghi serial nào trên Odoo."
        : "Tất cả các dòng serial đã có lot/serial trên Detail.",
  };
}

async function runGenerateLots(pickingName, expectedPlanHash) {
  assertOdooConfiguration();
  if (typeof expectedPlanHash !== "string" || !expectedPlanHash.trim()) {
    const error = new Error("Bắt buộc Preview trước khi Apply.");
    error.status = 400;
    throw error;
  }

  const plan = await makePlan(pickingName, callOdooAPI);
  const lockKey = plan.picking.id;
  if (applyingPickings.has(lockKey)) {
    const error = new Error("Phiếu này đang được Apply. Vui lòng chờ thao tác trước hoàn tất.");
    error.status = 409;
    throw error;
  }
  applyingPickings.add(lockKey);

  try {
  if (expectedPlanHash !== plan.hash) {
    const error = new Error("Phiếu hoặc Detail đã thay đổi sau Preview. Vui lòng Preview lại trước khi Apply.");
    error.status = 409;
    throw error;
  }
  if (plan.blockingIssues.length) {
    const error = new Error("Không thể Apply vì có dòng Detail chưa đúng quy tắc serial.");
    error.status = 422;
    error.payload = { blocking_issues: plan.blockingIssues };
    throw error;
  }

  const applied = [];
  const failed = [];
  for (const item of plan.lots) {
    try {
      applied.push(await createAndAssignLot(item, callOdooAPI));
    } catch (error) {
      failed.push({ ...item, error: error.message });
    }
  }

  const verifiedIds = await verifyAssignments(applied, callOdooAPI);
  const verified = applied.filter((item) => verifiedIds.has(item.move_line_id));
  for (const item of applied.filter((item) => !verifiedIds.has(item.move_line_id))) {
    failed.push({ ...item, error: "Odoo không xác nhận mã serial đã được ghi vào Detail." });
  }

  const byProduct = (product) => ({
    product_id: product.product_id,
    product_name: product.product_name,
    slug: product.slug,
    is_subcontract: product.is_subcontract,
    total_qty: product.total_qty,
    need_lots: product.need_lots,
    lots: verified
      .filter((item) => item.product_id === product.product_id)
      .map((item) => ({
        name: item.name,
        id: item.id,
        sequence: item.sequence,
        move_line_id: item.move_line_id,
        assign_method: item.assign_method,
        pending_lot: item.pending_lot,
        existing_source_lot: Boolean(item.existing_source_lot),
        renamed: Boolean(item.renamed),
        previous_name: item.previous_name || null,
      })),
    skipped: product.existing_lots || [],
    failed: failed
      .filter((item) => item.product_id === product.product_id)
      .map((item) => ({ name: item.name, error: item.error, move_line_id: item.move_line_id })),
  });

  const pendingCount = verified.filter((item) => item.pending_lot).length;
  const createdCount = verified.filter((item) => item.created).length;
  const renamedCount = verified.filter((item) => item.renamed).length;
  return {
    picking: pickingSummary(plan.picking),
    po_code: plan.poCode,
    products: plan.products.map(byProduct),
    total_to_create: plan.lots.filter((lot) => !lot.id).length,
    total_skipped: plan.products.reduce(
      (total, product) => total + (product.existing_lots?.length || 0),
      0
    ),
    total_created: createdCount,
    total_renamed: renamedCount,
    total_assigned: verified.length,
    total_pending_lot_creation: pendingCount,
    total_failed: failed.length,
    applied: true,
    message: failed.length
      ? `Đã điền ${verified.length} serial vào Detail, còn ${failed.length} dòng lỗi.`
      : pendingCount
        ? `Đã điền ${verified.length} serial vào Detail. ${pendingCount} lot sẽ được Odoo tạo khi Validate.`
        : `Đã tạo và gán thành công ${verified.length} lot/serial vào Detail trên Odoo.`,
  };
  } finally {
    applyingPickings.delete(lockKey);
  }
}

router.post("/generate-lots/preview", async (req, res, next) => {
  try {
    const pickingName = String(req.body?.pickingName || "").trim();
    if (!pickingName) return res.status(400).json({ error: "Vui lòng nhập mã phiếu (pickingName)" });
    assertOdooConfiguration();
    res.json(previewResponse(await makePlan(pickingName, callOdooAPI)));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message, ...(error.payload || {}) });
    next(error);
  }
});

router.post("/generate-lots/apply", async (req, res, next) => {
  const pickingName = String(req.body?.pickingName || "").trim();
  if (!pickingName) return res.status(400).json({ error: "Vui lòng nhập mã phiếu (pickingName)" });
  try {
    res.json(await runGenerateLots(pickingName, req.body?.expectedPlanHash));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message, ...(error.payload || {}) });
    next(error);
  }
});

export default router;
