import { useMemo } from 'react';
import { useApp } from '../store/store';
import {
  averageSurplus,
  categoryMap,
  monthSeries,
  monthSummary,
  netWorth,
  runwayMonths,
  spendByCategory,
  txInMonth,
} from '../store/selectors';
import { budgetStatus } from '../store/selectors';
import { findSavings, spendMix, totalOpportunity } from '../lib/savings';
import { fairness } from '../lib/split';
import { goalStatus } from '../lib/projections';
import { monthLabel } from '../lib/date';
import { formatPercent } from '../lib/money';
import { Card, Progress, Stat, Empty } from '../components/ui';
import { Donut, GroupedBars, RankedBars, SERIES_COLORS } from '../components/charts';

export default function Dashboard() {
  const { state, money, month } = useApp();
  const cats = categoryMap(state);

  const summary = monthSummary(state, month);
  const series = useMemo(() => monthSeries(state, month, 6), [state, month]);
  const prev = series[series.length - 2];
  const mix = spendMix(state, month);
  const nw = netWorth(state);
  const runway = runwayMonths(state, month);
  const suggestions = useMemo(() => findSavings(state, month), [state, month]);
  const opportunity = totalOpportunity(suggestions);
  const { rows, settlements } = useMemo(
    () => fairness(state, txInMonth(state, month)),
    [state, month],
  );
  const goals = state.goals.filter((g) => !g.archived).map(goalStatus);
  const budget = budgetStatus(state, month);
  const overspent = budget.filter((b) => b.over && b.actual > 0);
  const surplus = averageSurplus(state, month, 3);

  const topCategories = spendByCategory(state, month, false)
    .slice(0, 7)
    .map((s) => ({
      label: `${cats[s.categoryId]?.icon ?? ''} ${cats[s.categoryId]?.name ?? 'Uncategorized'}`,
      value: s.amount,
    }));

  const delta = (now: number, before: number): React.ReactNode => {
    if (!before) return null;
    const pct = ((now - before) / before) * 100;
    const worse = pct > 0;
    return (
      <span className={`kpi-delta ${worse ? 'neg' : 'pos'}`}>
        {worse ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}% vs {monthLabel(prev.month)}
      </span>
    );
  };

  if (!state.transactions.length) {
    return (
      <Empty
        icon="🪄"
        title="No transactions yet"
        hint="Add your first transaction, import a bank CSV, or load the demo household from Settings to see everything working."
      />
    );
  }

  return (
    <div className="col gap-16">
      <div className="grid cols-4">
        <Stat
          label="Income"
          value={money(summary.income, { compact: true })}
          sub={delta(summary.income, prev?.income ?? 0)}
          icon="💰"
        />
        <Stat
          label="Spending"
          value={money(summary.expense, { compact: true })}
          sub={delta(summary.expense, prev?.expense ?? 0)}
          icon="🧾"
        />
        <Stat
          label="Left over"
          value={money(summary.net, { compact: true })}
          tone={summary.net >= 0 ? 'pos' : 'neg'}
          sub={`${money(surplus)} average over 3 months`}
          icon="🌱"
        />
        <Stat
          label="Savings rate"
          value={formatPercent(summary.savingsRate, 0)}
          tone={summary.savingsRate >= state.settings.savingsRateTarget ? 'pos' : 'neg'}
          sub={`Target ${formatPercent(state.settings.savingsRateTarget, 0)}`}
          icon="🎯"
        />
      </div>

      <div className="grid side">
        <Card title="Cash flow" hint="Income against spending, last six months">
          <GroupedBars
            groups={series.map((s) => monthLabel(s.month))}
            series={[
              { name: 'Income', color: SERIES_COLORS[1], values: series.map((s) => s.income) },
              { name: 'Spending', color: SERIES_COLORS[3], values: series.map((s) => s.expense) },
            ]}
            format={(n) => money(n, { compact: true })}
          />
          <div className="legend mt-8">
            <span className="legend-item">
              <span className="dot" style={{ background: SERIES_COLORS[1] }} /> Income
            </span>
            <span className="legend-item">
              <span className="dot" style={{ background: SERIES_COLORS[3] }} /> Spending
            </span>
          </div>
        </Card>

        <Card title="Needs, wants, savings" hint="The 50/30/20 sanity check">
          <div className="row" style={{ justifyContent: 'center' }}>
            <Donut
              slices={[
                { label: 'Needs', value: mix.needs, color: SERIES_COLORS[0] },
                { label: 'Wants', value: mix.wants, color: SERIES_COLORS[2] },
                { label: 'Saved', value: mix.savings, color: SERIES_COLORS[1] },
              ]}
              center={formatPercent(summary.savingsRate, 0)}
              centerSub="saved"
              format={(n) => money(n)}
            />
          </div>
          <div className="col gap-6 mt-8">
            {(
              [
                ['Needs', mix.needs, 0.5, SERIES_COLORS[0]],
                ['Wants', mix.wants, 0.3, SERIES_COLORS[2]],
                ['Saved', mix.savings, 0.2, SERIES_COLORS[1]],
              ] as const
            ).map(([label, value, target, color]) => {
              const share = summary.income > 0 ? value / summary.income : 0;
              const ok = label === 'Saved' ? share >= target : share <= target;
              return (
                <div key={label} className="row small">
                  <span className="dot" style={{ background: color }} />
                  <span style={{ width: 52 }}>{label}</span>
                  <span className="num bold">{formatPercent(share, 0)}</span>
                  <span className="spacer" />
                  <span className={ok ? 'chip good' : 'chip warn'}>
                    guide {formatPercent(target, 0)}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid side">
        <Card title="Where the money went" hint={`Top categories in ${monthLabel(month, 'long')}`}>
          {topCategories.length ? (
            <RankedBars rows={topCategories} format={(n) => money(n)} />
          ) : (
            <Empty title="Nothing spent yet this month" />
          )}
        </Card>

        <div className="col gap-16">
          <Card title="Biggest opportunity" hint={`${suggestions.length} findings`}>
            {suggestions.length ? (
              <>
                <div className="stat-value pos">{money(opportunity.annual, { compact: true })}</div>
                <div className="stat-sub">per year if you act on every finding</div>
                <div className="divider" />
                {suggestions.slice(0, 3).map((s) => (
                  <div key={s.key} className="list-row">
                    <div style={{ minWidth: 0 }}>
                      <div className="small bold truncate">{s.title}</div>
                      <div className="tiny faint">{s.tag} · {s.effort}</div>
                    </div>
                    <div className="spacer" />
                    <div className="small num pos">
                      {s.annualSaving ? `${money(s.annualSaving, { compact: true })}/yr` : '—'}
                    </div>
                  </div>
                ))}
                <a className="btn block mt-16" href="#savings">
                  Open the savings finder
                </a>
              </>
            ) : (
              <Empty icon="✨" title="Nothing obvious to cut" hint="Your spending looks tight already." />
            )}
          </Card>

          <Card title="Balance between you" hint={monthLabel(month, 'long')}>
            {rows.map((r) => {
              const person = state.people.find((p) => p.id === r.personId)!;
              return (
                <div key={r.personId} className="list-row">
                  <span className="dot" style={{ background: person.color }} />
                  <span className="small">{person.name}</span>
                  <span className="spacer" />
                  <span className={`small num ${r.net >= 0 ? 'pos' : 'neg'}`}>
                    {r.net >= 0 ? '+' : ''}
                    {money(r.net)}
                  </span>
                </div>
              );
            })}
            {settlements.length ? (
              settlements.map((s, i) => (
                <div className="callout mt-8" key={i}>
                  {state.people.find((p) => p.id === s.from)?.name} owes{' '}
                  {state.people.find((p) => p.id === s.to)?.name}{' '}
                  <span className="bold">{money(s.amount)}</span> to square up.
                </div>
              ))
            ) : (
              <div className="callout good mt-8">You are even this month. Nice.</div>
            )}
          </Card>
        </div>
      </div>

      <div className="grid cols-3">
        <Card title="Goal progress" hint={`${goals.length} active`}>
          {goals.length ? (
            goals
              .sort((a, b) => a.goal.priority - b.goal.priority)
              .slice(0, 5)
              .map((g) => (
                <div key={g.goal.id} className="col gap-4" style={{ padding: '8px 0' }}>
                  <div className="row small">
                    <span className="truncate">{g.goal.name}</span>
                    <span className="spacer" />
                    <span className="num faint">
                      {money(g.goal.saved, { compact: true })} / {money(g.goal.target, { compact: true })}
                    </span>
                  </div>
                  <Progress value={g.progress} tone={g.onTrack ? 'good' : 'warn'} thin />
                </div>
              ))
          ) : (
            <Empty icon="◎" title="No goals yet" hint="Add one to start forecasting." />
          )}
        </Card>

        <Card title="Budget health" hint={`${overspent.length} envelopes over plan`}>
          {budget.length ? (
            budget
              .filter((b) => b.planned > 0 || b.actual > 0)
              .sort((a, b) => b.pace - a.pace)
              .slice(0, 5)
              .map((b) => (
                <div key={b.categoryId} className="col gap-4" style={{ padding: '8px 0' }}>
                  <div className="row small">
                    <span className="truncate">
                      {cats[b.categoryId]?.icon} {cats[b.categoryId]?.name ?? 'Uncategorized'}
                    </span>
                    <span className="spacer" />
                    <span className={`num ${b.over ? 'neg' : 'faint'}`}>
                      {money(b.actual)} / {money(b.planned)}
                    </span>
                  </div>
                  <Progress
                    value={b.planned ? b.actual / b.planned : 1}
                    tone={b.over ? 'bad' : b.pace > 0.85 ? 'warn' : 'good'}
                    thin
                  />
                </div>
              ))
          ) : (
            <Empty icon="◐" title="No budget for this month" hint="Set envelopes on the Budget page." />
          )}
        </Card>

        <Card title="Safety and net worth">
          <div className="col gap-16">
            <div>
              <div className="stat-label">Net worth</div>
              <div className="stat-value">{money(nw.net, { compact: true })}</div>
              <div className="stat-sub">
                {money(nw.assets, { compact: true })} assets · {money(nw.liabilities, { compact: true })} owed
              </div>
            </div>
            <div>
              <div className="row small mb-8">
                <span>Emergency runway</span>
                <span className="spacer" />
                <span className="num bold">{runway.toFixed(1)} months</span>
              </div>
              <Progress value={runway / 6} tone={runway >= 6 ? 'good' : runway >= 3 ? 'warn' : 'bad'} />
              <div className="tiny faint mt-8">Six months of essential spending is the usual target for two incomes.</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
