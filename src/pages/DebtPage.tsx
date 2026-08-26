import { useMemo, useState } from 'react';
import { useApp } from '../store/store';
import type { Debt } from '../store/types';
import { simulatePayoff, totalDebt, totalMinimums, weightedApr } from '../lib/debt';
import { uid } from '../lib/id';
import { formatPercent } from '../lib/money';
import { Card, ConfirmButton, Empty, Field, MoneyInput, PercentInput, Progress, Stat, useToast } from '../components/ui';
import { LineChart, SERIES_COLORS } from '../components/charts';

const KIND_LABEL: Record<Debt['kind'], string> = {
  credit: 'Credit card',
  student: 'Student loan',
  auto: 'Auto loan',
  mortgage: 'Mortgage',
  personal: 'Personal loan',
  medical: 'Medical',
};

const months = (n: number): string =>
  n === Infinity || !isFinite(n) ? 'never' : `${Math.floor(n / 12)}y ${n % 12}m`;

export default function DebtPage() {
  const { state, dispatch, money } = useApp();
  const toast = useToast();
  const debts = state.debts;
  const minimums = totalMinimums(debts);
  const [extra, setExtra] = useState(20000);

  const budget = minimums + extra;
  const snowball = useMemo(() => simulatePayoff(debts, budget, 'snowball'), [debts, budget]);
  const avalanche = useMemo(() => simulatePayoff(debts, budget, 'avalanche'), [debts, budget]);
  const minOnly = useMemo(() => simulatePayoff(debts, minimums, 'avalanche'), [debts, minimums]);
  const best = avalanche.totalInterest <= snowball.totalInterest ? avalanche : snowball;
  const savedVsMin = Math.max(0, minOnly.totalInterest - best.totalInterest);

  const add = () =>
    dispatch({
      type: 'debt/add',
      debt: { id: uid('d'), name: 'New debt', balance: 0, apr: 0.1, minPayment: 0, kind: 'credit' },
    });

  const chartMonths = Math.min(120, Math.max(snowball.track.length, avalanche.track.length, minOnly.track.length));
  const at = (track: { totalBalance: number }[], i: number) =>
    i < track.length ? track[i].totalBalance : 0;

  if (!debts.length) {
    return (
      <Empty
        icon="🎉"
        title="No debts tracked"
        hint="If you have loans or card balances, add them here and the app will compare snowball against avalanche and show what the interest actually costs you."
        action={
          <button className="btn primary" onClick={add}>
            Add a debt
          </button>
        }
      />
    );
  }

  return (
    <div className="col gap-16">
      <div className="grid cols-4">
        <Stat label="Total owed" value={money(totalDebt(debts), { compact: true })} sub={`${debts.length} balances`} icon="💳" />
        <Stat label="Blended rate" value={formatPercent(weightedApr(debts))} sub="Weighted by balance" icon="📈" />
        <Stat label="Minimum payments" value={money(minimums, { compact: true })} sub="Every month, no progress" icon="🧾" />
        <Stat
          label="Interest saved"
          value={money(savedVsMin, { compact: true })}
          tone="pos"
          sub={`Paying ${money(budget)}/mo instead of minimums`}
          icon="✂️"
        />
      </div>

      <Card
        title="Payoff plan"
        hint="Avalanche kills the highest rate first and costs less. Snowball kills the smallest balance first and feels better. Both are here."
      >
        <div className="row wrap gap-16">
          <div style={{ flex: 1, minWidth: 260 }}>
            <div className="row small mb-8">
              <span>Extra beyond the minimums</span>
              <span className="spacer" />
              <span className="num bold">{money(extra)}/mo</span>
            </div>
            <input
              type="range"
              min={0}
              max={300000}
              step={5000}
              value={extra}
              onChange={(e) => setExtra(Number(e.target.value))}
            />
            <div className="tiny faint">Total monthly payment: {money(budget)}</div>
          </div>
        </div>

        <div className="grid cols-2 mt-16">
          {[avalanche, snowball].map((plan) => {
            const isBest = plan === best;
            return (
              <div
                key={plan.strategy}
                className="card"
                style={{
                  boxShadow: 'none',
                  background: 'var(--surface-2)',
                  borderColor: isBest ? 'var(--accent)' : undefined,
                }}
              >
                <div className="row">
                  <span className="bold" style={{ textTransform: 'capitalize' }}>
                    {plan.strategy}
                  </span>
                  {isBest && <span className="chip accent">Cheapest</span>}
                </div>
                <div className="grid cols-2 mt-16" style={{ gap: 10 }}>
                  <div>
                    <div className="tiny faint">Debt free in</div>
                    <div className="num bold">{months(plan.months)}</div>
                  </div>
                  <div>
                    <div className="tiny faint">Interest paid</div>
                    <div className="num bold neg">{money(plan.totalInterest, { compact: true })}</div>
                  </div>
                </div>
                <div className="mt-16">
                  {[...debts]
                    .filter((d) => d.balance > 0)
                    .sort((a, b) => (plan.payoffMonth[a.id] ?? 999) - (plan.payoffMonth[b.id] ?? 999))
                    .map((d, i) => (
                      <div key={d.id} className="list-row">
                        <span className="chip">{i + 1}</span>
                        <span className="small truncate">{d.name}</span>
                        <span className="spacer" />
                        <span className="tiny faint">
                          {plan.payoffMonth[d.id] ? months(plan.payoffMonth[d.id]) : 'not cleared'}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            );
          })}
        </div>

        {best.impossible && (
          <div className="callout bad mt-16">
            At {money(budget)} a month the interest outruns the payments. Increase the payment, or look at
            a balance transfer or consolidation before anything else.
          </div>
        )}
      </Card>

      <Card title="Balance over time" hint="Minimums only, against your plan">
        <LineChart
          labels={Array.from({ length: chartMonths }, (_, i) => (i % 12 === 0 ? `${i / 12}y` : ''))}
          series={[
            {
              name: 'Minimums only',
              color: SERIES_COLORS[3],
              values: Array.from({ length: chartMonths }, (_, i) => at(minOnly.track, i)),
              dashed: true,
            },
            {
              name: 'Avalanche',
              color: SERIES_COLORS[0],
              values: Array.from({ length: chartMonths }, (_, i) => at(avalanche.track, i)),
            },
            {
              name: 'Snowball',
              color: SERIES_COLORS[1],
              values: Array.from({ length: chartMonths }, (_, i) => at(snowball.track, i)),
            },
          ]}
          format={(n) => money(n, { compact: true })}
        />
        <div className="legend mt-8">
          <span className="legend-item">
            <span className="dot" style={{ background: SERIES_COLORS[3] }} /> Minimums only
          </span>
          <span className="legend-item">
            <span className="dot" style={{ background: SERIES_COLORS[0] }} /> Avalanche
          </span>
          <span className="legend-item">
            <span className="dot" style={{ background: SERIES_COLORS[1] }} /> Snowball
          </span>
        </div>
      </Card>

      <Card
        title="What you owe"
        actions={
          <button className="btn primary sm" onClick={add}>
            + Add debt
          </button>
        }
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: 140 }}>Type</th>
                <th style={{ width: 130 }}>Balance</th>
                <th style={{ width: 100 }}>APR</th>
                <th style={{ width: 130 }}>Minimum</th>
                <th style={{ width: 150 }}>Share of debt</th>
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {debts.map((d) => (
                <tr key={d.id}>
                  <td>
                    <input
                      className="input"
                      value={d.name}
                      onChange={(e) => dispatch({ type: 'debt/update', id: d.id, patch: { name: e.target.value } })}
                    />
                  </td>
                  <td>
                    <select
                      className="select"
                      value={d.kind}
                      onChange={(e) =>
                        dispatch({ type: 'debt/update', id: d.id, patch: { kind: e.target.value as Debt['kind'] } })
                      }
                    >
                      {(Object.keys(KIND_LABEL) as Debt['kind'][]).map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <MoneyInput
                      value={d.balance}
                      onChange={(c) => dispatch({ type: 'debt/update', id: d.id, patch: { balance: c } })}
                    />
                  </td>
                  <td>
                    <PercentInput
                      value={d.apr}
                      onChange={(v) => dispatch({ type: 'debt/update', id: d.id, patch: { apr: v } })}
                    />
                  </td>
                  <td>
                    <MoneyInput
                      value={d.minPayment}
                      onChange={(c) => dispatch({ type: 'debt/update', id: d.id, patch: { minPayment: c } })}
                    />
                  </td>
                  <td>
                    <Progress value={d.balance / Math.max(1, totalDebt(debts))} thin />
                    <div className="tiny faint mt-8">
                      {money(Math.round((d.balance * d.apr) / 12))}/mo in interest
                    </div>
                  </td>
                  <td className="right">
                    <ConfirmButton
                      onConfirm={() => {
                        dispatch({ type: 'debt/remove', id: d.id });
                        toast('Debt removed');
                      }}
                    >
                      ✕
                    </ConfirmButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Field label="">
          <p className="tiny faint">
            Interest is charged on the balance every month before payments land, which is why the
            highest-rate balance is almost always the right one to attack first.
          </p>
        </Field>
      </Card>
    </div>
  );
}
