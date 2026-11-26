import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtMonth, fmtNum } from '../format.js';

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="tooltip">
      <div className="tooltip-title">{fmtMonth(d.month)}</div>
      <div>{fmtNum(d.count)} SKUs uploaded</div>
    </div>
  );
}

export default function UploadsChart({ products }) {
  const by = {};
  for (const p of products) {
    const m = p.uploadDate?.slice(0, 7);
    if (m) by[m] = (by[m] || 0) + 1;
  }
  // Fill gaps so months with zero uploads still appear on the time axis.
  const keys = Object.keys(by).sort();
  const data = [];
  if (keys.length) {
    let [y, m] = keys[0].split('-').map(Number);
    const [ey, em] = keys[keys.length - 1].split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) {
      const month = `${y}-${String(m).padStart(2, '0')}`;
      data.push({ month, count: by[month] || 0 });
      if (++m > 12) { m = 1; y++; }
    }
  }

  return (
    <section className="card">
      <h2>SKUs uploaded per month</h2>
      <div className="chart">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="month"
              tickFormatter={fmtMonth}
              tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
              axisLine={{ stroke: 'var(--grid)' }}
              tickLine={false}
              minTickGap={12}
            />
            <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<Tip />} cursor={{ fill: 'var(--hover)' }} />
            <Bar dataKey="count" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
