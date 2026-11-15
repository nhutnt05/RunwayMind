import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RiskScoreGauge } from '../components/pools/RiskScoreGauge';

describe('RiskScoreGauge (Pool Risk Dashboard)', () => {
  it('explains the score in plain words: out of 100, higher is safer, and what the band means', () => {
    const out = renderToStaticMarkup(<RiskScoreGauge score={87} band="HEALTHY" />);
    expect(out).toContain('Safety score');
    expect(out).toContain('out of 100');
    expect(out).toContain('Higher is safer');
    expect(out).toContain('Healthy (70–100)');
    expect(out).toContain('the agent may invest here');
    expect(out).toContain('aria-label="Safety score 87 out of 100 (higher is safer): Healthy"');
    expect(out).not.toContain('100 = safest');
    expect(out).toContain('left:87%');
  });

  it('WATCH and CRITICAL describe the agent action', () => {
    expect(renderToStaticMarkup(<RiskScoreGauge score={55} band="WATCH" />)).toContain('no new deposits');
    expect(renderToStaticMarkup(<RiskScoreGauge score={0} band="CRITICAL" />)).toContain('withdraws everything');
  });
});
