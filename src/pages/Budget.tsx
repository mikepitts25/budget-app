import { useMemo, useState } from 'react';
import { useApp } from '../store/store';
import type { CategoryGroup } from '../store/types';
import { budgetStatus, categoryAverage, categoryMap, monthSummary } from '../store/selectors';
import { addMonths, monthLabel } from '../lib/date';
import { formatPercent } from '../lib/money';
import { Card, ConfirmButton, Empty, MoneyInput, Progress, Stat, useToast } from '../components/ui';
import { StackedBar, SERIES_COLORS } from '../components/charts';

export default function Budget() {
  const { state, dispatch, money, month } = useApp();
  const toast = useToast();
  const cats = categoryMap(state);
  const [showAll, setShowAll] = useState(false);

  const status = useMemo(() => budgetStatus(state, month), [state, month]);
  const statusByCat = new Map(status.map((s) => [s.categoryId, s]));
  const summary = monthSummary(state, month);

  const expenseCats = state.categories.filter((c) => c.kind === 'expense' && !c.archived);
  const visible = showAll
    ? expenseCats
    : expenseCats.filter((c) => {
        const s = statusByCat.get(c.id);
        return (s?.planned ?? 0) > 0 || (s?.actual ?? 0) > 0;
      });

  const groups = [...new Set(visible.map((c) => c.group))] as CategoryGroup[];
  const totalPlanned = status.reduce((a, s) => a + s.planned, 0);
  const totalActual = status.reduce((a, s) => a + s.actual, 0);
  const toAssign = summary.income - totalPlanned;

  const setLine = (categoryId: string, planned: number) => {
    const existing = state.budget.find((b) => b.month === month && b.categoryId === categoryId);
    dispatch({
      type: 'budget/set',
      line: { month, categoryId, planned, rollover: existing?.rollover ?? false },
    });
  };

  return (
    <div className="col gap-16">
      <div className="grid cols-4">
        <Stat label="Planned" value={money(totalPlanned, { compact: true })} sub="across all envelopes" icon="◐" />
        <Stat
          label="Spent"
          value={money(totalActual, { compact: true })}
          sub={`${formatPercent(totalPlanned ? totalActual / totalPlanned : 0, 0)} of plan`}
          tone={totalActual > totalPlanned ? 'neg' : 'pos'}
          icon="🧾"
        />
        <Stat
          label="Left in envelopes"
          value={money(totalPlanned - totalActual, { compact: true })}
          tone={totalPlanned - totalActual >= 0 ? 'pos' : 'neg'}
          icon="✉️"
        />
        <Stat
          label={toAssign >= 0 ? 'Still to assign' : 'Over-assigned'}
          value={money(Math.abs(toAssign), { compact: true })}
          tone={toAssign >= 0 ? 'pos' : 'neg'}
          sub={`Income ${money(summary.income, { compact: true })}`}
          icon="🎯"
        />
      </div>

      <Card
        title={`${monthLabel(month, 'long')} plan`}
        hint="Give every dollar a job before the month starts. Envelopes turn amber at 85% and red when they blow."
        actions={
          <div className="row gap-6">
            <button
              className="btn sm"
              onClick={() => {
                dispatch({ type: 'budget/copy', from: addMonths(month, -1), to: month });
                toast(`Copied ${monthLabel(addMonths(month, -1), 'long')} into this month`);
              }}
            >
              Copy last month
            </button>
            <button
              className="btn sm"
              onClick={() => {
                dispatch({ type: 'budget/autofill', month, lookback: 3 });
                toast('Filled from your three-month averages');
              }}
            >
              Suggest from history
            </button>
            <ConfirmButton
              className="btn ghost sm"
              onConfirm={() => {
                dispatch({ type: 'budget/clear', month });
                toast('Cleared the month');
              }}
            >
              Clear
            </ConfirmButton>
          </div>
        }
      >
        {status.length === 0 && visible.length === 0 ? (
          <Empty
            icon="◐"
            title="This month has no plan yet"
            hint="Copy last month, or let the app suggest envelopes from your own averages."
          />
        ) : (
          <div className="col gap-16">
            {groups.map((group) => {
              const inGroup = visible.filter((c) => c.group === group);
              const planned = inGroup.reduce((a, c) => a + (statusByCat.get(c.id)?.planned ?? 0), 0);
              const actual = inGroup.reduce((a, c) => a + (statusByCat.get(c.id)?.actual ?? 0), 0);
              return (
                <div key={group}>
                  <div className="row small bold" style={{ marginBottom: 6 }}>
                    <span>{group}</span>
                    <span className="spacer" />
                    <span className="faint num">
                      {money(actual)} of {money(planned)}
                    </span>
                  </div>
                  <div className="table-wrap">
                    <table className="table">
                      <tbody>
                        {inGroup.map((c) => {
                          const s = statusByCat.get(c.id);
                          const planned = s?.planned ?? 0;
                          const actual = s?.actual ?? 0;
                          const pace = planned ? actual / planned : actual > 0 ? 2 : 0;
                          const avg = categoryAverage(state, c.id, addMonths(month, -1), 3);
                          const line = state.budget.find((b) => b.month === month && b.categoryId === c.id);
                          return (
                            <tr key={c.id}>
                              <td style={{ width: 190 }}>
                                <div className="row gap-6">
                                  <span>{c.icon}</span>
                                  <span className="truncate">{c.name}</span>
                                  {!c.essential && <span className="tiny faint">want</span>}
                                </div>
                              </td>
                              <td style={{ width: 130 }}>
                                <MoneyInput value={planned} onChange={(cents) => setLine(c.id, cents)} />
                              </td>
                              <td>
                                <Progress
                                  value={pace}
                                  tone={pace > 1 ? 'bad' : pace > 0.85 ? 'warn' : 'good'}
                                />
                                <div className="tiny faint mt-8">
                                  {money(actual)} spent
                                  {s && s.carried > 0 && ` · ${money(s.carried)} rolled over`}
                                  {avg > 0 && ` · 3-mo average ${money(avg)}`}
                                </div>
                              </td>
                              <td className="right num small" style={{ width: 110 }}>
                                <span className={planned - actual < 0 ? 'neg' : 'pos'}>
                                  {money(planned - actual)}
                                </span>
                                <div className="tiny faint">left</div>
                              </td>
                              <td style={{ width: 90 }}>
                                <label className="tiny faint row gap-4" title="Carry unspent money into next month">
                                  <input
                                    type="checkbox"
                                    checked={line?.rollover ?? false}
                                    onChange={(e) =>
                                      dispatch({
                                        type: 'budget/set',
                                        line: { month, categoryId: c.id, planned, rollover: e.target.checked },
                                      })
                                    }
                                  />
                                  roll
                                </label>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="row mt-16">
          <button className="btn ghost sm" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Hide unused categories' : `Show all ${expenseCats.length} categories`}
          </button>
        </div>
      </Card>

      <Card title="Plan against reality" hint="How the month is distributed once it is all added up">
        <StackedBar
          parts={status
            .filter((s) => s.actual > 0)
            .sort((a, b) => b.actual - a.actual)
            .slice(0, 8)
            .map((s, i) => ({
              label: cats[s.categoryId]?.name ?? 'Other',
              value: s.actual,
              color: SERIES_COLORS[i % SERIES_COLORS.length],
            }))}
          format={(n) => money(n)}
          height={18}
        />
        <div className="legend mt-16">
          {status
            .filter((s) => s.actual > 0)
            .sort((a, b) => b.actual - a.actual)
            .slice(0, 8)
            .map((s, i) => (
              <span className="legend-item" key={s.categoryId}>
                <span className="dot" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                {cats[s.categoryId]?.name} · {money(s.actual, { compact: true })}
              </span>
            ))}
        </div>
      </Card>
    </div>
  );
}
