# Accessibility checklist (FormBridge)

Target: WCAG 2.2 level AA on every screen (requirement 13). This page lists what is checked automatically, what was checked by hand, and what is still open. Automated checks cannot prove conformance on their own, so this page does not claim it.

Last updated: 2026-11-12.

## Automated, in the test suite

| Check | Where | Status |
| --- | --- | --- |
| axe (tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa), zero violations | `tests/e2e/nov17-acceptance.spec.ts`: picker, upload, confirm, text, radio, checkbox, low-confidence, date-format, description, IC error, review, download | passing |
| axe on states the Nov 17 path does not reach | `tests/e2e/accessibility.spec.ts`: a real `<select>` dropdown (10 options), a required-field error, a skipped required field in review | passing |
| 360 px wide with larger text: no horizontal scrolling, axe clean | `accessibility.spec.ts`: picker, upload with field list open, confirm, five question types, review, download | passing |
| Targets at least 44 px high and 24 px wide (buttons, inputs, selects, option rows, the details toggle) | same test | passing |
| Keyboard only: skip link first, focus on each step heading, Enter submits, arrow keys choose a radio, Back keeps the answer | `accessibility.spec.ts` | passing |
| `prefers-reduced-motion: reduce` replaces the slide with a fade | `accessibility.spec.ts` | passing |
| Errors tied to inputs (`aria-describedby`, `aria-invalid`), announced (`aria-live="polite"`) | `tests/unit/screens.test.tsx`, `nov17-acceptance.spec.ts` | passing |
| Review error summary: focused, labelled, links to the field | `screens.test.tsx` (the wizard prevents this state, so it is tested directly) | passing |
| Colour contrast of every text and control token pair | `tests/unit/tokens.test.ts` | passing |
| `<html lang>` follows the interface language; PDF labels and language names carry their own `lang` | `tests/unit/i18n.test.tsx`, `screens.test.tsx` | passing |
| Every state has an icon and words, never colour alone | `StatusMessage` component; checked in review | passing |

200% zoom: a 1280 px window at 200% is a 640 CSS px viewport. The 360 px run is the stricter case of the same reflow rule (WCAG 1.4.10), so it covers zoom reflow. A real browser zoom at 200% has not been checked by hand.

## By hand

| Check | Status |
| --- | --- |
| Keyboard-only run of the whole flow, by a person | not done |
| Screen reader pass (NVDA or VoiceOver) on the wizard and the review screen | not done |
| Real browser zoom to 200% on desktop | not done |
| Phone check on a real device | not done |
| Error wording and translations read by native speakers (Malay, Chinese, Tamil, Spanish, Indonesian) | not done |

## Filled PDFs in viewers (non-Latin output)

| Viewer | Latin forms | Chinese output (Spike 2) |
| --- | --- | --- |
| Chromium (pdf.js render) | checked: values inside their fields with 3pt padding, page screenshot in the Nov 17 report | checked: two characters, no empty boxes |
| Firefox | not checked | not checked |
| Acrobat Reader | not checked | not checked |

Chinese-language forms are not offered in the app yet; the confirmation screen says so.

## Known gaps

- The checks above run in Chromium only.
- Tamil text in PDFs: glyph coverage is checked, correct shaping is not.
