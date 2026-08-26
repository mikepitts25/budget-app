import { useState } from 'react';
import { useApp } from '../store/store';
import { CURRENCIES, currencyMeta, foreignCurrencies, formatIn, rateHealth } from '../lib/currency';
import { accountBalances, accountBalancesBase } from '../store/selectors';
import { todayISO } from '../lib/date';
import { Card, ConfirmButton, Empty, Field, Progress, useToast } from './ui';

/**
 * Rates are entered by hand on purpose: the app has no backend, and a rate
 * fetched from a random public endpoint would be neither auditable nor
 * available offline. What the app owes the couple instead is honesty about how
 * old each rate is.
 */
export default function CurrencyManager() {
  const { state, dispatch, money } = useApp();
  const toast = useToast();
  const [adding, setAdding] = useState('');

  const baseCode = state.settings.baseCurrency;
  const foreign = foreignCurrencies(state);
  const health = rateHealth(state, todayISO());
  const native = accountBalances(state);
  const inBase = accountBalancesBase(state);

  const exposure = foreign.map((code) => {
    const accounts = state.accounts.filter((a) => !a.archived && a.currency === code);
    return {
      code,
      accounts: accounts.length,
      native: accounts.reduce((total, a) => total + (native[a.id] ?? 0), 0),
      base: accounts.reduce((total, a) => total + (inBase[a.id] ?? 0), 0),
    };
  });

  return (
    <Card
      title="Currencies"
      hint="Every total, budget and chart is expressed in your base currency. Each transaction also keeps the amount your bank actually moved, and the rate it was converted at."
    >
      <div className="field-row">
        <Field
          label="Base currency"
          hint="Changing it re-expresses your whole history, so past months keep their meaning"
        >
          <select
            className="select"
            value={baseCode}
            onChange={(e) => {
              const code = e.target.value;
              if (code !== baseCode && !state.rates[code] && state.transactions.length) {
                toast(`Set a rate for ${code} first, so history can be converted`);
                return;
              }
              dispatch({ type: 'currency/setBase', code });
              toast(`Everything is now reported in ${code}`);
            }}
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Add a currency" hint="Then set an account or a transaction to use it">
          <div className="row gap-6">
            <select className="select" value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">Choose…</option>
              {CURRENCIES.filter((c) => c.code !== baseCode && !state.rates[c.code]).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={!adding}
              onClick={() => {
                dispatch({ type: 'rate/set', code: adding, rate: 1, updated: todayISO() });
                toast(`${adding} added — set its rate below`);
                setAdding('');
              }}
            >
              Add
            </button>
          </div>
        </Field>
      </div>

      {foreign.length === 0 ? (
        <Empty
          icon="💱"
          title="Everything is in one currency"
          hint="Add a currency above if you are paid in one and pay bills in another."
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Currency</th>
                  <th style={{ width: 200 }}>Rate</th>
                  <th>Meaning</th>
                  <th style={{ width: 130 }}>Updated</th>
                  <th style={{ width: 60 }} />
                </tr>
              </thead>
              <tbody>
                {health.map((h) => {
                  const meta = currencyMeta(h.code);
                  return (
                    <tr key={h.code}>
                      <td className="small bold">
                        {h.code} <span className="faint">{meta.symbol}</span>
                      </td>
                      <td>
                        <input
                          className="input num"
                          type="number"
                          step="0.0001"
                          min="0"
                          value={h.rate}
                          onChange={(e) =>
                            dispatch({
                              type: 'rate/set',
                              code: h.code,
                              rate: Number(e.target.value) || 0,
                              updated: todayISO(),
                            })
                          }
                        />
                      </td>
                      <td className="small faint">
                        {formatIn(100 * Math.pow(10, meta.digits - 2), h.code, {
                          locale: state.settings.locale,
                        })}{' '}
                        = {money(Math.round(h.rate * 100 * Math.pow(10, meta.digits - 2)))}
                      </td>
                      <td className="small">
                        {h.updated ? (
                          <>
                            {h.updated}
                            <div className={`tiny ${h.stale ? 'neg' : 'faint'}`}>
                              {h.ageDays === 0 ? 'today' : `${h.ageDays} days ago`}
                            </div>
                          </>
                        ) : (
                          <span className="chip warn">never set</span>
                        )}
                      </td>
                      <td className="right">
                        <ConfirmButton
                          onConfirm={() => {
                            dispatch({ type: 'rate/remove', code: h.code });
                            toast(`${h.code} removed`);
                          }}
                        >
                          ✕
                        </ConfirmButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {health.some((h) => h.stale) && (
            <div className="callout warn mt-16 small">
              Some rates are over a month old. That is usually fine for budgeting and badly wrong for
              deciding when to move money — update them before a transfer.
            </div>
          )}

          <div className="divider" />
          <div className="card-title mb-8">What you hold in each currency</div>
          {exposure.map((e) => {
            const share = Math.abs(e.base) / Math.max(1, Math.abs(state.accounts.reduce((t, a) => t + (inBase[a.id] ?? 0), 0)));
            return (
              <div key={e.code} className="col gap-4" style={{ padding: '6px 0' }}>
                <div className="row small">
                  <span className="bold">{e.code}</span>
                  <span className="faint">
                    {e.accounts} account{e.accounts === 1 ? '' : 's'}
                  </span>
                  <span className="spacer" />
                  <span className="num">
                    {formatIn(e.native, e.code, { locale: state.settings.locale })} ={' '}
                    {money(e.base)}
                  </span>
                </div>
                <Progress value={share} thin />
              </div>
            );
          })}
          <p className="tiny faint mt-8">
            A balance you still hold is converted at today's rate, because that is what it is worth now.
            A transaction that already happened keeps the rate it happened at, so last year's reports do
            not move when the rate does.
          </p>
        </>
      )}
    </Card>
  );
}
