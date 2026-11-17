import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WithdrawalTimeline } from '../components/dashboard/WithdrawalTimeline';

const DAY = 86_400;
const NOW = Date.UTC(2026, 10, 17) / 1000;
const DUE = Date.UTC(2027, 0, 1) / 1000;
const cover = (id: string, amount: string, dueDate = DUE) => ({ obligationId: id, occurrenceIndex: 1, dueDate, amount });
const item = (covers: ReturnType<typeof cover>[]) =>
  ({ deadline: DUE - 14 * DAY, amount: '0', requiredReserveAfter: '0', covers, suggestedSources: [], state: 'SATISFIED_BY_IDLE' }) as never;
const labels = new Map([
  ['1', 'Trả lương tháng 1'],
  ['2', 'Trả Grant tháng 1'],
  ['3', 'Trả Vendor tháng 1'],
]);
const html = (covers: ReturnType<typeof cover>[]) => renderToStaticMarkup(<WithdrawalTimeline items={[item(covers)]} chainTime={NOW} labels={labels} />);

describe('WithdrawalTimeline: payments covered by a withdrawal', () => {
  it('one payment → same format as several: heading + one tag with name and amount (no #id)', () => {
    const out = html([cover('2', '10000000000')]);
    expect(out).toContain('Before 1 payment on 01/01/27:');
    expect(out).toContain('>Trả Grant tháng 1</span>');
    expect(out).toContain('10,000.00');
    expect(out).not.toContain('is paid on');
    expect(out).not.toContain('#2');
  });

  it('several payments on one day → "Before N payments on DATE:" and one tag each with name and amount', () => {
    const out = html([cover('1', '20000000000'), cover('2', '10000000000'), cover('3', '5000000000')]);
    expect(out).toContain('Before 3 payments on 01/01/27:');
    for (const name of ['Trả lương tháng 1', 'Trả Grant tháng 1', 'Trả Vendor tháng 1']) expect(out).toContain(`>${name}</span>`);
    expect(out).toContain('20,000.00');
    expect(out).not.toContain(' · Trả');
    expect(out).not.toContain('is paid on');
  });

  it('several payments on different days → each tag shows its own date', () => {
    const out = html([cover('1', '20000000000'), cover('3', '5000000000', DUE + 9 * DAY)]);
    expect(out).toContain('Before 2 payments:');
    expect(out).toContain('· 10/01/27');
  });
});
