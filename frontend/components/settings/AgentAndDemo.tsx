'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useReadContracts } from 'wagmi';
import { AgentSettingsUpdateSchema, formatUsdcPlain, parseUsdc, type AgentSettingsUpdate, type DemoPrepareRequest } from '@runwaymind/shared';
import { useAdminWrite } from '@/hooks/useAdminWrite';
import { api, type AdminPrepareResponse, type AgentSettingsJson } from '@/lib/api';
import { appChain } from '@/lib/chains';
import { contracts } from '@/lib/contracts';
import type { AdminGate } from '@/lib/recommendations';
import { bpsToPercentText, percentToBps } from '@/lib/views';

/** Off-chain agent settings (ADMIN): PUT /agent/settings, bounds re-checked by the API (docs/09 §6). */
export function AgentSettingsForm({ settings, gate }: { settings: AgentSettingsJson; gate: AdminGate }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    mode: settings.mode,
    minApy: bpsToPercentText(settings.minApyBps),
    riskWithdrawThreshold: String(settings.riskWithdrawThreshold),
    riskInvestThreshold: String(settings.riskInvestThreshold),
    minActionAmount: formatUsdcPlain(BigInt(settings.minActionAmount)),
    preWithdrawLeadDays: String(settings.preWithdrawLeadDays),
    loopIntervalSec: String(settings.loopIntervalSec),
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (body: AgentSettingsUpdate) => api.putValidated('/agent/settings', AgentSettingsUpdateSchema, body),
    onSuccess: async () => {
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ['agent'] });
    },
    onError: (e) => setError((e as Error).message),
  });

  function submit() {
    setSaved(false);
    const minApyBps = percentToBps(form.minApy);
    let minActionAmount: string;
    try {
      minActionAmount = parseUsdc(form.minActionAmount).toString();
    } catch {
      return setError('Minimum action amount must be a USDC amount');
    }
    if (minApyBps === null) return setError('Minimum APY must be a percentage, e.g. 2 or 2.5');
    const body = {
      mode: form.mode,
      minApyBps,
      riskWithdrawThreshold: Number(form.riskWithdrawThreshold),
      riskInvestThreshold: Number(form.riskInvestThreshold),
      minActionAmount,
      preWithdrawLeadDays: Number(form.preWithdrawLeadDays),
      loopIntervalSec: Number(form.loopIntervalSec),
    };
    const parsed = AgentSettingsUpdateSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid settings');
    setError(null);
    save.mutate(parsed.data);
  }

  const field = (key: keyof typeof form, label: string, hint?: string) => (
    <label className="block text-sm">
      {label}
      <input
        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
        value={form[key]}
        disabled={!gate.enabled}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </label>
  );

  return (
    <section aria-label="Agent settings" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Agent (off-chain, ADMIN)</h3>
      <form
        className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="block text-sm">
          Mode
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
            value={form.mode}
            disabled={!gate.enabled}
            onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as AgentSettingsJson['mode'] }))}
          >
            <option value="APPROVE">APPROVE</option>
            <option value="AUTO">AUTO</option>
          </select>
        </label>
        {field('minApy', 'Minimum APY (%)', '0–100')}
        {field('riskWithdrawThreshold', 'Risk withdraw threshold', '0–100, below the invest threshold')}
        {field('riskInvestThreshold', 'Risk invest threshold', '0–100')}
        {field('minActionAmount', 'Minimum action amount (USDC)')}
        {field('preWithdrawLeadDays', 'Pre-withdraw lead (days)', '0–14')}
        {field('loopIntervalSec', 'Agent loop interval (seconds)', '5–600 (demo: 10)')}
        <div className="md:col-span-2">
          <button
            type="submit"
            disabled={!gate.enabled || save.isPending}
            title={gate.reason ?? undefined}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save agent settings'}
          </button>
          {saved ? <span className="ml-2 text-xs text-emerald-800">Saved (audited).</span> : null}
          {error ? (
            <p role="alert" className="mt-2 text-xs font-semibold text-red-800">
              {error}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

const POOL_FIELDS = ['apyBps', 'utilizationBps', 'paused', 'liquidityShortage'] as const;

const prepareDemo = (body: DemoPrepareRequest) => async () => (await api.post<AdminPrepareResponse>('/demo/prepare', body)).data;

/** Demo Controls (docs/08 §3.10 §4), only rendered when the Treasury is in demoMode. */
export function DemoControls({ gate }: { gate: AdminGate }) {
  const write = useAdminWrite();
  const pool = contracts?.pool;
  const reads = useReadContracts({
    allowFailure: false,
    contracts: pool?.address ? POOL_FIELDS.map((functionName) => ({ address: pool.address!, abi: pool.abi, functionName, chainId: appChain.id })) : [],
    query: { enabled: Boolean(pool?.address), refetchInterval: 5_000 },
  });
  const [apyBps, utilizationBps, paused, shortage] = (reads.data ?? []) as [bigint?, bigint?, boolean?, boolean?];
  const [apy, setApy] = useState(800);
  const [util, setUtil] = useState(5000);
  const [customDays, setCustomDays] = useState('2');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (apyBps !== undefined) setApy(Number(apyBps));
  }, [apyBps]);
  useEffect(() => {
    if (utilizationBps !== undefined) setUtil(Number(utilizationBps));
  }, [utilizationBps]);

  const disabled = !gate.enabled || write.isPending;
  const run = (title: string, contract: 'Treasury' | 'MockLendingPool', body: DemoPrepareRequest) => {
    setError(null);
    write.mutate({ title, contract, functionName: body.fn, prepare: prepareDemo(body) }, { onError: (e) => setError(e.message) });
  };
  const advance = (days: number) => run(`Advance time +${days} day${days === 1 ? '' : 's'}`, 'Treasury', { fn: 'advanceTime', args: [days * 86_400] });
  const btn = 'rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50';

  return (
    <section aria-label="Demo controls" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 shadow-sm">
      <p role="note" className="mb-3 rounded-md bg-amber-300 px-3 py-1.5 text-sm font-bold text-amber-950">
        DEMO MODE — not available in production
      </p>

      <div className="space-y-4 text-sm">
        <div>
          <p className="font-semibold">Advance time</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button type="button" className={btn} disabled={disabled} title={gate.reason ?? undefined} onClick={() => advance(1)}>
              +1 day
            </button>
            <button type="button" className={btn} disabled={disabled} title={gate.reason ?? undefined} onClick={() => advance(7)}>
              +7 days
            </button>
            <input aria-label="Custom days" className="w-16 rounded-md border border-slate-300 px-2 py-1" inputMode="numeric" value={customDays} onChange={(e) => setCustomDays(e.target.value)} />
            <button
              type="button"
              className={btn}
              disabled={disabled}
              title={gate.reason ?? undefined}
              onClick={() => {
                const d = /^\d{1,3}$/.test(customDays) ? Number(customDays) : 0;
                if (d < 1 || d > 365) return setError('Custom advance must be 1–365 days');
                advance(d);
              }}
            >
              Advance
            </button>
            <span className="text-xs text-slate-600">Time only moves forward.</span>
          </div>
        </div>

        {pool?.address ? (
          <>
            <div>
              <label className="font-semibold" htmlFor="demo-apy">
                Pool APY: {bpsToPercentText(apy)}%
              </label>
              <div className="flex items-center gap-2">
                <input id="demo-apy" type="range" min={0} max={2000} step={25} value={apy} onChange={(e) => setApy(Number(e.target.value))} className="flex-1" />
                <button type="button" className={btn} disabled={disabled || BigInt(apy) === apyBps} onClick={() => run(`Set APY ${bpsToPercentText(apy)}%`, 'MockLendingPool', { fn: 'setAPY', args: [apy] })}>
                  Apply
                </button>
              </div>
            </div>
            <div>
              <label className="font-semibold" htmlFor="demo-util">
                Utilization: {bpsToPercentText(util)}%
              </label>
              <div className="flex items-center gap-2">
                <input id="demo-util" type="range" min={0} max={10_000} step={100} value={util} onChange={(e) => setUtil(Number(e.target.value))} className="flex-1" />
                <button
                  type="button"
                  className={btn}
                  disabled={disabled || BigInt(util) === utilizationBps}
                  onClick={() => run(`Set utilization ${bpsToPercentText(util)}%`, 'MockLendingPool', { fn: 'setUtilization', args: [util] })}
                >
                  Apply
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={Boolean(paused)} disabled={disabled || paused === undefined} onChange={(e) => run(e.target.checked ? 'Pause pool' : 'Unpause pool', 'MockLendingPool', { fn: 'setPaused', args: [e.target.checked] })} />
                Pool paused
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(shortage)}
                  disabled={disabled || shortage === undefined}
                  onChange={(e) => run(e.target.checked ? 'Enable liquidity shortage' : 'Disable liquidity shortage', 'MockLendingPool', { fn: 'setLiquidityShortage', args: [e.target.checked] })}
                />
                Liquidity shortage
              </label>
            </div>
          </>
        ) : (
          <p className="text-xs text-slate-600">This deployment has no MockLendingPool.</p>
        )}

        <div>
          <button type="button" className={btn} disabled={disabled} title={gate.reason ?? undefined} onClick={() => run('Reset circuit breaker', 'Treasury', { fn: 'resetCircuitBreaker', args: [] })}>
            Reset circuit breaker
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-xs font-semibold text-red-800">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
