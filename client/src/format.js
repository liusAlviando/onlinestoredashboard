const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('id-ID');
const pct = new Intl.NumberFormat('id-ID', { style: 'percent', maximumFractionDigits: 1 });

export const fmtIDR = (v) => (v == null ? '—' : idr.format(v));
export const fmtNum = (v) => (v == null ? '—' : num.format(v));
export const fmtPct = (v) => (v == null ? '—' : pct.format(v));
export const fmtMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};
