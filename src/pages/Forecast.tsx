import { useMemo, useState } from 'react';
import { useApp } from '../store/store';
import type { Cadence, Scheduled } from '../store/types';
import { categoryMap } from '../store/selectors';
import { buildForecast } from '../lib/forecast';
import { monthlyEquivalent, proposeIncome, proposeSchedules } from '../lib/schedule';
import { dateLabel, daysBetweenDates, todayISO, weekdayLabel } from '../lib/date';
import { uid } from '../lib/id';
import { sum } from '../lib/money';
import {
  Card,
  ConfirmButton,
  Empty,
  Field,
  Modal,
  MoneyInput,
  Segmented,
  Stat,
  useToast,
} from '../components/ui';
import { SERIES_COLORS } from '../components/charts';

const CADENCES: Cadence[] = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'annual'];

export default function Forecast() {
  const { state, dispatch, money, month } = useApp();
  const toast = useToast();
  const cats = categoryMap(state);
  const [horizon, setHorizon] = useState<'30' | '60' | '90'>('60');
  const [editing, setEditing] = useState<Scheduled | null>(null);

  const forecast = useMemo(() => buildForecast(state, Number(horizon)), [state, horizon]);
  const proposals = useMemo(
    () => [...proposeSchedules(state, month), ...proposeIncome(state, month)],
    [state, month],
  );

  const committedMonthly = sum(
    state.scheduled.filter((s) => s.enabled && s.amount < 0).map((s) => Math.abs(monthlyEquivalent(s))),
  );
  const scheduledIncome = sum(
    state.scheduled.filter((s) => s.enabled && s.amount > 0).map((s) => monthlyEquivalent(s)),
  );

  const upcoming = forecast.days
    .filter((d) => d.events.length)
    .slice(0, 40);

  const blank = (): Scheduled => ({
    id: uid('sch'),
    name: '',
    amount: 0,
    accountId: state.accounts[0]?.id ?? '',
    categoryId: state.categories.find((c) => c.kind === 'expense')?.id ?? '',
    cadence: 'monthly',
    nextDate: todayISO(),
    paidBy: 'joint',
    splitRule: state.settings.defaultSplit,
    enabled: true,
    autoDetected: false,
  });

  return (
    <div className="col gap-16">
      <div className="grid cols-4">
        <Stat
          label="In your spending accounts"
          value={money(forecast.startingBalance, { compact: true })}
          sub="Checking and cash, right now"
          icon="🏦"
        />
        <Stat
          label="Safe to spend"
          value={money(Math.max(0, forecast.safeToSpend), { compact: true })}
          tone={forecast.safeToSpend > 0 ? 'pos' : 'neg'}
          sub={`Without dropping below your ${money(
            state.settings.safeToSpendBuffer,
          )} buffer in the next 30 days`}
          icon="✅"
        />
        <Stat
          label="Projected low point"
          value={money(forecast.low.balance, { compact: true })}
          tone={forecast.low.balance < 0 ? 'neg' : 'pos'}
          sub={`On ${dateLabel(forecast.low.date)}`}
          icon="📉"
        />
        <Stat
          label="Committed each month"
          value={money(committedMonthly, { compact: true })}
          sub={`Against ${money(scheduledIncome, { compact: true })} of scheduled income`}
          icon="🔁"
        />
      </div>

      <div className="callout small">
        On top of the scheduled items the forecast assumes{' '}
        <span className="bold">{money(forecast.dailyVariable)} a day</span> of everyday spending, taken from
        your own three-month average with the scheduled items removed so nothing is counted twice. Over{' '}
        {horizon} days that is {money(forecast.dailyVariable * Number(horizon))}.
      </div>

      {forecast.nextIncomeDate && (
        <div className="callout small">
          Money next lands on {dateLabel(forecast.nextIncomeDate)}; the low before then is{' '}
          <span className="bold">{money(forecast.lowBeforeIncome)}</span>, and the low across the next 30
          days is <span className="bold">{money(forecast.lowNext30)}</span>. Safe-to-spend uses the
          30-day figure, so a paycheck arriving tomorrow does not tell you to spend the rent.
        </div>
      )}

      {forecast.daysUntilNegative !== null && (
        <div className="callout bad">
          At this rate your spending accounts go negative in{' '}
          <span className="bold">{forecast.daysUntilNegative} days</span>. Move money in, move a bill, or
          cut something before then.
        </div>
      )}

      <Card
        title="The next few weeks"
        hint="Today's balance, carried forward through every bill and paycheck you have scheduled"
        actions={
          <Segmented
            value={horizon}
            onChange={setHorizon}
            options={[
              { value: '30', label: '30 days' },
              { value: '60', label: '60 days' },
              { value: '90', label: '90 days' },
            ]}
          />
        }
      >
        <BalanceLine forecast={forecast} buffer={state.settings.safeToSpendBuffer} money={money} />
        <div className="legend mt-8">
          <span className="legend-item">
            <span className="dot" style={{ background: SERIES_COLORS[0] }} /> Projected balance
          </span>
          <span className="legend-item">
            <span className="dot" style={{ background: 'var(--warn)' }} /> Your buffer
          </span>
          <span className="legend-item">
            <span className="dot" style={{ background: 'var(--bad)' }} /> Zero
          </span>
        </div>
      </Card>

      {proposals.length > 0 && (
        <Card
          title={`${proposals.length} recurring payments detected`}
          hint="Confirm these and the forecast above knows about them"
          actions={
            <button
              className="btn primary sm"
              onClick={() => {
                dispatch({ type: 'scheduled/addMany', items: proposals });
                toast(`Added ${proposals.length} scheduled items`);
              }}
            >
              Add all
            </button>
          }
        >
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {proposals.slice(0, 12).map((p) => (
                  <tr key={p.id}>
                    <td className="small bold">{p.name}</td>
                    <td className="small faint">{p.cadence}, next {dateLabel(p.nextDate)}</td>
                    <td className={`right num small ${p.amount > 0 ? 'pos' : ''}`}>
                      {money(p.amount, { sign: true })}
                    </td>
                    <td className="right" style={{ width: 90 }}>
                      <button
                        className="btn sm"
                        onClick={() => {
                          dispatch({ type: 'scheduled/add', item: p });
                          toast(`${p.name} scheduled`);
                        }}
                      >
                        Add
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid side">
        <Card title="What is coming" hint="Every dated event in the window, with the running balance">
          {upcoming.length === 0 ? (
            <Empty
              icon="📅"
              title="Nothing scheduled yet"
              hint="Add your rent, your paychecks and your subscriptions — or accept the detected ones above — and this becomes a real forecast."
            />
          ) : (
            <div className="table-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 96 }}>Date</th>
                    <th>Event</th>
                    <th className="right" style={{ width: 110 }}>Amount</th>
                    <th className="right" style={{ width: 120 }}>Balance after</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((day) =>
                    day.events.map((e, i) => (
                      <tr key={`${day.date}-${i}`}>
                        <td className="small faint">
                          {i === 0 && (
                            <>
                              {weekdayLabel(day.date)} {dateLabel(day.date)}
                              <div className="tiny">
                                in {daysBetweenDates(todayISO(), day.date)}d
                              </div>
                            </>
                          )}
                        </td>
                        <td className="small">
                          {e.name}
                          <span className="tiny faint">
                            {' '}
                            · {e.kind === 'scheduled' ? 'scheduled' : 'recorded'}
                            {e.categoryId && cats[e.categoryId] ? ` · ${cats[e.categoryId].name}` : ''}
                          </span>
                        </td>
                        <td className={`right num small ${e.amount > 0 ? 'pos' : ''}`}>
                          {money(e.amount, { sign: true })}
                        </td>
                        <td className="right num small">
                          {i === day.events.length - 1 && (
                            <span className={day.balance < 0 ? 'neg bold' : ''}>{money(day.balance)}</span>
                          )}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Scheduled commitments"
          hint="The bills and paychecks the forecast is built from"
          actions={
            <button className="btn primary sm" onClick={() => setEditing(blank())}>
              + Add
            </button>
          }
        >
          {state.scheduled.length === 0 ? (
            <Empty icon="🔁" title="Nothing scheduled" />
          ) : (
            <div className="col gap-4">
              {[...state.scheduled]
                .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
                .map((s) => (
                  <div key={s.id} className="list-row">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={(e) =>
                        dispatch({ type: 'scheduled/update', id: s.id, patch: { enabled: e.target.checked } })
                      }
                    />
                    <div style={{ minWidth: 0 }}>
                      <div className="small truncate">{s.name}</div>
                      <div className="tiny faint">
                        {s.cadence} · next {dateLabel(s.nextDate)}
                        {s.autoDetected && ' · detected'}
                      </div>
                    </div>
                    <span className="spacer" />
                    <span className={`small num ${s.amount > 0 ? 'pos' : ''}`}>
                      {money(s.amount, { sign: true })}
                    </span>
                    <button className="btn ghost sm" onClick={() => setEditing(s)}>
                      ✎
                    </button>
                  </div>
                ))}
            </div>
          )}
          <div className="divider" />
          <div className="row small">
            <span className="faint">Committed monthly</span>
            <span className="spacer" />
            <span className="num bold">{money(committedMonthly)}</span>
          </div>
        </Card>
      </div>

      {editing && (
        <ScheduleModal
          item={editing}
          isNew={!state.scheduled.some((s) => s.id === editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Daily balance line with the zero and buffer thresholds drawn in. */
function BalanceLine({
  forecast,
  buffer,
  money,
}: {
  forecast: ReturnType<typeof buildForecast>;
  buffer: number;
  money: (c: number, o?: { compact?: boolean }) => string;
}) {
  const W = 760;
  const H = 240;
  const padL = 58;
  const padB = 24;
  const padT = 12;
  const innerW = W - padL - 12;
  const innerH = H - padB - padT;

  const values = forecast.days.map((d) => d.balance);
  const max = Math.max(...values, buffer, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (i: number) => padL + (i / Math.max(1, forecast.days.length - 1)) * innerW;
  const y = (v: number) => padT + innerH - ((v - min) / span) * innerH;

  const path = forecast.days.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.balance)}`).join(' ');
  const lowIndex = forecast.days.findIndex((d) => d.date === forecast.low.date);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line className="grid-line" x1={padL} x2={W - 12} y1={padT + innerH * f} y2={padT + innerH * f} />
          <text x={padL - 8} y={padT + innerH * f + 3} textAnchor="end">
            {money(min + span * (1 - f), { compact: true })}
          </text>
        </g>
      ))}

      {min < 0 && (
        <line x1={padL} x2={W - 12} y1={y(0)} y2={y(0)} stroke="var(--bad)" strokeWidth={1.5} strokeDasharray="4 4" />
      )}
      <line
        x1={padL}
        x2={W - 12}
        y1={y(buffer)}
        y2={y(buffer)}
        stroke="var(--warn)"
        strokeWidth={1.5}
        strokeDasharray="4 4"
      />

      <path
        d={`${path} L${x(forecast.days.length - 1)},${y(min)} L${x(0)},${y(min)} Z`}
        fill={SERIES_COLORS[0]}
        opacity={0.14}
      />
      <path d={path} fill="none" stroke={SERIES_COLORS[0]} strokeWidth={2} strokeLinejoin="round" />

      {lowIndex >= 0 && (
        <>
          <circle cx={x(lowIndex)} cy={y(forecast.low.balance)} r={4} fill="var(--bad)" />
          <text x={x(lowIndex)} y={y(forecast.low.balance) - 10} textAnchor="middle" style={{ fontSize: 10 }}>
            low {money(forecast.low.balance, { compact: true })}
          </text>
        </>
      )}

      {forecast.days.map((d, i) =>
        i % Math.ceil(forecast.days.length / 8) === 0 ? (
          <text key={d.date} x={x(i)} y={H - 6} textAnchor="middle">
            {dateLabel(d.date)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function ScheduleModal({ item, isNew, onClose }: { item: Scheduled; isNew: boolean; onClose: () => void }) {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const [draft, setDraft] = useState<Scheduled>(item);
  const set = <K extends keyof Scheduled>(k: K, v: Scheduled[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const isIncome = draft.amount > 0;

  return (
    <Modal
      title={isNew ? 'New scheduled item' : draft.name}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <ConfirmButton
              className="btn danger"
              onConfirm={() => {
                dispatch({ type: 'scheduled/remove', id: draft.id });
                toast('Removed from the schedule');
                onClose();
              }}
            >
              Delete
            </ConfirmButton>
          )}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              if (isNew) dispatch({ type: 'scheduled/add', item: draft });
              else dispatch({ type: 'scheduled/update', id: draft.id, patch: draft });
              toast('Schedule saved');
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="field-row">
        <Field label="Name">
          <input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label="Amount">
          <div className="row">
            <Segmented
              value={isIncome ? 'in' : 'out'}
              onChange={(v) => set('amount', v === 'in' ? Math.abs(draft.amount) : -Math.abs(draft.amount))}
              options={[
                { value: 'out', label: '−' },
                { value: 'in', label: '+' },
              ]}
            />
            <MoneyInput
              value={Math.abs(draft.amount)}
              onChange={(c) => set('amount', isIncome ? c : -c)}
            />
          </div>
        </Field>
      </div>
      <div className="field-row three">
        <Field label="How often">
          <select
            className="select"
            value={draft.cadence}
            onChange={(e) => set('cadence', e.target.value as Cadence)}
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Next date">
          <input className="input" type="date" value={draft.nextDate} onChange={(e) => set('nextDate', e.target.value)} />
        </Field>
        <Field label="Ends" hint="Optional">
          <input
            className="input"
            type="date"
            value={draft.endDate ?? ''}
            onChange={(e) => set('endDate', e.target.value || undefined)}
          />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Account">
          <select className="select" value={draft.accountId} onChange={(e) => set('accountId', e.target.value)}>
            {state.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select className="select" value={draft.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            {state.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="callout small">
        Only items in checking or cash accounts affect the forecast — that is where bills actually come
        from.
      </div>
    </Modal>
  );
}

export { ScheduleModal };
