import { fmtIDR, fmtNum, fmtPct } from '../format.js';

function Tile({ label, value, sub }) {
  return (
    <div className="card tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

export default function KpiRow({ products }) {
  const skus = products.length;
  const unique = new Set(products.map((p) => p.name)).size;
  const active = products.filter((p) => p.status === 'Active').length;
  const outOfStock = products.filter((p) => p.status === 'Habis').length;
  const modals = products.map((p) => p.modal).filter((v) => v > 0);
  const avgModal = modals.length ? modals.reduce((a, b) => a + b, 0) / modals.length : null;
  const changes = products.map((p) => p.costChangePct).filter((v) => v != null);
  const avgChange = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null;

  return (
    <div className="kpis">
      <Tile label="SKUs" value={fmtNum(skus)} sub={`${fmtNum(unique)} products`} />
      <Tile label="Active" value={fmtNum(active)} sub={skus ? `${fmtPct(active / skus)} of SKUs` : null} />
      <Tile label="Out of stock (Habis)" value={fmtNum(outOfStock)} sub={skus ? `${fmtPct(outOfStock / skus)} of SKUs` : null} />
      <Tile label="Avg. cost (modal)" value={fmtIDR(avgModal)} sub="per SKU" />
      <Tile label="Avg. cost change" value={avgChange == null ? '—' : `${avgChange > 0 ? '+' : ''}${fmtPct(avgChange)}`} sub="old → new modal" />
    </div>
  );
}
