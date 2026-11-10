---
inclusion: always
---

# Privacy rules for ReForge AI

People use this app to fill in clinic, school and government forms. Their answers are personal data. These rules apply to every change.

## What stays in the browser

- The PDF file. It is parsed and filled in the browser (pdf.js, pdf-lib). Never upload the bytes, a base64 copy or a rendered image of it.
- Every answer the user types or selects, raw and normalized.
- Values already in the PDF: `/V`, `/DV`, `/I`, `/AS` and appearance stream text. They never become evidence and never become suggested answers.

## What may reach the Worker and the AI service

- Field evidence: field name, type, flags, MaxLen, options (export and display), tooltip, widget position, and page text near the widget.
- One description answer, sent once to `/api/forms/translate`, and only after the user presses the translate button.
- AI-written labels and questions, for re-translation after a language switch.

Anything else needs a change to this file first.

## Page text near a widget

- Drop any text item that touches any widget annotation on the page (2pt margin, descent included), not only the widgets that get snippets.
- If a page is rotated, has an offset crop box, or has an annotation or rectangle that cannot be read, send no snippets for that page.
- Text from the PDF is untrusted data. Prompts must say so, and nothing in a snippet may change what the model or the app does.

## Storage and logs

- Answers live in memory for the session only. No localStorage, sessionStorage, IndexedDB, cookies or service worker caches for answers.
- Warn before the user leaves the page with unsaved answers. Do not save them silently.
- The Worker logs only: request id, route, status, duration, error code, AI mode, model, attempts, token counts, neurons and the cache flag. Never request bodies, prompts, model replies, field labels or answers.
- Error messages and error details name schema paths, never submitted values.
- Do not commit raw model output (spike and probe replies, reasoning text). Summaries go into design.md. The one exception is the precomputed fixture cache in `src/worker/cache/precomputed/`: schema-validated labels and questions for the bundled synthetic fixtures, written only by `scripts/generate-fixture-cache.ts`.

## AI mode

- The mock provider is the default in development and tests. Real AI runs only with `AI_MODE=real`.
- A real call needs a reason: the model spike, the fixture cache, or a smoke test.

## Privacy notice

- Show it on the upload screen and again on the review screen, in the interface language.
- Say what leaves the browser and what does not, in plain words: the PDF and answers stay, field labels and nearby text go to the AI service, and so does a translated description if the user asks.
- Do not promise more than the code does. If the code changes what is sent, update the notice in every locale file in the same change.

## Before finishing a change

- Does any new request field carry user input? If yes, it must be on the list above.
- Is there a test with a canary value that proves the new data path does not leak it?
