// @vitest-environment jsdom
/**
 * tests/unit/accessforge-leave-warning.test.tsx
 *
 * accessforge-skeleton task 16.16: the beforeunload handler is registered
 * while answers exist and no confirmation arrived, requests the warning, and
 * is removed otherwise. No storage is written. The test checks the handler,
 * not a browser dialog.
 * Validates: Requirements 12.5, 13.4
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from './accessforge-render.js';
import { leaveWarningHandler, useLeaveWarning } from '../../src/frontend/accessforge/useLeaveWarning.js';

function Probe({ active }: { active: boolean }) {
  useLeaveWarning(active);
  return null;
}

afterEach(() => vi.restoreAllMocks());

const registered = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.filter((c: unknown[]) => c[0] === 'beforeunload' && c[1] === leaveWarningHandler).length;

describe('useLeaveWarning', () => {
  it('registers the handler while active and removes it when inactive', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = render(<Probe active={false} />);
    expect(registered(add)).toBe(0);
    view.rerender(<Probe active />);
    expect(registered(add)).toBe(1);
    view.rerender(<Probe active={false} />);
    expect(registered(remove)).toBe(1);
    view.unmount();
  });

  it('the handler requests the leave-page warning', () => {
    // A plain object: jsdom's Event.returnValue is a legacy boolean.
    const e = { preventDefault: vi.fn(), returnValue: 'unset' as unknown };
    leaveWarningHandler(e as unknown as BeforeUnloadEvent);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(e.returnValue).toBe('');
  });

  it('a real beforeunload while active is cancelled, and saves nothing', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const view = render(<Probe active />);
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    view.rerender(<Probe active={false} />);
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    view.unmount();
  });
});
