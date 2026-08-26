# Connecting financial institutions

Two Ledgers is local-first: the ledger lives in your browser and nothing is
transmitted anywhere. Live bank connections break that property, so this
document is deliberately explicit about what they cost — in infrastructure,
in compliance, and in ongoing maintenance — before anyone starts building.

**The short version:** the aggregation is roughly 20% of the work. The backend,
the multi-user account model and the operational burden of keeping connections
alive are the other 80%. For two people using this privately, file import plus
SimpleFIN gets ~95% of the value for about $18/year and no server at all.

---

## 1. What already works without any of this

| Path | Effort | What it gets you |
|---|---|---|
| Manual entry | none | Full control, no dependencies |
| CSV import | none | Works with every bank; dedupes by date/amount/payee |
| **OFX / QFX / QIF import** | none | **Carries the bank's own transaction id (FITID), so re-importing an overlapping statement is exact rather than guessed** |

Most banks export OFX or QFX from the same screen as CSV. Prefer it. The parser
lives in `src/lib/ofx.ts` and the dedupe logic in `src/lib/sources.ts`.

---

## 2. Why a browser cannot do this alone

An aggregator gives you a long-lived access token that can read a bank account.
That token cannot live in a browser:

- Anything in `localStorage` is readable by any script on the page and by anyone
  with the device unlocked.
- Aggregator APIs do not send CORS headers for browser origins, deliberately.
- Token exchange requires a client secret, which by definition cannot ship to a
  client.
- Webhooks need a public HTTPS endpoint to be delivered to.

So connecting institutions means running a server. Once there is a server, two
partners on two devices need accounts, sync and conflict resolution — which is a
larger project than the aggregation itself and changes the app's privacy story
fundamentally.

---

## 3. Providers

| Provider | Coverage | Model | Notes |
|---|---|---|---|
| **SimpleFIN Bridge** | US | ~$1.50/mo, read-only | **The right answer for a private household.** No OAuth dance, tiny token model. Actual Budget uses it for this reason. |
| **Plaid** | US/CA/UK/EU | Per connected item, monthly | Best developer experience, widest US coverage, mature Link SDK. The default for a product. |
| **Teller** | US | Flat per connection | Bank-direct, developer-friendly, simpler pricing than Plaid. |
| **MX**, **Finicity** (Mastercard), **Yodlee** (Envestnet) | US | Enterprise contracts | Minimums and negotiation. Richer enrichment. Only worth it at scale. |
| **Akoya** | US | API-only network | Bank-permissioned, FDX-based, no screen scraping. |
| **GoCardless Bank Account Data** (was Nordigen) | UK/EU | Free tier available | Open banking under PSD2. |
| **TrueLayer**, **Tink** (Visa), **Salt Edge** | UK/EU | Per connection | Open banking. |
| **Basiq** (AU), **Flinks** (CA) | Regional | Per connection | |

Pricing changes and is often negotiable — confirm current rates directly rather
than trusting any figure written down here.

---

## 4. The flow, concretely

Using Plaid as the archetype; the others are structurally identical.

```
Browser                     Your server                    Provider        Bank
   │                             │                             │             │
   │  GET /link-token            │                             │             │
   │ ──────────────────────────► │  /link/token/create         │             │
   │                             │ ──────────────────────────► │             │
   │  ◄────────── link_token ─── │  ◄────────── link_token ─── │             │
   │                                                           │             │
   │  open Link widget ─────────────────────────────────────►  │             │
   │  user authenticates WITH THE BANK, never with you ──────────────────►   │
   │  ◄───────── public_token ─────────────────────────────────│             │
   │                             │                             │             │
   │  POST /exchange             │  /item/public_token/exchange│             │
   │ ──────────────────────────► │ ──────────────────────────► │             │
   │                             │  ◄───────── access_token ── │             │
   │                             │  encrypt + store            │             │
   │                             │                             │             │
   │                             │  ◄─── webhook: SYNC_UPDATES_AVAILABLE ─── │
   │                             │  /transactions/sync (cursor)│             │
   │  ◄── your own API ───────── │  ◄───── added/modified/removed ────────── │
```

**Never** let the access token reach the browser. The browser talks only to your
API, which returns your own normalized data.

### Non-negotiables on the server

1. **Encrypt tokens at rest** with envelope encryption (KMS/HSM-backed data key).
   Never log them, never include them in error reports.
2. **Cursor-based incremental sync** (`/transactions/sync`), driven by webhooks
   rather than polling.
3. **Handle pending → posted.** A pending transaction's amount *and its id* can
   both change when it settles. This app models `status: 'pending' | 'cleared'`
   and keys on `externalId` for exactly this reason.
4. **Handle re-auth.** Consent expires; banks break. Expect **5–15% of
   connections to need reconnecting in any given month**. "Reconnect your bank"
   is a permanent UX surface, not an edge case.
5. **Deduplicate against manual entries.** Someone will type in the coffee they
   bought before the feed catches up. Match on date ± 3 days and amount, and
   surface probable matches rather than silently merging.
6. **Rate limits and backoff** on every provider call.

---

## 5. Compliance

- **UK / EU:** reading someone's bank data makes you an **AISP under PSD2**. You
  either become regulated or operate as an agent of a provider that already is.
  This is the strongest single argument for using an aggregator rather than
  going direct.
- **US:** the CFPB's **Section 1033** open-banking rule was finalised in late
  2024 but has been in litigation and reconsideration since, so the regulatory
  floor is genuinely unsettled. Verify the current position before planning
  around it.
- **Whatever the jurisdiction:** encryption at rest and in transit, a written
  retention and deletion policy, breach response, and SOC 2 the moment anyone
  beyond you two uses it. If you store another household's financial data, you
  have taken on a duty you cannot hand back.

---

## 6. How this codebase is prepared for it

`src/lib/sources.ts` defines one interface that every ingestion path satisfies:

```ts
interface TransactionSource {
  id: string;
  label: string;
  requiresBackend: boolean;
  description: string;
  fetch(input: { file?: { name: string; text: string }; cursor?: string }): Promise<FetchResult>;
}
```

`ofxSource` is fully implemented and runs in the browser. `simplefinSource` and
`plaidSource` exist, declare `requiresBackend: true`, and throw with an
explanation rather than pretending a page can hold a token.

Adding a real connection therefore means:

1. Stand up the server and the account model (the large part).
2. Implement `fetch()` for the provider against your own API.
3. Feed the result to `ingest()` in `src/lib/sources.ts`, which already handles
   dedupe by `externalId`, payee-based categorization and the rules engine.

Nothing in the pages or the store needs to change.

---

## 7. Recommended order

1. **OFX/QFX/QIF import** — done. Stable ids, zero cost, works today.
2. **Rules, transfers, derived balances, reconciliation** — done. This is the
   data model an aggregator would need anyway.
3. **Cash-flow forecast** — done. Proves the data is worth having.
4. **Then** aggregation, if and only if the manual path has become the
   bottleneck.

Starting at step 4 means pointing a firehose at an app with nowhere to put it.
