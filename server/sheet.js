import { parse } from 'csv-parse/sync';

export const CSV_URL =
  process.env.CSV_URL ||
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTNRQgwWfezz5AzHf5KrPeaobLXEmtBKtekRVJml8qsBSC8F-1fcz8k9UbCf4VYWz5SU1HCcmiN9E-M/pub?gid=1028129083&single=true&output=csv';

// Margin columns in the sheet: selling price needed to hit each margin.
export const MARGINS = [20, 25, 27.5, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 60];

// Column index -> field. Mapped by position because the sheet has duplicate
// and blank headers (e.g. two "Paket Diskon" columns).
const COLS = {
  no: 0,
  name: 1,
  variant: 2,
  skuShopee: 3,
  skuJaknote: 4,
  weight: 5,
  link: 6,
  modal: 8,
  status: 11,
  marginStart: 12, // 13 columns: Laba 20% .. Laba 60%
  targetMargin: 26,
  uploadDate: 28,
  packQty: 29, // "X"
  minOrder: 33,
  minPackageDiscount: 34,
  packageDiscountPct: 35,
  priceAdjustment: 36,
  packageDiscountStatus: 37,
  minOrderActive: 38,
  oldCost: 39,
  newCost: 40,
  costBeforeX: 41,
};

/** Indonesian-formatted number: "11.150" -> 11150, "0,0075" -> 0.0075, "9,43%" -> 0.0943 */
export function parseNum(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s || s.startsWith('#')) return null;
  const pct = s.endsWith('%');
  if (pct) s = s.slice(0, -1);
  s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

function parseDate(raw) {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(String(raw || '').trim());
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

const str = (v) => (v == null ? '' : String(v).trim());

/** Classify the "Link Jaknot" URL by where it points. */
export function linkSource(url) {
  if (!url) return 'No link';
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'Other';
  }
  if (host === 'jakartanotebook.com' || host.endsWith('.jakartanotebook.com')) return 'Jaknot';
  if (/(^|\.)shopee\.co\.id$/.test(host) || /(^|\.)shp\.ee$/.test(host)) return 'Shopee';
  return 'Other';
}

export function parseSheet(csvText) {
  const rows = parse(csvText, { relax_column_count: true, skip_empty_lines: true });
  // Row 0 = headers, rows 1-2 = helper/meta rows in the sheet.
  const data = rows.slice(3);
  const products = [];
  for (const r of data) {
    const name = str(r[COLS.name]);
    const sku = str(r[COLS.skuShopee]);
    if (!name && !sku) continue; // blank template rows

    const prices = {};
    MARGINS.forEach((m, i) => {
      prices[m] = parseNum(r[COLS.marginStart + i]);
    });

    const oldCost = parseNum(r[COLS.oldCost]);
    const newCost = parseNum(r[COLS.newCost]);

    products.push({
      key: `${products.length}|${sku}|${str(r[COLS.skuJaknote])}`,
      no: parseNum(r[COLS.no]),
      name,
      variant: str(r[COLS.variant]),
      skuShopee: sku,
      skuJaknote: str(r[COLS.skuJaknote]),
      weight: parseNum(r[COLS.weight]),
      link: str(r[COLS.link]),
      linkSource: linkSource(str(r[COLS.link])),
      modal: parseNum(r[COLS.modal]),
      status: str(r[COLS.status]) || 'Unknown',
      prices,
      targetMargin: parseNum(r[COLS.targetMargin]),
      uploadDate: parseDate(r[COLS.uploadDate]),
      packQty: parseNum(r[COLS.packQty]),
      minOrder: parseNum(r[COLS.minOrder]),
      minPackageDiscount: parseNum(r[COLS.minPackageDiscount]),
      packageDiscountPct: parseNum(r[COLS.packageDiscountPct]),
      priceAdjustment: str(r[COLS.priceAdjustment]),
      packageDiscountStatus: str(r[COLS.packageDiscountStatus]),
      minOrderActive: str(r[COLS.minOrderActive]),
      oldCost,
      newCost,
      costBeforeX: parseNum(r[COLS.costBeforeX]),
      costChangePct: oldCost && newCost != null ? (newCost - oldCost) / oldCost : null,
    });
  }
  return products;
}

const countBy = (arr, fn) =>
  arr.reduce((acc, x) => {
    const k = fn(x);
    if (k) acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

export function summarize(products) {
  const modals = products.map((p) => p.modal).filter((v) => v != null && v > 0);
  const changes = products.map((p) => p.costChangePct).filter((v) => v != null);
  const byMonth = countBy(products, (p) => p.uploadDate?.slice(0, 7));
  return {
    totalSkus: products.length,
    uniqueProducts: new Set(products.map((p) => p.name).filter(Boolean)).size,
    byStatus: countBy(products, (p) => p.status),
    byLinkSource: countBy(products, (p) => p.linkSource),
    priceAdjustment: countBy(products, (p) => p.priceAdjustment),
    packageDiscount: countBy(products, (p) => p.packageDiscountStatus),
    avgModal: modals.length ? modals.reduce((a, b) => a + b, 0) / modals.length : null,
    totalModal: modals.reduce((a, b) => a + b, 0),
    avgCostChangePct: changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null,
    costIncreasedCount: changes.filter((c) => c > 0).length,
    uploadsByMonth: Object.keys(byMonth)
      .sort()
      .map((month) => ({ month, count: byMonth[month] })),
    margins: MARGINS,
  };
}
