// A small natural-language calculator, one line at a time (the syntax follows Numi's):
//   2 + 3 * 4 · (1 + 2)^2 · 15% of 200 · 200 + 10% · 20 inches in cm · $20 in eur - 5%
//   x = 5 · x * 2 · prev · sum · # a heading · Label: 3 * 4
// Pure: no I/O. Currency rates (units per US dollar) come from the caller.

export type Rates = Readonly<Record<string, number>>;

interface Unit {
  readonly dim: string;
  /** How many base units one of this unit is (temperatures use `toBase`/`fromBase`). */
  readonly factor: number;
  readonly symbol: string;
  readonly toBase?: (n: number) => number;
  readonly fromBase?: (n: number) => number;
}

export interface Value {
  readonly n: number;
  readonly unit?: Unit;
  readonly percent?: boolean;
}

const u = (dim: string, factor: number, symbol: string, names: string): Array<readonly [string, Unit]> =>
  names.split(' ').map((name) => [name, { dim, factor, symbol }] as const);

const temp = (
  symbol: string,
  toBase: (n: number) => number,
  fromBase: (n: number) => number,
  names: string,
) =>
  names
    .split(' ')
    .map((name) => [name, { dim: 'temperature', factor: 1, symbol, toBase, fromBase }] as const);

const UNITS = new Map<string, Unit>([
  ...u('length', 0.001, 'mm', 'mm millimeter millimeters'),
  ...u('length', 0.01, 'cm', 'cm centimeter centimeters'),
  ...u('length', 1, 'm', 'm meter meters metre metres'),
  ...u('length', 1000, 'km', 'km kilometer kilometers'),
  ...u('length', 0.0254, 'in', 'in inch inches'),
  ...u('length', 0.3048, 'ft', 'ft foot feet'),
  ...u('length', 0.9144, 'yd', 'yd yard yards'),
  ...u('length', 1609.344, 'mi', 'mi mile miles'),
  ...u('mass', 0.001, 'mg', 'mg milligram milligrams'),
  ...u('mass', 1, 'g', 'g gram grams'),
  ...u('mass', 1000, 'kg', 'kg kilogram kilograms kilo kilos'),
  ...u('mass', 28.349523125, 'oz', 'oz ounce ounces'),
  ...u('mass', 453.59237, 'lb', 'lb lbs pound pounds'),
  ...u('mass', 1_000_000, 't', 'ton tons tonne tonnes'),
  ...u('time', 0.001, 'ms', 'ms millisecond milliseconds'),
  ...u('time', 1, 's', 's sec secs second seconds'),
  ...u('time', 60, 'min', 'min mins minute minutes'),
  ...u('time', 3600, 'h', 'h hr hrs hour hours'),
  ...u('time', 86400, 'days', 'd day days'),
  ...u('time', 604800, 'weeks', 'week weeks'),
  ...u('time', 2629746, 'months', 'month months'),
  ...u('time', 31556952, 'years', 'year years'),
  ...u('data', 1, 'B', 'B byte bytes'),
  ...u('data', 1e3, 'KB', 'KB kb kilobyte kilobytes'),
  ...u('data', 1e6, 'MB', 'MB mb megabyte megabytes'),
  ...u('data', 1e9, 'GB', 'GB gb gigabyte gigabytes'),
  ...u('data', 1e12, 'TB', 'TB tb terabyte terabytes'),
  ...u('volume', 0.001, 'ml', 'ml milliliter milliliters'),
  ...u('volume', 1, 'l', 'l liter liters litre litres'),
  ...u('volume', 3.785411784, 'gal', 'gal gallon gallons'),
  ...temp(
    '°C',
    (n) => n + 273.15,
    (n) => n - 273.15,
    '°C c celsius',
  ),
  ...temp(
    '°F',
    (n) => ((n - 32) * 5) / 9 + 273.15,
    (n) => ((n - 273.15) * 9) / 5 + 32,
    '°F f fahrenheit',
  ),
  ...temp(
    'K',
    (n) => n,
    (n) => n,
    'K kelvin',
  ),
]);

const CURRENCY_WORDS: Readonly<Record<string, string>> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  dollar: 'USD',
  dollars: 'USD',
  usd: 'USD',
  euro: 'EUR',
  euros: 'EUR',
  peso: 'ARS',
  pesos: 'ARS',
  pound: 'GBP',
  yen: 'JPY',
};

const currency = (code: string, rates: Rates): Unit | undefined => {
  const rate = rates[code];
  return rate ? { dim: 'currency', factor: 1 / rate, symbol: code } : undefined;
};

/** A unit by name: a currency code or word (with known rates), else a measure. Case matters only for measures. */
const findUnit = (word: string, rates: Rates): Unit | undefined => {
  const lower = word.toLowerCase();
  const code = CURRENCY_WORDS[lower] ?? (word.length === 3 ? word.toUpperCase() : undefined);
  if (code !== undefined) {
    const c = currency(code, rates);
    if (c) return c;
  }
  if (lower === 'pound' || lower === 'pounds') return UNITS.get(lower);
  return UNITS.get(word) ?? UNITS.get(lower);
};

// MARK: Tokens

type Token =
  | { readonly t: 'num'; readonly v: number }
  | { readonly t: 'word'; readonly v: string }
  | { readonly t: 'op'; readonly v: string };

const tokenize = (line: string): Array<Token> | undefined => {
  const out: Array<Token> = [];
  const re =
    /\s*(?:(\d[\d,_]*(?:\.\d+)?(?:e[+-]?\d+)?|\.\d+)|(°[CF]|[A-Za-zÀ-ÿ_][\w]*)|(\*\*|[-+*/^%()=×÷$€£¥]))/y;
  let i = 0;
  while (i < line.length) {
    if (/^\s*$/.test(line.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(line);
    if (!m) return undefined;
    i = re.lastIndex;
    if (m[1] !== undefined) {
      // 1,000 and 1_000 are thousands; a lone comma group that isn't three digits is not a number we know.
      if (/,(?!\d{3}(?:\D|$))/.test(m[1])) return undefined;
      out.push({ t: 'num', v: Number(m[1].replace(/[,_]/g, '')) });
    } else if (m[2] !== undefined) out.push({ t: 'word', v: m[2] });
    else if (m[3] !== undefined) out.push({ t: 'op', v: m[3] === '**' ? '^' : m[3] });
  }
  return out;
};

// MARK: Parser

class Fail extends Error {}
const fail = (): never => {
  throw new Fail();
};

const WORD_OPS: Readonly<Record<string, string>> = {
  plus: '+',
  and: '+',
  with: '+',
  minus: '-',
  without: '-',
  times: '*',
  x: '*',
  mul: '*',
  divide: '/',
  mod: 'mod',
};

const CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI, e: Math.E };
const FUNCTIONS: Readonly<Record<string, (n: number) => number>> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  log: Math.log10,
  ln: Math.log,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
};

export interface Context {
  readonly rates: Rates;
  readonly vars: ReadonlyMap<string, Value>;
  readonly prev?: Value;
  /** Results of the lines above, back to the last blank line. */
  readonly above: ReadonlyArray<Value>;
}

const toBase = (v: Value) => (v.unit?.toBase ? v.unit.toBase(v.n) : v.n * (v.unit?.factor ?? 1));
const fromBase = (n: number, unit: Unit) => (unit.fromBase ? unit.fromBase(n) : n / unit.factor);

/** `v` in `unit`, or a failure when they measure different things. */
const convert = (v: Value, unit: Unit): Value => {
  if (!v.unit) return { n: v.n, unit };
  if (v.unit.dim !== unit.dim) return fail();
  return { n: fromBase(toBase(v), unit), unit };
};

const add = (a: Value, b: Value, sign: 1 | -1): Value => {
  if (b.percent && !a.percent)
    return { n: a.n * (1 + (sign * b.n) / 100), ...(a.unit ? { unit: a.unit } : {}) };
  const unit = a.unit ?? b.unit;
  const bn = a.unit && b.unit ? convert(b, a.unit).n : b.n;
  return {
    n: a.n + sign * bn,
    ...(unit ? { unit } : {}),
    ...(a.percent && b.percent ? { percent: true } : {}),
  };
};

const multiply = (a: Value, b: Value, op: string): Value => {
  const an = a.percent ? a.n / 100 : a.n;
  const bn = b.percent ? b.n / 100 : b.n;
  if (op === '*') {
    if (a.unit && b.unit) return fail();
    const unit = a.unit ?? b.unit;
    return { n: an * bn, ...(unit ? { unit } : {}) };
  }
  if (bn === 0 && op !== '*') return fail();
  if (op === 'mod') return { n: an % bn, ...(a.unit ? { unit: a.unit } : {}) };
  if (a.unit && b.unit) {
    if (a.unit.dim !== b.unit.dim) return fail();
    return { n: toBase(a) / toBase(b) };
  }
  if (b.unit) return fail();
  return { n: an / bn, ...(a.unit ? { unit: a.unit } : {}) };
};

const sumOf = (values: ReadonlyArray<Value>): Value =>
  values.reduce<Value>((acc, v) => (v.percent ? acc : add(acc, v, 1)), { n: 0 });

class Parser {
  private i = 0;
  constructor(
    private readonly tokens: ReadonlyArray<Token>,
    private readonly ctx: Context,
  ) {}

  private peek(offset = 0) {
    return this.tokens[this.i + offset];
  }
  private isOp(v: string) {
    const t = this.peek();
    return t !== undefined && t.t === 'op' && t.v === v;
  }
  private isWord(...vs: Array<string>) {
    const t = this.peek();
    return t !== undefined && t.t === 'word' && vs.includes(t.v.toLowerCase());
  }
  private unitAt(offset = 0): Unit | undefined {
    const t = this.peek(offset);
    if (!t) return undefined;
    if (t.t === 'op' && CURRENCY_WORDS[t.v]) return currency(CURRENCY_WORDS[t.v]!, this.ctx.rates);
    if (t.t === 'word' && !this.ctx.vars.has(t.v)) return findUnit(t.v, this.ctx.rates);
    return undefined;
  }

  /** A whole line; trailing plain words ("$20 in eur - 5% discount") are a note, not an error. */
  line(): Value {
    const v = this.expr();
    while (this.i < this.tokens.length) if ((this.tokens[this.i++] as Token).t !== 'word') return fail();
    return v;
  }

  private expr(): Value {
    let v = this.term();
    for (;;) {
      // "… in cm", "… to eur": converts what came before, and the line may go on ("- 5%").
      if (this.isWord('in', 'to', 'as', 'into') && this.unitAt(1)) {
        const unit = this.unitAt(1)!;
        this.i += 2;
        v = convert(v, unit);
        continue;
      }
      const t = this.peek();
      const op = t?.t === 'op' ? t.v : t?.t === 'word' ? WORD_OPS[t.v.toLowerCase()] : undefined;
      if (op !== '+' && op !== '-') return v;
      this.i++;
      v = add(v, this.term(), op === '+' ? 1 : -1);
    }
  }

  private term(): Value {
    let v = this.power();
    for (;;) {
      const t = this.peek();
      let op = t?.t === 'op' ? t.v : t?.t === 'word' ? WORD_OPS[t.v.toLowerCase()] : undefined;
      if (op === '×') op = '*';
      if (op === '÷') op = '/';
      if (op !== '*' && op !== '/' && op !== 'mod') return v;
      this.i++;
      if (this.isWord('by')) this.i++; // "divide by"
      v = multiply(v, this.power(), op);
    }
  }

  private power(): Value {
    const base = this.unary();
    if (!this.isOp('^')) return base;
    this.i++;
    const exp = this.power();
    if (exp.unit || base.unit) return fail();
    return { n: base.n ** exp.n };
  }

  private unary(): Value {
    if (this.isOp('-')) {
      this.i++;
      const v = this.unary();
      return { ...v, n: -v.n };
    }
    if (this.isOp('+')) {
      this.i++;
      return this.unary();
    }
    return this.postfix();
  }

  private postfix(): Value {
    let v = this.primary();
    if (this.isOp('%')) {
      this.i++;
      v = { n: v.n, percent: true };
      if (this.isWord('of', 'on', 'off')) {
        const word = (this.peek() as { v: string }).v.toLowerCase();
        this.i++;
        const of = this.unary();
        const part = (of.n * v.n) / 100;
        const n = word === 'of' ? part : word === 'on' ? of.n + part : of.n - part;
        return { n, ...(of.unit ? { unit: of.unit } : {}) };
      }
      return v;
    }
    // "20 inches", "5 usd"; not before "in"/"to" (a conversion) when the word is ambiguous.
    const unit = this.unitAt();
    if (unit && !v.unit && !(this.isWord('in') && this.peek(1) !== undefined)) {
      this.i++;
      return { n: v.n, unit };
    }
    return v;
  }

  private primary(): Value {
    const t = this.peek() ?? fail();
    if (t.t === 'num') {
      this.i++;
      return { n: t.v };
    }
    if (t.t === 'op' && t.v === '(') {
      this.i++;
      const v = this.expr();
      if (!this.isOp(')')) return fail();
      this.i++;
      return v;
    }
    // $20, €5
    if (t.t === 'op' && CURRENCY_WORDS[t.v]) {
      const unit = this.unitAt() ?? fail();
      this.i++;
      const v = this.postfix();
      if (v.unit || v.percent) return fail();
      return { n: v.n, unit };
    }
    if (t.t === 'word') {
      const w = t.v.toLowerCase();
      const variable = this.ctx.vars.get(t.v);
      if (variable) {
        this.i++;
        return variable;
      }
      if (w === 'prev') {
        this.i++;
        return this.ctx.prev ?? fail();
      }
      if (w === 'sum' || w === 'total') {
        this.i++;
        return sumOf(this.ctx.above);
      }
      if (w === 'avg' || w === 'average') {
        this.i++;
        const s = sumOf(this.ctx.above);
        return this.ctx.above.length ? { ...s, n: s.n / this.ctx.above.length } : fail();
      }
      if (CONSTANTS[w] !== undefined && !this.unitAt()) {
        this.i++;
        return { n: CONSTANTS[w] };
      }
      const f = FUNCTIONS[w];
      if (f) {
        this.i++;
        const arg = this.unary();
        return { ...arg, n: f(arg.n) };
      }
    }
    return fail();
  }
}

/** One line's value, or undefined when it isn't a calculation (text, a heading, a typo). */
export const evaluateLine = (line: string, ctx: Context): Value | undefined => {
  const tokens = tokenize(line);
  if (!tokens || tokens.length === 0) return undefined;
  try {
    const v = new Parser(tokens, ctx).line();
    return Number.isFinite(v.n) ? v : undefined;
  } catch (e) {
    if (e instanceof Fail) return undefined;
    throw e;
  }
};

export interface LineResult {
  /** What to show on the right, or '' for nothing. */
  readonly text: string;
  readonly value?: Value;
}

/** Every line of a sheet: headings (#), comments (//), labels ("Rent: 1200"), variables ("x = 5"). */
export const evaluateSheet = (sheet: string, rates: Rates): ReadonlyArray<LineResult> => {
  const vars = new Map<string, Value>();
  let prev: Value | undefined;
  let above: Array<Value> = [];
  return sheet.split('\n').map((raw) => {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (line === '') {
      above = [];
      return { text: '' };
    }
    if (line.startsWith('#')) return { text: '' };
    const ctx: Context = { rates, vars, above, ...(prev ? { prev } : {}) };
    const assign = /^([A-Za-z_][\w]*)\s*=\s*(.+)$/.exec(line);
    let value: Value | undefined;
    if (assign) {
      value = evaluateLine(assign[2]!, ctx);
      if (value) vars.set(assign[1]!, value);
    } else {
      value = evaluateLine(line, ctx);
      const label = value ? undefined : /^[^:]+:\s*(.+)$/.exec(line);
      if (label) value = evaluateLine(label[1]!, ctx);
    }
    if (!value) return { text: '' };
    prev = value;
    above.push(value);
    return { text: format(value), value };
  });
};

/** 1,234.5 · 12.5% · 20 cm · € 21.40 · ARS 150.00 (a symbol when the currency has its own) */
const SIGNS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' };

export const format = (v: Value): string => {
  const currencyUnit = v.unit?.dim === 'currency';
  const digits = currencyUnit ? 2 : Math.abs(v.n) >= 1000 ? 2 : Math.abs(v.n) >= 1 ? 4 : 8;
  const n = v.n.toLocaleString('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: currencyUnit ? 2 : 0,
  });
  if (v.percent) return `${n}%`;
  if (!v.unit) return n;
  if (currencyUnit) return `${SIGNS[v.unit.symbol] ?? v.unit.symbol} ${n}`;
  return `${n} ${v.unit.symbol}`;
};
