/**
 * OFX / QFX / QIF parsing.
 *
 * These formats matter more than CSV for one reason: every transaction carries a
 * stable id from the bank (FITID), so re-importing an overlapping statement is
 * exactly reliable rather than heuristically deduped by date and amount.
 */

export interface ParsedTransaction {
  date: string;
  amount: number;
  payee: string;
  memo: string;
  /** FITID in OFX, absent in QIF. */
  externalId?: string;
  type?: string;
  checkNumber?: string;
}

export interface ParsedStatement {
  accountId?: string;
  accountType?: string;
  currency?: string;
  /** Ledger balance reported by the bank, if present. */
  balance?: number;
  balanceDate?: string;
  transactions: ParsedTransaction[];
  format: 'ofx' | 'qif';
}

/* --------------------------------------------------------------- OFX/QFX */

/** OFX dates look like YYYYMMDDHHMMSS[.XXX][TZ] — only the date part matters. */
function ofxDate(raw: string): string {
  const digits = raw.trim().replace(/[^0-9]/g, '');
  if (digits.length < 8) return '';
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

const ofxAmount = (raw: string): number => {
  const cleaned = raw.trim().replace(/,/g, '');
  const n = parseFloat(cleaned);
  return isFinite(n) ? Math.round(n * 100) : 0;
};

/**
 * SGML-style OFX omits closing tags, so a real XML parser is no use. This walks
 * the tag stream instead, which handles both the SGML and XML flavours.
 */
function ofxTags(body: string): { tag: string; value: string }[] {
  const out: { tag: string; value: string }[] = [];
  const re = /<([A-Za-z0-9._]+)>([^<]*)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    out.push({ tag: match[1].toUpperCase(), value: match[2].trim() });
  }
  return out;
}

export function parseOFX(text: string): ParsedStatement {
  // Strip the header block that precedes the SGML body.
  const bodyStart = text.indexOf('<OFX>');
  const body = bodyStart >= 0 ? text.slice(bodyStart) : text;
  const tags = ofxTags(body);

  const statement: ParsedStatement = { transactions: [], format: 'ofx' };
  let current: Partial<ParsedTransaction> | null = null;
  let inBalance = false;

  // A transaction ends when the next <STMTTRN> opens or the list closes; SGML
  // gives us no closing tag to rely on, so the pending one is flushed first.
  const flush = () => {
    if (current) pushTransaction(statement, current);
    current = null;
  };

  for (const { tag, value } of tags) {
    switch (tag) {
      case 'STMTTRN':
        flush();
        current = {};
        break;
      case 'LEDGERBAL':
        flush();
        inBalance = true;
        break;
      case 'AVAILBAL':
        inBalance = false;
        break;
      case 'DTPOSTED':
      case 'DTUSER':
        if (current && !current.date) current.date = ofxDate(value);
        break;
      case 'TRNAMT':
        if (current) current.amount = ofxAmount(value);
        break;
      case 'FITID':
        if (current) current.externalId = value;
        break;
      case 'NAME':
      case 'PAYEE':
        if (current && !current.payee) current.payee = value;
        break;
      case 'MEMO':
        if (current) current.memo = value;
        break;
      case 'TRNTYPE':
        if (current) current.type = value;
        break;
      case 'CHECKNUM':
        if (current) current.checkNumber = value;
        break;
      case 'ACCTID':
        statement.accountId = value;
        break;
      case 'ACCTTYPE':
        statement.accountType = value;
        break;
      case 'CURDEF':
        statement.currency = value;
        break;
      case 'BALAMT':
        if (inBalance && statement.balance === undefined) statement.balance = ofxAmount(value);
        break;
      case 'DTASOF':
        if (inBalance && !statement.balanceDate) statement.balanceDate = ofxDate(value);
        break;
      default:
        break;
    }
  }
  flush();

  return statement;
}

function pushTransaction(statement: ParsedStatement, t: Partial<ParsedTransaction>) {
  if (!t.date || t.amount === undefined) return;
  statement.transactions.push({
    date: t.date,
    amount: t.amount,
    payee: t.payee || t.memo || t.type || 'Unknown',
    memo: t.memo ?? '',
    externalId: t.externalId,
    type: t.type,
    checkNumber: t.checkNumber,
  });
}

/* -------------------------------------------------------------------- QIF */

const QIF_DATE = /^(\d{1,2})[/'-](\d{1,2})[/'-](\d{2,4})$/;

function qifDate(raw: string): string {
  const clean = raw.trim().replace(/\s/g, '');
  const m = clean.match(QIF_DATE);
  if (!m) {
    const parsed = Date.parse(clean);
    return isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10);
  }
  const [, a, b, c] = m;
  // QIF is US-ordered (M/D/Y); two-digit years before 70 are 2000s.
  const year = c.length === 4 ? c : Number(c) < 70 ? `20${c.padStart(2, '0')}` : `19${c}`;
  return `${year}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
}

export function parseQIF(text: string): ParsedStatement {
  const statement: ParsedStatement = { transactions: [], format: 'qif' };
  let current: Partial<ParsedTransaction> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('!')) {
      if (/!Type:/i.test(line)) statement.accountType = line.split(':')[1];
      continue;
    }
    const code = line[0];
    const value = line.slice(1).trim();

    switch (code) {
      case 'D':
        current.date = qifDate(value);
        break;
      case 'T':
      case 'U':
        current.amount = Math.round(parseFloat(value.replace(/,/g, '')) * 100) || 0;
        break;
      case 'P':
        current.payee = value;
        break;
      case 'M':
        current.memo = value;
        break;
      case 'N':
        current.checkNumber = value;
        break;
      case '^':
        if (current.date && current.amount !== undefined) pushTransaction(statement, current);
        current = {};
        break;
      default:
        break;
    }
  }
  if (current.date && current.amount !== undefined) pushTransaction(statement, current);
  return statement;
}

/** Picks the parser from the content rather than trusting the file extension. */
export function parseStatement(text: string, filename = ''): ParsedStatement {
  const head = text.slice(0, 2000).toUpperCase();
  if (head.includes('<OFX>') || head.includes('OFXHEADER')) return parseOFX(text);
  if (head.includes('!TYPE:') || /^[DTPM^]/m.test(text.slice(0, 200))) return parseQIF(text);
  if (/\.qif$/i.test(filename)) return parseQIF(text);
  return parseOFX(text);
}
