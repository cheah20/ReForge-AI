// @vitest-environment jsdom
/**
 * tests/unit/accessforge-diy-show.test.tsx
 *
 * accessforge-skeleton task 26.3 (Slice 2): the do-it-yourself list offers a
 * control that shows the field on the old page, with an accessible name that
 * includes the field, and only when the screen can act on it.
 * Validates: Requirements 12.2
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { DoItYourselfList } from '../../src/frontend/accessforge/MirrorReview.js';
import { planFor } from './accessforge-helpers.js';
import { toFirstQuestion } from './accessforge-machine-helpers.js';
import { fire, render, withApp, type Rendered } from './accessforge-render.js';

let view: Rendered | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});
const show = (node: Parameters<typeof withApp>[0]) => (view = render(withApp(node))).container;

const diyFields = () => toFirstQuestion(planFor(['f0:text:nama'])).state.fields.filter((f) => f.status === 'do-it-yourself');

describe('DoItYourselfList show control (12.2)', () => {
  it('has no button when the screen gives no way to show a field', () => {
    const root = show(<DoItYourselfList fields={diyFields()} />);
    expect(root.querySelectorAll('button')).toHaveLength(0);
  });

  it('has one button per field, named after the field, that asks to show that field', () => {
    const fields = diyFields();
    const onShow = vi.fn();
    const root = show(<DoItYourselfList fields={fields} onShow={onShow} />);
    const buttons = Array.from(root.querySelectorAll('button'));
    expect(buttons).toHaveLength(fields.length);
    expect(buttons[0]!.textContent).toContain('Show this field on the old page');
    expect(buttons[0]!.textContent).toContain(fields[0]!.entry.neighbourText);
    fire(() => buttons[2]!.click());
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onShow).toHaveBeenCalledWith(fields[2]!.elementId);
  });
});
