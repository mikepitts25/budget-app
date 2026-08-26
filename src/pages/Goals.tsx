import { useMemo, useState } from 'react';
import { useApp } from '../store/store';
import type { Goal, GoalKind } from '../store/types';
import { averageSurplus } from '../store/selectors';
import { addMonths, currentMonth, monthLabel, monthsUntil } from '../lib/date';
import { uid } from '../lib/id';
import { allocateSurplus, futureValue, goalStatus, monthsToTarget } from '../lib/projections';
import { sum } from '../lib/money';
import {
  Card,
  ConfirmButton,
  Empty,
  Field,
  Modal,
  MoneyInput,
  PercentInput,
  Progress,
  Stat,
  useToast,
} from '../components/ui';
import { LineChart, SERIES_COLORS } from '../components/charts';

const KIND_META: Record<GoalKind, { icon: string; label: string; hint: string; ret: number }> = {
  house: { icon: '🏠', label: 'Home', hint: 'Down payment, closing costs and a moving cushion.', ret: 0.042 },
  car: { icon: '🚗', label: 'Vehicle', hint: 'Buying outright beats financing at today’s rates.', ret: 0.04 },
  vacation: { icon: '✈️', label: 'Travel', hint: 'Flights, stays, food and the fun budget.', ret: 0.02 },
  emergency: { icon: '🛟', label: 'Emergency fund', hint: 'Three to six months of essential spending.', ret: 0.041 },
  retirement: { icon: '⌛', label: 'Retirement', hint: 'Tracked in detail on the Retirement page.', ret: 0.065 },
  education: { icon: '🎓', label: 'Education', hint: 'Tuition, a course, or a career change runway.', ret: 0.05 },
  wedding: { icon: '💍', label: 'Wedding', hint: 'Venue, rings, the lot.', ret: 0.02 },
  baby: { icon: '🍼', label: 'Baby', hint: 'Leave, childcare and the gear nobody warns you about.', ret: 0.03 },
  renovation: { icon: '🔨', label: 'Renovation', hint: 'Add 20% for what the walls are hiding.', ret: 0.04 },
  custom: { icon: '✨', label: 'Something else', hint: 'Anything the two of you are saving toward.', ret: 0.04 },
};

export default function Goals() {
  const { state, dispatch, money, month } = useApp();
  const toast = useToast();
  const [editing, setEditing] = useState<Goal | null>(null);
  const [whatIf, setWhatIf] = useState(0);

  const goals = state.goals.filter((g) => !g.archived);
  const statuses = useMemo(() => goals.map(goalStatus), [goals]);
  const surplus = averageSurplus(state, month, 3);
  const committed = sum(goals.map((g) => g.monthlyContribution));
  const unassigned = surplus - committed;
  const allocation = useMemo(
    () => allocateSurplus(goals, surplus + whatIf),
    [goals, surplus, whatIf],
  );

  const totalTarget = sum(goals.map((g) => g.target));
  const totalSaved = sum(goals.map((g) => g.saved));
  const behind = statuses.filter((s) => !s.onTrack);

  const blank = (kind: GoalKind = 'custom'): Goal => ({
    id: uid('g'),
    name: '',
    kind,
    target: 0,
    saved: 0,
    targetDate: addMonths(currentMonth(), 24) + '-01',
    monthlyContribution: 0,
    priority: goals.length + 1,
    expectedReturn: KIND_META[kind].ret,
    notes: '',
    archived: false,
  });

  return (
    <div className="col gap-16">
      <div className="grid cols-4">
        <Stat label="Saved toward goals" value={money(totalSaved, { compact: true })} sub={`of ${money(totalTarget, { compact: true })}`} icon="◎" />
        <Stat label="Committed monthly" value={money(committed, { compact: true })} sub={`${goals.length} active goals`} icon="📆" />
        <Stat
          label={unassigned >= 0 ? 'Unassigned surplus' : 'Over-committed'}
          value={money(Math.abs(unassigned), { compact: true })}
          tone={unassigned >= 0 ? 'pos' : 'neg'}
          sub={`Average surplus ${money(surplus, { compact: true })}/mo`}
          icon="🌊"
        />
        <Stat
          label="Behind schedule"
          value={String(behind.length)}
          tone={behind.length ? 'neg' : 'pos'}
          sub={behind.length ? behind.map((b) => b.goal.name).join(', ') : 'Everything on track'}
          icon="⏱️"
        />
      </div>

      <Card
        title="Your goals"
        hint="Priority decides who gets the surplus first. Drag the what-if slider below to test a different monthly number."
        actions={
          <button className="btn primary sm" onClick={() => setEditing(blank())}>
            + New goal
          </button>
        }
      >
        {goals.length === 0 ? (
          <Empty
            icon="◎"
            title="No goals yet"
            hint="A house, a car, a trip, a cushion — name it and the app will tell you what it costs a month."
            action={
              <div className="row wrap gap-6" style={{ justifyContent: 'center' }}>
                {(['emergency', 'house', 'car', 'vacation'] as GoalKind[]).map((k) => (
                  <button key={k} className="btn sm" onClick={() => setEditing(blank(k))}>
                    {KIND_META[k].icon} {KIND_META[k].label}
                  </button>
                ))}
              </div>
            }
          />
        ) : (
          <div className="col gap-16">
            {statuses
              .sort((a, b) => a.goal.priority - b.goal.priority)
              .map((s) => {
                const meta = KIND_META[s.goal.kind];
                const share = allocation[s.goal.id] ?? 0;
                return (
                  <div key={s.goal.id} className="card" style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
                    <div className="row wrap">
                      <span style={{ fontSize: 20 }}>{meta.icon}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="bold">{s.goal.name || 'Untitled goal'}</div>
                        <div className="tiny faint">
                          {money(s.goal.saved)} of {money(s.goal.target)} · target{' '}
                          {monthLabel(s.goal.targetDate.slice(0, 7), 'long')} ·{' '}
                          {s.monthsLeft} months left
                        </div>
                      </div>
                      <div className="spacer" />
                      <span className={s.onTrack ? 'chip good' : 'chip warn'}>
                        {s.onTrack ? 'On track' : `Short ${money(s.gap)}/mo`}
                      </span>
                      <button className="btn ghost sm" onClick={() => setEditing(s.goal)}>
                        Edit
                      </button>
                    </div>

                    <div className="mt-16">
                      <Progress value={s.progress} tone={s.onTrack ? 'good' : 'warn'} />
                    </div>

                    <div className="grid cols-4 mt-16" style={{ gap: 10 }}>
                      <div>
                        <div className="tiny faint">Contributing</div>
                        <div className="num bold">{money(s.goal.monthlyContribution)}/mo</div>
                      </div>
                      <div>
                        <div className="tiny faint">Needs</div>
                        <div className="num bold">{money(s.required)}/mo</div>
                      </div>
                      <div>
                        <div className="tiny faint">Projected by target date</div>
                        <div className={`num bold ${s.onTrack ? 'pos' : 'neg'}`}>
                          {money(s.projected, { compact: true })}
                        </div>
                      </div>
                      <div>
                        <div className="tiny faint">At this pace</div>
                        <div className="num bold">
                          {s.etaMonths === null
                            ? 'never'
                            : s.etaMonths === 0
                              ? 'funded'
                              : `${Math.floor(s.etaMonths / 12)}y ${s.etaMonths % 12}m`}
                        </div>
                      </div>
                    </div>

                    <div className="row wrap gap-6 mt-16">
                      <button
                        className="btn sm"
                        onClick={() => {
                          dispatch({
                            type: 'goal/update',
                            id: s.goal.id,
                            patch: { monthlyContribution: s.required },
                          });
                          toast(`${s.goal.name} set to ${money(s.required)}/mo — that gets you there on time`);
                        }}
                        disabled={s.gap === 0}
                      >
                        Fund to target ({money(s.required)}/mo)
                      </button>
                      <button
                        className="btn sm"
                        onClick={() => {
                          dispatch({ type: 'goal/fund', id: s.goal.id, amount: s.goal.monthlyContribution });
                          toast(`Logged this month’s ${money(s.goal.monthlyContribution)} into ${s.goal.name}`);
                        }}
                      >
                        Log a contribution
                      </button>
                      {share > 0 && (
                        <span className="chip accent">Surplus plan gives it {money(share)}/mo</span>
                      )}
                      {s.goal.notes && <span className="tiny faint truncate">{s.goal.notes}</span>}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </Card>

      {goals.length > 0 && (
        <div className="grid side">
          <Card title="Funding forecast" hint="Where each goal lands if nothing changes">
            <LineChart
              labels={Array.from({ length: 37 }, (_, i) => (i % 6 === 0 ? `${i}m` : ''))}
              series={statuses.slice(0, 5).map((s, i) => ({
                name: s.goal.name,
                color: SERIES_COLORS[i % SERIES_COLORS.length],
                values: Array.from({ length: 37 }, (_, m) =>
                  futureValue(s.goal.saved, s.goal.monthlyContribution, s.goal.expectedReturn, m),
                ),
              }))}
              format={(n) => money(n, { compact: true })}
            />
            <div className="legend mt-8">
              {statuses.slice(0, 5).map((s, i) => (
                <span className="legend-item" key={s.goal.id}>
                  <span className="dot" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                  {s.goal.name}
                </span>
              ))}
            </div>
          </Card>

          <Card title="What if we saved more?" hint="Move the slider to see the waterfall re-plan itself">
            <div className="row">
              <span className="small faint">{money(surplus)}</span>
              <input
                type="range"
                min={0}
                max={200000}
                step={5000}
                value={whatIf}
                onChange={(e) => setWhatIf(Number(e.target.value))}
              />
              <span className="small bold num">+{money(whatIf)}</span>
            </div>
            <div className="divider" />
            {statuses
              .sort((a, b) => a.goal.priority - b.goal.priority)
              .map((s) => {
                const give = allocation[s.goal.id] ?? 0;
                const eta = monthsToTarget(s.goal.saved, give, s.goal.expectedReturn, s.goal.target);
                return (
                  <div key={s.goal.id} className="list-row">
                    <span>{KIND_META[s.goal.kind].icon}</span>
                    <span className="small truncate">{s.goal.name}</span>
                    <span className="spacer" />
                    <span className="small num">{money(give)}/mo</span>
                    <span className="tiny faint" style={{ width: 74, textAlign: 'right' }}>
                      {eta === null ? '—' : eta === 0 ? 'funded' : `${Math.round(eta / 12 * 10) / 10}y`}
                    </span>
                  </div>
                );
              })}
            <p className="tiny faint mt-8">
              Money flows down the priority list: each goal takes what it needs to hit its date, the rest
              falls through to the next one.
            </p>
          </Card>
        </div>
      )}

      {editing && (
        <GoalModal
          goal={editing}
          isNew={!state.goals.some((g) => g.id === editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function GoalModal({ goal, isNew, onClose }: { goal: Goal; isNew: boolean; onClose: () => void }) {
  const { state, dispatch, money } = useApp();
  const toast = useToast();
  const [draft, setDraft] = useState<Goal>(goal);
  const set = <K extends keyof Goal>(k: K, v: Goal[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const status = goalStatus(draft);

  return (
    <Modal
      title={isNew ? 'New goal' : draft.name || 'Goal'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <ConfirmButton
              className="btn danger"
              onConfirm={() => {
                dispatch({ type: 'goal/remove', id: draft.id });
                toast('Goal deleted');
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
              if (!draft.name.trim()) {
                toast('Name the goal first');
                return;
              }
              if (isNew) dispatch({ type: 'goal/add', goal: draft });
              else dispatch({ type: 'goal/update', id: draft.id, patch: draft });
              toast(isNew ? 'Goal created' : 'Goal updated');
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <Field label="What are you saving for?">
        <input className="input" value={draft.name} onChange={(e) => set('name', e.target.value)} autoFocus />
      </Field>

      <Field label="Type">
        <div className="row wrap gap-6">
          {(Object.keys(KIND_META) as GoalKind[]).map((k) => (
            <button
              key={k}
              className={`btn sm ${draft.kind === k ? 'primary' : ''}`}
              onClick={() => setDraft((d) => ({ ...d, kind: k, expectedReturn: KIND_META[k].ret }))}
            >
              {KIND_META[k].icon} {KIND_META[k].label}
            </button>
          ))}
        </div>
      </Field>
      <p className="tiny faint">{KIND_META[draft.kind].hint}</p>

      <div className="field-row three">
        <Field label="Target amount">
          <MoneyInput value={draft.target} onChange={(c) => set('target', c)} />
        </Field>
        <Field label="Saved so far">
          <MoneyInput value={draft.saved} onChange={(c) => set('saved', c)} />
        </Field>
        <Field label="Target date">
          <input
            className="input"
            type="date"
            value={draft.targetDate}
            onChange={(e) => set('targetDate', e.target.value)}
          />
        </Field>
      </div>

      <div className="field-row three">
        <Field label="Monthly contribution">
          <MoneyInput value={draft.monthlyContribution} onChange={(c) => set('monthlyContribution', c)} />
        </Field>
        <Field label="Expected return" hint="Cash ≈ 4%, invested ≈ 6.5%">
          <PercentInput value={draft.expectedReturn} onChange={(v) => set('expectedReturn', v)} />
        </Field>
        <Field label="Priority" hint="1 gets funded first">
          <input
            className="input num"
            type="number"
            min={1}
            value={draft.priority}
            onChange={(e) => set('priority', Number(e.target.value) || 1)}
          />
        </Field>
      </div>

      <Field label="Funded from">
        <select
          className="select"
          value={draft.accountId ?? ''}
          onChange={(e) => set('accountId', e.target.value || undefined)}
        >
          <option value="">Not linked to an account</option>
          {state.accounts
            .filter((a) => !a.archived)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </Field>

      <Field label="Notes">
        <textarea className="textarea" value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>

      <div className={`callout ${status.onTrack ? 'good' : 'warn'}`}>
        {monthsUntil(draft.targetDate)} months to go. You need{' '}
        <span className="bold">{money(status.required)}/mo</span> to land on{' '}
        {money(draft.target)}; you are putting in {money(draft.monthlyContribution)}.{' '}
        {status.onTrack
          ? 'That gets you there.'
          : `Add ${money(status.gap)} a month, or move the date out.`}
      </div>
    </Modal>
  );
}
