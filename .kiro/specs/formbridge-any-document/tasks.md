# Implementation Plan: FormBridge Any Document

## Overview

The plan builds the Document_Path in TypeScript in the order the design's data path runs. A short prerequisite gate comes first. Then one combined shared-file task makes every change to the shared files for both this spec and `accessforge-skeleton` (design Q10, "Order"). The OCR spike follows. Then come the pure logic in `src/lib/document/` (file recognition, geometry, the Document_Model, the Label_Classifier, the label review and the request builder), the thin browser services (decoding, the page pipeline, the OCR service), the session and wizard glue, the screens, and finally the Playwright, privacy, accessibility and real-OCR tests.

**Slices.** Every task and sub-task carries a Slice label that matches "Delivery slices" in requirements.md and design.md. Slice 1 (tasks 1 to 17) is the only slice needed for acceptance. Every Slice 1 sub-task is required, including every Slice 1 test. Slice 2 (tasks 18 to 23) is optional; its sub-tasks carry the optional marker `*`. No Slice 1 task depends on a Slice 2 task.

**Time estimate for Slice 1.** In working days:

| Group | Days |
|---|---|
| 1 Prerequisite gate | 0 (developer input) |
| 2 Combined shared-file task (this spec's part) | 1.5 |
| 3 OCR spike and fixtures | 1 (plus developer time on real phones) |
| 4 File recognition and limits | 0.5 |
| 5 Geometry and Document_Model | 1 |
| 6 Answer_Areas and Label_Classifier | 1 |
| 7 Label review and request builder | 0.5 |
| 9 Browser services | 1 |
| 10 Session, wizard logic, re-translation builder and read-aloud | 1.25 |
| 11 Screens | 1.5 |
| Answer_Sheet PDF, "Add another page" and Share (tasks 5.10, 5.13, 11.6, 11.17 to 11.19) | 0.75 |
| 13 End-to-end, privacy and accessibility tests | 1 |
| 14 Real-OCR tests | 0.25 |
| 15 Docs and human checks | 0.25 (plus developer time for sessions) |
| **Total** | **11.5** |

The developer accepted this estimate on 2026-11-12 and keeps Slice 1 whole (open decision 10). No cut order is applied: the Answer_Sheet PDF download, "Add another page" and Share are built in the normal flow, and the final acceptance checkpoint (task 17) covers them. The re-translation builder and Property 34 add 0.25 days to group 10. The AccessForge sub-tasks of task 2 are counted in the AccessForge plan, not here.

**Order and file ownership (open decision 4, decided 2026-11-12).**

1. Task 2, the combined shared-file task, is the first implementation task. It does not start until the developer has sent the approved Privacy_Steering wording (task 1.1).
2. After task 2 has landed, this spec and `accessforge-skeleton` are implemented in parallel chats with strict file ownership, as the ownership table in design Q10 states. Neither chat edits a file the other chat owns or a file of the combined task. This spec's tasks after task 2 change only files that design Q10 assigns to "This spec only".
3. Any further shared-file need goes through a **coordinated change**: one small change, agreed by both chats before it is made, that touches only the shared files it needs, and that both chats pick up before their next task. Tasks that need one are marked **Coordinated change**.
4. Task 16, the progress checkpoint, runs on 2026-11-20 wherever the work stands. It reviews status only.

Three files that design Q10 does not list are left alone by this spec: `src/frontend/api.ts`, `tests/unit/tokens.test.ts` and `scripts/generate-fixture-cache.ts`. This spec puts its label client in `src/frontend/document/label-client.ts`, imports the existing `retranslate` client from `api.ts` read-only, and writes its high-contrast checks in a new test file.

**AI and OCR in tests.** No task calls real AI. Every automated test uses the mock AiProvider. Playwright tests use a mock OCR result. Real OCR runs only in the spike (task 3.3) and in the real-OCR tests (task 14.1), started by hand with `npm run test:ocr`.

## Tasks

- [ ] 1. Prerequisite gate (Slice 1, 0 days of coding)
  - [ ] 1.1 Receive the developer's approved Privacy_Steering wording (Slice 1)
    - **Needs the developer.** Open decision 3 is still open. The developer sends the approved wording for `.kiro/steering/privacy.md` and for the Privacy_Notice.
    - The wording in design Q10 is a proposal. It is not approved and is not used as the approved text.
    - Task 2 does not start until the approved wording has arrived.
    - _Requirements: 24.4, 24.5_
  - [ ] 1.2 Check that the decided open decisions are recorded (Slice 1)
    - No developer question remains for these. Confirm that "Open decisions" in design.md records them as decided on 2026-11-12, and apply them as written: 1 (Malay bar), 4 (order and ownership), 10 (Slice 1 whole, no cuts), 11 (slow-page and stall values), 12 (classifier failure blocks a page), 13 (selector-only changes to `tests/e2e/upload.spec.ts`), 14 (a push-button-only PDF goes to the Document_Path), 15 (GET requests for the app's own static assets are allowed in Original_Label_Mode), 16 (re-translation through `/api/forms/retranslate` with a 64-zero `contentHash`), 17 (digit rule V2: 6 or more digits anywhere) and 20 (OCR model variant by the rule in Q5).
    - Decisions 2, 6, 7, 8, 9 and 18 are still open and are taken as the design's proposal; decision 3 is task 1.1.
    - _Requirements: 2.2, 5.2, 9.1, 10.7, 11.2, 14.3_

- [ ] 2. Combined shared-file task for both specs, landed as one change (Slice 1, about 1.5 days)
  - Starts only after task 1.1. Its sub-tasks are reviewed one by one and land in one change. After it lands, every file it touched is frozen (design Q10 ownership table) and changes only through a coordinated change.
  - **AccessForge sub-tasks this task completes, for the AccessForge chat to tick** (the `accessforge-skeleton` tasks.md is not edited here): 13.1, 13.2 and 13.4 in full (task 2.10); 15.1 in full (task 2.3); the shared-file part of 4.5 (the `build:legacy` script entry, task 2.20), of 19.1 (the Playwright config change, task 2.21), and of 5.11, 13.7 and 16.11 where task 2.19 could add the entry. If optional task 2.22 is done, also the shared-file parts of 25.1 and 25.2. AccessForge 1.1, 1.2 and 2.1 were already done before this task.
  - **No placeholders.** An entry that would import a module the other spec has not written yet does not compile. Such an entry is left out, named in the change description, and added later in a coordinated change together with the task that writes the module. No placeholder module is written to make it compile.
  - [ ] 2.1 Capture the Fillable_Path golden request bodies (Slice 1)
    - The first sub-task, before any other code change of this spec. For each bundled fillable fixture, write the exact analyze request body that the current code sends to `tests/golden/fillable-analyze/<fixture>.json`.
    - `tests/unit/fillable-golden.test.ts`: the body built for each fixture is byte-identical to its golden file, and every precomputed fixture cache entry is found and passes schema validation.
    - _Requirements: 5.3_
  - [ ] 2.2 Update the Privacy_Steering with the approved wording (Slice 1)
    - **Shared file:** `.kiro/steering/privacy.md`. Use the wording received in task 1.1, word for word. Keep the AccessForge text already there unchanged.
    - _Requirements: 24.4_
  - [ ] 2.3 Update the privacy notices and add every new locale key for both specs (Slice 1)
    - **Shared file:** every interface locale file in `src/packs/language/locales/` (every Core_Language, plus `es` and any experimental file that already carries the FormBridge notice).
    - This spec: rewrite `upload.privacyNotice` and `review.privacyNotice` as Requirement 24.5 states and as the approved wording allows; add a Label_Review notice key; new text for `upload.title` and `upload.button` (same key, same input); every `entry.*` and `document.*` key named in the design, including `document.ocrLanguage.notYet`, `document.ocrLanguage.malayNotYet`, `document.originalMode.notice`, `document.sheet.pdfNotAvailable`, refusal messages, limits, page errors, OCR download and progress, Retake_Advice, Label_Review, Original_Label_Mode, Fictional_Examples and help texts per answer type, read-aloud, leave-page warning, Answer_Sheet, Share and Clerk_Summary.
    - AccessForge: every Slice 1 `accessforge.*` key of its task 15.1. Keep the `accessforge.notice.*` keys as they are.
    - A later task that needs a key not listed here adds it through a coordinated change to every locale file.
    - _Requirements: 1.2, 9.8, 23.10, 24.5, 24.6_
  - [ ] 2.4 Write the locale tests for the new keys (Slice 1)
    - `tests/unit/document-locales.test.ts`: every new key is non-empty in every Core_Language file; no `entry.*` string in `en` contains "upload", "PDF", "OCR", "file format" or "MIME" (case-insensitive); no `en` string about the Document_Path contains "accepts anything", "any document", "accurate" or "compliant", and the Document_Path description uses "helps you prepare your answers".
    - _Requirements: 1.2, 23.10, 28.2_
  - [ ] 2.5 Change the existing upload test selectors only (Slice 1)
    - `tests/e2e/upload.spec.ts` (owned by this spec): the three selectors for the old "Choose PDF file" label change to the new `upload.button` text from task 2.3, with no assertion changed. Lands in the same change as task 2.3 so the suite stays green. The "no fields" routing assertion changes later, in task 11.4.
    - `tests/unit/rejection.test.ts`, `tests/e2e/accessibility.spec.ts` and `nov17-acceptance.spec.ts` stay unchanged.
    - _Requirements: 5.2_
  - [ ] 2.6 Add the label schemas and types (Slice 1)
    - **Shared file:** `src/shared/schemas.ts`, `src/shared/types.ts`. Additions only.
    - `LABEL_ID_PATTERN`, `LabelAnswerTypeSchema`, `KeptLabelSchema`, `LabelAnalysisRequestSchema` (strict, with the uniqueness and id-consistency refinements), `LabelAnalysisSchema`, `LabelBatchReplyEnvelopeSchema`, `LabelAnalysisResponseSchema` and their inferred types, as in design "Data Models". Add to `types.ts` any AccessForge type that its design places there.
    - Unit tests: each bound of Requirement 13.2 on both sides, an extra key rejected, a mismatched Label_Id rejected.
    - _Requirements: 13.1, 13.2, 13.5, 13.6_
  - [ ] 2.7 Export the country pack patterns (Slice 1)
    - **Shared file:** `src/packs/country/my.ts`, `us.ts`, `universal.ts`, `dates.ts`. Export `MY_IC_PATTERN`, `MY_IC_SEARCH`, `US_SSN_SEARCH`, `EMAIL_SEARCH` and the `DATE_FORMATS` separators, with no behaviour change.
    - Unit tests: the unanchored search patterns find the value inside surrounding text, and the existing pack tests pass unchanged.
    - _Requirements: 11.2, 16.5_
  - [ ] 2.8 Move language and country detection into a shared module (Slice 1)
    - `src/frontend/state.ts` (owned by this spec): move `combineVotes` to `src/lib/analysis/detection.ts` and import it back into `state.ts`. Behaviour unchanged; move its existing tests with it. Done here because the runner of task 2.13 needs it.
    - _Requirements: 10.4, 13.3_
  - [ ] 2.9 Add the `analyzeLabels` provider method and prompt (Slice 1)
    - **Shared file:** `src/lib/ai/interface.ts`, `cf-workers.ts`, `mock.ts`, `prompt.ts`.
    - `analyzeLabelsMessages`: system prompt with the data rule of design Q2; user message with `<form_data>` markers and `<` and `>` escaped as `\u003c` and `\u003e` inside the JSON.
    - `MockAiProvider.analyzeLabels`: the deterministic English and Malay keyword table, confidence 0.9 or 0.5, a `[demo]` question and a fixed fictional example per answer type. No call to Workers AI in mock mode.
    - `CfWorkersAiProvider.analyzeLabels`: the existing timeout and `max_completion_tokens: 2000`.
    - _Requirements: 13.3, 13.4, 13.12_
  - [ ] 2.10 Add the AccessForge `analyzePage` provider method and prompt (Slice 1)
    - **Shared file:** `src/lib/ai/interface.ts`, `cf-workers.ts`, `mock.ts`, `prompt.ts`. Additive only.
    - Exactly as `accessforge-skeleton` tasks 13.1, 13.2 and 13.4 and its design describe: `PageAnalyzeCall`, `analyzePage`, the deterministic mock reply from its mock-analysis fixture, `pageAnalyzeMessages()` with its delimiting, and the Workers AI implementation with its timeout and token limit. The AccessForge tests for these stay with the AccessForge chat.
    - _Requirements: 24.1_
  - [ ] 2.11 Write the property test for prompt delimiting (Slice 1)
    - **Property 11: Prompt data delimiting round trip**
    - **Validates: Requirements 13.4**
    - In `tests/unit/analyze-labels.property.test.ts`, 100 runs, with label texts containing the markers, quotes, backslashes, newlines and instruction-like sentences.
  - [ ] 2.12 Write the property test for mock determinism (Slice 1)
    - **Property 31: Mock label analysis is deterministic**
    - **Validates: Requirements 13.12**
  - [ ] 2.13 Implement the label analysis runner (Slice 1)
    - `src/lib/analysis/run-labels.ts`: batches of 30 in page and reading order, one retry per batch after an invalid envelope or a timeout, `sanitizeLabelEntries` (drop unknown and duplicate ids and disallowed answer types; drop only a failing `explanation` or `example`), `failedLabelIds` for batches that failed twice, detection across batches through `detection.ts`, and the AI-unavailable or AI-timeout error when every batch failed.
    - _Requirements: 13.5, 13.6, 13.7, 13.11_
  - [ ] 2.14 Write the property test for reply sanitising (Slice 1)
    - **Property 12: Reply sanitising**
    - **Validates: Requirements 13.5, 13.6**
  - [ ] 2.15 Write the property test for batching and retry (Slice 1)
    - **Property 13: Batching and retry**
    - **Validates: Requirements 13.7, 13.11**
    - Scripted provider outcomes per call: valid, invalid envelope, timeout, quota.
  - [ ] 2.16 Add the `POST /api/documents/analyze-labels` route and its entry (Slice 1)
    - **Shared file:** `src/worker/index.ts` (one `ROUTES` entry with the 163,840-byte limit and `RATE_LIMITER_ANALYZE`).
    - `src/worker/routes/analyze-labels.ts` (owned by this spec): body size check, `LabelAnalysisRequestSchema` with schema-path-only details, per-IP rate limit, Language_Registry check, `runAnalyzeLabels`, the shared error shape, and the existing `LogEntry` fields only.
    - Unit tests: success with the mock provider, and every Worker row of the design's error table.
    - _Requirements: 13.2, 13.3, 13.7, 24.3_
  - [ ] 2.17 Write the property test for invalid requests (Slice 1)
    - **Property 32: Invalid requests are rejected with schema paths only**
    - **Validates: Requirements 13.2, 13.13**
  - [ ] 2.18 Write the canary test for the combined change (Slice 1)
    - `tests/unit/analyze-labels-canary.test.ts`: a Canary_Value label goes through the route with a recording logger, an invalid body, a provider that throws and a provider that times out. The canary is absent from every log entry and every response. A recording provider receives the canary only between the `<form_data>` markers, and receives no prefilled-fixture canary.
    - _Requirements: 13.13, 24.1, 24.3_
  - [ ] 2.19 Add the AccessForge Worker, config and app entries (Slice 1)
    - **Shared file:** `src/worker/index.ts`, `wrangler.jsonc`, `src/frontend/App.tsx`.
    - As `accessforge-skeleton` tasks 5.11, 13.7 and 16.11 describe: the `ROUTES` entry for `POST /api/pages/analyze`, the `/legacy` and `/legacy/*` dispatch to `handleLegacy` before the assets binding, `assets.run_worker_first` set to `["/api/*", "/legacy", "/legacy/*"]`, and the AccessForge entry in `App.tsx`.
    - Each entry is added only if the AccessForge module it imports exists. Otherwise the "No placeholders" rule of task 2 applies, and the change description names each entry left for a coordinated change.
    - _Requirements: 24.1_
  - [ ] 2.20 Add dependencies, scripts, the OCR asset copy step, headers and ignore rules (Slice 1)
    - **Shared file:** `package.json` and the lock file, `public/_headers`, `.gitignore`.
    - Add `tesseract.js` 7.x and the `eng` and `msa` language data packages, pinned to exact versions (design Research 1 and 2, Q5).
    - `scripts/copy-ocr-assets.ts` (owned by this spec): copy `worker.min.js`, the four core builds and the language data (both `best_int` and `fast` until task 3.5 chooses) into `public/ocr/<tesseract-version>/` and write `manifest.json` with path, bytes and SHA-256 per file. Run it from `predev` and `prebuild`.
    - Script entries: `copy-ocr-assets`, `test:ocr` (kept out of the default `npm test`), `generate-fixtures:documents`, and AccessForge's `build:legacy`. Hook and chain entries that would call a script that does not exist yet (`build:legacy` from `predev` and `prebuild`; `generate-fixtures:documents` from `generate-fixtures`) follow the "No placeholders" rule.
    - `public/_headers`: the `/ocr/*` block of design Q5 and the AccessForge path block its design names, if any. `.gitignore`: `public/ocr/`.
    - Unit test: the manifest lists every copied file with its correct size and hash.
    - _Requirements: 8.1, 8.3, 8.8, 25.7_
  - [ ] 2.21 Add the Playwright config entries for both specs (Slice 1)
    - **Shared file:** `playwright.config.ts`. Add the `mobile-chromium` project (Pixel 7 descriptor, 360×640 viewport, touch), limited by `testMatch` to the Document_Path specs that use it so existing specs do not also run on it. Add the AccessForge rule of its task 19.1: exclude `@smoke` unless `BASE_URL` is set.
    - _Requirements: 25.5, 27.9_
  - [ ]* 2.22 Add the AccessForge Slice 2 re-translation schemas, provider method and prompt (Slice 2)
    - **Shared file:** `src/shared/page-schemas.ts`, `src/lib/ai/interface.ts`, `cf-workers.ts`, `mock.ts`, `prompt.ts`. Only if the developer wants it in this change; otherwise it is a later coordinated change.
    - As `accessforge-skeleton` tasks 25.1 and 25.2 describe.
    - _Requirements: 24.1_
  - [ ] 2.23 Verify and land the combined change (Slice 1)
    - Run `npx vitest --run` and `npm run test:e2e`; every existing test passes, including the golden test of task 2.1. The change description lists the AccessForge sub-tasks completed and every entry left for a coordinated change.
    - _Requirements: 5.2, 5.3, 24.4, 24.5_

- [ ] 3. OCR spike and fixtures (Slice 1, about 1 day plus developer phone time)
  - [ ] 3.1 Write the document fixture generator (Slice 1)
    - `scripts/create-fixtures/documents.ts`, run by the `generate-fixtures:documents` script of task 2.20, writes every Slice 1 fixture of Requirement 25.1 with synthetic content only: clean English and Malay printed forms as JPEG and PNG; a rotated photo with EXIF orientation 6 and one without a tag; a glary or blurred photo; a mixed PDF without fields (text pages and scanned pages); a 6-page PDF without fields; a push-button-only PDF; the prefilled sensitive form with the Canary_Values of design Q1 (one inside a ruled box, one inside an underline, `Nama: ZQXCOLON` after a colon); an RTF and a legacy `.doc` file; a file of 15,728,641 bytes; malformed and truncated PDF, JPEG and PNG files; the 2×1 px EXIF probe JPEG of design Q6.
    - Next to the fixtures, write the expected labels per fixture and the expected Page_Text_Source per page of the mixed PDF, for tests 3.3, 13.3 and 13.5.
    - `tests/unit/document-fixtures.test.ts`: two runs with no arguments write byte-identical files, and no fixture text contains a name or organisation outside the synthetic word list.
    - _Requirements: 25.1_
  - [ ] 3.2 Write the character error rate helper (Slice 1)
    - `tests/ocr/cer.ts`: Levenshtein distance divided by the expected length, after NFKC and whitespace collapsing, and the OCR_Validation_Bar check (at least 90% of expected labels each match one Text_Line at a CER of 10% or less).
    - Unit tests with fixed pairs, including an exact match, one substitution and an empty result.
    - _Requirements: 9.1_
  - [ ] 3.3 Run the desktop spike measurements (Slice 1)
    - `tests/ocr/ocr-spike.spec.ts`, run by hand only. In Playwright Chromium and Firefox, load Tesseract.js from `/ocr/` with `cacheMethod: 'none'` and `workerBlobURL: false`, and record: bytes served per asset for `best_int` and `fast`; that no request goes to another origin; recognition time per clean fixture at 2,200 px; the OCR_Validation_Bar result per label for `eng` and `msa`; word count and mean line confidence for the clean and the glary fixtures; the EXIF probe result per browser.
    - The spec prints a summary only. No raw OCR output is committed.
    - _Requirements: 8.1, 8.9, 9.1, 9.4_
  - [ ] 3.4 Run the phone and throttled measurements (Slice 1)
    - **Needs the developer** (real devices). On the reference mid-range Android phone with Chrome and on an iPhone with iOS 17 Safari: recognition time per clean page, the EXIF probe result, that the second Tesseract fetch is a cache hit, and that cancel responds within 1 second during recognition. On the DevTools "Slow 3G" preset: first-use time and the preset's actual values. On the deployed URL: whether `_headers` is honoured.
    - _Requirements: 8.4, 8.9_
  - [ ] 3.5 Record the spike result and apply the approved bar (Slice 1)
    - Write the exact versions and licences, sizes, the model variant chosen by the rule in Q5, the timings table, the OCR_Validation_Bar results for English and Malay, the threshold values and the browser notes into "OCR Spike Result" in design.md.
    - Apply the approved bar of Requirement 9.1 without rounding: set `VALIDATED_OCR_LANGUAGES` in `src/lib/document/limits.ts` to `['eng', 'msa']` only if Malay passes, otherwise leave it `['eng']`. Set the chosen variant in `scripts/copy-ocr-assets.ts`. Record any change to `OCR_MIN_WORDS` or `OCR_MIN_MEAN_CONFIDENCE` with its reason.
    - _Requirements: 8.9, 9.1, 9.8, 26.4_

- [ ] 4. File recognition and limits (Slice 1, about 0.5 days)
  - [ ] 4.1 Add the limits module (Slice 1)
    - `src/lib/document/limits.ts` with every constant of design "Limits", including `VALIDATED_OCR_LANGUAGES = ['eng']` until task 3.5, and the note that the values may change after the phone tests.
    - _Requirements: 3.7, 9.1_
  - [ ] 4.2 Implement the File_Sniffer (Slice 1)
    - `src/lib/document/sniff.ts`: `sniffHead` with the signature table of design Q6 (Slice 2 formats return `refused`), `classifyPdf` through the low-level `/AcroForm` lookup (never `getForm()`), and `sniffFile` reading at most 65,536 bytes for non-PDF files. A PDF is `fillable-pdf` only with at least one answer field; a push-button-only PDF goes to the Document_Path (decision 14).
    - _Requirements: 2.1, 2.2, 2.6, 2.7, 2.8_
  - [ ] 4.3 Write the property test for sniffer totality and soundness (Slice 1)
    - **Property 3: The File_Sniffer is total, sound and ignores names**
    - **Validates: Requirements 2.1, 2.2, 2.7, 25.3**
    - In `tests/unit/document-sniff.property.test.ts`, 100 runs, including truncated and mutated copies of the fixtures.
  - [ ] 4.4 Write the property test for the bounded head read (Slice 1)
    - **Property 4: Sniffing a non-PDF reads a bounded head**
    - **Validates: Requirements 2.8**
  - [ ] 4.5 Write the sniffer example tests (Slice 1)
    - `tests/unit/document-sniff.test.ts`: every fixture kind, the 15 MB file and the file one byte over, the empty file, the push-button-only PDF, the encrypted PDF without fields, an XFA PDF, and a `getForm()` spy that is never called.
    - Canary test: a Canary_Value inside the bytes, a `fetch` spy, and no request made.
    - _Requirements: 2.2, 2.3, 2.9, 3.1_
  - [ ] 4.6 Implement the image header reader (Slice 1)
    - `src/lib/document/image-header.ts`: PNG `IHDR` dimensions, JPEG `SOFn` dimensions within the first 1 MB, and the EXIF orientation value. Total for any bytes.
    - Unit tests on the fixtures, on headers without EXIF and on truncated headers, and the 20,000,000-pixel check with width and height swapped for orientations 5 to 8.
    - _Requirements: 3.3, 7.1_

- [ ] 5. Geometry, reading order and the Document_Model (Slice 1, about 1 day)
  - [ ] 5.1 Add the document types and orientation maths (Slice 1)
    - `src/lib/document/types.ts` as in design "Data Models"; `src/lib/document/orientation.ts` with `uprightTransform(exif, decoderApplies)`, rotation by 90 degrees, box mapping to the upright frame, and the Working_Image size.
    - _Requirements: 3.4, 6.6, 7.1, 7.2_
  - [ ] 5.2 Write the property test for EXIF orientation (Slice 1)
    - **Property 7: EXIF orientation is applied exactly once**
    - **Validates: Requirements 7.1**
    - In `tests/unit/document-orientation.property.test.ts`.
  - [ ] 5.3 Write the property test for rotation (Slice 1)
    - **Property 8: Rotation round trip and upright boxes**
    - **Validates: Requirements 6.6, 7.2**
  - [ ] 5.4 Write the property test for the Working_Image scale (Slice 1)
    - **Property 17: Working_Image scale**
    - **Validates: Requirements 3.4**
  - [ ] 5.5 Implement line grouping and reading order (Slice 1)
    - `src/lib/document/reading-order.ts`: `groupIntoLines(fragments)` with rows from vertical centres within half the median line height, rows top to bottom, fragments left to right, indexes from 0.
    - Unit tests: two-column rows, a skewed line, equal boxes.
    - _Requirements: 4.2, 4.6_
  - [ ] 5.6 Implement the text-layer reader (Slice 1)
    - `src/lib/document/text-layer.ts`: convert pdf.js text items to upright viewport boxes, keep only items inside the visible area, count visible non-whitespace characters, and decide the Page_Text_Source from the count and the invisible-text flag.
    - _Requirements: 6.1, 6.2, 6.4, 6.6_
  - [ ] 5.7 Write the property test for the text source decision (Slice 1)
    - **Property 19: Text source decision**
    - **Validates: Requirements 6.1, 6.2, 6.4**
    - In `tests/unit/document-model.property.test.ts`.
  - [ ] 5.8 Write the property test for visible text only (Slice 1)
    - **Property 20: Text-layer lines come only from visible page text**
    - **Validates: Requirements 6.4**
  - [ ] 5.9 Implement OCR result mapping (Slice 1)
    - `src/lib/document/ocr-map.ts`: `mapTesseractBlocks` (confidence divided by 100, empty lines dropped) and `isLowQuality`.
    - Unit tests: a recorded block structure built by hand, an empty page with mean confidence 0.
    - _Requirements: 9.4, 9.5_
  - [ ] 5.10 Implement the Document_Model builder (Slice 1)
    - `src/lib/document/model.ts`: `buildPage` (sort, index, clamp boxes), `buildCandidates` (order, `textLang`, `checkYourself`), `labelIdOf`, `checkModel`, `replacePage` for rotate and retake, and `appendPage` for "Add another page" (page number is the current count plus 1, refused at the page limit, existing pages unchanged).
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7, 7.3, 7.5, 7.6, 9.5, 10.3_
  - [ ] 5.11 Write the property test for model invariants (Slice 1)
    - **Property 5: Document_Model invariants**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.6, 4.7, 25.4**
  - [ ] 5.12 Write the property test for stable Label_Ids (Slice 1)
    - **Property 6: Label_Ids are stable**
    - **Validates: Requirements 4.3, 25.4**
  - [ ] 5.13 Write the property test for page-local changes (Slice 1)
    - **Property 16: Page-local changes stay local**
    - **Validates: Requirements 7.3, 7.5, 9.4**
    - Covers rotate, retake and "Add another page".
  - [ ] 5.14 Write the property test for OCR quality marking (Slice 1)
    - **Property 21: OCR quality marking**
    - **Validates: Requirements 9.4, 9.5**
  - [ ] 5.15 Write the property test for the `lang` rule (Slice 1)
    - **Property 23: `lang` attribute rule**
    - **Validates: Requirements 10.3**

- [ ] 6. Answer_Areas and the Label_Classifier (Slice 1, about 1 day)
  - [ ] 6.1 Implement the label rules (Slice 1)
    - `src/lib/document/label-rules.ts`: NFKC and Unicode-digit normalisation, the label-ending colon rule, rules V1 to V9 and L1 to L3 with the exact patterns of design Q1, importing the pack pattern exports from task 2.7. Rule V2 marks a line `value-like` when it has 6 or more digits anywhere, in addition to the run of 4 or more digits (decision 17).
    - _Requirements: 11.2, 11.3, 11.4, 11.8, 11.10_
  - [ ] 6.2 Write one example test per rule (Slice 1)
    - `tests/unit/document-label-rules.test.ts`: one test per rule V1 to V9 and L1 to L3 with its exact pattern, including `10:30` (not a label colon), full-width digits and Tamil digits.
    - _Requirements: 11.8_
  - [ ] 6.3 Write the rule V2 example test (Slice 1)
    - In `tests/unit/document-label-rules.test.ts`: `9 0 0 1 0 1`, `A1-B2-C3-D4-E5-F6` and `Form KP01 (Rev. 1/2020)` are `value-like` by V2; `Item 12345` is `value-like` by V1; `Section 2, part 3` (2 digits) is not `value-like`.
    - _Requirements: 11.2, 11.8_
  - [ ] 6.4 Implement the Answer_Area detector (Slice 1)
    - `src/lib/document/answer-areas.ts`: `detectRuledAreas` on grey pixels (underline and box), `leaderAreas` and the after-colon area, with the thresholds of design Q1.
    - Unit tests on small synthetic grey images: an underline, a box, a line too short to count, a leader run.
    - _Requirements: 11.2, 11.3_
  - [ ] 6.5 Implement page classification (Slice 1)
    - `src/lib/document/classify.ts`: `classifyPage` (value rules first, the whole-line rule, the colon split), its zod self-check with the `classifier-failed` page status, and `isValueLikeText` for edits.
    - Unit tests: a throwing rule and a failing self-check give no candidate from that page and leave other pages unchanged.
    - _Requirements: 11.1, 11.5, 11.6, 11.9, 12.5_
  - [ ] 6.6 Write the property test for classification rules (Slice 1)
    - **Property 1: Classification is total, deterministic and follows the label rules**
    - **Validates: Requirements 11.1, 11.3, 11.4, 11.10**
    - In `tests/unit/document-classify.property.test.ts`.
  - [ ] 6.7 Write the property test for value exclusion (Slice 1)
    - **Property 2: No Label_Candidate contains a value part**
    - **Validates: Requirements 11.2, 11.5, 11.7, 11.9, 12.2**
    - Value generators include numbers that `validateMyPhone`, `validateUsPhone` and `validateInternationalPhone` accept, which also checks that V4 covers all three packs, and lines with 6 or more scattered digits for V2.
  - [ ] 6.8 Write the prefilled fixture classifier test (Slice 1)
    - `tests/unit/document-classify-prefilled.test.ts`, using the text layer and the mock OCR result of the prefilled sensitive fixture: first assert that each Canary_Value is present in the input, then that no Label_Candidate contains any of them.
    - _Requirements: 11.7, 11.8_

- [ ] 7. Label review and the request builder (Slice 1, about 0.5 days)
  - [ ] 7.1 Implement the review reducer (Slice 1)
    - `src/lib/document/review.ts`: `initialReview`, `reduceReview` (toggle, edit, reset; edits re-checked with `isValueLikeText`; empty text keeps its row), `keptLabels`.
    - _Requirements: 12.3, 12.4, 12.5, 12.9, 12.12_
  - [ ] 7.2 Write the property test for the review reducer (Slice 1)
    - **Property 10: Label_Review reducer keeps a consistent send list**
    - **Validates: Requirements 12.3, 12.6, 12.12**
    - In `tests/unit/document-review.property.test.ts`.
  - [ ] 7.3 Implement the request builder (Slice 1)
    - `src/lib/document/request.ts`: `buildLabelAnalysisRequests` in batches of 30 in page and reading order, each request parsed with `LabelAnalysisRequestSchema` before it is returned; no request when nothing is kept.
    - _Requirements: 12.9, 12.11, 13.1, 13.11_
  - [ ] 7.4 Write the property test for the request content (Slice 1)
    - **Property 9: The request carries only Kept_Labels and never a value-like string**
    - **Validates: Requirements 12.5, 12.9, 12.11, 13.1, 25.2**
  - [ ] 7.5 Write the prefilled fixture request canary test (Slice 1)
    - `tests/unit/document-request-canary.test.ts`: from the prefilled sensitive fixture, build requests with the default selections and with every `likely-label` selected; no Canary_Value appears in any request.
    - _Requirements: 24.7, 25.2_

- [ ] 8. Checkpoint: pure logic (Slice 1)
  - Run `npx vitest --run`. Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Browser services (Slice 1, about 1 day)
  - [ ] 9.1 Implement page decoding (Slice 1)
    - `src/frontend/document/decode.ts`: `detectDecoderOrientation` with the probe JPEG; photo decode with `createImageBitmap(..., { imageOrientation: 'from-image' })`, scaled to the Working_Image, full bitmap closed at once; PDF page render at a 2,200 px long edge with `/Rotate`, then the canvas released; the 1,200 px JPEG preview as an object URL; typed `PageError`s.
    - Unit tests with fake decoders: pixel-limit skip without allocation, bitmap closed, preview revoked on discard.
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 6.2, 6.6, 7.1, 7.4_
  - [ ] 9.2 Implement the page pipeline (Slice 1)
    - `src/frontend/document/pipeline.ts`: pages one at a time in page order; text layer first, OCR otherwise; Answer_Areas and classification per page; page status for skipped, failed, low-quality and classifier-failed pages; the 60-second slow-page timer that never stops processing by itself; the 5-page limit choice before any page.
    - _Requirements: 3.2, 3.5, 3.8, 6.3, 6.5, 6.7_
  - [ ] 9.3 Write the property test for one bitmap at a time (Slice 1)
    - **Property 18: One full-size bitmap at a time**
    - **Validates: Requirements 3.5, 6.3**
    - In `tests/unit/document-pipeline.property.test.ts`, with a counting fake decoder.
  - [ ] 9.4 Implement the OCR service (Slice 1)
    - `src/frontend/document/ocr.ts`: `pendingDownloadBytes`, `download` (fetch with progress, length and SHA-256 checked against the manifest, only verified files put into the `reforge-ocr-<version>` cache, 30-second stall notice while the download continues), `recognize` (dynamic `import()`, one worker created on first use and reused, paths under `/ocr/`, only the languages in `VALIDATED_OCR_LANGUAGES`), `cancel` (terminate and abort).
    - The test-only OCR result hook (`window.__REFORGE_TEST_OCR__`) is read only in the test build and stripped from production builds.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8, 8.10_
  - [ ] 9.5 Write the OCR service unit tests (Slice 1)
    - With a fake `createWorker` and fake `fetch`: lazy creation, one worker reused, cancel terminates within the test clock's 2 seconds, only the chosen language listed, an aborted or hash-mismatched download leaves no cache entry, the stall notice at 30 seconds, cache keys only manifest paths, and a production-build check that the test hook is absent.
    - Static test: every `createWorker` call passes `workerPath`, `corePath` and `langPath` starting with `/ocr/`.
    - _Requirements: 8.1, 8.2, 8.3, 8.6, 8.8, 8.10, 24.9_

- [ ] 10. Session, wizard logic, re-translation builder and read-aloud (Slice 1, about 1.25 days)
  - [ ] 10.1 Add the document session and Kept_Label mapping (Slice 1)
    - `src/frontend/state.ts` (owned by this spec; additions only: `origin`, `arrivalAnswer`, `document`).
    - `src/frontend/document/session.ts`: Kept_Labels to `FieldState` by the mapping table in design "Data Models"; the Original_Label_Mode analysis and `originalLabelQuestion(text, lang)`; Interface_Language, Form_Language and OCR_Language kept as separate settings; discard of the model, previews and answers on a new file.
    - _Requirements: 4.4, 4.5, 4.8, 10.1, 10.2, 13.8, 13.9, 14.2, 16.2_
  - [ ] 10.2 Extend the wizard logic (Slice 1)
    - `src/frontend/wizard-logic.ts` (owned by this spec). Add `documentReviewStatus`, `documentWizardTotal` and the undo rule. Existing exports keep their behaviour.
    - _Requirements: 15.1, 15.3, 15.7, 18.1_
  - [ ] 10.3 Write the property test for Kept_Label coverage (Slice 1)
    - **Property 14: Every Kept_Label becomes exactly one wizard item or sign-yourself row**
    - **Validates: Requirements 4.5, 13.8, 13.9, 15.1, 15.5**
    - In `tests/unit/document-session.property.test.ts`.
  - [ ] 10.4 Write the property test for independent language settings (Slice 1)
    - **Property 22: Language settings are independent**
    - **Validates: Requirements 10.1, 10.2, 12.13**
  - [ ] 10.5 Write the property test for answer length bounds (Slice 1)
    - **Property 24: Answer length bounds**
    - **Validates: Requirements 16.2**
  - [ ] 10.6 Write the property test for validation messages (Slice 1)
    - **Property 25: Validation messages never contain the answer**
    - **Validates: Requirements 16.3**
  - [ ] 10.7 Write the property test for undo (Slice 1)
    - **Property 26: Undo restores the arrival answer**
    - **Validates: Requirements 15.3**
  - [ ] 10.8 Write the property test for Original_Label_Mode quoting (Slice 1)
    - **Property 30: Original_Label_Mode quotes the label unchanged**
    - **Validates: Requirements 14.2**
  - [ ] 10.9 Implement the re-translation request builder (Slice 1)
    - `src/lib/document/retranslate.ts`: `buildDocumentRetranslateRequests(fields, targetLanguage)` copies, for each AI-analysed field only, the Label_Id as `fieldId`, the AI-written `humanLabel` and `question`, the 64-zero `contentHash` and the target language; skips Original_Label_Mode fields; returns no request when no field qualifies; parses each request with the existing `RetranslateRequestSchema` before returning it (decision 16).
    - _Requirements: 10.7, 24.1_
  - [ ] 10.10 Write the property test for re-translation content (Slice 1)
    - **Property 34: Re-translation carries only AI-written labels and questions**
    - **Validates: Requirements 10.7, 24.1**
    - In `tests/unit/document-session.property.test.ts`, with Canary_Values in Kept_Label text, Text_Lines and answers.
  - [ ] 10.11 Implement local voice matching and speech control (Slice 1)
    - `src/frontend/speech.ts`: `matchLocalVoice` with the table of Requirement 17.1, re-checked on `voiceschanged`; speak and cancel through `speechSynthesis` only.
    - Unit tests: cancel on step change, unmount and language change within 500 ms (fake timers); no `speechSynthesis` hides the control.
    - _Requirements: 17.1, 17.2, 17.3, 17.4_
  - [ ] 10.12 Write the property test for voice matching (Slice 1)
    - **Property 27: Local voice matching**
    - **Validates: Requirements 17.1, 17.2**
    - In `tests/unit/speech.property.test.ts`.
  - [ ] 10.13 Write the static validation-reuse test (Slice 1)
    - Fails when a module under `src/lib/document/` or `src/frontend/document/` defines an IC, phone, postcode, email or date pattern, or imports a validator other than `validateAnswer`; only `label-rules.ts` may import the pack pattern exports.
    - _Requirements: 16.1, 16.5_
  - [ ] 10.14 Implement the leave-page guard (Slice 1)
    - `src/frontend/document/leave-guard.ts`: `beforeunload` registered while an answer is non-empty or a Document_Model is loaded, removed when neither holds.
    - Unit test: register and remove on the matching state changes.
    - _Requirements: 20.1, 20.3_

- [ ] 11. Screens (Slice 1, about 1.5 days, plus 0.75 days for the PDF, "Add another page" and Share)
  - [ ] 11.1 Add the high-contrast option and Document_Path text scale (Slice 1)
    - `src/frontend/tokens.css` (owned by this spec): `:root[data-contrast='high']` values and `.document-flow` with `--text-scale: 1.25` under the large option, as in the design plan; the toggle in `components/AppHeader.tsx`.
    - `tests/unit/tokens-high-contrast.test.ts` (new; `tests/unit/tokens.test.ts` stays unchanged): every text pair of the high-contrast set is at least 7:1.
    - _Requirements: 23.2_
  - [ ] 11.2 Add the label analysis client (Slice 1)
    - `src/frontend/document/label-client.ts`: send the batches one after another with "part 2 of 3" progress; on network error, timeout, quota, rate limit or AI-unavailable, return a result that starts Original_Label_Mode with no automatic retry; `failedLabelIds` and missing ids go to Original_Label_Mode as type `text`.
    - Unit tests for each failure kind and for a partial failure.
    - _Requirements: 13.8, 14.1_
  - [ ] 11.3 Build the Entry_Screen and the refusal message (Slice 1)
    - `src/frontend/screens/Upload.tsx`, `src/frontend/App.tsx` (owned by this spec).
    - `EntryButtons.tsx`: two labelled file inputs (camera with `accept="image/*"` and `capture`; file with no `accept` and no `capture`, labelled by `upload.button`), at least 64 px tall, focus returned after a cancelled picker; the sample-form link after both, in a quieter style; the handwriting line; the privacy notice; the help text with the tested input kinds in plain words.
    - Routing through `sniffFile`: `fillable-pdf` to the existing flow unchanged, `refused` and `unknown` to the refusal message with the camera control, the 15 MB check.
    - Component tests for each criterion.
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 2.3, 2.5, 3.1, 24.6, 28.1, 28.3_
  - [ ] 11.4 Build the document reading screen and change the routing test (Slice 1)
    - `DocumentReading.tsx` inside `.document-flow`: the 5-page choice, skipped-page and failed-page messages with "continue without this page" and "take a photo of this page instead", whole-file decode and encryption messages, the slow-page notice with "Keep waiting" and "Stop".
    - `tests/e2e/upload.spec.ts`: the "no interactive form fields" rejection case now asserts routing to the Document_Path. No other assertion changes.
    - _Requirements: 2.4, 3.2, 3.3, 3.6, 3.8, 5.2, 6.5, 6.7_
  - [ ] 11.5 Build the language question, the Malay line and OCR progress (Slice 1)
    - `OcrLanguageQuestion.tsx`: a `fieldset` listing `VALIDATED_OCR_LANGUAGES` by native name with `lang`, "Another language" with the "not yet" message, the handwriting line. When `msa` is not in `VALIDATED_OCR_LANGUAGES`, no Malay radio is shown and `document.ocrLanguage.malayNotYet` states that the app cannot read printed Malay forms yet. The choice sets OCR_Language and the initial Form_Language.
    - In `DocumentReading.tsx`: the one-time download notice with the size from the manifest, progress in megabytes, "Reading page 2 of 3", cancel, the load-failed, needs-connection and unsupported-browser messages; a live-region announcer throttled to one message per page change and per 25% of the download.
    - Component test (Malay gate): with `['eng']` there is no Malay radio and the `malayNotYet` line is shown; with `['eng', 'msa']` the radio is present and the line is absent.
    - _Requirements: 8.5, 8.6, 8.7, 8.10, 9.2, 9.3, 9.7, 9.8, 14.5, 14.6, 23.11_
  - [ ] 11.6 Build the page preview, rotate control, Retake_Advice and "Add another page" (Slice 1)
    - `RotateControl.tsx` (44 px, 90 degrees per press, page rebuilt through `replacePage`), the preview step for photos, `RetakeAdvice.tsx` (one sentence, retake that replaces only that page, rotate, "Continue with what was read"), and the "We found no labels" screen.
    - "Add another page" while a photo model has fewer than 5 pages, through `appendPage`; a file that is too large, does not decode or is not a photo is refused with the matching message, and existing pages stay unchanged. Component tests for each refusal.
    - _Requirements: 7.2, 7.3, 7.5, 7.6, 9.4, 12.10_
  - [ ] 11.7 Build Page_Crops and the crop dialog (Slice 1)
    - `src/frontend/document/crops.ts` draws a crop from the page preview around a line box. `PageCropButton.tsx` has alt text with the candidate text and page number. `CropDialog.tsx` is a native `<dialog>` with zoom from 100% to 400% in 50% steps, focus kept inside, and Escape or Close returning focus to the crop button.
    - _Requirements: 12.7, 23.6, 23.12_
  - [ ] 11.8 Build the Label_Review screen (Slice 1)
    - `LabelReview.tsx`: a ruled list per page with checkbox and state text, an editable text input with `lang`, the crop beside it, the "Check this yourself" notice, the value-not-sent notice, the page-not-checked notice, the selected count in an `aria-live="polite"` region, the privacy notice, "Write my questions" and "Continue without AI", and the "select at least one item" message. Selections and edits survive a language switch.
    - _Requirements: 9.5, 11.6, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.8, 12.11, 12.13, 23.5, 24.6_
  - [ ] 11.9 Write the property test for crop alternatives and announcements (Slice 1)
    - **Property 33: Crop text alternatives and throttled announcements**
    - **Validates: Requirements 23.6, 23.11**
    - In `tests/unit/document-a11y.property.test.ts`.
  - [ ] 11.10 Build the document settings, connect the review to the wizard and add re-translation (Slice 1)
    - `DocumentSettings.tsx`: Form_Country choice with "none of these" for the `universal` pack, and Form_Language choice, for Original_Label_Mode; reuse the existing confirmation screen for low-confidence detection after label analysis.
    - Confirming the Label_Review calls the client of task 11.2 or starts Original_Label_Mode; the Answer_Sheet font is fetched into memory here.
    - An Interface_Language switch after Label_Analyses were received sends the requests of `buildDocumentRetranslateRequests` through the existing `retranslate` client in `api.ts` (imported, not changed); on failure the previous wording stays. No request is sent when no field was AI-analysed.
    - _Requirements: 10.2, 10.4, 10.5, 10.6, 10.7, 12.9, 13.8, 14.1_
  - [ ] 11.11 Extend the Question_Wizard for document fields (Slice 1)
    - `src/frontend/screens/QuestionWizard.tsx` (owned by this spec). Everything renders only when `field.origin` is set: the original label with `lang` and page number, the machine-translated label, `CheckYourself.tsx`, `FictionalExample.tsx`, `HelpPanel.tsx` ("I do not know": explanation, skip, ask someone you trust, nothing sent), undo, `ReadAloudButton.tsx`, the Original_Label_Mode notice and question, the sticky Back control, the refresh warning on the first step, and an empty input unless answered before. Validation through `validateAnswer` with `aria-describedby`, `aria-live` and `aria-invalid`.
    - _Requirements: 13.10, 14.2, 14.4, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 16.1, 16.3, 17.5, 20.4, 23.3_
  - [ ] 11.12 Extend the Review_Screen for document fields (Slice 1)
    - `src/frontend/screens/ReviewScreen.tsx` (owned by this spec). Rows with original text and `lang`, page number, Page_Crop, question, answer and one status; edit per row, also for skipped rows; "Make my answer sheet" disabled with a reason while an answer awaits validation; the privacy notice including the "nothing was sent" variant.
    - _Requirements: 18.1, 18.2, 18.3, 18.4_
  - [ ] 11.13 Implement the Answer_Sheet content (Slice 1)
    - `src/lib/document/answer-sheet.ts`: `buildAnswerSheet` (rows, statuses, machine-translated marks, Clerk_Summary with the English fallback and `lang="en"`), `answerSheetPlainText`.
    - _Requirements: 16.4, 19.1, 19.2, 19.4_
  - [ ] 11.14 Write the property test for Answer_Sheet coverage (Slice 1)
    - **Property 15: The Answer_Sheet lists every Kept_Label**
    - **Validates: Requirements 15.7, 16.4, 18.1, 19.1, 19.4, 19.10**
    - In `tests/unit/answer-sheet.property.test.ts`.
  - [ ] 11.15 Write the property test for Clerk_Summary fallback (Slice 1)
    - **Property 28: Clerk_Summary strings and fallback**
    - **Validates: Requirements 19.2**
  - [ ] 11.16 Build the Answer_Sheet screen with Print (Slice 1)
    - `AnswerSheet.tsx`: heading, `<table>` with `<caption>` and `th scope="col"`, stacked rows below 600 px, 20 px body on screen, the print style sheet (14 pt, black on white, controls hidden, `break-inside: avoid`), the screen-only approved stamp, the Clerk_Summary section, and Print through `window.print()` on a press only. The sheet is rebuilt on every render.
    - _Requirements: 19.3, 19.5, 19.7, 19.10, 19.11_
  - [ ] 11.17 Add the Answer_Sheet PDF download (Slice 1)
    - `src/frontend/document/answer-sheet-pdf.ts`: pdf-lib with fontkit and the bundled Noto Sans already in memory, A4, 14 pt body, 18 pt heading, wrapped lines, page numbers; glyph check on every code point; the button hidden with `document.sheet.pdfNotAvailable` for non-Latin Form_Languages or missing glyphs, and disabled with the same message if the font is not in memory; rebuilt on each press.
    - _Requirements: 19.6, 19.10, 19.11_
  - [ ] 11.18 Write the property test for PDF read-back (Slice 1)
    - **Property 29: Answer_Sheet PDF read-back**
    - **Validates: Requirements 19.6**
    - In `tests/unit/answer-sheet.property.test.ts`, 25 runs, stated in the test tag.
  - [ ] 11.19 Add Share for the Answer_Sheet (Slice 1)
    - In `AnswerSheet.tsx`: share the PDF when `navigator.canShare({ files })` is true, otherwise the plain text; hidden without Web Share; a cancelled share shows no message.
    - Component tests for each branch.
    - _Requirements: 19.5, 19.9_
  - [ ] 11.20 Make Original_Label_Mode work offline (Slice 1)
    - Check and, where needed, change the session and screen code so that in Original_Label_Mode, from the first question step to the Answer_Sheet, the app makes no request with document-derived or answer data. Only GET requests for the app's own static assets are allowed (decision 15), and a failed static asset request leaves every step, the Review_Screen, the Answer_Sheet and Print working.
    - `tests/unit/document-offline.test.ts`: with a `fetch` spy that rejects every call, a session in Original_Label_Mode goes through every question, the Review_Screen and the Answer_Sheet; the spy records no call other than a GET for an own static asset with no document data.
    - _Requirements: 14.3_
  - [ ] 11.21 Write the component tests for the new screens (Slice 1)
    - Answer_Sheet: every row has a `th` and `td` pair, every foreign-language element has `lang`, nothing is truncated. Question_Wizard and Review_Screen: no document-only element renders for a Fillable_Path field. Status elements carry text and an icon.
    - _Requirements: 5.1, 19.7, 23.5_

- [ ] 12. Checkpoint: screens in place (Slice 1)
  - Run `npx vitest --run` and `npm run test:e2e`. Ensure all tests pass, ask the user if questions arise.

- [ ] 13. End-to-end, privacy and accessibility tests (Slice 1, about 1 day)
  - [ ] 13.1 Add the mock OCR helpers (Slice 1)
    - `tests/e2e/helpers/document.ts`: inject mock OCR results per fixture through the test hook, record every request URL, header and body, and scan browser storage. The `mobile-chromium` project already exists from task 2.21.
    - _Requirements: 25.5, 27.9_
  - [ ] 13.2 Write scenario 2: clean phone photo (Slice 1)
    - `tests/e2e/document-photo.spec.ts`: Entry_Screen, language question, Label_Review with a Page_Crop beside every candidate, every question, Review_Screen, Answer_Sheet listing every Kept_Label with its answer.
    - _Requirements: 27.2_
  - [ ] 13.3 Write scenario 3: rotated photo (Slice 1)
    - `tests/e2e/document-rotated.spec.ts`: the EXIF-tagged fixture with zero rotate presses and the untagged fixture after one press both show the expected labels.
    - _Requirements: 7.1, 7.2, 27.3_
  - [ ] 13.4 Write scenario 4: poor photo (Slice 1)
    - `tests/e2e/document-retake.spec.ts`: a mock low-quality result shows the generic Retake_Advice; retaking with the clean fixture reaches the Label_Review.
    - _Requirements: 9.4, 27.4_
  - [ ] 13.5 Write scenario 5: mixed PDF (Slice 1)
    - `tests/e2e/document-mixed-pdf.spec.ts`: each page has the expected Page_Text_Source and candidates appear in page order.
    - _Requirements: 6.3, 27.5_
  - [ ] 13.6 Write scenario 7: no network or no AI quota (Slice 1)
    - `tests/e2e/document-no-ai.spec.ts`: once with every API request failing with a network error, once with a quota error; the Original_Label_Mode notice appears and the user completes an Answer_Sheet.
    - _Requirements: 14.1, 14.4, 27.6_
  - [ ] 13.7 Write scenario 8: prefilled sensitive form (Slice 1)
    - `tests/e2e/document-privacy.spec.ts`: runs twice, through AI and in Original_Label_Mode. The AI run includes an Interface_Language switch after label analysis, so the re-translation request is recorded too. No Canary_Value in any request URL, header or body, except a typed description canary in the one translate request after the press; every request goes to the app's own origin; localStorage, sessionStorage, every IndexedDB database, cookies, Cache Storage (only `reforge-ocr-*` with manifest paths), the URL and `history.state` hold no canary.
    - _Requirements: 4.4, 8.8, 10.7, 19.11, 20.2, 20.5, 20.6, 24.1, 24.2, 24.7, 24.9, 27.7_
  - [ ] 13.8 Write scenario 9: unsupported file (Slice 1)
    - `tests/e2e/document-refused.spec.ts`: the RTF and `.doc` fixtures show the refusal message and the photo suggestion.
    - _Requirements: 2.5, 27.8_
  - [ ] 13.9 Write scenario 10, automated part: first-time user on a phone (Slice 1)
    - `tests/e2e/document-mobile.spec.ts` on `mobile-chromium` in `zh-Hans`: scenario 2 using only the entry buttons and wizard controls; every primary control measures at least 44 by 44 px and the entry buttons at least 64 px tall; the Back control is visible without scrolling; no horizontal scrolling.
    - _Requirements: 1.1, 15.2, 23.1, 23.7, 27.9_
  - [ ] 13.10 Write the offline and throttled-download tests (Slice 1)
    - `tests/e2e/document-network.spec.ts`: after the Label_Review, `context.setOffline(true)`, then the wizard, Review_Screen and Answer_Sheet complete in Original_Label_Mode with no request that carries document-derived or answer data; GET requests for the app's own static assets are allowed and may fail (decision 15). With a CDP "Slow 3G" throttle, the download notice shows the size, progress advances, and cancel returns to the Entry_Screen within 2 seconds.
    - _Requirements: 8.5, 8.6, 14.3_
  - [ ] 13.11 Write the axe checks for every new screen (Slice 1)
    - `tests/e2e/document-accessibility.spec.ts`: tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, in `en` and `zh-Hans`, failing on any violation, on every screen of Requirement 23.8 (the Answer_Sheet with its PDF and Share controls), plus a keyboard-only pass through scenario 2 with focus moving to each new heading, and the high-contrast and larger-text options on.
    - _Requirements: 23.2, 23.3, 23.4, 23.7, 23.8_

- [ ] 14. Real-OCR tests (Slice 1, about 0.25 days)
  - [ ] 14.1 Write the real-OCR tests (Slice 1)
    - `tests/ocr/real-ocr.spec.ts`, run by `npm run test:ocr`: real Tesseract.js from `/ocr/` on the clean English photo, the rotated fixtures and the glary or blurred fixture, and Malay only when `msa` is in `VALIDATED_OCR_LANGUAGES`. Fails when the clean fixture is below the OCR_Validation_Bar; asserts a Low_Quality_Page for the glary fixture; prints timings.
    - _Requirements: 25.5_
  - [ ] 14.2 Record the real recognition timings (Slice 1)
    - Run task 14.1 on the desktop and write the measured timings into the OCR Spike Result table in design.md. Phone timings come from the developer's runs in task 3.4. Record any threshold change with its reason.
    - _Requirements: 8.9, 25.5, 26.4_

- [ ] 15. Docs and human checks (Slice 1, about 0.25 days plus developer time)
  - [ ] 15.1 Write this spec's README and checklist content (Slice 1)
    - **Coordinated change:** `README.md`, `docs/accessibility-checklist.md`.
    - README: the Document_Path privacy wording, identical to the Privacy_Notice; the tested input kinds; the Validated_OCR_Languages from task 3.5; handwriting not supported; if Malay failed the bar, the statement that the app cannot yet read printed Malay forms; the untagged PDF note; other inputs and languages marked not supported; disclosure rows for Tesseract.js and each language data file with the version and licence recorded in task 3.5.
    - Checklist: the six entries of Requirement 23.9, each marked "not yet run".
    - `tests/unit/readme-ocr-languages.test.ts`: fails when the README's OCR language list differs from `VALIDATED_OCR_LANGUAGES`, and checks that the Malay statement is present exactly when `msa` is absent. Extend the phrase scan of `tests/unit/document-locales.test.ts` to the README text about the Document_Path.
    - _Requirements: 23.9, 24.8, 28.1, 28.2, 28.3, 28.4, 28.5_
  - [ ] 15.2 Run the manual accessibility checks (Slice 1)
    - **Needs the developer. Coordinated change:** `docs/accessibility-checklist.md`. Fill in the six entries of Requirement 23.9 with pass or fail and the date.
    - _Requirements: 23.9_
  - [ ] 15.3 Create the Usability_Test_Record template (Slice 1)
    - `docs/usability-test-record.md`: the completion bar, the per-session fields of Requirement 26.2, participant codes only, and the help definition. No results are written by this task.
    - _Requirements: 26.1, 26.2, 26.3, 26.5_
  - [ ] 15.4 Run the sessions with three representative users (Slice 1)
    - **Needs the developer. Human task, not a coding task.** At least three participants aged 60 or over, or who rarely use apps beyond calls and messaging, complete scenario 2 on a phone with synthetic forms. Record each session and whether the bar was met, with no rounding up. If the bar is not met, list the changes and at least one further session. Any limit or threshold changed afterwards is recorded in design.md.
    - _Requirements: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6_
  - [ ] 15.5 Add Kiro usage log rows for features actually used (Slice 1)
    - `docs/kiro-usage-log.md` (both chats append rows and never edit a row they did not write). One row per real use: this spec, each property test that found a bug (with the regression test name and seed), and any hook, steering or MCP use during these tasks. Record only what happened.
    - _Requirements: 28.4_

- [ ] 16. Progress checkpoint on 2026-11-20 (Slice 1)
  - Runs on 2026-11-20, wherever the work stands. Status review only: list which tasks are done in this tasks.md and in `.kiro/specs/accessforge-skeleton/tasks.md`, the result of `npx vitest --run` and `npm run test:e2e`, any coordinated change still pending, and any blocker. Changes no code, no requirement, no scope and no file ownership. Ask the user if questions arise.

- [ ] 17. Final Slice 1 acceptance checkpoint (Slice 1)
  - Run `npx vitest --run`, `npm run test:e2e` (scenarios 1, 2, 3, 4, 5, 7, 8, 9 and the automated part of 10, plus the unchanged fillable `MY` and `US` scenarios and the golden test of task 2.1) and `npm run test:ocr`. This covers the Answer_Sheet PDF download, "Add another page" and Share. Confirm task 15.4 records the completion bar result. Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Additional input formats (Slice 2)
  - New dependencies (for example a HEIC converter) need a coordinated change to `package.json`.
  - [ ]* 18.1 Recognise WebP, HEIC, SVG, DOCX and TXT in the File_Sniffer (Slice 2)
    - _Requirements: 2.6_
  - [ ]* 18.2 Decode WebP (Slice 2)
    - `src/frontend/document/decode-webp.ts`, within the pixel limit.
    - _Requirements: 21.1_
  - [ ]* 18.3 Decode HEIC with a self-hosted converter (Slice 2)
    - `decode-heic.ts`, converter loaded from the app's origin only for `heic`, EXIF once, two synthetic iPhone photo fixtures.
    - _Requirements: 21.2_
  - [ ]* 18.4 Sanitise and rasterise SVG (Slice 2)
    - `svg-sanitize.ts`: remove scripts, event handlers, external references and `foreignObject`; no network request.
    - _Requirements: 21.3_
  - [ ]* 18.5 Write the SVG sanitiser property test (Slice 2)
    - For any generated SVG, no script, event handler, external reference or `foreignObject` survives.
    - _Requirements: 21.3_
  - [ ]* 18.6 Read DOCX text with size limits (Slice 2)
    - `src/lib/document/docx.ts`: paragraph and table text in order, limits on entry count, uncompressed size and ratio; the Word file is never modified.
    - _Requirements: 21.4_
  - [ ]* 18.7 Write the DOCX limit tests (Slice 2)
    - Zip-bomb and oversized entry fixtures stop reading with the decode message.
    - _Requirements: 21.4_
  - [ ]* 18.8 Read TXT files (Slice 2)
    - `src/lib/document/txt.ts`: UTF-8 only, one Text_Line per non-empty line up to the design's line limit.
    - _Requirements: 21.5_
  - [ ]* 18.9 Extend the sniffer property generators (Slice 2)
    - **Property 3: The File_Sniffer is total, sound and ignores names** (malformed and oversized cases of each delivered format)
    - **Validates: Requirements 21.6**

- [ ] 19. Photo-quality checks and crop (Slice 2)
  - [ ]* 19.1 Implement local photo-quality checks (Slice 2)
    - `src/lib/document/photo-quality.ts`: blur, darkness, glare and small text, one instruction at a time, continue allowed.
    - _Requirements: 22.1_
  - [ ]* 19.2 Write the photo-quality canary test (Slice 2)
    - Nothing from the checks is sent anywhere.
    - _Requirements: 22.5_
  - [ ]* 19.3 Build the crop tool (Slice 2)
    - `CropTool.tsx`: 44 px handles moved by arrow keys; applying a crop recognises the page again.
    - _Requirements: 22.2_
  - [ ]* 19.4 Write the crop tool tests (Slice 2)
    - Keyboard movement, re-recognition, and the axe check.
    - _Requirements: 22.2, 22.5_

- [ ] 20. More OCR languages (Slice 2)
  - New language data packages need a coordinated change to `package.json`; new warning strings need one to the locale files.
  - [ ]* 20.1 Generate Chinese and Tamil printed form fixtures (Slice 2)
    - _Requirements: 25.6_
  - [ ]* 20.2 Measure `chi_sim`, `chi_tra` and `tam` against the OCR_Validation_Bar (Slice 2)
    - Record per-language quality and warning text in design.md.
    - _Requirements: 9.6_
  - [ ]* 20.3 Offer each language that passes, with its warnings (Slice 2)
    - _Requirements: 9.6_
  - [ ]* 20.4 Write scenario 6 (Slice 2)
    - Chinese and Tamil fixtures show the quality warnings.
    - _Requirements: 27.10_

- [ ] 21. Advanced recovery (Slice 2)
  - [ ]* 21.1 Re-read one page with another Validated_OCR_Language (Slice 2)
    - _Requirements: 22.3_
  - [ ]* 21.2 Move a page to another position (Slice 2)
    - _Requirements: 22.3_
  - [ ]* 21.3 Confirm before discarding answers (Slice 2)
    - State how many answers would be discarded and wait for confirmation.
    - _Requirements: 22.4_
  - [ ]* 21.4 Write the recovery tests (Slice 2)
    - Answers kept for unchanged Label_Id and text; the discard count; the canary test.
    - _Requirements: 22.3, 22.4, 22.5_

- [ ] 22. Overlay and non-Latin Answer_Sheet PDF (Slice 2)
  - [ ]* 22.1 Build the Overlay (Slice 2)
    - `Overlay.tsx`: the user places each answer, a preview before download, no claim of automatic placement.
    - _Requirements: 19.8_
  - [ ]* 22.2 Add CJK and Tamil Answer_Sheet PDF output (Slice 2)
    - Reuse the CJK subsetting of `formbridge-pdf`; Tamil after its shaping check.
    - _Requirements: 19.6_
  - [ ]* 22.3 Write the Overlay and non-Latin PDF tests (Slice 2)
    - _Requirements: 19.6, 19.8_

- [ ] 23. Checkpoint: Slice 2 (Slice 2)
  - Run `npx vitest --run`, `npm run test:e2e` and `npm run test:ocr`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Slice 1 sub-tasks have no optional marker: every Slice 1 test, including every property test, is required. Slice 2 sub-tasks carry `*` because the whole slice is optional; task 2.22 is a Slice 2 sub-task inside the combined task.
- Each correctness property of design.md has exactly one property test sub-task in Slice 1, with at least 100 runs (Property 29: 25 runs) and the tag `// Feature: formbridge-any-document, Property {n}: {property title}`. Task 18.9 extends Property 3 for Slice 2 formats.
- Tasks marked **Needs the developer** (1.1, 3.4, 15.2, 15.4) cannot be done by code. Task 15.4 is a human study with three people. Task 2 cannot start before task 1.1.
- Tasks marked **Coordinated change** (15.1, 15.2, and any entry left out of task 2 under its "No placeholders" rule) touch files frozen after task 2 and are agreed with the AccessForge chat first.
- No task calls real AI. Real OCR runs only in tasks 3.3 and 14.1. No raw OCR output, model output, personal data or secrets are committed.
- Open decisions 8 (instruction lines as context) and 9 (choice questions) have no tasks; the design places both in Slice 2 pending the developer's choice.
- The dependency graph below lists leaf sub-tasks only. Checkpoints 8, 12, 16, 17 and 23 are not in it; task 16 runs on its date.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.6", "2.7", "2.8", "2.20", "2.21"] },
    { "id": 3, "tasks": ["2.4", "2.5", "2.9"] },
    { "id": 4, "tasks": ["2.10", "2.11", "2.13"] },
    { "id": 5, "tasks": ["2.12", "2.16", "2.22"] },
    { "id": 6, "tasks": ["2.14", "2.18", "2.19"] },
    { "id": 7, "tasks": ["2.15"] },
    { "id": 8, "tasks": ["2.17"] },
    { "id": 9, "tasks": ["2.23"] },
    { "id": 10, "tasks": ["3.1", "3.2", "4.1", "5.1", "5.5", "6.1", "6.4"] },
    { "id": 11, "tasks": ["3.3", "4.2", "4.6", "5.2", "5.6", "5.9", "6.2"] },
    { "id": 12, "tasks": ["3.4", "4.3", "5.3", "5.7", "5.10", "6.3", "6.5"] },
    { "id": 13, "tasks": ["3.5", "4.4", "5.4", "5.8", "6.6", "7.1", "9.1"] },
    { "id": 14, "tasks": ["4.5", "5.11", "6.7", "7.2", "7.3", "9.4"] },
    { "id": 15, "tasks": ["5.12", "6.8", "7.4", "9.2", "9.5"] },
    { "id": 16, "tasks": ["5.13", "7.5", "9.3", "10.1"] },
    { "id": 17, "tasks": ["5.14", "10.2", "10.9", "10.11", "10.14"] },
    { "id": 18, "tasks": ["5.15", "10.3", "10.12", "10.13", "11.1", "11.2"] },
    { "id": 19, "tasks": ["10.4", "11.3"] },
    { "id": 20, "tasks": ["10.5", "11.4"] },
    { "id": 21, "tasks": ["10.6", "11.5", "11.7"] },
    { "id": 22, "tasks": ["10.7", "11.6", "11.13"] },
    { "id": 23, "tasks": ["10.8", "11.8", "11.14"] },
    { "id": 24, "tasks": ["10.10", "11.9", "11.10", "11.15"] },
    { "id": 25, "tasks": ["11.11", "11.16"] },
    { "id": 26, "tasks": ["11.12", "11.17"] },
    { "id": 27, "tasks": ["11.18", "11.19"] },
    { "id": 28, "tasks": ["11.20", "11.21"] },
    { "id": 29, "tasks": ["13.1"] },
    { "id": 30, "tasks": ["13.2", "13.3", "13.4", "13.5", "13.6", "13.7", "13.8", "13.9", "13.10", "13.11", "14.1"] },
    { "id": 31, "tasks": ["14.2", "15.1", "15.3"] },
    { "id": 32, "tasks": ["15.2", "15.4"] },
    { "id": 33, "tasks": ["15.5"] },
    { "id": 34, "tasks": ["18.1", "19.1", "20.1", "21.1", "22.1"] },
    { "id": 35, "tasks": ["18.2", "19.2", "19.3", "20.2", "21.2"] },
    { "id": 36, "tasks": ["18.3", "19.4", "20.3", "21.3", "22.2"] },
    { "id": 37, "tasks": ["18.4", "20.4", "21.4", "22.3"] },
    { "id": 38, "tasks": ["18.5", "18.6"] },
    { "id": 39, "tasks": ["18.7", "18.8"] },
    { "id": 40, "tasks": ["18.9"] }
  ]
}
```
