/**
 * Safe arithmetic expression evaluator for programmatic template fields.
 *
 * Supports:
 *  - Numeric literals (e.g. 1, 2.5, .5)
 *  - Field references via {{field_name}}
 *  - Operators: + - * / %
 *  - Parentheses
 *
 * No use of eval/Function. Implements a recursive-descent parser.
 */

export interface FormulaContext {
  /** Map of field name -> raw string value entered by user. */
  values: Record<string, string>;
}

export interface FormulaResult {
  ok: boolean;
  value: number | null;
  error?: string;
}

/** Extract referenced field names from a formula string. */
export function extractReferencedFields(formula: string): string[] {
  const out = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula))) out.add(m[1]);
  return [...out];
}

/** Replace {{name}} tokens with literal numeric values. Missing/non-numeric → 0. */
function substitute(formula: string, ctx: FormulaContext): string {
  return formula.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) => {
    const raw = ctx.values[name];
    if (raw === undefined || raw === null || String(raw).trim() === "") return "0";
    const n = Number(String(raw).replace(/,/g, ""));
    return Number.isFinite(n) ? String(n) : "0";
  });
}

interface Tokenizer {
  s: string;
  i: number;
}

function peek(t: Tokenizer): string {
  while (t.i < t.s.length && /\s/.test(t.s[t.i])) t.i++;
  return t.s[t.i] || "";
}

function consume(t: Tokenizer): string {
  peek(t);
  return t.s[t.i++] || "";
}

function parseExpression(t: Tokenizer): number {
  let left = parseTerm(t);
  while (true) {
    const c = peek(t);
    if (c === "+" || c === "-") {
      consume(t);
      const right = parseTerm(t);
      left = c === "+" ? left + right : left - right;
    } else break;
  }
  return left;
}

function parseTerm(t: Tokenizer): number {
  let left = parseFactor(t);
  while (true) {
    const c = peek(t);
    if (c === "*" || c === "/" || c === "%") {
      consume(t);
      const right = parseFactor(t);
      if (c === "*") left = left * right;
      else if (c === "/") left = right === 0 ? NaN : left / right;
      else left = right === 0 ? NaN : left % right;
    } else break;
  }
  return left;
}

function parseFactor(t: Tokenizer): number {
  const c = peek(t);
  if (c === "+") { consume(t); return parseFactor(t); }
  if (c === "-") { consume(t); return -parseFactor(t); }
  if (c === "(") {
    consume(t);
    const v = parseExpression(t);
    if (peek(t) !== ")") throw new Error("Expected )");
    consume(t);
    return v;
  }
  // number
  let num = "";
  while (t.i < t.s.length && /[0-9.]/.test(t.s[t.i])) {
    num += t.s[t.i++];
  }
  if (num === "") throw new Error(`Unexpected character: '${c}'`);
  const n = Number(num);
  if (!Number.isFinite(n)) throw new Error(`Invalid number: ${num}`);
  return n;
}

export function evaluateFormula(formula: string, ctx: FormulaContext): FormulaResult {
  if (!formula || !formula.trim()) return { ok: false, value: null, error: "Empty formula" };
  try {
    const substituted = substitute(formula, ctx);
    // Validate only allowed characters remain.
    if (!/^[\d+\-*/%().\s]*$/.test(substituted)) {
      return { ok: false, value: null, error: "Invalid characters in formula" };
    }
    const t: Tokenizer = { s: substituted, i: 0 };
    const v = parseExpression(t);
    if (peek(t) !== "") return { ok: false, value: null, error: "Unexpected trailing input" };
    if (!Number.isFinite(v)) return { ok: false, value: null, error: "Math error (e.g. divide by zero)" };
    return { ok: true, value: v };
  } catch (err) {
    return { ok: false, value: null, error: err instanceof Error ? err.message : "Parse error" };
  }
}

export function formatNumber(n: number, decimals: number, prefix?: string): string {
  const d = Number.isFinite(decimals) && decimals >= 0 && decimals <= 8 ? decimals : 2;
  const fixed = n.toFixed(d);
  return prefix ? `${prefix}${fixed}` : fixed;
}
