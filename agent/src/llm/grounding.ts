// Grounding check for LLM explanations (docs/05 §7.3, §12). Every number the LLM writes must already exist in
// DecisionFacts; numbers are compared as canonical decimal strings (no floating point).
import { bpsToPercent, type DecisionFacts } from '@runwaymind/shared';

export interface GroundingInput {
  headline: string;
  explanation: string;
  reasons: string[];
  riskNote: string | null;
}

export interface GroundingResult {
  ok: boolean;
  /** Numeric tokens not found in FACTS. */
  ungrounded: string[];
  /** 0x… addresses / hex not present in FACTS (prompt-injection guard, docs/05 §12). */
  unknownAddresses: string[];
}

/** Matches numbers incl. grouped thousands: "70,030.68", "70.030,68", "8.00", "14". */
const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
const HEX_RE = /0x[0-9a-fA-F]+/g;

/** "0070000.500" → "70000.5"; "8.00" → "8"; pure digits/one dot only. */
export function canonicalDecimal(s: string): string {
  const [intRaw = '', frac = ''] = s.split('.');
  const int = intRaw.replace(/^0+(?=\d)/, '') || '0';
  const f = frac.replace(/0+$/, '');
  return f ? `${int}.${f}` : int;
}

/**
 * All plausible canonical readings of a numeric token. "70,000" may be thousands (70000) or a vi decimal (70.000);
 * "1.000" may be 1 or 1000. Accepting the token if ANY reading is a fact keeps vi/en formatting working while an
 * invented value ("75,000") still fails.
 */
export function numericReadings(token: string): string[] {
  const out = new Set<string>();
  const hasDot = token.includes('.');
  const hasComma = token.includes(',');
  if (!hasDot && !hasComma) {
    out.add(canonicalDecimal(token));
  } else if (hasDot && hasComma) {
    // The last separator is the decimal mark.
    const decimalMark = token.lastIndexOf('.') > token.lastIndexOf(',') ? '.' : ',';
    const thousands = decimalMark === '.' ? ',' : '.';
    out.add(canonicalDecimal(token.split(thousands).join('').replace(decimalMark, '.')));
  } else {
    const sep = hasDot ? '.' : ',';
    const parts = token.split(sep);
    if (parts.length === 2) out.add(canonicalDecimal(`${parts[0]}.${parts[1]}`)); // decimal reading
    if (parts.slice(1).every((p) => p.length === 3)) out.add(canonicalDecimal(parts.join(''))); // thousands reading
  }
  return [...out];
}

export function extractNumbers(text: string): string[] {
  return text.match(NUMBER_RE) ?? [];
}

function collectStrings(v: unknown, acc: string[]): string[] {
  if (v === null || v === undefined) return acc;
  if (typeof v === 'string') acc.push(v);
  else if (typeof v === 'number' || typeof v === 'bigint') acc.push(String(v));
  else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, acc));
  else if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach((x) => collectStrings(x, acc));
  return acc;
}

/** Canonical numbers the explainer may use: every number in FACTS, 1–3 (reason counting), and minApy as percent. */
export function allowedNumbers(facts: DecisionFacts, minApyBps: number): Set<string> {
  const allowed = new Set<string>(['1', '2', '3']);
  for (const s of collectStrings(facts, [])) {
    for (const tok of extractNumbers(s)) for (const r of numericReadings(tok)) allowed.add(r);
  }
  allowed.add(canonicalDecimal(bpsToPercent(minApyBps)));
  return allowed;
}

export function checkGrounding(out: GroundingInput, facts: DecisionFacts, minApyBps: number): GroundingResult {
  const texts = [out.headline, out.explanation, ...out.reasons, out.riskNote ?? ''];
  const factStrings = collectStrings(facts, []).map((s) => s.toLowerCase());
  const unknownAddresses: string[] = [];
  const allowed = allowedNumbers(facts, minApyBps);
  const ungrounded: string[] = [];
  for (const t of texts) {
    for (const hex of t.match(HEX_RE) ?? []) {
      if (!factStrings.some((s) => s.includes(hex.toLowerCase()))) unknownAddresses.push(hex);
    }
    // Hex was judged above; strip it so its digits are not also read as numbers.
    for (const tok of extractNumbers(t.replace(HEX_RE, ' '))) {
      if (!numericReadings(tok).some((r) => allowed.has(r))) ungrounded.push(tok);
    }
  }
  return { ok: ungrounded.length === 0 && unknownAddresses.length === 0, ungrounded, unknownAddresses };
}
