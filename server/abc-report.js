// Pure helpers for the ABC sales / consumption report (GET /api/abc-analysis).
// Kept free of Odoo calls so they can be unit-tested with `node --test`.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Vietnam is UTC+7 with no DST; Odoo stores datetimes in UTC.
const VN_OFFSET_HOURS = 7;

export function isValidDateString(value) {
  if (!DATE_RE.test(value || "")) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function formatUtc(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

// Convert a Vietnam calendar day range (inclusive) into Odoo UTC datetime bounds.
// e.g. 2026-09-01..2026-09-30 → "2026-08-31 17:00:00" .. "2026-09-30 16:59:59"
export function vnDateRangeToUtc(startDate, endDate) {
  const range = {};
  if (startDate) {
    const start = new Date(`${startDate}T00:00:00Z`);
    start.setUTCHours(start.getUTCHours() - VN_OFFSET_HOURS);
    range.start = formatUtc(start);
  }
  if (endDate) {
    const end = new Date(`${endDate}T23:59:59Z`);
    end.setUTCHours(end.getUTCHours() - VN_OFFSET_HOURS);
    range.end = formatUtc(end);
  }
  return range;
}

// Sort products by `value` desc and assign rank, sales_percent, cumulative_percent
// and abc_class (Pareto 80/15/5). Products with value 0 are always class C so an
// empty period never turns everything into class A.
export function assignAbcClasses(products, valueKey = "total_sales") {
  products.sort((a, b) => (b[valueKey] || 0) - (a[valueKey] || 0));
  const total = products.reduce((sum, p) => sum + (p[valueKey] || 0), 0);

  let cumulative = 0;
  products.forEach((product, index) => {
    const value = product[valueKey] || 0;
    cumulative += value;
    product.rank = index + 1;
    product.sales_percent = total > 0 ? (value / total) * 100 : 0;
    product.cumulative_percent = total > 0 ? (cumulative / total) * 100 : 0;

    if (value <= 0) product.abc_class = "C";
    // The top seller is always A, even when it alone exceeds 80% of the total.
    else if (product.cumulative_percent <= 80 || index === 0) product.abc_class = "A";
    else if (product.cumulative_percent <= 95) product.abc_class = "B";
    else product.abc_class = "C";
  });

  return products;
}

export function summarizeAbc(products, valueKey = "total_sales") {
  const summary = {
    totalProducts: products.length,
    totalRevenue: 0,
    classA_count: 0,
    classB_count: 0,
    classC_count: 0,
    classA_revenue: 0,
    classB_revenue: 0,
    classC_revenue: 0,
  };

  products.forEach((p) => {
    const value = p[valueKey] || 0;
    summary.totalRevenue += value;
    summary[`class${p.abc_class}_count`]++;
    summary[`class${p.abc_class}_revenue`] += value;
  });

  for (const cls of ["A", "B", "C"]) {
    summary[`class${cls}_percent`] =
      summary.totalRevenue > 0
        ? (summary[`class${cls}_revenue`] / summary.totalRevenue) * 100
        : 0;
  }

  return summary;
}
