import { fmtNum, fmtPct } from '../format.js';

function Progress({ label, done, total }) {
  const pct = total ? done / total : 0;
  return (
    <div className="progress" title={`${label}: ${fmtNum(done)} done, ${fmtNum(total - done)} pending`}>
      <div className="progress-head">
        <span>{label}</span>
        <span>
          <strong>{fmtPct(pct)}</strong> <span className="muted">done</span>
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct * 100}%` }} />
      </div>
      <div className="progress-foot muted small">
        {fmtNum(done)} done · {fmtNum(total - done)} pending
      </div>
    </div>
  );
}

export default function WorkflowProgress({ products }) {
  const count = (key) => {
    const rows = products.filter((p) => p[key]);
    return { done: rows.filter((p) => p[key] === 'Done').length, total: rows.length };
  };
  return (
    <section className="card">
      <h2>Listing task progress</h2>
      <Progress label="Price adjustment" {...count('priceAdjustment')} />
      <Progress label="Package discount (Paket Diskon)" {...count('packageDiscountStatus')} />
      <Progress label="Minimum order active" {...count('minOrderActive')} />
    </section>
  );
}
