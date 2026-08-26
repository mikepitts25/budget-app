import { useMemo, useRef, useState } from 'react';
import { useApp } from '../store/store';
import type { ID, SplitRule, Transaction } from '../store/types';
import { categoryMap, txInMonth } from '../store/selectors';
import { dateLabel, monthLabel, todayISO } from '../lib/date';
import { uid } from '../lib/id';
import { guessColumns, parseCSV, rowsToTransactions, transactionsToCSV, type ColumnMap } from '../lib/csv';
import { shareOf } from '../lib/split';
import { Card, ConfirmButton, Empty, Field, Modal, MoneyInput, Segmented, useToast } from '../components/ui';

type Filter = 'all' | 'in' | 'out';

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
      if (!q) return true;
      return (
        t.payee.toLowerCase().includes(q) ||
        t.note.toLowerCase().includes(q) ||
        (cats[t.categoryId]?.name ?? '').toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.includes(q))
      );
    });
  }, [base, query, filter, categoryFilter, personFilter, cats]);

  const inflow = rows.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0);
  const outflow = rows.filter((t) => t.amount < 0).reduce((a, t) => a + Math.abs(t.amount), 0);

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

  const blank = (): Transaction => ({
    id: uid('tx'),
    date: todayISO(),
    amount: 0,
    accountId: state.accounts[0]?.id ?? '',
    categoryId: state.categories.find((c) => c.kind === 'expense')?.id ?? '',
    payee: '',
    note: '',
    paidBy: 'joint',
    splitRule: state.settings.defaultSplit,
    splitShares: {},
    tags: [],
    cleared: true,
  });

  return (
    <div className="col gap-16">
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
                          {t.payee}
                        </button>
                        {t.note && <div className="tiny faint truncate">{t.note}</div>}
                      </td>
                      <td className="small">
                        {cats[t.categoryId]?.icon} {cats[t.categoryId]?.name ?? '—'}
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
                      <td className="tiny faint">{SPLIT_LABEL[t.splitRule]}</td>
                      <td className={`right num ${t.amount >= 0 ? 'pos' : ''}`}>
                        {money(t.amount, { sign: true })}
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
  const set = <K extends keyof Transaction>(key: K, value: Transaction[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const isIncome = draft.amount > 0;
  const shares = shareOf(draft, state.people);

  const save = () => {
    if (!draft.payee.trim()) {
      toast('Give the transaction a payee first');
      return;
    }
    if (isNew) dispatch({ type: 'tx/add', tx: draft });
    else dispatch({ type: 'tx/update', id: draft.id, patch: draft });
    toast(isNew ? 'Transaction added' : 'Transaction updated');
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
        <Field label="Amount" hint={isIncome ? 'Money coming in' : 'Money going out'}>
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
        <Field label="Category">
          <select
            className="select"
            value={draft.categoryId}
            onChange={(e) => set('categoryId', e.target.value)}
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

      <Field label="Note">
        <input className="input" value={draft.note} onChange={(e) => set('note', e.target.value)} />
      </Field>
      <Field label="Tags" hint="Space separated — handy for trips, projects or reimbursements">
        <input
          className="input"
          value={draft.tags.join(' ')}
          onChange={(e) => set('tags', e.target.value.split(/\s+/).filter(Boolean))}
        />
      </Field>
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

  const header = rows[0] ?? [];
  const preview = useMemo(() => {
    const account = state.accounts.find((a) => a.id === accountId);
    if (!account || !rows.length) return null;
    return rowsToTransactions(rows, map, {
      account,
      categories: state.categories,
      existing: state.transactions,
      defaultCategoryId:
        state.categories.find((c) => c.name === 'Miscellaneous')?.id ?? state.categories[0].id,
      paidBy,
      hasHeader,
    });
  }, [rows, map, accountId, paidBy, hasHeader, state]);

  const onFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseCSV(text);
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
              dispatch({ type: 'tx/addMany', txs: preview.transactions });
              toast(`Imported ${preview.transactions.length} transactions`);
              onClose();
            }}
          >
            Import {preview?.transactions.length ?? 0}
          </button>
        </>
      }
    >
      <p className="small muted">
        Export a CSV from your bank and drop it in. Columns are detected automatically, duplicates are
        skipped, and payees you have categorized before are matched to the same category again.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="input"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />

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

          {preview && (
            <div className="callout small">
              {preview.transactions.length} ready to import · {preview.duplicates} duplicates skipped ·{' '}
              {preview.skipped} rows unreadable
            </div>
          )}

          {preview && preview.transactions.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Payee</th>
                    <th className="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.transactions.slice(0, 30).map((t) => (
                    <tr key={t.id}>
                      <td className="small faint">{t.date}</td>
                      <td className="small">{t.payee}</td>
                      <td className={`right num small ${t.amount > 0 ? 'pos' : ''}`}>
                        {(t.amount / 100).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
