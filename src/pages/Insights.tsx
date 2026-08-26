import { useMemo } from 'react';
import { useApp } from '../store/store';
import { categoryMap } from '../store/selectors';
import {
  basketInflation,
  costStructure,
  findAnomalies,
  freedomMetrics,
  incomeStability,
  lifestyleCreep,
  netWorthAttribution,
  seasonalLumps,
  spendingHeat,
} from '../lib/analysis';
import { monthLabel } from '../lib/date';
import { formatPercent } from '../lib/money';
import { Card, Empty, Progress, Stat, useToast } from '../components/ui';
import { GroupedBars, RankedBars, StackedBar, SERIES_COLORS } from '../components/charts';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const BAND_COPY = {
  steady: 'Your income barely moves, so a smaller cushion is genuinely enough.',
  variable: 'Your income moves enough that a thin cushion would bite in a bad month.',
  lumpy: 'Your income is lumpy. A deep cushion is not caution, it is the cost of the volatility.',
} as const;

export default function Insights() {
  const { state, dispatch, money, month } = useApp();
  const toast = useToast();
  const cats = categoryMap(state);

  const structure = useMemo(() => costStructure(state, month), [state, month]);
  const stability = useMemo(() => incomeStability(state, month), [state, month]);
  const anomalies = useMemo(() => findAnomalies(state, month), [state, month]);
  const lumps = useMemo(() => seasonalLumps(state, month), [state, month]);
  const creep = useMemo(() => lifestyleCreep(state, month), [state, month]);
  const freedom = useMemo(() => freedomMetrics(state, month), [state, month]);
  const attribution = useMemo(() => netWorthAttribution(state, month), [state, month]);
  const inflation = useMemo(() => basketInflation(state, month), [state, month]);
  const heat = useMemo(() => spendingHeat(state, month), [state, month]);

  if (!state.transactions.length) {
    return <Empty icon="🔬" title="Nothing to analyse yet" hint="Import a few months of history first." />;
  }

  const daysBought = Math.round(freedom.daysBoughtThisMonth);

  return (
    <div className="col gap-16">
      <div className="grid cols-4">
        <Stat
          label="Fixed costs"
          value={formatPercent(structure.fixedShare, 0)}
          tone={structure.fixedShare > 0.6 ? 'neg' : 'pos'}
          sub={`${money(structure.fixed, { compact: true })} committed before you decide anything`}
          icon="🔒"
        />
        <Stat
          label="Income volatility"
          value={formatPercent(stability.volatility, 0)}
          sub={`${stability.band} · suggests a ${stability.recommendedMonths}-month fund`}
          icon="🌊"
        />
        <Stat
          label="Freedom ratio"
          value={`${freedom.fiRatio.toFixed(1)}×`}
          sub={`Invested covers ${freedom.yearsCovered.toFixed(1)} years of spending`}
          icon="🕊️"
        />
        <Stat
          label="Days of freedom bought"
          value={daysBought > 0 ? `${daysBought}` : '0'}
          tone={daysBought > 0 ? 'pos' : 'neg'}
          sub={`From this month's ${money(freedom.monthlySurplus)} surplus`}
          icon="⏳"
        />
      </div>

      <div className="grid side">
        <Card
          title="What is actually committed"
          hint="Fixed costs are the measure of how much room you have if income stops — more useful than any category breakdown"
        >
          <StackedBar
            parts={[
              { label: 'Fixed', value: structure.fixed, color: SERIES_COLORS[3] },
              { label: 'Variable', value: structure.variable, color: SERIES_COLORS[2] },
              { label: 'Left over', value: Math.max(0, structure.income - structure.fixed - structure.variable), color: SERIES_COLORS[1] },
            ]}
            format={(n) => money(n)}
            height={20}
          />
          <div className="legend mt-16">
            <span className="legend-item">
              <span className="dot" style={{ background: SERIES_COLORS[3] }} /> Fixed {money(structure.fixed)}
            </span>
            <span className="legend-item">
              <span className="dot" style={{ background: SERIES_COLORS[2] }} /> Variable {money(structure.variable)}
            </span>
            <span className="legend-item">
              <span className="dot" style={{ background: SERIES_COLORS[1] }} /> Left {money(structure.flexible - structure.variable)}
            </span>
          </div>
          <div className={`callout mt-16 ${structure.fixedShare > 0.6 ? 'warn' : 'good'}`}>
            {formatPercent(structure.fixedShare, 0)} of your income is spoken for before either of you makes a
            single decision. {structure.fixedShare > 0.6
              ? 'Above about 60% a lost income or a bad month gets painful quickly — the fix is usually one big fixed cost, not many small ones.'
              : 'That leaves real room to absorb a shock or redirect money at a goal.'}
          </div>
        </Card>

        <Card title="How steady is the money coming in?" hint="This is what sets your emergency fund target">
          <div className="stat-value">{formatPercent(stability.volatility, 0)}</div>
          <div className="stat-sub">variation in monthly income over the last year</div>
          <p className="small muted mt-16">{BAND_COPY[stability.band]}</p>
          <div className="divider" />
          <div className="row small mb-8">
            <span>Cushion</span>
            <span className="spacer" />
            <span className="num bold">
              {stability.currentMonths.toFixed(1)} of {stability.recommendedMonths} months
            </span>
          </div>
          <Progress
            value={stability.currentMonths / stability.recommendedMonths}
            tone={
              stability.currentMonths >= stability.recommendedMonths
                ? 'good'
                : stability.currentMonths >= stability.recommendedMonths / 2
                  ? 'warn'
                  : 'bad'
            }
          />
          <div className="tiny faint mt-8">
            Target {money(stability.recommendedFund)} — {stability.recommendedMonths} months of essential
            spending, set by your volatility rather than a generic rule.
          </div>
        </Card>
      </div>

      <Card
        title="Worth a second look"
        hint={`${anomalies.length} things that do not match your own patterns this month`}
      >
        {anomalies.length === 0 ? (
          <Empty icon="😌" title="Nothing unusual" hint="Every category is behaving like it normally does." />
        ) : (
          <div className="col gap-6">
            {anomalies.map((a) => (
              <div key={a.key} className="list-row">
                <span
                  className={`chip ${a.severity === 'high' ? 'bad' : a.severity === 'medium' ? 'warn' : ''}`}
                >
                  {a.kind.replace('-', ' ')}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="small bold truncate">{a.title}</div>
                  <div className="tiny faint">{a.detail}</div>
                </div>
                <span className="small num">{money(a.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid side">
        <Card title="When money leaves" hint="Day of the week, last six months">
          <GroupedBars
            groups={WEEKDAYS}
            series={[{ name: 'Spending', color: SERIES_COLORS[0], values: heat.weekday }]}
            format={(n) => money(n, { compact: true })}
            height={170}
          />
          <div className="callout mt-16 small">
            {WEEKDAYS[heat.busiestWeekday]} is your heaviest day, and{' '}
            {formatPercent(heat.weekendShare, 0)} of spending happens at the weekend. Knowing the shape is
            usually enough to change it.
          </div>
          <div className="card-title mt-16 mb-8">Across the month</div>
          <GroupedBars
            groups={heat.monthday.map((_, i) => (i % 5 === 0 ? String(i + 1) : ''))}
            series={[{ name: 'Spending', color: SERIES_COLORS[4], values: heat.monthday }]}
            format={(n) => money(n, { compact: true })}
            height={140}
          />
        </Card>

        <div className="col gap-16">
          {creep && (
            <Card title="Lifestyle creep" hint="Second half of the year against the first">
              <div className="row gap-16">
                <div style={{ flex: 1 }}>
                  <div className="tiny faint">Income</div>
                  <div className={`stat-value ${creep.incomeGrowth >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 21 }}>
                    {creep.incomeGrowth >= 0 ? '+' : ''}
                    {formatPercent(creep.incomeGrowth, 1)}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div className="tiny faint">Spending</div>
                  <div className={`stat-value ${creep.spendingGrowth > creep.incomeGrowth ? 'neg' : 'pos'}`} style={{ fontSize: 21 }}>
                    {creep.spendingGrowth >= 0 ? '+' : ''}
                    {formatPercent(creep.spendingGrowth, 1)}
                  </div>
                </div>
              </div>
              <div
                className={`callout mt-16 ${
                  creep.verdict === 'squeeze' ? 'bad' : creep.verdict === 'creep' ? 'warn' : 'good'
                }`}
              >
                {creep.verdict === 'creep' &&
                  (creep.incomeGrowth > 0.02
                    ? `Spending is growing faster than income. Of the extra you now earn each month, about ${money(
                        Math.max(0, creep.absorbed),
                      )} is being absorbed rather than saved — the raise happened, but it did not reach your goals.`
                    : `Spending is up ${formatPercent(creep.spendingGrowth, 1)} while income is flat. That is ${money(
                        Math.max(0, creep.late.spending - creep.early.spending),
                      )} a month more going out than earlier in the window, with nothing extra coming in to cover it.`)}
                {creep.verdict === 'squeeze' &&
                  `Income is down ${formatPercent(Math.abs(creep.incomeGrowth), 1)} while spending is up ${formatPercent(
                    creep.spendingGrowth,
                    1,
                  )}. That is roughly ${money(
                    Math.abs(creep.late.income - creep.early.income) + Math.max(0, creep.absorbed),
                  )} a month of pressure appearing from both directions at once — worth understanding before it eats the buffer.`}
                {creep.verdict === 'tightening' &&
                  `Spending is falling — ${money(
                    Math.abs(creep.early.spending - creep.late.spending),
                  )} a month less than earlier in the window. Whatever you changed is working.`}
                {creep.verdict === 'healthy' &&
                  'Spending is growing no faster than income, which is exactly how a raise turns into progress rather than a bigger baseline.'}
              </div>
            </Card>
          )}

          <Card title="Where net worth came from" hint="What you did, versus what the market did">
            <GroupedBars
              groups={attribution.map((a) => monthLabel(a.month))}
              series={[
                { name: 'Saved', color: SERIES_COLORS[1], values: attribution.map((a) => a.saved) },
                { name: 'Debt paid', color: SERIES_COLORS[0], values: attribution.map((a) => a.debtPaid) },
                { name: 'Market', color: SERIES_COLORS[2], values: attribution.map((a) => Math.max(0, a.marketMove)) },
              ]}
              format={(n) => money(n, { compact: true })}
              height={180}
            />
            <div className="legend mt-8">
              {[
                ['Saved', SERIES_COLORS[1]],
                ['Debt paid', SERIES_COLORS[0]],
                ['Market', SERIES_COLORS[2]],
              ].map(([l, c]) => (
                <span className="legend-item" key={l}>
                  <span className="dot" style={{ background: c }} /> {l}
                </span>
              ))}
            </div>
            <div className="tiny faint mt-8">
              The first two are yours. The third is not, and should be judged over years rather than months.
            </div>
          </Card>
        </div>
      </div>

      <div className="grid side">
        <Card
          title="Annual lumps you can stop being surprised by"
          hint="Categories that spike in one month, turned into a monthly amount"
        >
          {lumps.length === 0 ? (
            <Empty icon="📆" title="No seasonal spikes found" hint="Two years of history sharpens this a lot." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Lands in</th>
                    <th className="right">Typical</th>
                    <th className="right">Set aside monthly</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lumps.map((l) => (
                    <tr key={`${l.categoryId}-${l.month}`}>
                      <td className="small">
                        {cats[l.categoryId]?.icon} {cats[l.categoryId]?.name}
                      </td>
                      <td className="small faint">{l.monthName}</td>
                      <td className="right num small">{money(l.typical)}</td>
                      <td className="right num small bold">{money(l.monthlySinkingFund)}</td>
                      <td className="right">
                        <button
                          className="btn sm"
                          onClick={() => {
                            dispatch({
                              type: 'budget/set',
                              line: {
                                month,
                                categoryId: l.categoryId,
                                planned: l.monthlySinkingFund,
                                rollover: true,
                              },
                            });
                            toast(
                              `${cats[l.categoryId]?.name}: ${money(l.monthlySinkingFund)}/mo envelope with rollover`,
                            );
                          }}
                        >
                          Make a sinking fund
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Costing more, or buying more?" hint="Spend per visit against number of visits">
          {inflation.length === 0 ? (
            <Empty icon="🧺" title="Not enough history" />
          ) : (
            <RankedBars
              rows={inflation.slice(0, 7).map((r) => ({
                label: `${cats[r.categoryId]?.icon ?? ''} ${cats[r.categoryId]?.name ?? ''}`,
                value: Math.abs(Math.round(r.change * 1000)),
                sub: `${r.change >= 0 ? '+' : ''}${Math.round(r.change * 100)}% per visit · ${
                  r.frequencyChange >= 0 ? '+' : ''
                }${Math.round(r.frequencyChange * 100)}% as often (${r.visitsLate}/mo)`,
              }))}
              format={() => ''}
              colorFor={(_, i) => (inflation[i]?.change > 0 ? 'var(--bad)' : 'var(--good)')}
            />
          )}
          <div className="tiny faint mt-16">
            A rise in spend per visit is prices. A rise in visits is habit. They need different responses,
            and lumping them together is why "we are spending more on food" never leads anywhere.
          </div>
        </Card>
      </div>
    </div>
  );
}
