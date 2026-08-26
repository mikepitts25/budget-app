import { useMemo } from 'react';
import { useApp } from '../store/store';
import { projectRetirement, futureValue } from '../lib/projections';
import { formatPercent } from '../lib/money';
import { Card, Field, MoneyInput, PercentInput, Progress, Stat } from '../components/ui';
import { LineChart, SERIES_COLORS } from '../components/charts';

export default function Retirement() {
  const { state, dispatch, money } = useApp();
  const plan = state.retirement;
  const people = state.people;

  const projection = useMemo(
    () => projectRetirement(plan, people.map((p) => p.id)),
    [plan, people],
  );

  const set = (patch: Partial<typeof plan>) => dispatch({ type: 'retirement/update', patch });
  const setAge = (id: string, value: number) =>
    set({ currentAge: { ...plan.currentAge, [id]: value } });
  const setRetireAge = (id: string, value: number) =>
    set({ retireAge: { ...plan.retireAge, [id]: value } });

  const coverage = projection.numberAtRetirement
    ? projection.projectedAtRetirement / projection.numberAtRetirement
    : 0;

  // The one number people actually want: what an extra $100/mo is worth by then.
  const marginalValue =
    futureValue(0, 10000, plan.expectedReturn, projection.yearsToRetirement * 12);

  return (
    <div className="col gap-16">
      <div className="grid cols-4">
        <Stat
          label="Your number"
          value={money(projection.numberToday, { compact: true })}
          sub={`In today's money at a ${formatPercent(plan.safeWithdrawalRate, 1)} withdrawal rate`}
          icon="🎯"
        />
        <Stat
          label="Needed at retirement"
          value={money(projection.numberAtRetirement, { compact: true })}
          sub={`${projection.yearsToRetirement} years of ${formatPercent(plan.inflation, 1)} inflation`}
          icon="📈"
        />
        <Stat
          label="On track for"
          value={money(projection.projectedAtRetirement, { compact: true })}
          tone={projection.shortfall === 0 ? 'pos' : 'neg'}
          sub={`${Math.round(coverage * 100)}% of the target`}
          icon="🛤️"
        />
        <Stat
          label={projection.shortfall > 0 ? 'Shortfall' : 'Surplus'}
          value={money(
            projection.shortfall > 0
              ? projection.shortfall
              : projection.projectedAtRetirement - projection.numberAtRetirement,
            { compact: true },
          )}
          tone={projection.shortfall > 0 ? 'neg' : 'pos'}
          sub={
            projection.shortfall > 0
              ? `Contribute ${money(projection.requiredMonthly)}/mo to close it`
              : 'You can retire earlier, or spend more'
          }
          icon={projection.shortfall > 0 ? '⚠️' : '🎉'}
        />
      </div>

      <div className="grid side">
        <Card
          title="The long view"
          hint="Your projected balance against the target, which itself grows with inflation"
        >
          <LineChart
            labels={projection.track.map((t) => (t.year % 5 === 0 ? `age ${t.age}` : ''))}
            series={[
              {
                name: 'Projected balance',
                color: SERIES_COLORS[1],
                values: projection.track.map((t) => t.balance),
              },
              {
                name: 'Target (inflating)',
                color: SERIES_COLORS[3],
                values: projection.track.map((t) => t.target),
                dashed: true,
              },
            ]}
            format={(n) => money(n, { compact: true })}
            height={260}
            area
          />
          <div className="legend mt-8">
            <span className="legend-item">
              <span className="dot" style={{ background: SERIES_COLORS[1] }} /> Projected balance
            </span>
            <span className="legend-item">
              <span className="dot" style={{ background: SERIES_COLORS[3] }} /> Target, inflated
            </span>
          </div>

          <div className="divider" />
          <div className="row small mb-8">
            <span>Coverage at retirement</span>
            <span className="spacer" />
            <span className="num bold">{Math.round(coverage * 100)}%</span>
          </div>
          <Progress value={coverage} tone={coverage >= 1 ? 'good' : coverage >= 0.75 ? 'warn' : 'bad'} />

          <div className="callout mt-16">
            {projection.coastAge
              ? `At this pace your investments cover the inflated target from about age ${projection.coastAge} — from there you could stop contributing and still coast to retirement.`
              : 'At this pace the balance never catches the inflating target. Raise the contribution, push the date out, or plan to spend less.'}
          </div>
          <div className="callout good mt-8">
            Every extra {money(10000)} a month you invest from today is worth{' '}
            <span className="bold">{money(marginalValue, { compact: true })}</span> at retirement.
          </div>
        </Card>

        <Card title="Assumptions" hint="Change anything — the projection updates as you type">
          {people.map((p) => (
            <div key={p.id} className="col gap-6" style={{ paddingBottom: 12 }}>
              <div className="row">
                <span className="dot" style={{ background: p.color }} />
                <span className="bold small">{p.name}</span>
              </div>
              <div className="field-row">
                <Field label="Age now">
                  <input
                    className="input num"
                    type="number"
                    value={plan.currentAge[p.id] ?? 35}
                    onChange={(e) => setAge(p.id, Number(e.target.value) || 0)}
                  />
                </Field>
                <Field label="Retire at">
                  <input
                    className="input num"
                    type="number"
                    value={plan.retireAge[p.id] ?? 65}
                    onChange={(e) => setRetireAge(p.id, Number(e.target.value) || 0)}
                  />
                </Field>
              </div>
            </div>
          ))}

          <div className="divider" />

          <Field label="Invested for retirement today" hint="401(k), IRA, brokerage — everything earmarked">
            <MoneyInput value={plan.currentSavings} onChange={(c) => set({ currentSavings: c })} />
          </Field>
          <Field label="Combined monthly contribution" hint="Both of you, including employer match">
            <MoneyInput value={plan.monthlyContribution} onChange={(c) => set({ monthlyContribution: c })} />
          </Field>
          <Field label="Annual spending in retirement" hint="In today's money, for the two of you">
            <MoneyInput value={plan.desiredAnnualSpend} onChange={(c) => set({ desiredAnnualSpend: c })} />
          </Field>

          <div className="field-row three">
            <Field label="Return" hint="Long-run real-ish">
              <PercentInput value={plan.expectedReturn} onChange={(v) => set({ expectedReturn: v })} />
            </Field>
            <Field label="Inflation">
              <PercentInput value={plan.inflation} onChange={(v) => set({ inflation: v })} />
            </Field>
            <Field label="Withdrawal" hint="4% is the classic">
              <PercentInput value={plan.safeWithdrawalRate} onChange={(v) => set({ safeWithdrawalRate: v })} />
            </Field>
          </div>

          <p className="tiny faint">
            This is a straight-line projection, not a guarantee. Real markets are lumpy — revisit it once a
            year and adjust rather than trusting a single number to the dollar.
          </p>
        </Card>
      </div>

      <Card title="What moves the needle" hint="Same plan, one variable changed">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Change</th>
                <th className="right">Balance at retirement</th>
                <th className="right">Difference</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Your current plan', months: projection.yearsToRetirement * 12, monthly: plan.monthlyContribution, ret: plan.expectedReturn },
                { label: 'Contribute 10% more', months: projection.yearsToRetirement * 12, monthly: Math.round(plan.monthlyContribution * 1.1), ret: plan.expectedReturn },
                { label: 'Contribute 25% more', months: projection.yearsToRetirement * 12, monthly: Math.round(plan.monthlyContribution * 1.25), ret: plan.expectedReturn },
                { label: 'Work three more years', months: (projection.yearsToRetirement + 3) * 12, monthly: plan.monthlyContribution, ret: plan.expectedReturn },
                { label: 'Retire three years earlier', months: Math.max(0, (projection.yearsToRetirement - 3) * 12), monthly: plan.monthlyContribution, ret: plan.expectedReturn },
                { label: 'Returns 1% worse', months: projection.yearsToRetirement * 12, monthly: plan.monthlyContribution, ret: plan.expectedReturn - 0.01 },
              ].map((row) => {
                const value = futureValue(plan.currentSavings, row.monthly, row.ret, row.months);
                const diff = value - projection.projectedAtRetirement;
                return (
                  <tr key={row.label}>
                    <td className="small">{row.label}</td>
                    <td className="right num">{money(value, { compact: true })}</td>
                    <td className={`right num small ${diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'faint'}`}>
                      {diff === 0 ? '—' : money(diff, { compact: true, sign: true })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
