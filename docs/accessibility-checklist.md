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

## AccessForge

The fictional demonstration portal under `/legacy/` fails accessibility on purpose: it imitates a neglected 2005 portal (small grey text with low contrast, table layout, no labels tied to inputs) so that the revival has something to improve. Only the Mirror, which is the AccessForge screen beside the old page, is held to WCAG 2.2 AA. The automated checks leave the old page's frame out. The one part of the old page that must stay readable is the banner that says it is a fictional demonstration portal.

### Automated, in the test suite

| Check | Where | Status |
| --- | --- | --- |
| axe, zero violations, in `en` and `zh-Hans`: start screen, data notice, a step of each answer type, the low-confidence step, a validation error, review, verified result, could-not-verify report, stop message, do-it-yourself report, larger text on | `tests/e2e/accessforge-a11y.spec.ts` | passing |
| Targets at least 24 px (primary action at least 44 px), body text at least 16 px (20 px with larger text), no horizontal scroll at 360 px, 640 px and 320 px | same file | passing |
| Focus returns to the control that opened the cancel dialog; the leave-page warning handler is registered while answers exist | `accessforge-session-flows.spec.ts` | passing |
| Write highlight at least 3 px and 3:1 against the old page's white, grey and cell colours; no transition under reduced motion | `tokens.test.ts`, `accessforge-session-flows.spec.ts` | passing |
| Errors tied to inputs (`aria-describedby`, `aria-invalid`, `aria-live="polite"`); the original Malay wording carries `lang="ms"` | `tests/unit/accessforge-adapter.test.tsx`, `accessforge-components.test.tsx` | passing |

Axe cannot judge focus order, wording, translations or how a screen reader reads the page. The next table covers those. The developer fills in the result and the date.

### By hand (the developer records the result)

| Check | Result (pass or fail) | Date checked |
| --- | --- | --- |
| Keyboard-only run of the whole revival: revive, notice, every question, review, confirm, result | not done | |
| Screen reader pass (NVDA or VoiceOver) on a question step | not done | |
| Screen reader pass on the review screen | not done | |
| Screen reader pass on the confirmation screen, including the original Malay text read in Malay | not done | |
| 360 px width on a real phone, with the old page shown and hidden | not done | |
| 200% browser zoom on desktop (the frame stays beside the Mirror or moves below it, no clipped text) | not done | |
| Reduced motion turned on in the system: highlight and focus changes without animation | not done | |
| Larger text option: every screen readable, nothing cut off | not done | |
| Chinese and Malay Mirror strings read by a native speaker | not done | |

## Photos, scans and PDFs without fields

The reading, line review, question and answer-sheet screens of the photo path are held to WCAG 2.2 AA. The paper form in the photo is not: it is the user's own document.

### Automated, in the test suite

| Check | Where | Status |
| --- | --- | --- |
| axe, zero violations, in `en` and `zh-Hans`: entry, language question, page preview, line review (also with two lines ticked), confirm language, a question, review, answer sheet | `tests/e2e/document-accessibility.spec.ts` | passing |
| Focus moves to the heading of each new screen: language question, line review, confirm language, answer sheet | same file | passing |
| axe with the larger text option on, on the line review and the answer sheet | same file | passing |
| Keyboard: Space ticks a line, and the buttons show a focus outline | same file | passing |
| Answer sheet: a heading, a caption, `th scope="col"` headers, a `th` and `td` pair in every row, a `lang` on every text that differs from the page, the clerk summary in the form language with per-string English fallback, stacked rows below 600 px | `tests/unit/answer-sheet-screen.test.tsx`, `tests/unit/answer-sheet.test.ts` | passing |
| Print prints only after its own button press and makes no request; the controls and the stamp are hidden from print | `tests/unit/answer-sheet-screen.test.tsx` | passing |
| Every screen shows the privacy notice or the "nothing was sent" notice for its own path | `tests/e2e/document-thin.spec.ts`, `tests/unit/screens.test.tsx` | passing |

Axe cannot judge the printed result, the camera, wording or how a screen reader reads a table.

### By hand (the developer records the result)

| Check | Result (pass or fail) | Date checked |
| --- | --- | --- |
| Keyboard-only run of the photo path: two big buttons, language question, preview and rotate, line review, every question, review, answer sheet, Print | not done | |
| Screen reader pass on the line review: the state of each line is read, and the notice about what will be sent | not done | |
| Screen reader pass on the answer sheet table, including a label read in its own language | not done | |
| Print preview of the answer sheet on A4: black on white, 14 pt, no row split across pages, controls hidden | not done | |
| A real phone (camera button, photo from the gallery): the whole path at 360 px wide | not done | |
| A photo taken by a person who is not the developer, with the app's retake advice read aloud to them | not done | |
| Larger text and 200% zoom on the line review and the answer sheet | not done | |
| Reduced motion turned on in the system | not done | |
| Chinese, Malay and Tamil strings of the photo path read by a native speaker | not done | |
