import { useMemo, useState } from 'react';
import { useApp } from '../store/store';
import { txInMonths } from '../store/selectors';
import { monthRange, monthLabel } from '../lib/date';
import { committedMonthly, detectRecurring } from '../lib/recurring';
import { findSavings, recurringCandidates, totalOpportunity, type Suggestion } from '../lib/savings';
import { futureValue } from '../lib/projections';
import { Card, Empty, Progress, Stat, useToast } from '../components/ui';
import { RankedBars, SERIES_COLORS } from '../components/charts';

const TAGS = ['All', 'Subscriptions', 'Habits', 'Rates', 'Structure', 'Risk', 'Goals'] as const;

const EFFORT_LABEL: Record<Suggestion['effort'], string> = {
  easy: 'Quick win',
  medium: 'Some effort',
  hard: 'Habit change',
};

export default function SavingsFinder() {
  const { state, dispatch, money, month } = useApp();
  const toast = useToast();
  const [tag, setTag] = useState<(typeof TAGS)[number]>('All');
  const [horizonYears, setHorizonYears] = useState(10);

  const suggestions = useMemo(() => findSavings(state, month), [state, month]);
  const shown = tag === 'All' ? suggestions : suggestions.filter((s) => s.tag === tag);
  const opportunity = totalOpportunity(suggestions);

  const series = useMemo(
    () => detectRecurring(recurringCandidates(state, txInMonths(state, monthRange(month, 6)))),
    [state, month],
  );
  const committed = committedMonthly(series);

  // What the freed-up money becomes if it is invested instead of spent.
  const compounded = futureValue(0, opportunity.monthly, 0.065, horizonYears * 12);

  // Annualized spending over the last six months, for context on the opportunity.
  const annualSpend =
    txInMonths(state, monthRange(month, 6))
      .filter((t) => t.amount < 0)
      .reduce((a, t) => a + Math.abs(t.amount), 0) * 2;
  const shareOfSpending = Math.min(1, opportunity.annual / Math.max(1, annualSpend));

  const dismissed = state.dismissedSuggestions;
  const goals = state.goals.filter((g) => !g.archived).sort((a, b) => a.priority - b.priority);

  return (
    <div className="col gap-16">
      <div className="grid cols-4">
        <Stat
          label="Findings"
          value={String(suggestions.length)}
          sub={`${suggestions.filter((s) => s.effort === 'easy').length} are quick wins`}
          icon="✦"
        />
        <Stat
          label="Monthly opportunity"
          value={money(opportunity.monthly, { compact: true })}
          tone="pos"
          sub="If you act on everything actionable"
          icon="💸"
        />
        <Stat
          label="Yearly opportunity"
          value={money(opportunity.annual, { compact: true })}
          tone="pos"
          sub="Same money, annualized"
          icon="📅"
        />
        <Stat
          label="Committed subscriptions"
          value={money(committed, { compact: true })}
          sub={`${series.length} recurring charges detected`}
          icon="🔁"
        />
      </div>

      <Card
        title={`Ways to save, found in your own ${monthLabel(month, 'long')} data`}
        hint="Every number here comes from your transactions — nothing generic, nothing invented."
        actions={
          <div className="seg">
            {TAGS.map((t) => (
              <button key={t} className={t === tag ? 'active' : ''} onClick={() => setTag(t)}>
                {t}
              </button>
            ))}
          </div>
        }
      >
        {shown.length === 0 ? (
          <Empty
            icon="✨"
            title="Nothing to flag here"
            hint="Either your spending is genuinely tight, or there is not enough history yet. Import a few months of statements to sharpen this."
          />
        ) : (
          <div className="col gap-16">
            {shown.map((s) => (
              <div key={s.key} className="card" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
                <div className="row wrap">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row gap-6">
                      <span className="bold">{s.title}</span>
                      <span className="chip">{s.tag}</span>
                      <span
                        className={`chip ${s.effort === 'easy' ? 'good' : s.effort === 'medium' ? 'warn' : ''}`}
                      >
                        {EFFORT_LABEL[s.effort]}
                      </span>
                    </div>
                    <p className="small muted mt-8">{s.detail}</p>
                    {s.evidence.length > 0 && (
                      <div className="row wrap gap-6">
                        {s.evidence.map((e) => (
                          <span key={e} className="tiny faint">
                            {e}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="right" style={{ minWidth: 130 }}>
                    {s.annualSaving > 0 ? (
                      <>
                        <div className="stat-value pos" style={{ fontSize: 20 }}>
                          {money(s.annualSaving, { compact: true })}
                        </div>
                        <div className="tiny faint">a year · {money(s.monthlySaving)}/mo</div>
                      </>
                    ) : (
                      <span className="chip accent">Worth doing</span>
                    )}
                  </div>
                </div>

                <div className="row wrap gap-6 mt-16">
                  {s.monthlySaving > 0 && goals.length > 0 && (
                    <select
                      className="select"
                      style={{ maxWidth: 260 }}
                      value=""
                      onChange={(e) => {
                        const goal = goals.find((g) => g.id === e.target.value);
                        if (!goal) return;
                        dispatch({
                          type: 'goal/update',
                          id: goal.id,
                          patch: { monthlyContribution: goal.monthlyContribution + s.monthlySaving },
                        });
                        dispatch({ type: 'suggestion/dismiss', key: s.key });
                        toast(`${money(s.monthlySaving)}/mo redirected to ${goal.name}`);
                      }}
                    >
                      <option value="">Redirect this saving to…</option>
                      {goals.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className="btn ghost sm"
                    onClick={() => {
                      dispatch({ type: 'suggestion/dismiss', key: s.key });
                      toast('Dismissed — you can bring it back below');
                    }}
                  >
                    Not for us
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid side">
        <Card title="Recurring charges" hint="Detected from repeated payees at a steady cadence and price">
          {series.length === 0 ? (
            <Empty icon="🔁" title="No recurring charges detected" hint="Six months of history makes this much sharper." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Payee</th>
                    <th>Cadence</th>
                    <th className="right">Each</th>
                    <th className="right">Per month</th>
                    <th className="right">Per year</th>
                    <th className="right">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {series.map((s) => (
                    <tr key={s.key}>
                      <td className="small bold">{s.payee}</td>
                      <td className="small faint">
                        {s.cadence} · {s.occurrences}×
                      </td>
                      <td className="right num small">{money(s.typicalAmount)}</td>
                      <td className="right num small">{money(s.monthlyCost)}</td>
                      <td className="right num small bold">{money(s.annualCost)}</td>
                      <td className="right small">
                        {s.priceIncrease > 0.05 ? (
                          <span className="chip bad">+{Math.round(s.priceIncrease * 100)}%</span>
                        ) : (
                          <span className="faint tiny">steady</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="col gap-16">
          <Card title="What the savings become" hint="Freed-up money, invested at 6.5% instead of spent">
            <div className="stat-value pos">{money(compounded, { compact: true })}</div>
            <div className="stat-sub">
              in {horizonYears} years, from {money(opportunity.monthly)}/month
            </div>
            <input
              className="mt-16"
              type="range"
              min={1}
              max={30}
              value={horizonYears}
              onChange={(e) => setHorizonYears(Number(e.target.value))}
            />
            <div className="row tiny faint">
              <span>1 year</span>
              <span className="spacer" />
              <span>30 years</span>
            </div>
            <p className="tiny faint mt-8">
              This is the real argument for cancelling the thing you forgot you were paying for.
            </p>
          </Card>

          <Card title="Where the opportunity sits">
            <RankedBars
              rows={(['Subscriptions', 'Habits', 'Rates', 'Structure', 'Risk', 'Goals'] as const)
                .map((t) => ({
                  label: t,
                  value: suggestions.filter((s) => s.tag === t).reduce((a, s) => a + s.annualSaving, 0),
                }))
                .filter((r) => r.value > 0)
                .sort((a, b) => b.value - a.value)}
              format={(n) => money(n, { compact: true })}
              colorFor={(_, i) => SERIES_COLORS[i % SERIES_COLORS.length]}
            />
            {opportunity.annual > 0 && (
              <div className="mt-16">
                <div className="row small mb-8">
                  <span>Share of your yearly spending</span>
                  <span className="spacer" />
                  <span className="num bold">{Math.round(shareOfSpending * 100)}%</span>
                </div>
                <Progress value={shareOfSpending} tone="good" thin />
              </div>
            )}
          </Card>

          {dismissed.length > 0 && (
            <Card title="Dismissed" hint={`${dismissed.length} hidden`}>
              <div className="row wrap gap-6">
                {dismissed.map((key) => (
                  <button
                    key={key}
                    className="btn ghost sm"
                    onClick={() => dispatch({ type: 'suggestion/restore', key })}
                  >
                    ↺ {key.split(':')[1] ?? key}
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
