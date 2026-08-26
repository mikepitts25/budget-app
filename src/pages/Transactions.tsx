import { useMemo, useRef, useState } from 'react';
import { useApp } from '../store/store';
import type { ID, SplitRule, Transaction, TxStatus } from '../store/types';
import { categoryMap, txInMonth } from '../store/selectors';
import { dateLabel, monthLabel, todayISO } from '../lib/date';
import { uid } from '../lib/id';
import { makeTransaction, withBase } from '../store/factory';
import { guessColumns, parseCSV, rowsToTransactions, transactionsToCSV, type ColumnMap } from '../lib/csv';
import { ingest, ofxSource } from '../lib/sources';
import { shareOf } from '../lib/split';
import { categorizeIncoming, ruleFromTransaction } from '../lib/rules';
import { activePerson, needsApproval, visiblePayee } from '../lib/couples';
import { isMultiCurrency } from '../lib/currency';
import { RuleModal } from '../components/RulesManager';
import LabelReview from '../components/LabelReview';
import { explainLabel, isAutomatic } from '../lib/labels';
import { Card, ConfirmButton, Empty, Field, Modal, MoneyInput, Segmented, useToast } from '../components/ui';
import { canSeeDetail as canSee } from '../lib/couples';

type Filter = 'all' | 'in' | 'out';

const STATUS_LABEL: Record<TxStatus, string> = {
  pending: 'Pending',
  cleared: 'Cleared',
  reconciled: 'Reconciled',
};

const SPLIT_LABEL: Record<SplitRule, string> = {
  even: 'Split evenly',
  income: 'Split by income',
  custom: 'Custom split',
  personal: 'One of us only',
};

export default function Transactions() {
  const { state, dispatch, money, month } = useApp();
  const toast = useToast();
  const cats = categoryMap(state);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [categoryFilter, setCategoryFilter] = useState<ID | 'all'>('all');
  const [personFilter, setPersonFilter] = useState<ID | 'all' | 'joint'>('all');
  const [statusFilter, setStatusFilter] = useState<TxStatus | 'all'>('all');
  const [autoOnly, setAutoOnly] = useState(false);
  const [scope, setScope] = useState<'month' | 'all'>('month');
  const [selected, setSelected] = useState<Set<ID>>(new Set());
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [importing, setImporting] = useState(false);

  const base = scope === 'month' ? txInMonth(state, month) : state.transactions;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return base.filter((t) => {
      if (filter === 'in' && t.amount <= 0) return false;
      if (filter === 'out' && t.amount >= 0) return false;
      if (categoryFilter !== 'all' && t.categoryId !== categoryFilter) return false;
      if (personFilter !== 'all' && t.paidBy !== personFilter) return false;
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (autoOnly && !isAutomatic(t)) return false;
      if (!q) return true;
      return (
        t.payee.toLowerCase().includes(q) ||
        t.note.toLowerCase().includes(q) ||
        (cats[t.categoryId]?.name ?? '').toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.includes(q))
      );
    });
  }, [base, query, filter, categoryFilter, personFilter, statusFilter, autoOnly, cats]);

  // Totals must use base amounts: adding dollars to euros would be nonsense.
  const real = rows.filter((t) => !t.transferId);
  const inflow = real.filter((t) => t.baseAmount > 0).reduce((a, t) => a + t.baseAmount, 0);
  const outflow = real.filter((t) => t.baseAmount < 0).reduce((a, t) => a + Math.abs(t.baseAmount), 0);
  const transferCount = rows.length - real.length;

  const toggle = (id: ID) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const exportCSV = () => {
    const csv = transactionsToCSV(rows, state.categories, state.accounts);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${scope === 'month' ? month : 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${rows.length} transactions`);
  };

  const blank = (): Transaction =>
    makeTransaction(state, {
      date: todayISO(),
      amount: 0,
      accountId: state.accounts[0]?.id ?? '',
      // Defaulting to the first expense category makes every new entry rent,
      // which is both wrong and quietly exempt from the big-purchase check-in.
      categoryId:
        state.categories.find((c) => c.name === 'Miscellaneous' && !c.archived)?.id ??
        state.categories.find((c) => c.kind === 'expense' && !c.essential && !c.archived)?.id ??
        state.categories.find((c) => c.kind === 'expense')?.id ??
        '',
      payee: '',
    });

  return (
    <div className="col gap-16">
      <LabelReview />

      {rows.some((t) => needsApproval(state, t)) && (
        <Card
          title="Waiting on both of you"
          hint={`Anything over ${money(state.settings.bigPurchaseThreshold)} needs a nod from each of you — an agreement you set, not a rule the app invented.`}
        >
          {rows
            .filter((t) => needsApproval(state, t))
            .slice(0, 6)
            .map((t) => {
              const me = activePerson(state);
              const mine = t.approvals.includes(me.id);
              return (
                <div key={t.id} className="list-row">
                  <span className="small bold truncate">{visiblePayee(state, t)}</span>
                  <span className="small num neg">{money(t.amount)}</span>
                  <span className="spacer" />
                  <span className="tiny faint">
                    {t.approvals.length} of {state.people.length} signed off
                  </span>
                  <button
                    className="btn sm"
                    disabled={mine}
                    onClick={() => {
                      dispatch({ type: 'tx/approve', id: t.id, personId: me.id });
                      toast(`${me.name} signed off on ${visiblePayee(state, t)}`);
                    }}
                  >
                    {mine ? '✓ You approved' : `Approve as ${me.name}`}
                  </button>
                </div>
              );
            })}
        </Card>
      )}

      <Card>
        <div className="row wrap gap-16">
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: 'month', label: monthLabel(month, 'long') },
              { value: 'all', label: 'All time' },
            ]}
          />
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'in', label: 'Money in' },
              { value: 'out', label: 'Money out' },
            ]}
          />
          <input
            className="input"
            style={{ maxWidth: 240 }}
            placeholder="Search payee, note, tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="select"
            style={{ maxWidth: 190 }}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as ID | 'all')}
          >
            <option value="all">All categories</option>
            {state.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            style={{ maxWidth: 160 }}
            value={personFilter}
            onChange={(e) => setPersonFilter(e.target.value as ID | 'all' | 'joint')}
          >
            <option value="all">Anyone</option>
            <option value="joint">Joint</option>
            {state.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="tiny faint row gap-4" title="Only transactions the app categorized for you">
            <input
              type="checkbox"
              checked={autoOnly}
              onChange={(e) => setAutoOnly(e.target.checked)}
            />
            auto-filed only
          </label>
          <select
            className="select"
            style={{ maxWidth: 150 }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as TxStatus | 'all')}
          >
            <option value="all">Any status</option>
            {(Object.keys(STATUS_LABEL) as TxStatus[]).map((st) => (
              <option key={st} value={st}>
                {STATUS_LABEL[st]}
              </option>
            ))}
          </select>
          <div className="spacer" />
          <button className="btn" onClick={exportCSV}>
            ⭳ Export
          </button>
          <button className="btn" onClick={() => setImporting(true)}>
            ⭱ Import CSV
          </button>
          <button className="btn primary" onClick={() => setEditing(blank())}>
            + Add transaction
          </button>
        </div>

        <div className="row wrap gap-16 mt-16 small faint">
          <span>
            {rows.length} transaction{rows.length === 1 ? '' : 's'}
          </span>
          <span className="pos num">+{money(inflow)}</span>
          <span className="neg num">−{money(outflow)}</span>
          <span className={`num bold ${inflow - outflow >= 0 ? 'pos' : 'neg'}`}>
            net {money(inflow - outflow)}
          </span>
          {isMultiCurrency(state) && (
            <span className="chip">totals in {state.settings.baseCurrency}</span>
          )}
          {transferCount > 0 && (
            <span className="chip">{transferCount} transfer legs excluded from totals</span>
          )}
        </div>

        {selected.size > 0 && (
          <div className="row wrap gap-16 mt-16">
            <span className="chip accent">{selected.size} selected</span>
            <select
              className="select"
              style={{ maxWidth: 220 }}
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                dispatch({ type: 'tx/bulkCategory', ids: [...selected], categoryId: e.target.value });
                toast(`Recategorized ${selected.size} transactions`);
                setSelected(new Set());
              }}
            >
              <option value="">Recategorize to…</option>
              {state.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
            <select
              className="select"
              style={{ maxWidth: 180 }}
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                dispatch({ type: 'tx/status', ids: [...selected], status: e.target.value as TxStatus });
                toast(`Marked ${selected.size} as ${e.target.value}`);
                setSelected(new Set());
              }}
            >
              <option value="">Mark as…</option>
              {(Object.keys(STATUS_LABEL) as TxStatus[]).map((st) => (
                <option key={st} value={st}>
                  {STATUS_LABEL[st]}
                </option>
              ))}
            </select>
            <ConfirmButton
              onConfirm={() => {
                dispatch({ type: 'tx/removeMany', ids: [...selected] });
                toast(`Deleted ${selected.size} transactions`);
                setSelected(new Set());
              }}
            >
              Delete selected
            </ConfirmButton>
            <button className="btn ghost sm" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </div>
        )}
      </Card>

      <Card>
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 30 }}>
                    <input
                      type="checkbox"
                      checked={selected.size === rows.length && rows.length > 0}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                      }
                    />
                  </th>
                  <th style={{ width: 80 }}>Date</th>
                  <th>Payee</th>
                  <th style={{ width: 170 }}>Category</th>
                  <th style={{ width: 130 }}>Paid by</th>
                  <th style={{ width: 130 }}>Split</th>
                  <th className="right" style={{ width: 120 }}>
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 400).map((t) => {
                  const person = state.people.find((p) => p.id === t.paidBy);
                  return (
                    <tr
                      key={t.id}
                      className={selected.has(t.id) ? 'selected' : ''}
                      onDoubleClick={() => setEditing(t)}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                      </td>
                      <td className="small faint num">{dateLabel(t.date)}</td>
                      <td>
                        <button
                          className="btn ghost sm"
                          style={{ padding: 0, fontWeight: 550 }}
                          onClick={() => setEditing(t)}
                        >
                          {visiblePayee(state, t)}
                        </button>
                        {t.private && <span className="chip" title="Detail hidden from your partner">🔒</span>}
                        {needsApproval(state, t) && <span className="chip warn">needs sign-off</span>}
                        {t.comments.length > 0 && (
                          <span className="chip" title={`${t.comments.length} comments`}>
                            💬 {t.comments.length}
                          </span>
                        )}
                        {t.note && canSee(state, t) && <div className="tiny faint truncate">{t.note}</div>}
                      </td>
                      <td className="small">
                        {cats[t.categoryId]?.icon} {cats[t.categoryId]?.name ?? '—'}
                        {isAutomatic(t) && (
                          <span
                            className="chip"
                            style={{ marginLeft: 6 }}
                            title={`${explainLabel(state, t).label}. ${explainLabel(state, t).detail}`}
                          >
                            auto
                          </span>
                        )}
                      </td>
                      <td className="small">
                        {person ? (
                          <span className="row gap-6">
                            <span className="dot" style={{ background: person.color }} />
                            {person.name}
                          </span>
                        ) : (
                          <span className="faint">Joint</span>
                        )}
                      </td>
                      <td className="tiny faint">
                        {t.transferId ? (
                          <span className="chip">⇄ transfer</span>
                        ) : (
                          SPLIT_LABEL[t.splitRule]
                        )}
                        {t.status !== 'cleared' && (
                          <div className={`tiny ${t.status === 'pending' ? 'muted' : 'faint'}`}>
                            {STATUS_LABEL[t.status]}
                          </div>
                        )}
                      </td>
                      <td className={`right num ${t.amount >= 0 ? 'pos' : ''}`}>
                        {money(t.amount, { sign: true, currency: t.currency })}
                        {t.currency !== state.settings.baseCurrency && (
                          <div className="tiny faint">
                            = {money(t.baseAmount, { sign: true })}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length > 400 && (
              <div className="small faint center mt-16">
                Showing the first 400 of {rows.length}. Narrow the filters to see the rest.
              </div>
            )}
          </div>
        ) : (
          <Empty
            icon="🔍"
            title="Nothing matches"
            hint="Try a different month, category or search term."
          />
        )}
      </Card>

      {editing && (
        <TransactionModal
          tx={editing}
          isNew={!state.transactions.some((t) => t.id === editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </div>
  );
}

function TransactionModal({
  tx,
  isNew,
  onClose,
}: {
  tx: Transaction;
  isNew: boolean;
  onClose: () => void;
}) {
  const { state, dispatch, money } = useApp();
  const toast = useToast();
  const [draft, setDraft] = useState<Transaction>(tx);
  const [makingRule, setMakingRule] = useState<import('../store/types').Rule | null>(null);
  const [commentText, setCommentText] = useState('');

  const addComment = () => {
    const text = commentText.trim();
    if (!text) return;
    const comment = {
      id: uid('cm'),
      personId: activePerson(state).id,
      text,
      at: new Date().toISOString(),
    };
    dispatch({ type: 'tx/comment', id: draft.id, comment });
    setDraft((d) => ({ ...d, comments: [...d.comments, comment] }));
    setCommentText('');
  };
  const set = <K extends keyof Transaction>(key: K, value: Transaction[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const isIncome = draft.amount > 0;
  const shares = shareOf(draft, state.people);

  const save = () => {
    if (!draft.payee.trim()) {
      toast('Give the transaction a payee first');
      return;
    }
    if (isNew) {
      const [filed] = categorizeIncoming(state, [draft]);
      dispatch({ type: 'tx/add', tx: filed });
      toast(
        filed.categoryId === draft.categoryId
          ? 'Transaction added'
          : 'Transaction added and filed by your rules',
      );
    } else {
      dispatch({ type: 'tx/update', id: draft.id, patch: draft });
      toast('Transaction updated');
    }
    onClose();
  };

  return (
    <Modal
      title={isNew ? 'New transaction' : 'Edit transaction'}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <ConfirmButton
              className="btn danger"
              onConfirm={() => {
                dispatch({ type: 'tx/remove', id: draft.id });
                toast('Transaction deleted');
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
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="field-row">
        <Field label="Payee">
          <input className="input" value={draft.payee} onChange={(e) => set('payee', e.target.value)} autoFocus />
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={draft.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
      </div>

      <div className="field-row">
        <Field
          label={`Amount${draft.currency !== state.settings.baseCurrency ? ` (${draft.currency})` : ''}`}
          hint={isIncome ? 'Money coming in' : 'Money going out'}
        >
          <div className="row">
            <Segmented
              value={isIncome ? 'in' : 'out'}
              onChange={(v) =>
                setDraft((d) => withBase(d, v === 'in' ? Math.abs(d.amount) : -Math.abs(d.amount)))
              }
              options={[
                { value: 'out', label: '−' },
                { value: 'in', label: '+' },
              ]}
            />
            <MoneyInput
              value={Math.abs(draft.amount)}
              onChange={(c) => setDraft((d) => withBase(d, isIncome ? c : -c))}
            />
          </div>
        </Field>
        <Field
          label="Category"
          hint={isAutomatic(draft) ? explainLabel(state, draft).label : undefined}
        >
          <select
            className="select"
            value={draft.categoryId}
            onChange={(e) =>
              // Choosing by hand is a decision, and decisions are never
              // overwritten by rules later.
              setDraft((d) => ({
                ...d,
                categoryId: e.target.value,
                categorySource: 'manual',
                categoryRuleId: undefined,
                categoryConfidence: undefined,
              }))
            }
          >
            {state.categories
              .filter((c) => !c.archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
          </select>
        </Field>
      </div>

      {draft.currency !== state.settings.baseCurrency && (
        <div className="field-row">
          <Field
            label={`Rate used (1 ${draft.currency} in ${state.settings.baseCurrency})`}
            hint="Fixed at the time of the transaction, so old reports do not move"
          >
            <input
              className="input num"
              type="number"
              step="0.0001"
              value={draft.rate}
              onChange={(e) =>
                setDraft((d) => withBase(d, d.amount, Number(e.target.value) || d.rate))
              }
            />
          </Field>
          <Field label={`Counts as (${state.settings.baseCurrency})`}>
            <div className="input num" style={{ display: 'flex', alignItems: 'center' }}>
              {money(draft.baseAmount, { sign: true })}
            </div>
          </Field>
        </div>
      )}

      <div className="field-row">
        <Field label="Account">
          <select
            className="select"
            value={draft.accountId}
            onChange={(e) => {
              // The account decides the currency, and changing it re-rates the
              // amount rather than silently re-denominating it.
              const account = state.accounts.find((a) => a.id === e.target.value);
              const currency = account?.currency ?? state.settings.baseCurrency;
              const rate =
                currency === state.settings.baseCurrency ? 1 : (state.rates[currency]?.rate ?? 1);
              setDraft((d) => withBase({ ...d, accountId: e.target.value, currency }, d.amount, rate));
            }}
          >
            {state.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.currency !== state.settings.baseCurrency ? ` (${a.currency})` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Paid by">
          <select
            className="select"
            value={draft.paidBy}
            onChange={(e) => set('paidBy', e.target.value as ID | 'joint')}
          >
            <option value="joint">Joint account</option>
            {state.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="How is this shared?">
        <select
          className="select"
          value={draft.splitRule}
          onChange={(e) => {
            const rule = e.target.value as SplitRule;
            const shares: Record<ID, number> =
              rule === 'personal'
                ? Object.fromEntries(
                    state.people.map((p) => [p.id, p.id === draft.paidBy ? 1 : 0]),
                  )
                : Object.fromEntries(state.people.map((p) => [p.id, 1 / state.people.length]));
            setDraft((d) => ({ ...d, splitRule: rule, splitShares: shares }));
          }}
        >
          {(Object.keys(SPLIT_LABEL) as SplitRule[]).map((r) => (
            <option key={r} value={r}>
              {SPLIT_LABEL[r]}
            </option>
          ))}
        </select>
      </Field>

      {draft.splitRule === 'custom' && (
        <div className="col gap-6">
          {state.people.map((p) => {
            const pct = Math.round((draft.splitShares[p.id] ?? 0) * 100);
            return (
              <div key={p.id} className="row">
                <span className="dot" style={{ background: p.color }} />
                <span className="small" style={{ width: 80 }}>
                  {p.name}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={pct}
                  onChange={(e) => {
                    const value = Number(e.target.value) / 100;
                    const others = state.people.filter((x) => x.id !== p.id);
                    const rest = (1 - value) / Math.max(1, others.length);
                    setDraft((d) => ({
                      ...d,
                      splitShares: {
                        [p.id]: value,
                        ...Object.fromEntries(others.map((o) => [o.id, rest])),
                      },
                    }));
                  }}
                />
                <span className="small num" style={{ width: 42 }}>
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      )}

      {draft.amount !== 0 && draft.splitRule !== 'personal' && (
        <div className="callout small">
          {state.people
            .map((p) => `${p.name} carries ${money(shares[p.id] ?? 0)}`)
            .join(' · ')}
        </div>
      )}

      {!isNew && (
        <div className="row">
          <button className="btn sm" onClick={() => setMakingRule(ruleFromTransaction(draft, state.rules.length + 1))}>
            ⚡ Always file {draft.payee} like this
          </button>
        </div>
      )}

      {draft.transferId && (
        <div className="callout warn small">
          This is one leg of a transfer between your own accounts. Deleting it removes both legs; changing
          the amount here would leave the two sides disagreeing, so edit it as a pair instead.
        </div>
      )}

      <div className="field-row">
        <Field label="Status" hint="Pending amounts can still change at the bank">
          <select
            className="select"
            value={draft.status}
            onChange={(e) => set('status', e.target.value as Transaction['status'])}
          >
            {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((st) => (
              <option key={st} value={st}>
                {STATUS_LABEL[st]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Note">
          <input className="input" value={draft.note} onChange={(e) => set('note', e.target.value)} />
        </Field>
      </div>
      <Field label="Tags" hint="Space separated — handy for trips, projects or reimbursements">
        <input
          className="input"
          value={draft.tags.join(' ')}
          onChange={(e) => set('tags', e.target.value.split(/\s+/).filter(Boolean))}
        />
      </Field>

      <label className="row gap-6 small">
        <input
          type="checkbox"
          checked={draft.private}
          onChange={(e) => set('private', e.target.checked)}
        />
        Keep the detail private
        <span className="tiny faint">
          — your partner still sees the amount, but not the merchant. Hiding the amount would quietly
          break every total in the app.
        </span>
      </label>

      {!isNew && needsApproval(state, draft) && (
        <div className="callout warn">
          <div className="bold small">
            Over your {money(state.settings.bigPurchaseThreshold)} check-in threshold
          </div>
          <div className="row wrap gap-6 mt-8">
            {state.people.map((p) => {
              const signed = draft.approvals.includes(p.id);
              return (
                <button
                  key={p.id}
                  className={`btn sm ${signed ? '' : 'primary'}`}
                  disabled={signed}
                  onClick={() => {
                    dispatch({ type: 'tx/approve', id: draft.id, personId: p.id });
                    setDraft((d) => ({ ...d, approvals: [...d.approvals, p.id] }));
                  }}
                >
                  {signed ? `✓ ${p.name}` : `Sign off as ${p.name}`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!isNew && (
        <div>
          <div className="card-title mb-8">Between you two</div>
          {draft.comments.length === 0 && (
            <div className="tiny faint mb-8">
              No comments yet. This is the place for "what was this?" — better here than remembered wrong
              three weeks later.
            </div>
          )}
          {draft.comments.map((c) => {
            const person = state.people.find((p) => p.id === c.personId);
            return (
              <div key={c.id} className="list-row">
                <span className="dot" style={{ background: person?.color }} />
                <div style={{ minWidth: 0 }}>
                  <div className="small">{c.text}</div>
                  <div className="tiny faint">
                    {person?.name} · {c.at.slice(0, 10)}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="row gap-6 mt-8">
            <input
              className="input"
              placeholder={`Add a note as ${activePerson(state).name}…`}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addComment()}
            />
            <button className="btn sm" onClick={addComment} disabled={!commentText.trim()}>
              Send
            </button>
          </div>
        </div>
      )}

      {makingRule && <RuleModal rule={makingRule} isNew onClose={() => setMakingRule(null)} />}
    </Modal>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Partial<ColumnMap>>({});
  const [hasHeader, setHasHeader] = useState(true);
  const [accountId, setAccountId] = useState(state.accounts[0]?.id ?? '');
  const [paidBy, setPaidBy] = useState<ID | 'joint'>('joint');
  // OFX/QFX/QIF need no column mapping — the format already says what is what.
  const [statement, setStatement] = useState<{
    name: string;
    rows: import('../lib/sources').SourceTransaction[];
    warnings: string[];
    balance?: number;
  } | null>(null);

  const header = rows[0] ?? [];
  const defaultCategoryId =
    state.categories.find((c) => c.name === 'Miscellaneous')?.id ?? state.categories[0].id;

  const preview = useMemo(() => {
    const account = state.accounts.find((a) => a.id === accountId);
    if (!account) return null;
    if (statement) {
      const result = ingest(state, statement.rows, { account, paidBy, defaultCategoryId });
      return {
        transactions: result.transactions,
        duplicates: result.duplicates,
        skipped: result.skipped,
        matchedByExternalId: result.matchedByExternalId,
      };
    }
    if (!rows.length) return null;
    return {
      ...rowsToTransactions(rows, map, {
        state,
        account,
        categories: state.categories,
        existing: state.transactions,
        defaultCategoryId,
        paidBy,
        hasHeader,
      }),
      matchedByExternalId: 0,
    };
  }, [rows, map, accountId, paidBy, hasHeader, state, statement, defaultCategoryId]);

  const onFile = async (file: File) => {
    const text = await file.text();
    const looksStructured =
      /\.(ofx|qfx|qif)$/i.test(file.name) ||
      text.slice(0, 2000).toUpperCase().includes('<OFX>') ||
      /^!Type:/im.test(text.slice(0, 200));

    if (looksStructured) {
      const result = await ofxSource.fetch({ file: { name: file.name, text } });
      setStatement({
        name: file.name,
        rows: result.transactions,
        warnings: result.warnings,
        balance: result.accounts[0]?.balance,
      });
      setRows([]);
      return;
    }
    const parsed = parseCSV(text);
    setStatement(null);
    setRows(parsed);
    setMap(guessColumns(parsed[0] ?? []));
  };

  return (
    <Modal
      title="Import transactions"
      wide
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!preview || !preview.transactions.length}
            onClick={() => {
              if (!preview) return;
              const filed = categorizeIncoming(state, preview.transactions);
              dispatch({ type: 'tx/addMany', txs: filed });
              toast(
                `Imported ${filed.length} transactions${
                  state.rules.length ? ` through ${state.rules.length} rules` : ''
                }`,
              );
              onClose();
            }}
          >
            Import {preview?.transactions.length ?? 0}
          </button>
        </>
      }
    >
      <p className="small muted">
        Drop in a CSV, or better, an OFX/QFX/QIF export. Quicken formats carry the bank's own transaction
        id, so re-importing a statement that overlaps one you already loaded is exact rather than guessed.
        Columns are detected automatically, payees you have categorized before are matched again, and your
        rules run over everything on the way in.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.ofx,.qfx,.qif,text/csv"
        className="input"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />

      {statement && (
        <>
          <div className="callout small">
            Read <span className="bold">{statement.name}</span> — {statement.rows.length} transactions
            {statement.balance !== undefined && `, bank balance ${(statement.balance / 100).toFixed(2)}`}.
            No column mapping needed.
          </div>
          {statement.warnings.map((w) => (
            <div className="callout warn small" key={w}>
              {w}
            </div>
          ))}
          <div className="field-row">
            <Field label="Into account">
              <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {state.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Paid by">
              <select className="select" value={paidBy} onChange={(e) => setPaidBy(e.target.value as ID | 'joint')}>
                <option value="joint">Joint</option>
                {state.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </>
      )}

      {rows.length > 0 && (
        <>
          <div className="field-row three">
            <Field label="Into account">
              <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {state.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Paid by">
              <select className="select" value={paidBy} onChange={(e) => setPaidBy(e.target.value as ID | 'joint')}>
                <option value="joint">Joint</option>
                {state.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="First row">
              <select
                className="select"
                value={hasHeader ? 'header' : 'data'}
                onChange={(e) => setHasHeader(e.target.value === 'header')}
              >
                <option value="header">Is a header row</option>
                <option value="data">Is already data</option>
              </select>
            </Field>
          </div>

          <div className="field-row three">
            {(['date', 'payee', 'amount', 'debit', 'credit', 'note'] as (keyof ColumnMap)[]).map((key) => (
              <Field key={key} label={key}>
                <select
                  className="select"
                  value={map[key] ?? ''}
                  onChange={(e) =>
                    setMap((m) => ({
                      ...m,
                      [key]: e.target.value === '' ? undefined : Number(e.target.value),
                    }))
                  }
                >
                  <option value="">— none —</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
        </>
      )}

      {preview && (
        <div className="callout small">
          <span className="bold">{preview.transactions.length}</span> ready to import ·{' '}
          {preview.duplicates} duplicates skipped
          {preview.matchedByExternalId > 0 &&
            ` (${preview.matchedByExternalId} matched exactly on the bank's own id)`}{' '}
          · {preview.skipped} rows unreadable
        </div>
      )}

      {preview && preview.transactions.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Payee</th>
                <th>Category</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {preview.transactions.slice(0, 30).map((t) => (
                <tr key={t.id}>
                  <td className="small faint">{t.date}</td>
                  <td className="small">{t.payee}</td>
                  <td className="tiny faint">
                    {state.categories.find((c) => c.id === t.categoryId)?.name}
                  </td>
                  <td className={`right num small ${t.amount > 0 ? 'pos' : ''}`}>
                    {(t.amount / 100).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
