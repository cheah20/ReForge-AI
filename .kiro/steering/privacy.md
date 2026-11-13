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

For AccessForge (the revived legacy portal), these may also reach the Worker and the AI service:

- The Page_Model of the legacy page: control types, names, ids, label text, neighbouring-cell text, next-row text, option text, nearby text, `required`, `maxlength`, position, and the Page_Version. It is read from attributes and text nodes only, never from what is typed into the page.
- In Slice 2 only, the re-translation payload: the existing human labels and questions plus the target language.

AccessForge answers never go to the AI service. When the user confirms, the answers go only to the Legacy_Handler on the ReForge app's own Worker. It processes them in memory for that one request, renders them back once in the confirmation page, and never stores or logs them.

**Photos, scans and PDFs without fields (FormBridge Document_Path)**

These may also reach the Worker and the AI service:
- Kept_Labels: label text that the user saw on the label review, next to the crop of the page it came from, and kept in the send list, with its Label_Id, page number and reading-order index. Nothing else read from the document is sent.
- As on the fillable-PDF path: one description answer after the user presses the translate button, and AI-written labels and questions for re-translation after a language switch.

The label review starts with a conservative selection. Only short lines that look like a printed prompt and match no name, address or number rule start selected. Everything else starts unselected, and number-like text is never offered. The user is the last check.

What stays in the browser also includes: the file of every kind (photo, scan, PDF), decoded page images, page crops, and all text read from the page that is not a Kept_Label.

Answers stay on this device unless the user chooses Translate, Share, Print or Download. Print, Share and Download are allowed when the user starts them, and they are not network disclosure by the app. Print hands the answer sheet to the browser's print dialog, Download saves it on the device, and Share hands it to the app the user picks.

The logging, error-message and storage rules of this file apply to the Document_Path unchanged. The rules under "Page text near a widget" apply only to the fillable-PDF path; the Document_Path sends no page-text snippet and chooses what may be sent only through the label classifier and the label review.

Document text is untrusted data. It must stay inside the prompt's data delimiters, and nothing in it may change what the model or the app does.

The app may cache the OCR engine and its language files, downloaded from its own origin, in the browser. That cache holds only those engine and language files.

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
- AccessForge has its own notice (`accessforge.notice.*`), shown before analysis and again on the review screen: labels and nearby text from the old page go to the AI service; answers stay in the browser until the user confirms; then they go only to the demonstration portal's own form handler. The re-translation sentence is added only in the change that delivers language switching.
- Do not promise more than the code does. If the code changes what is sent, update the notice in every locale file in the same change.

## Before finishing a change

- Does any new request field carry user input? If yes, it must be on the list above.
- Is there a test with a canary value that proves the new data path does not leak it?
