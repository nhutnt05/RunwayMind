// Deterministic explanation templates (docs/05 §7.3 step 4): `templates[reasonCode](facts, language)`, one per
// ReasonCode in en and vi. Used when the LLM is disabled, fails, times out or fails grounding. Only numbers already
// present in DecisionFacts (plus minApy as percent) are printed, so templates always pass grounding.
import { bpsToPercent, type AgentActionType, type DecisionFacts, type Explanation, type ReasonCode } from '@runwaymind/shared';

export type ExplanationLanguage = 'en' | 'vi';

export interface TemplateInput {
  action: AgentActionType;
  reasonCode: ReasonCode;
  facts: DecisionFacts;
  minApyBps: number;
  /** Default 'en'. */
  language?: ExplanationLanguage;
}

interface TemplateCtx {
  action: AgentActionType;
  f: DecisionFacts;
  minApy: string;
  usd: (v: string | null) => string;
  pool: string;
  next: string | null;
}

type Parts = Omit<Explanation, 'source'>;
type Template = (c: TemplateCtx) => Parts;

const reasons = (xs: (string | null)[]) => xs.filter((x): x is string => !!x).slice(0, 3);
const usd = (v: string | null) => `${v ?? '0.00'} USDC`;

const EN: Record<ReasonCode, Template> = {
  IDLE_SURPLUS: ({ f, usd, pool }) => ({
    headline: `Invest ${usd(f.amount)} into ${pool}`,
    explanation:
      `Idle balance is ${usd(f.idle)} and the required reserve is ${usd(f.requiredReserve)}, ` +
      `so ${usd(f.amount)} can earn ${f.apyPercent ?? '0.00'}% APY in ${pool} while every obligation ` +
      `in the next ${f.safetyHorizonDays} days stays covered.`,
    reasons: reasons([
      `Idle ${usd(f.idle)} above reserve ${usd(f.requiredReserve)}`,
      `APY ${f.apyPercent ?? '0.00'}%`,
      f.riskScore === null ? null : `Pool risk score ${f.riskScore}`,
    ]),
    riskNote: null,
  }),
  DEADLINE_REACHED: ({ f, usd, pool, next }) => ({
    headline: `Withdraw ${usd(f.amount)} from ${pool}`,
    explanation:
      `Idle balance ${usd(f.idle)} is ${usd(f.shortfall)} below the required reserve of ` +
      `${usd(f.requiredReserve)}. Withdraw ${usd(f.amount)} back to the Treasury now so payments are covered.`,
    reasons: reasons([`Shortfall ${usd(f.shortfall)}`, `Required reserve ${usd(f.requiredReserve)}`, next]),
    riskNote: null,
  }),
  PRE_DEADLINE: ({ f, usd, pool, next }) => ({
    headline: `Withdraw ${usd(f.amount)} from ${pool} before the deadline`,
    explanation:
      `A withdrawal deadline is ${f.deadlineInDays ?? 0} days away. Moving ${usd(f.amount)} back to the ` +
      `Treasury now keeps the reserve funded before the policy enforces it.`,
    reasons: reasons([`Deadline in ${f.deadlineInDays ?? 0} days`, next, `Safety horizon ${f.safetyHorizonDays} days`]),
    riskNote: null,
  }),
  POOL_RISK_CRITICAL: ({ f, usd, pool, next }) => ({
    headline: `Withdraw ${usd(f.amount)} from ${pool}`,
    explanation: f.paused
      ? `${pool} is paused. Withdraw ${usd(f.amount)} back to the Treasury to protect upcoming payments.`
      : `${pool} risk score is ${f.riskScore ?? 0} with utilization ${f.utilizationPercent ?? '0.00'}%. ` +
        `Withdraw ${usd(f.amount)} back to the Treasury to protect upcoming payments.`,
    reasons: reasons([
      f.paused ? 'Pool paused' : `Risk score ${f.riskScore ?? 0}`,
      f.utilizationPercent === null ? null : `Utilization ${f.utilizationPercent}%`,
      next,
    ]),
    riskNote: 'Only the currently available liquidity can be withdrawn.',
  }),
  ALL_POOLS_CRITICAL: ({ next }) => ({
    headline: 'Trip the circuit breaker',
    explanation:
      'Every active pool is critical. Tripping the circuit breaker blocks all new investments; withdrawals and ' +
      'payments keep working.',
    reasons: reasons(['All active pools critical', next]),
    riskNote: null,
  }),
  APY_BELOW_MINIMUM: ({ f, usd, pool, next, minApy }) => ({
    headline: `Withdraw ${usd(f.amount)} from ${pool}`,
    explanation: `APY dropped to ${f.apyPercent ?? '0.00'}% (minimum ${minApy}%). Withdraw ${usd(f.amount)} from ${pool} back to the Treasury.`,
    reasons: reasons([`APY ${f.apyPercent ?? '0.00'}% below ${minApy}% minimum`, next]),
    riskNote: null,
  }),
  POOL_RISK_WATCH: ({ f, pool }) => ({
    headline: `Hold: no new investment into ${pool}`,
    explanation: `${pool} risk score ${f.riskScore ?? 0} is in the watch band. Existing funds stay; no new money goes in.`,
    reasons: reasons([`Risk score ${f.riskScore ?? 0}`]),
    riskNote: null,
  }),
  MANUAL: ({ action, f, usd, pool }) => ({
    headline: `${action === 'INVEST' ? 'Invest' : 'Withdraw'} ${usd(f.amount)} (${action === 'INVEST' ? 'into' : 'from'} ${pool})`,
    explanation: 'Requested manually by the ADMIN. The on-chain policy still checks every rule before execution.',
    reasons: reasons(['Manual ADMIN request']),
    riskNote: null,
  }),
};

const VI: Record<ReasonCode, Template> = {
  IDLE_SURPLUS: ({ f, usd, pool }) => ({
    headline: `Đầu tư ${usd(f.amount)} vào ${pool}`,
    explanation:
      `Số dư nhàn rỗi là ${usd(f.idle)} và mức dự trữ bắt buộc là ${usd(f.requiredReserve)}, ` +
      `nên ${usd(f.amount)} có thể hưởng ${f.apyPercent ?? '0.00'}% APY tại ${pool} mà mọi khoản phải trả ` +
      `trong ${f.safetyHorizonDays} ngày tới vẫn được đảm bảo.`,
    reasons: reasons([
      `Nhàn rỗi ${usd(f.idle)} vượt dự trữ ${usd(f.requiredReserve)}`,
      `APY ${f.apyPercent ?? '0.00'}%`,
      f.riskScore === null ? null : `Điểm rủi ro pool ${f.riskScore}`,
    ]),
    riskNote: null,
  }),
  DEADLINE_REACHED: ({ f, usd, pool, next }) => ({
    headline: `Rút ${usd(f.amount)} từ ${pool}`,
    explanation:
      `Số dư nhàn rỗi ${usd(f.idle)} thấp hơn mức dự trữ bắt buộc ${usd(f.requiredReserve)} là ${usd(f.shortfall)}. ` +
      `Rút ${usd(f.amount)} về Treasury ngay để đảm bảo các khoản thanh toán.`,
    reasons: reasons([`Thiếu hụt ${usd(f.shortfall)}`, `Dự trữ bắt buộc ${usd(f.requiredReserve)}`, next]),
    riskNote: null,
  }),
  PRE_DEADLINE: ({ f, usd, pool, next }) => ({
    headline: `Rút ${usd(f.amount)} từ ${pool} trước hạn`,
    explanation:
      `Còn ${f.deadlineInDays ?? 0} ngày đến hạn rút bắt buộc. Chuyển ${usd(f.amount)} về Treasury ngay ` +
      `để dự trữ đủ trước khi chính sách tự cưỡng chế.`,
    reasons: reasons([`Hạn rút sau ${f.deadlineInDays ?? 0} ngày`, next, `Khung an toàn ${f.safetyHorizonDays} ngày`]),
    riskNote: null,
  }),
  POOL_RISK_CRITICAL: ({ f, usd, pool, next }) => ({
    headline: `Rút ${usd(f.amount)} từ ${pool}`,
    explanation: f.paused
      ? `${pool} đang tạm dừng. Rút ${usd(f.amount)} về Treasury để bảo vệ các khoản thanh toán sắp tới.`
      : `Điểm rủi ro của ${pool} là ${f.riskScore ?? 0}, mức sử dụng ${f.utilizationPercent ?? '0.00'}%. ` +
        `Rút ${usd(f.amount)} về Treasury để bảo vệ các khoản thanh toán sắp tới.`,
    reasons: reasons([
      f.paused ? 'Pool tạm dừng' : `Điểm rủi ro ${f.riskScore ?? 0}`,
      f.utilizationPercent === null ? null : `Mức sử dụng ${f.utilizationPercent}%`,
      next,
    ]),
    riskNote: 'Chỉ rút được phần thanh khoản hiện có.',
  }),
  ALL_POOLS_CRITICAL: ({ next }) => ({
    headline: 'Kích hoạt cầu dao ngắt (circuit breaker)',
    explanation:
      'Mọi pool đang hoạt động đều ở mức nguy hiểm. Cầu dao ngắt chặn mọi khoản đầu tư mới; rút tiền và thanh toán ' +
      'vẫn hoạt động.',
    reasons: reasons(['Mọi pool đều nguy hiểm', next]),
    riskNote: null,
  }),
  APY_BELOW_MINIMUM: ({ f, usd, pool, next, minApy }) => ({
    headline: `Rút ${usd(f.amount)} từ ${pool}`,
    explanation: `APY giảm còn ${f.apyPercent ?? '0.00'}% (tối thiểu ${minApy}%). Rút ${usd(f.amount)} từ ${pool} về Treasury.`,
    reasons: reasons([`APY ${f.apyPercent ?? '0.00'}% dưới mức tối thiểu ${minApy}%`, next]),
    riskNote: null,
  }),
  POOL_RISK_WATCH: ({ f, pool }) => ({
    headline: `Giữ nguyên: không đầu tư thêm vào ${pool}`,
    explanation: `Điểm rủi ro ${f.riskScore ?? 0} của ${pool} nằm trong vùng theo dõi. Giữ khoản hiện có; không đầu tư thêm.`,
    reasons: reasons([`Điểm rủi ro ${f.riskScore ?? 0}`]),
    riskNote: null,
  }),
  MANUAL: ({ action, f, usd, pool }) => ({
    headline: `${action === 'INVEST' ? 'Đầu tư' : 'Rút'} ${usd(f.amount)} (${action === 'INVEST' ? 'vào' : 'từ'} ${pool})`,
    explanation: 'Do ADMIN yêu cầu thủ công. Chính sách on-chain vẫn kiểm tra mọi quy tắc trước khi thực thi.',
    reasons: reasons(['Yêu cầu thủ công của ADMIN']),
    riskNote: null,
  }),
};

/** `templates[language][reasonCode]` — one deterministic template per ReasonCode and language. */
export const templates: Record<ExplanationLanguage, Record<ReasonCode, Template>> = { en: EN, vi: VI };

function nextObligationReason(f: DecisionFacts, language: ExplanationLanguage): string | null {
  const n = f.nextObligation;
  if (!n) return null;
  return language === 'vi'
    ? `${n.label} ${usd(n.amount)} đến hạn sau ${n.dueInDays} ngày`
    : `${n.label} of ${usd(n.amount)} due in ${n.dueInDays} days`;
}

export function templateExplanation({ action, reasonCode, facts: f, minApyBps, language = 'en' }: TemplateInput): Explanation {
  const ctx: TemplateCtx = {
    action,
    f,
    minApy: bpsToPercent(minApyBps),
    usd,
    pool: f.adapterName ?? (language === 'vi' ? 'pool' : 'the pool'),
    next: nextObligationReason(f, language),
  };
  const t = templates[language][reasonCode] ?? templates[language].MANUAL;
  const p = t(ctx);
  return {
    headline: p.headline.slice(0, 80),
    explanation: p.explanation,
    reasons: p.reasons.length ? p.reasons : [language === 'vi' ? 'Quy tắc chính sách' : 'Policy rule'],
    riskNote: p.riskNote,
    source: 'TEMPLATE',
  };
}
