import { fmtNum, fmtPct } from '../format.js';

// Status is a state, so it uses the reserved status palette + icon + label.
export const STATUS_STYLE = {
  Active: { color: 'var(--status-good)', icon: '✓' },
  'Belum Upload': { color: 'var(--status-warning)', icon: '…' },
  Habis: { color: 'var(--status-serious)', icon: '!' },
  Deleted: { color: 'var(--status-critical)', icon: '×' },
};

export default function StatusChart({ products, order }) {
  const total = products.length;
  const counts = order.map((s) => ({ status: s, count: products.filter((p) => p.status === s).length }));
  const max = Math.max(1, ...counts.map((c) => c.count));

  return (
    <section className="card">
      <h2>SKUs by Shopee status</h2>
      <div className="hbars">
        {counts.map(({ status, count }) => {
          const st = STATUS_STYLE[status] || { color: 'var(--text-secondary)', icon: '•' };
          return (
            <div className="hbar-row" key={status} title={`${status}: ${fmtNum(count)} SKUs (${fmtPct(total ? count / total : 0)})`}>
              <div className="hbar-label">
                <span className="status-icon" style={{ background: st.color }}>
                  {st.icon}
                </span>
                {status}
              </div>
              <div className="hbar-track">
                <div className="hbar-fill" style={{ width: `${(count / max) * 100}%`, background: st.color }} />
              </div>
              <div className="hbar-value">
                {fmtNum(count)} <span className="muted">· {fmtPct(total ? count / total : 0)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
