import { useMemo, useState } from 'react';
import { useApp } from '../store/store';
import { categoryMap, monthSeries, txInMonths } from '../store/selectors';
import { monthLabel, monthRange } from '../lib/date';
import { sum } from '../lib/money';
import { Card, Empty, Segmented, Stat } from '../components/ui';
import { LineChart, RankedBars, Sparkline, SERIES_COLORS } from '../components/charts';

export default function Reports() {
  const { state, money, month } = useApp();
  const cats = categoryMap(state);
  const [window, setWindow] = useState<'6' | '12' | '24'>('12');
  const count = Number(window);

  const months = monthRange(month, count);
  const series = useMemo(() => monthSeries(state, month, count), [state, month, count]);
  const txs = useMemo(() => txInMonths(state, months), [state, months.join()]);

  const totalIncome = sum(series.map((s) => s.income));
  const totalExpense = sum(series.map((s) => s.expense));
  const saved = totalIncome - totalExpense;

  // Category rows with their own monthly track, so trends are visible at a glance.
  const categoryRows = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const t of txs) {
      if (t.amount >= 0) continue;
      const idx = months.indexOf(t.date.slice(0, 7));
      if (idx < 0) continue;
      const track = map.get(t.categoryId) ?? months.map(() => 0);
      track[idx] += Math.abs(t.amount);
      map.set(t.categoryId, track);
    }
    return [...map.entries()]
      .map(([categoryId, track]) => {
        const total = sum(track);
        const half = Math.floor(track.length / 2);
        const firstHalf = sum(track.slice(0, half)) / Math.max(1, half);
        const secondHalf = sum(track.slice(half)) / Math.max(1, track.length - half);
        return {
          categoryId,
          track,
          total,
          average: Math.round(total / track.length),
          peak: Math.max(...track),
          trend: firstHalf > 0 ? (secondHalf - firstHalf) / firstHalf : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [txs, months.join()]);

  const payees = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>();
    for (const t of txs) {
      if (t.amount >= 0) continue;
      const cur = map.get(t.payee) ?? { total: 0, count: 0 };
      cur.total += Math.abs(t.amount);
      cur.count += 1;
      map.set(t.payee, cur);
    }
    return [...map.entries()]
      .map(([payee, v]) => ({ payee, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  }, [txs]);

  const tagTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of txs) {
      if (t.amount >= 0) continue;
      for (const tag of t.tags) map.set(tag, (map.get(tag) ?? 0) + Math.abs(t.amount));
    }
    return [...map.entries()].map(([tag, total]) => ({ tag, total })).sort((a, b) => b.total - a.total);
  }, [txs]);

  if (!txs.length) {
    return <Empty icon="◫" title="No data in this window" hint="Pick a wider window or import some history." />;
  }

  return (
    <div className="col gap-16">
      <div className="row">
        <Segmented
          value={window}
          onChange={setWindow}
          options={[
            { value: '6', label: '6 months' },
            { value: '12', label: '12 months' },
            { value: '24', label: '24 months' },
          ]}
        />
      </div>

      <div className="grid cols-4">
        <Stat label="Income" value={money(totalIncome, { compact: true })} sub={`over ${count} months`} icon="💰" />
        <Stat label="Spending" value={money(totalExpense, { compact: true })} sub={`${money(Math.round(totalExpense / count), { compact: true })}/mo average`} icon="🧾" />
        <Stat label="Saved" value={money(saved, { compact: true })} tone={saved >= 0 ? 'pos' : 'neg'} icon="🌱" />
        <Stat
          label="Savings rate"
          value={`${Math.round(totalIncome ? (saved / totalIncome) * 100 : 0)}%`}
          tone={totalIncome && saved / totalIncome >= state.settings.savingsRateTarget ? 'pos' : 'neg'}
          sub={`Target ${Math.round(state.settings.savingsRateTarget * 100)}%`}
          icon="🎯"
        />
      </div>

      <Card title="Income, spending and what stayed" hint="The shape of your finances over time">
        <LineChart
          labels={series.map((s) => monthLabel(s.month))}
          series={[
            { name: 'Income', color: SERIES_COLORS[1], values: series.map((s) => s.income) },
            { name: 'Spending', color: SERIES_COLORS[3], values: series.map((s) => s.expense) },
            { name: 'Net', color: SERIES_COLORS[0], values: series.map((s) => s.net), dashed: true },
          ]}
          format={(n) => money(n, { compact: true })}
          height={250}
        />
        <div className="legend mt-8">
          {[
            ['Income', SERIES_COLORS[1]],
            ['Spending', SERIES_COLORS[3]],
            ['Net', SERIES_COLORS[0]],
          ].map(([label, color]) => (
            <span className="legend-item" key={label}>
              <span className="dot" style={{ background: color }} /> {label}
            </span>
          ))}
        </div>
      </Card>

      <Card title="Every category, tracked" hint="Trend compares the second half of the window against the first">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th style={{ width: 130 }}>Shape</th>
                <th className="right" style={{ width: 110 }}>Total</th>
                <th className="right" style={{ width: 110 }}>Per month</th>
                <th className="right" style={{ width: 110 }}>Peak month</th>
                <th className="right" style={{ width: 90 }}>Trend</th>
              </tr>
            </thead>
            <tbody>
              {categoryRows.map((row) => {
                const cat = cats[row.categoryId];
                const up = row.trend > 0.05;
                const down = row.trend < -0.05;
                return (
                  <tr key={row.categoryId}>
                    <td className="small">
                      {cat?.icon} {cat?.name ?? 'Uncategorized'}
                      {cat && !cat.essential && <span className="tiny faint"> · want</span>}
                    </td>
                    <td>
                      <Sparkline
                        values={row.track}
                        color={up ? 'var(--bad)' : down ? 'var(--good)' : 'var(--accent)'}
                      />
                    </td>
                    <td className="right num small">{money(row.total, { compact: true })}</td>
                    <td className="right num small">{money(row.average)}</td>
                    <td className="right num small faint">{money(row.peak)}</td>
                    <td className="right">
                      <span className={`chip ${up ? 'bad' : down ? 'good' : ''}`}>
                        {row.trend > 0 ? '+' : ''}
                        {Math.round(row.trend * 100)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid side">
        <Card title="Biggest payees" hint={`Where the money actually goes, last ${count} months`}>
          <RankedBars
            rows={payees.map((p) => ({
              label: p.payee,
              value: p.total,
              sub: `${p.count}×`,
            }))}
            format={(n) => money(n, { compact: true })}
          />
        </Card>

        <div className="col gap-16">
          <Card title="Spending by person" hint="Who the money left through">
            <RankedBars
              rows={[
                ...state.people.map((p) => ({
                  label: p.name,
                  value: sum(
                    txs.filter((t) => t.amount < 0 && t.paidBy === p.id).map((t) => Math.abs(t.amount)),
                  ),
                })),
                {
                  label: 'Joint accounts',
                  value: sum(
                    txs.filter((t) => t.amount < 0 && t.paidBy === 'joint').map((t) => Math.abs(t.amount)),
                  ),
                },
              ]}
              format={(n) => money(n, { compact: true })}
              colorFor={(label) => state.people.find((p) => p.name === label)?.color ?? SERIES_COLORS[4]}
            />
          </Card>

          {tagTotals.length > 0 && (
            <Card title="By tag" hint="Trips, projects, anything you have labelled">
              <RankedBars
                rows={tagTotals.map((t) => ({ label: t.tag, value: t.total }))}
                format={(n) => money(n, { compact: true })}
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
