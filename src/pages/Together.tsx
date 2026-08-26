import { useMemo } from 'react';
import { useApp } from '../store/store';
import type { SplitRule } from '../store/types';
import { categoryMap, txInMonth, txInMonths } from '../store/selectors';
import { fairness, shareOf } from '../lib/split';
import { monthLabel, monthRange } from '../lib/date';
import { formatPercent, sum } from '../lib/money';
import { Card, Field, Progress, Stat, useToast } from '../components/ui';
import { GroupedBars, LineChart, RankedBars, SERIES_COLORS } from '../components/charts';

const SPLIT_HELP: Record<SplitRule, string> = {
  even: 'Every shared cost is halved, regardless of who earns what.',
  income: 'Each of you covers the share of costs that matches your share of household income.',
  custom: 'You set the percentages yourself, per transaction.',
  personal: 'The cost belongs entirely to whoever spent it.',
};

export default function Together() {
  const { state, dispatch, money, month } = useApp();
  const toast = useToast();
  const cats = categoryMap(state);
  const people = state.people;

  const monthTx = useMemo(() => txInMonth(state, month), [state, month]);
  const { rows, settlements } = useMemo(() => fairness(state, monthTx), [state, monthTx]);

  const months = monthRange(month, 6);
  const history = useMemo(
    () =>
      months.map((m) => {
        const f = fairness(state, txInMonth(state, m));
        return { month: m, rows: f.rows };
      }),
    [state, months.join()],
  );

  // Personal (unshared) discretionary spending — the "allowance" comparison.
  const personalSpend = people.map((p) => {
    const txs = monthTx.filter(
      (t) => t.amount < 0 && t.splitRule === 'personal' && t.paidBy === p.id,
    );
    return { person: p, total: sum(txs.map((t) => Math.abs(t.amount))), count: txs.length };
  });

  // Category-level view of who is carrying what.
  const byCategory = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const t of monthTx) {
      if (t.amount >= 0) continue;
      const shares = shareOf(t, people);
      const row = map.get(t.categoryId) ?? Object.fromEntries(people.map((p) => [p.id, 0]));
      for (const p of people) row[p.id] += shares[p.id] ?? 0;
      map.set(t.categoryId, row);
    }
    return [...map.entries()]
      .map(([categoryId, shares]) => ({
        categoryId,
        shares,
        total: sum(Object.values(shares)),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [monthTx, people]);

  const sharedTotal = sum(
    monthTx.filter((t) => t.amount < 0 && t.splitRule !== 'personal').map((t) => Math.abs(t.amount)),
  );
  const personalTotal = sum(
    monthTx.filter((t) => t.amount < 0 && t.splitRule === 'personal').map((t) => Math.abs(t.amount)),
  );

  const copySummary = () => {
    const lines = [
      `${state.settings.householdName} — ${monthLabel(month, 'long')}`,
      ...rows.map((r) => {
        const p = people.find((x) => x.id === r.personId)!;
        return `${p.name}: paid ${money(r.paid)}, owed ${money(r.owed)}, net ${money(r.net)}`;
      }),
      ...settlements.map((s) => {
        const from = people.find((p) => p.id === s.from)?.name;
        const to = people.find((p) => p.id === s.to)?.name;
        return `${from} → ${to}: ${money(s.amount)}`;
      }),
    ];
    navigator.clipboard?.writeText(lines.join('\n'));
    toast('Settle-up summary copied');
  };

  return (
    <div className="col gap-16">
      <div className="grid cols-4">
        <Stat label="Shared costs" value={money(sharedTotal, { compact: true })} sub={monthLabel(month, 'long')} icon="🤝" />
        <Stat label="Personal spending" value={money(personalTotal, { compact: true })} sub="Not split between you" icon="🙋" />
        {rows.map((r) => {
          const p = people.find((x) => x.id === r.personId)!;
          return (
            <Stat
              key={r.personId}
              label={`${p.name} balance`}
              value={money(r.net, { sign: true, compact: true })}
              tone={r.net >= 0 ? 'pos' : 'neg'}
              sub={`Paid ${money(r.paid, { compact: true })} · owed ${money(r.owed, { compact: true })}`}
            />
          );
        })}
      </div>

      <div className="grid side">
        <Card
          title="Who is carrying the household right now"
          hint="Paid is what actually left their pocket. Owed is their share under the split rules you set."
        >
          <div className="col gap-16">
            {rows.map((r) => {
              const p = people.find((x) => x.id === r.personId)!;
              const maxPaid = Math.max(...rows.map((x) => Math.max(x.paid, x.owed)), 1);
              return (
                <div key={r.personId} className="col gap-6">
                  <div className="row">
                    <span className="dot" style={{ background: p.color }} />
                    <span className="bold">{p.name}</span>
                    <span className="spacer" />
                    <span className="small faint">
                      earns {formatPercent(r.incomeShare, 0)} of household income · pays{' '}
                      {formatPercent(r.paidShare, 0)} of the bills
                    </span>
                  </div>
                  <div className="row small">
                    <span style={{ width: 46 }} className="faint">
                      paid
                    </span>
                    <div className="bar" style={{ flex: 1 }}>
                      <span style={{ width: `${(r.paid / maxPaid) * 100}%`, background: p.color }} />
                    </div>
                    <span className="num" style={{ width: 92, textAlign: 'right' }}>
                      {money(r.paid)}
                    </span>
                  </div>
                  <div className="row small">
                    <span style={{ width: 46 }} className="faint">
                      owed
                    </span>
                    <div className="bar" style={{ flex: 1 }}>
                      <span style={{ width: `${(r.owed / maxPaid) * 100}%`, background: 'var(--border-strong)' }} />
                    </div>
                    <span className="num" style={{ width: 92, textAlign: 'right' }}>
                      {money(r.owed)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="divider" />

          {settlements.length ? (
            <div className="col gap-6">
              {settlements.map((s, i) => (
                <div className="callout" key={i}>
                  <span className="bold">
                    {people.find((p) => p.id === s.from)?.name} → {people.find((p) => p.id === s.to)?.name}
                  </span>{' '}
                  {money(s.amount)} squares the month up.
                </div>
              ))}
              <div className="row gap-6 mt-8">
                <button className="btn sm" onClick={copySummary}>
                  Copy summary
                </button>
                <span className="tiny faint">
                  Settle up however you like — this is a statement, not a transaction.
                </span>
              </div>
            </div>
          ) : (
            <div className="callout good">Nobody owes anybody. You are square for {monthLabel(month, 'long')}.</div>
          )}
        </Card>

        <Card title="Fairness policy" hint="How new shared costs get divided by default">
          <Field label="Default split for new transactions">
            <select
              className="select"
              value={state.settings.defaultSplit}
              onChange={(e) =>
                dispatch({ type: 'settings/update', patch: { defaultSplit: e.target.value as SplitRule } })
              }
            >
              <option value="even">Split evenly (50/50)</option>
              <option value="income">Split by income (proportional)</option>
              <option value="custom">Custom percentages</option>
              <option value="personal">Personal, never shared</option>
            </select>
          </Field>
          <p className="small muted mt-8">{SPLIT_HELP[state.settings.defaultSplit]}</p>

          <div className="divider" />
          <div className="card-title mb-8">Income split</div>
          {people.map((p) => {
            const total = sum(people.map((x) => x.annualIncome)) || 1;
            return (
              <div key={p.id} className="col gap-4" style={{ padding: '6px 0' }}>
                <div className="row small">
                  <span className="dot" style={{ background: p.color }} />
                  <span>{p.name}</span>
                  <span className="spacer" />
                  <span className="num faint">
                    {money(p.annualIncome, { compact: true })}/yr · {formatPercent(p.annualIncome / total, 0)}
                  </span>
                </div>
                <Progress value={p.annualIncome / total} thin />
              </div>
            );
          })}
          <p className="tiny faint mt-8">
            Income-proportional splitting keeps the lower earner from being squeezed by an even split.
            Set incomes in Settings.
          </p>

          <div className="divider" />
          <div className="card-title mb-8">Personal spending this month</div>
          {personalSpend.map((r) => (
            <div key={r.person.id} className="list-row">
              <span className="dot" style={{ background: r.person.color }} />
              <span className="small">{r.person.name}</span>
              <span className="spacer" />
              <span className="small num">{money(r.total)}</span>
            </div>
          ))}
          <p className="tiny faint mt-8">
            Some couples agree an equal no-questions-asked allowance each. This is the number to compare.
          </p>
        </Card>
      </div>

      <div className="grid side">
        <Card title="Balance over time" hint="Positive means the household owes them for that month">
          <LineChart
            labels={history.map((h) => monthLabel(h.month))}
            series={people.map((p, i) => ({
              name: p.name,
              color: p.color || SERIES_COLORS[i],
              values: history.map((h) => h.rows.find((r) => r.personId === p.id)?.net ?? 0),
            }))}
            format={(n) => money(n, { compact: true })}
          />
          <div className="legend mt-8">
            {people.map((p) => (
              <span className="legend-item" key={p.id}>
                <span className="dot" style={{ background: p.color }} /> {p.name}
              </span>
            ))}
          </div>
        </Card>

        <Card title="Who carries which category" hint="Share of each category under your split rules">
          <RankedBars
            rows={byCategory.map((r) => ({
              label: `${cats[r.categoryId]?.icon ?? ''} ${cats[r.categoryId]?.name ?? 'Other'}`,
              value: r.total,
            }))}
            format={(n) => money(n)}
          />
        </Card>
      </div>

      <Card title="Contribution history" hint="What each of you actually paid out, month by month">
        <GroupedBars
          groups={months.map((m) => monthLabel(m))}
          series={people.map((p, i) => ({
            name: p.name,
            color: p.color || SERIES_COLORS[i],
            values: months.map((m) =>
              sum(
                txInMonths(state, [m])
                  .filter((t) => t.amount < 0 && t.paidBy === p.id)
                  .map((t) => Math.abs(t.amount)),
              ),
            ),
          }))}
          format={(n) => money(n, { compact: true })}
        />
      </Card>
    </div>
  );
}
