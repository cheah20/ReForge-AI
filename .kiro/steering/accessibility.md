---
inclusion: fileMatch
fileMatchPattern: "src/frontend/**"
---

# Accessibility rules for the frontend

Target: WCAG 2.2 level AA on every screen. Many users are older, use a second language, or fill the form on a small phone.

## Structure

- Use real elements: `<button>`, `<label for>`, `<fieldset>` with `<legend>` for radio groups and checkbox groups, `<main>`, `<header>`, `<nav>`.
- One `<h1>` per screen and no skipped heading levels. Add a "Skip to main content" link.
- ARIA only where HTML has nothing native. An ARIA attribute that repeats native meaning is a bug.

## Forms and errors

- Every input has a visible label. Placeholder text is never the only label.
- Persistent helper text under inputs with a format (IC number, phone, date, postcode), linked with `aria-describedby`.
- An error appears under its field and is linked with `aria-describedby`. Announce it with an `aria-live="polite"` region, and set `aria-invalid="true"` on the input.
- Validate on blur and on Next, not on every keystroke.
- Error text says what is wrong and how to fix it. Never show colour alone: add an icon and words.
- Mark required fields in text, not only with an asterisk or colour.
- Set `inputmode`, `type` and `autocomplete` where they fit (email, tel, numeric).

## Focus and keyboard

- Everything works with the keyboard alone, in reading order, with no traps.
- After a wizard step changes, move focus to the new step's heading (`tabIndex={-1}`).
- Dialogs trap focus while open and return it to the opener when closed.
- Focus rings are visible (at least 2px, 3:1 contrast against the background). Never remove `outline` without a replacement.

## Visual

- Text contrast is at least 4.5:1 (3:1 for large text, borders and focus rings).
- Pointer targets are at least 24x24 CSS px; primary actions such as Next and Download are at least 44x44.
- Body text is at least 16px, with a larger-text option. Layout works at 360px wide and at 200% zoom without horizontal scrolling.
- Long values (emails, addresses, IC numbers) wrap with `overflow-wrap: anywhere`. Never truncate an answer the user must check.
- `prefers-reduced-motion`: replace slides with a short fade or nothing.

## Language

- `<html lang>` follows the interface language.
- Any element in another language gets its own `lang`: the original PDF label, option labels from the PDF, and language names in the picker.

## Checks

- Run axe (`@axe-core/playwright`, tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) on every screen and state: picker, upload, each question type, error shown, review, download.
- axe cannot prove focus order, focus moving between steps, sensible error wording, readable translations, or zoom and reflow. Check these by hand before a demo: keyboard-only run of the whole flow, 360px width, 200% zoom, reduced motion on, and one screen-reader pass (NVDA or VoiceOver) on the wizard and review screens.
