import { useState } from 'react';
import { useApp } from '../store/store';
import type { Account, AccountType } from '../store/types';
import { LIABILITY_TYPES, netWorth } from '../store/selectors';
import { monthLabel } from '../lib/date';
import { uid } from '../lib/id';
import { sum } from '../lib/money';
import { Card, ConfirmButton, Empty, Field, MoneyInput, PercentInput, Stat, useToast } from '../components/ui';
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
  const { state, dispatch, money } = useApp();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const nw = netWorth(state);
  const accounts = state.accounts.filter((a) => showArchived || !a.archived);

  const assets = accounts.filter((a) => !LIABILITY_TYPES.has(a.type));
  const liabilities = accounts.filter((a) => LIABILITY_TYPES.has(a.type));
  const history = state.netWorth;

  const add = () =>
    dispatch({
      type: 'account/add',
      account: {
        id: uid('ac'),
        name: 'New account',
        institution: '',
        type: 'checking',
        owner: 'joint',
        balance: 0,
        apr: 0,
        archived: false,
      },
    });

  const patch = (id: string, p: Partial<Account>) => dispatch({ type: 'account/update', id, patch: p });

  return (
    <div className="col gap-16">
      <div className="grid cols-4">
        <Stat label="Net worth" value={money(nw.net, { compact: true })} tone={nw.net >= 0 ? 'pos' : 'neg'} icon="▲" />
        <Stat label="Assets" value={money(nw.assets, { compact: true })} sub={`${assets.length} accounts`} icon="🏦" />
        <Stat label="Liabilities" value={money(nw.liabilities, { compact: true })} sub="Cards, loans and tracked debts" icon="📉" />
        <Stat
          label="Invested"
          value={money(
            sum(accounts.filter((a) => a.type === 'investment' || a.type === 'retirement').map((a) => a.balance)),
            { compact: true },
          )}
          sub="Brokerage and retirement"
          icon="📈"
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
            <Empty icon="📊" title="Not enough snapshots yet" hint="Take one each month and this becomes the most motivating chart in the app." />
          )}
        </Card>

        <Card title="Composition" hint="Where the money actually is">
          <div className="row" style={{ justifyContent: 'center' }}>
            <Donut
              slices={assets.map((a, i) => ({
                label: a.name,
                value: Math.max(0, a.balance),
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
        hint="Balances feed net worth, the emergency runway and the rate-arbitrage findings"
        actions={
          <div className="row gap-6">
            <label className="tiny faint row gap-4">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              show archived
            </label>
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
                <th style={{ width: 130 }}>Institution</th>
                <th style={{ width: 130 }}>Type</th>
                <th style={{ width: 130 }}>Owner</th>
                <th style={{ width: 140 }}>Balance</th>
                <th style={{ width: 100 }}>Rate</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} style={a.archived ? { opacity: 0.55 } : undefined}>
                  <td>
                    <input className="input" value={a.name} onChange={(e) => patch(a.id, { name: e.target.value })} />
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
                    <select
                      className="select"
                      value={a.owner}
                      onChange={(e) => patch(a.id, { owner: e.target.value })}
                    >
                      <option value="joint">Joint</option>
                      {state.people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <MoneyInput value={a.balance} onChange={(c) => patch(a.id, { balance: c })} />
                  </td>
                  <td>
                    <PercentInput value={a.apr} onChange={(v) => patch(a.id, { apr: v })} />
                  </td>
                  <td className="right">
                    <div className="row gap-4" style={{ justifyContent: 'flex-end' }}>
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
              ))}
            </tbody>
          </table>
        </div>
        {liabilities.length > 0 && (
          <Field label="">
            <p className="tiny faint">
              Credit cards and loans count as liabilities — enter what you owe as a positive balance.
            </p>
          </Field>
        )}
      </Card>
    </div>
  );
}
