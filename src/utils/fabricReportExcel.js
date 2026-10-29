// Excel export for the Stock fabrics consumption report. Built in the browser
// from the rows currently shown, so the file always matches the screen.

const PRICE_SOURCE_LABEL = {
  cost: "Giá vốn",
  list: "Giá niêm yết (thiếu giá vốn)",
  none: "Không có giá",
};

function periodLabel(startDate, endDate) {
  if (startDate && endDate) return `${startDate} → ${endDate}`;
  if (startDate) return `Từ ${startDate}`;
  if (endDate) return `Đến ${endDate}`;
  return "Toàn bộ thời gian";
}

const sum = (products, key) =>
  products.reduce((total, p) => total + (p[key] || 0), 0);

export function buildFabricReportRows(products) {
  return products.map((p) => ({
    rank: p.rank,
    abc_class: p.abc_class,
    product: p.product_name || p.name,
    variant: p.variant || "",
    default_code:
      p.default_code && p.default_code !== "N/A" ? p.default_code : "",
    company: p.company || "",
    quantity_direct: p.quantity_direct || 0,
    quantity_in_mo: p.quantity_in_mo || 0,
    quantity_returned: p.quantity_returned || 0,
    quantity_sold: p.quantity_sold || 0,
    unit_price: p.unit_price || 0,
    price_source: PRICE_SOURCE_LABEL[p.price_source] || p.price_source || "",
    total_sales: p.total_sales || 0,
    direct_revenue: p.direct_revenue || 0,
    sales_percent: (p.sales_percent || 0) / 100,
    cumulative_percent: (p.cumulative_percent || 0) / 100,
    missing_cost: p.price_source !== "cost",
  }));
}

export async function buildFabricReportWorkbook(
  ExcelJS,
  { products, summary, startDate, endDate, productName, filterClass },
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Tiêu thụ vải", {
    views: [{ state: "frozen", ySplit: 5 }],
  });

  sheet.columns = [
    { key: "rank", width: 6 },
    { key: "abc_class", width: 7 },
    { key: "product", width: 34 },
    { key: "variant", width: 22 },
    { key: "default_code", width: 16 },
    { key: "company", width: 22 },
    { key: "quantity_direct", width: 12 },
    { key: "quantity_in_mo", width: 12 },
    { key: "quantity_returned", width: 12 },
    { key: "quantity_sold", width: 14 },
    { key: "unit_price", width: 14 },
    { key: "price_source", width: 26 },
    { key: "total_sales", width: 18 },
    { key: "direct_revenue", width: 18 },
    { key: "sales_percent", width: 9 },
    { key: "cumulative_percent", width: 10 },
  ];

  sheet.addRow(["Báo cáo tiêu thụ vải (Stock fabrics)"]).font = {
    bold: true,
    size: 14,
  };
  sheet.addRow([
    `Kỳ: ${periodLabel(startDate, endDate)}` +
      (productName ? ` · Tìm: "${productName}"` : "") +
      (filterClass && filterClass !== "all" ? ` · Lớp ${filterClass}` : ""),
  ]);
  sheet.addRow([
    `Tổng giá trị tiêu thụ: ${Math.round(summary?.totalRevenue || 0).toLocaleString("vi-VN")} đ` +
      ` · Doanh thu bán trực tiếp: ${Math.round(summary?.totalDirectRevenue || 0).toLocaleString("vi-VN")} đ` +
      ` · Xuất lúc ${new Date().toLocaleString("vi-VN")}`,
  ]);
  sheet.addRow([]);

  const header = sheet.addRow([
    "#",
    "Lớp",
    "Sản phẩm",
    "Biến thể",
    "Mã",
    "Công ty",
    "SL bán TT (m)",
    "SL dùng SX (m)",
    "SL trả (m)",
    "SL tiêu thụ (m)",
    "Đơn giá (đ/m)",
    "Nguồn giá",
    "Giá trị tiêu thụ (đ)",
    "Doanh thu bán TT (đ)",
    "%",
    "Lũy kế %",
  ]);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", wrapText: true };
  header.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEDE9FE" },
    };
  });

  for (const { missing_cost: missingCost, ...values } of buildFabricReportRows(
    products,
  )) {
    const row = sheet.addRow(values);
    if (missingCost)
      row.getCell("price_source").font = { color: { argb: "FFB45309" } };
  }

  sheet.addRow({
    product: "Tổng",
    quantity_direct: sum(products, "quantity_direct"),
    quantity_in_mo: sum(products, "quantity_in_mo"),
    quantity_returned: sum(products, "quantity_returned"),
    quantity_sold: sum(products, "quantity_sold"),
    total_sales: sum(products, "total_sales"),
    direct_revenue: sum(products, "direct_revenue"),
  }).font = { bold: true };

  for (const key of [
    "quantity_direct",
    "quantity_in_mo",
    "quantity_returned",
    "quantity_sold",
  ]) {
    sheet.getColumn(key).numFmt = "#,##0.00";
  }
  for (const key of ["unit_price", "total_sales", "direct_revenue"]) {
    sheet.getColumn(key).numFmt = "#,##0";
  }
  for (const key of ["sales_percent", "cumulative_percent"]) {
    sheet.getColumn(key).numFmt = "0.0%";
  }

  return workbook;
}

export async function exportFabricReportExcel(options) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = await buildFabricReportWorkbook(ExcelJS, options);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Bao_Cao_Tieu_Thu_Vai_${options.startDate || "all"}_${options.endDate || new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
