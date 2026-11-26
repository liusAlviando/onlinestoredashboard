import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtIDR, fmtPct } from '../format.js';

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="tooltip">
      <div className="tooltip-title">{d.sku}</div>
      <div className="small muted">{d.fullName}</div>
      <div>
        {fmtIDR(d.oldCost)} → {fmtIDR(d.newCost)} (<strong>+{fmtPct(d.change)}</strong>)
      </div>
    </div>
  );
}

export default function CostChangeChart({ products }) {
  const data = products
    .filter((p) => p.costChangePct != null && p.costChangePct > 0)
    .sort((a, b) => b.costChangePct - a.costChangePct)
    .slice(0, 10)
    .map((p) => ({
      sku: p.skuShopee || p.skuJaknote,
      fullName: `${p.name}${p.variant ? ` — ${p.variant}` : ''}`,
      oldCost: p.oldCost,
      newCost: p.newCost,
      change: p.costChangePct,
    }));

  return (
    <section className="card">
      <h2>Largest cost (modal) increases</h2>
      {data.length === 0 ? (
        <p className="muted">No cost increases in the current selection.</p>
      ) : (
        <div className="chart">
          <ResponsiveContainer width="100%" height={Math.max(160, data.length * 26)}>
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }} barCategoryGap={4}>
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis
                type="category"
                dataKey="sku"
                width={96}
                tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<Tip />} cursor={{ fill: 'var(--hover)' }} />
              <Bar dataKey="change" fill="var(--series-2)" radius={[0, 4, 4, 0]} maxBarSize={18}>
                <LabelList
                  dataKey="change"
                  position="right"
                  formatter={(v) => `+${fmtPct(v)}`}
                  style={{ fill: 'var(--text-primary)', fontSize: 12 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
