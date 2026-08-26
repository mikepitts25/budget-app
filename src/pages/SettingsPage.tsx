import { useRef, useState } from 'react';
import { useApp } from '../store/store';
import type { AppState, Category, CategoryGroup } from '../store/types';
import { uid } from '../lib/id';
import { Card, ConfirmButton, Field, MoneyInput, PercentInput, useToast } from '../components/ui';

const GROUPS: CategoryGroup[] = [
  'Income', 'Housing', 'Transport', 'Food', 'Health', 'Kids',
  'Lifestyle', 'Subscriptions', 'Debt', 'Savings', 'Other',
];

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CHF', 'SEK', 'INR', 'SGD', 'ZAR'];

export default function SettingsPage() {
  const { state, dispatch, money } = useApp();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showArchivedCats, setShowArchivedCats] = useState(false);

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `two-ledgers-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded');
  };

  const importJSON = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as AppState;
      if (!parsed.people || !parsed.categories) throw new Error('not a Two Ledgers backup');
      dispatch({ type: 'load', state: parsed });
      toast('Backup restored');
    } catch (err) {
      toast(`Could not read that file: ${(err as Error).message}`);
    }
  };

  const addCategory = () => {
    const category: Category = {
      id: uid('cat'),
      name: 'New category',
      group: 'Other',
      kind: 'expense',
      essential: false,
      icon: '•',
      archived: false,
    };
    dispatch({ type: 'category/add', category });
  };

  const categories = state.categories.filter((c) => showArchivedCats || !c.archived);

  return (
    <div className="col gap-16">
      <div className="grid cols-2">
        <Card title="Household" hint="Names, incomes and how you think about money together">
          <Field label="Household name">
            <input
              className="input"
              value={state.settings.householdName}
              onChange={(e) => dispatch({ type: 'settings/update', patch: { householdName: e.target.value } })}
            />
          </Field>

          <div className="divider" />

          {state.people.map((p) => (
            <div key={p.id} className="col gap-6" style={{ paddingBottom: 14 }}>
              <div className="field-row">
                <Field label="Name">
                  <input
                    className="input"
                    value={p.name}
                    onChange={(e) => dispatch({ type: 'person/update', id: p.id, patch: { name: e.target.value } })}
                  />
                </Field>
                <Field label="Gross annual income" hint="Drives income-proportional splitting">
                  <MoneyInput
                    value={p.annualIncome}
                    onChange={(c) => dispatch({ type: 'person/update', id: p.id, patch: { annualIncome: c } })}
                  />
                </Field>
              </div>
              <div className="row gap-6">
                <span className="tiny faint">Colour</span>
                <input
                  type="color"
                  value={p.color}
                  onChange={(e) => dispatch({ type: 'person/update', id: p.id, patch: { color: e.target.value } })}
                  style={{ width: 40, height: 26, background: 'none', border: 'none' }}
                />
                <span className="dot" style={{ background: p.color, width: 12, height: 12 }} />
                <span className="tiny faint">{money(p.annualIncome, { compact: true })} per year</span>
              </div>
            </div>
          ))}
        </Card>

        <Card title="Preferences">
          <div className="field-row">
            <Field label="Currency">
              <select
                className="select"
                value={state.settings.currency}
                onChange={(e) => dispatch({ type: 'settings/update', patch: { currency: e.target.value } })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Number format">
              <select
                className="select"
                value={state.settings.locale}
                onChange={(e) => dispatch({ type: 'settings/update', patch: { locale: e.target.value } })}
              >
                {['en-US', 'en-GB', 'en-CA', 'en-AU', 'de-DE', 'fr-FR', 'es-ES', 'ja-JP'].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Savings rate target" hint="What share of income you want to keep each month">
            <PercentInput
              value={state.settings.savingsRateTarget}
              onChange={(v) => dispatch({ type: 'settings/update', patch: { savingsRateTarget: v } })}
              step={1}
            />
          </Field>

          <Field label="Theme">
            <select
              className="select"
              value={state.settings.theme}
              onChange={(e) =>
                dispatch({ type: 'settings/update', patch: { theme: e.target.value as 'dark' | 'light' } })
              }
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </Field>

          <div className="divider" />
          <div className="card-title mb-8">Your data</div>
          <p className="small muted">
            Everything lives in this browser. Nothing is uploaded, and there is no account. That also means
            a cleared browser clears your budget — take a backup now and then.
          </p>
          <div className="row wrap gap-6">
            <button className="btn" onClick={exportJSON}>
              ⭳ Download backup
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              ⭱ Restore backup
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && importJSON(e.target.files[0])}
            />
          </div>
          <div className="row wrap gap-6 mt-16">
            <ConfirmButton
              className="btn sm"
              onConfirm={() => {
                dispatch({ type: 'reset', demo: true });
                toast('Demo household loaded');
              }}
              confirmLabel="Replace everything?"
            >
              Load demo household
            </ConfirmButton>
            <ConfirmButton
              className="btn danger sm"
              onConfirm={() => {
                dispatch({ type: 'reset', demo: false });
                toast('Started fresh');
              }}
              confirmLabel="Erase everything?"
            >
              Start from scratch
            </ConfirmButton>
          </div>
        </Card>
      </div>

      <Card
        title="Categories"
        hint="Essential categories count as needs in the 50/30/20 check and in your emergency runway"
        actions={
          <div className="row gap-6">
            <label className="tiny faint row gap-4">
              <input
                type="checkbox"
                checked={showArchivedCats}
                onChange={(e) => setShowArchivedCats(e.target.checked)}
              />
              show archived
            </label>
            <button className="btn primary sm" onClick={addCategory}>
              + Add category
            </button>
          </div>
        }
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Icon</th>
                <th>Name</th>
                <th style={{ width: 150 }}>Group</th>
                <th style={{ width: 120 }}>Kind</th>
                <th style={{ width: 110 }}>Essential</th>
                <th style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} style={c.archived ? { opacity: 0.55 } : undefined}>
                  <td>
                    <input
                      className="input center"
                      value={c.icon}
                      maxLength={2}
                      onChange={(e) => dispatch({ type: 'category/update', id: c.id, patch: { icon: e.target.value } })}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      value={c.name}
                      onChange={(e) => dispatch({ type: 'category/update', id: c.id, patch: { name: e.target.value } })}
                    />
                  </td>
                  <td>
                    <select
                      className="select"
                      value={c.group}
                      onChange={(e) =>
                        dispatch({ type: 'category/update', id: c.id, patch: { group: e.target.value as CategoryGroup } })
                      }
                    >
                      {GROUPS.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="select"
                      value={c.kind}
                      onChange={(e) =>
                        dispatch({
                          type: 'category/update',
                          id: c.id,
                          patch: { kind: e.target.value as 'income' | 'expense' },
                        })
                      }
                    >
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                    </select>
                  </td>
                  <td className="center">
                    <input
                      type="checkbox"
                      checked={c.essential}
                      onChange={(e) =>
                        dispatch({ type: 'category/update', id: c.id, patch: { essential: e.target.checked } })
                      }
                    />
                  </td>
                  <td className="right">
                    <div className="row gap-4" style={{ justifyContent: 'flex-end' }}>
                      <button
                        className="btn ghost sm"
                        onClick={() => dispatch({ type: 'category/update', id: c.id, patch: { archived: !c.archived } })}
                      >
                        {c.archived ? '↺' : '📦'}
                      </button>
                      <ConfirmButton
                        onConfirm={() => {
                          dispatch({ type: 'category/remove', id: c.id });
                          toast('Category removed; its transactions moved to Miscellaneous');
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
      </Card>

      <Card title="How the numbers are worked out" hint="No black boxes">
        <ul className="small muted" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
          <li>
            <span className="bold">Splitting.</span> Even splits halve every shared cost; income splits divide
            them in proportion to each partner’s gross income. Joint-account spending is treated as funded by
            both of you in the same income proportion.
          </li>
          <li>
            <span className="bold">Settling up.</span> Balances are paid-minus-owed, and transfers are matched
            largest debtor to largest creditor, so you never need more than one payment each.
          </li>
          <li>
            <span className="bold">Subscriptions.</span> A payee counts as recurring when it charges at least
            three times, at a steady cadence, at a steady price. Cadence and price both have to hold.
          </li>
          <li>
            <span className="bold">Goals.</span> Projections compound monthly at the return you set. “Needs”
            is the contribution that lands exactly on the target amount on the target date.
          </li>
          <li>
            <span className="bold">Debt.</span> Interest accrues monthly before payments. Avalanche pays the
            highest rate first; snowball pays the smallest balance first; freed-up minimums roll into the next
            debt in both.
          </li>
          <li>
            <span className="bold">Retirement.</span> The target is your desired annual spending divided by the
            withdrawal rate, inflated to your retirement year, then compared against a compounded projection.
          </li>
        </ul>
      </Card>
    </div>
  );
}
