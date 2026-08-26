import { useMemo, useState } from 'react';
import { useApp } from '../store/store';
import type { Account, AccountType, Transaction } from '../store/types';
import {
  accountBalances,
  accountBalancesBase,
  clearedBalance,
  LIABILITY_TYPES,
  netWorth,
  txInMonth,
} from '../store/selectors';
import { CURRENCIES, isMultiCurrency } from '../lib/currency';
import { monthLabel, todayISO } from '../lib/date';
import { makeAccount, makeTransaction } from '../store/factory';
import { sum } from '../lib/money';
import {
  Card,
  ConfirmButton,
  Empty,
  Field,
  Modal,
  MoneyInput,
  PercentInput,
  Stat,
  useToast,
} from '../components/ui';
import { Donut, LineChart, SERIES_COLORS } from '../components/charts';

const TYPE_LABEL: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  cash: 'Cash',
  credit: 'Credit card',
  investment: 'Investment',
  retirement: 'Retirement',
  property: 'Property',
  loan: 'Loan',
};

export default function NetWorthPage() {
  const { state, dispatch, money, month } = useApp();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [reconciling, setReconciling] = useState<Account | null>(null);
  const [transferring, setTransferring] = useState(false);

  const nw = netWorth(state);
  const balances = useMemo(() => accountBalances(state), [state]);
  const balancesBase = useMemo(() => accountBalancesBase(state), [state]);
  const multi = isMultiCurrency(state);
  const accounts = state.accounts.filter((a) => showArchived || !a.archived);
  const assets = accounts.filter((a) => !LIABILITY_TYPES.has(a.type));
  const history = state.netWorth;

  const monthTx = txInMonth(state, month);
  const movedThisMonth = sum(monthTx.filter((t) => !t.transferId).map((t) => t.amount));

  const add = () =>
    dispatch({
      type: 'account/add',
      account: makeAccount(state),
    });

  const patch = (id: string, p: Partial<Account>) => dispatch({ type: 'account/update', id, patch: p });

  return (
    <div className="col gap-16">
      <div className="grid cols-4">
        <Stat label="Net worth" value={money(nw.net, { compact: true })} tone={nw.net >= 0 ? 'pos' : 'neg'} icon="▲" />
        <Stat label="Assets" value={money(nw.assets, { compact: true })} sub={`${assets.length} accounts`} icon="🏦" />
        <Stat label="Liabilities" value={money(nw.liabilities, { compact: true })} sub="Cards, loans and tracked debts" icon="📉" />
        <Stat
          label="Moved this month"
          value={money(movedThisMonth, { compact: true, sign: true })}
          tone={movedThisMonth >= 0 ? 'pos' : 'neg'}
          sub="Excluding transfers between your own accounts"
          icon="🔀"
        />
      </div>

      <div className="grid side">
        <Card
          title="Net worth over time"
          hint="Snapshots you take, one per month"
          actions={
            <button
              className="btn sm"
              onClick={() => {
                dispatch({ type: 'networth/snapshot' });
                toast('Snapshot taken for this month');
              }}
            >
              Take snapshot
            </button>
          }
        >
          {history.length > 1 ? (
            <>
              <LineChart
                labels={history.map((h) => monthLabel(h.month))}
                series={[
                  {
                    name: 'Net worth',
                    color: SERIES_COLORS[0],
                    values: history.map((h) => h.assets - h.liabilities),
                  },
                  { name: 'Assets', color: SERIES_COLORS[1], values: history.map((h) => h.assets) },
                  { name: 'Liabilities', color: SERIES_COLORS[3], values: history.map((h) => h.liabilities) },
                ]}
                format={(n) => money(n, { compact: true })}
                area
              />
              <div className="legend mt-8">
                {['Net worth', 'Assets', 'Liabilities'].map((n, i) => (
                  <span className="legend-item" key={n}>
                    <span className="dot" style={{ background: SERIES_COLORS[[0, 1, 3][i]] }} /> {n}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <Empty
              icon="📊"
              title="Not enough snapshots yet"
              hint="Take one each month and this becomes the most motivating chart in the app."
            />
          )}
        </Card>

        <Card title="Composition" hint="Where the money actually is">
          <div className="row" style={{ justifyContent: 'center' }}>
            <Donut
              slices={assets.map((a, i) => ({
                label: a.name,
                value: Math.max(0, balancesBase[a.id] ?? 0),
                color: SERIES_COLORS[i % SERIES_COLORS.length],
              }))}
              center={money(nw.assets, { compact: true })}
              centerSub="in assets"
              format={(n) => money(n)}
            />
          </div>
          <div className="legend mt-16">
            {assets.map((a, i) => (
              <span className="legend-item" key={a.id}>
                <span className="dot" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                {a.name}
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Card
        title="Accounts"
        hint={`Balances are derived: opening balance plus every transaction. Nothing writes a balance directly, so the ledger and the number can never disagree.${
          multi ? ` Foreign balances are shown in their own currency, with today's value in ${state.settings.baseCurrency} underneath.` : ''
        }`}
        actions={
          <div className="row gap-6">
            <label className="tiny faint row gap-4">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              show archived
            </label>
            <button className="btn sm" onClick={() => setTransferring(true)}>
              ⇄ Transfer
            </button>
            <button className="btn primary sm" onClick={add}>
              + Add account
            </button>
          </div>
        }
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: 120 }}>Institution</th>
                <th style={{ width: 110 }}>Type</th>
                <th style={{ width: 100 }}>Owner</th>
                <th style={{ width: 90 }}>Currency</th>
                <th style={{ width: 120 }}>Opening</th>
                <th className="right" style={{ width: 140 }}>Balance now</th>
                <th style={{ width: 90 }}>Rate</th>
                <th style={{ width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => {
                const live = balances[a.id] ?? 0;
                const drift = a.lastReconciled ? live - a.lastReconciled.balance : null;
                return (
                  <tr key={a.id} style={a.archived ? { opacity: 0.55 } : undefined}>
                    <td>
                      <input className="input" value={a.name} onChange={(e) => patch(a.id, { name: e.target.value })} />
                      {a.lastReconciled && (
                        <div className="tiny faint mt-8">
                          Reconciled {a.lastReconciled.date}
                          {drift !== null && drift !== 0 && ` · ${money(drift, { sign: true })} since`}
                        </div>
                      )}
                    </td>
                    <td>
                      <input
                        className="input"
                        value={a.institution}
                        onChange={(e) => patch(a.id, { institution: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="select"
                        value={a.type}
                        onChange={(e) => patch(a.id, { type: e.target.value as AccountType })}
                      >
                        {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => (
                          <option key={t} value={t}>
                            {TYPE_LABEL[t]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select className="select" value={a.owner} onChange={(e) => patch(a.id, { owner: e.target.value })}>
                        <option value="joint">Joint</option>
                        {state.people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="select"
                        value={a.currency}
                        onChange={(e) => patch(a.id, { currency: e.target.value })}
                      >
                        {CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <MoneyInput value={a.openingBalance} onChange={(c) => patch(a.id, { openingBalance: c })} />
                    </td>
                    <td className="right num bold">
                      {money(live, { currency: a.currency })}
                      {a.currency !== state.settings.baseCurrency && (
                        <div className="tiny faint">= {money(balancesBase[a.id] ?? 0)}</div>
                      )}
                    </td>
                    <td>
                      <PercentInput value={a.apr} onChange={(v) => patch(a.id, { apr: v })} />
                    </td>
                    <td className="right">
                      <div className="row gap-4" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn ghost sm" title="Reconcile" onClick={() => setReconciling(a)}>
                          ⚖
                        </button>
                        <button
                          className="btn ghost sm"
                          title={a.archived ? 'Restore' : 'Archive'}
                          onClick={() => patch(a.id, { archived: !a.archived })}
                        >
                          {a.archived ? '↺' : '📦'}
                        </button>
                        <ConfirmButton
                          onConfirm={() => {
                            dispatch({ type: 'account/remove', id: a.id });
                            toast('Account and its transactions removed');
                          }}
                        >
                          ✕
                        </ConfirmButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {reconciling && <ReconcileModal account={reconciling} onClose={() => setReconciling(null)} />}
      {transferring && <TransferModal onClose={() => setTransferring(false)} />}
    </div>
  );
}

/** Compare the ledger against a real statement and settle the difference. */
function ReconcileModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const { state, dispatch, money } = useApp();
  const toast = useToast();
  const [statement, setStatement] = useState(clearedBalance(state, account.id));
  const [date, setDate] = useState(todayISO());

  const settled = clearedBalance(state, account.id);
  const live = accountBalances(state)[account.id] ?? 0;
  const pending = live - settled;
  const difference = statement - settled;

  const pendingTx = state.transactions.filter(
    (t) => t.accountId === account.id && t.status === 'pending',
  );

  return (
    <Modal
      title={`Reconcile ${account.name}`}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              // A leftover difference becomes one honest adjusting entry rather
              // than a silently edited balance.
              const adjustment: Transaction | undefined =
                difference !== 0
                  ? makeTransaction(state, {
                      date,
                      amount: difference,
                      accountId: account.id,
                      categoryId:
                        state.categories.find((c) => c.name === 'Miscellaneous')?.id ??
                        state.categories[0].id,
                      payee: 'Reconciliation adjustment',
                      note: `Statement ${money(statement)} vs ledger ${money(settled)}`,
                      splitRule: 'income',
                      tags: ['reconciliation'],
                      status: 'reconciled',
                    })
                  : undefined;
              dispatch({ type: 'account/reconcile', id: account.id, date, balance: statement, adjustment });
              dispatch({
                type: 'tx/status',
                ids: state.transactions
                  .filter((t) => t.accountId === account.id && t.status === 'cleared' && t.date <= date)
                  .map((t) => t.id),
                status: 'reconciled',
              });
              toast(
                difference === 0
                  ? 'Reconciled — the ledger matches the statement exactly'
                  : `Reconciled with a ${money(difference, { sign: true })} adjustment`,
              );
              onClose();
            }}
          >
            {difference === 0 ? 'Mark reconciled' : `Adjust by ${money(difference, { sign: true })}`}
          </button>
        </>
      }
    >
      <div className="field-row">
        <Field label="Statement date">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Statement balance" hint="What the bank says today">
          <MoneyInput value={statement} onChange={setStatement} />
        </Field>
      </div>

      <div className="col gap-6">
        <div className="row small">
          <span>Cleared in your ledger</span>
          <span className="spacer" />
          <span className="num">{money(settled)}</span>
        </div>
        <div className="row small">
          <span>Pending, not yet settled</span>
          <span className="spacer" />
          <span className="num faint">{money(pending)}</span>
        </div>
        <div className="divider" />
        <div className="row">
          <span className="bold">Difference</span>
          <span className="spacer" />
          <span className={`num bold ${difference === 0 ? 'pos' : 'neg'}`}>{money(difference, { sign: true })}</span>
        </div>
      </div>

      {difference !== 0 && (
        <div className="callout warn">
          A difference usually means a missing transaction, a duplicate, or a wrong amount. Fix it in the
          ledger if you can find it — posting an adjustment is the last resort, and it will show up in your
          spending as Miscellaneous.
        </div>
      )}

      {pendingTx.length > 0 && (
        <div>
          <div className="card-title mb-8">Still pending</div>
          {pendingTx.slice(0, 8).map((t) => (
            <div key={t.id} className="list-row">
              <span className="small truncate">{t.payee}</span>
              <span className="spacer" />
              <span className="small num">{money(t.amount, { sign: true })}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Move money between your own accounts as one two-legged entry. */
function TransferModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch, money } = useApp();
  const toast = useToast();
  const live = accountBalances(state);
  const [amount, setAmount] = useState(0);
  const [fromAccountId, setFrom] = useState(state.accounts[0]?.id ?? '');
  const [toAccountId, setTo] = useState(state.accounts[1]?.id ?? '');
  const [date, setDate] = useState(todayISO());
  const [categoryId, setCategory] = useState(
    state.categories.find((c) => c.name === 'Savings transfer')?.id ?? state.categories[0]?.id ?? '',
  );

  const valid = amount > 0 && fromAccountId && toAccountId && fromAccountId !== toAccountId;

  return (
    <Modal
      title="Transfer between accounts"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => {
              dispatch({
                type: 'tx/transfer',
                transfer: {
                  date,
                  amount,
                  fromAccountId,
                  toAccountId,
                  categoryId,
                  payee: `Transfer to ${state.accounts.find((a) => a.id === toAccountId)?.name ?? 'account'}`,
                },
              });
              toast(`Transferred ${money(amount)}`);
              onClose();
            }}
          >
            Transfer
          </button>
        </>
      }
    >
      <p className="small muted">
        A transfer is not income and not spending — it is the same money in a different place. Both sides
        are recorded, so your reports stay honest and both balances move.
      </p>
      <div className="field-row">
        <Field label="From">
          <select className="select" value={fromAccountId} onChange={(e) => setFrom(e.target.value)}>
            {state.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {money(live[a.id] ?? 0)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="To">
          <select className="select" value={toAccountId} onChange={(e) => setTo(e.target.value)}>
            {state.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {money(live[a.id] ?? 0)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="field-row three">
        <Field label="Amount">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Category" hint="For reporting only">
          <select className="select" value={categoryId} onChange={(e) => setCategory(e.target.value)}>
            {state.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {fromAccountId === toAccountId && <div className="callout bad">Pick two different accounts.</div>}
    </Modal>
  );
}
