import { describe, expect, it } from 'vitest';
import { parseOFX, parseQIF, parseStatement } from './ofx';

const OFX = `OFXHEADER:100
DATA:OFXSGML

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>USD
<BANKACCTFROM><BANKID>021<ACCTID>000123456789<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260803120000<TRNAMT>-84.15<FITID>A1<NAME>GREEN GROCER<MEMO>PURCHASE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260805120000<TRNAMT>-16.99<FITID>A2<NAME>NETFLIX.COM</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260807120000<TRNAMT>3471.18<FITID>A3<NAME>PAYROLL</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>9420.55<DTASOF>20260826120000</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('parseOFX', () => {
  it('reads every transaction, not just the last', () => {
    const statement = parseOFX(OFX);
    expect(statement.transactions).toHaveLength(3);
  });

  it('reads dates, signed amounts and ids', () => {
    const [first, , third] = parseOFX(OFX).transactions;
    expect(first).toMatchObject({
      date: '2026-08-03',
      amount: -8415,
      payee: 'GREEN GROCER',
      memo: 'PURCHASE',
      externalId: 'A1',
    });
    expect(third.amount).toBe(347118);
  });

  it('reads the account and ledger balance', () => {
    const statement = parseOFX(OFX);
    expect(statement.accountId).toBe('000123456789');
    expect(statement.accountType).toBe('CHECKING');
    expect(statement.currency).toBe('USD');
    expect(statement.balance).toBe(942055);
    expect(statement.balanceDate).toBe('2026-08-26');
  });

  it('falls back to the memo when there is no payee', () => {
    const [t] = parseOFX(
      `<OFX><STMTTRN><DTPOSTED>20260101<TRNAMT>-5.00<FITID>Z<MEMO>ATM FEE</STMTTRN></OFX>`,
    ).transactions;
    expect(t.payee).toBe('ATM FEE');
  });

  it('survives a file with no transactions', () => {
    expect(parseOFX('<OFX></OFX>').transactions).toHaveLength(0);
  });
});

const QIF = `!Type:Bank
D8/03/2026
T-84.15
PGreen Grocer
MPurchase
^
D12/31/2025
T1,250.00
PRefund
^`;

describe('parseQIF', () => {
  it('reads records separated by carets', () => {
    const statement = parseQIF(QIF);
    expect(statement.transactions).toHaveLength(2);
    expect(statement.format).toBe('qif');
  });

  it('reads US-ordered dates and comma-separated amounts', () => {
    const [first, second] = parseQIF(QIF).transactions;
    expect(first.date).toBe('2026-08-03');
    expect(first.amount).toBe(-8415);
    expect(second.date).toBe('2025-12-31');
    expect(second.amount).toBe(125000);
  });

  it('has no external ids to dedupe on', () => {
    expect(parseQIF(QIF).transactions.every((t) => t.externalId === undefined)).toBe(true);
  });
});

describe('parseStatement', () => {
  it('picks the parser from the content, not the filename', () => {
    expect(parseStatement(OFX, 'export.qif').format).toBe('ofx');
    expect(parseStatement(QIF, 'export.ofx').format).toBe('qif');
  });
});
