# Implementation Plan: FormBridge Any Document

## Overview

The plan builds the Document_Path in TypeScript in the order the design's data path runs. A prerequisite gate and the OCR spike come first. One shared-file task follows, making every change to files that `accessforge-skeleton` also edits. Then come the pure logic in `src/lib/document/` (file recognition, geometry, the Document_Model, the Label_Classifier, the label review and the request builder), the thin browser services (decoding, the page pipeline, the OCR service), the session and wizard glue, the screens, and finally the Playwright, privacy, accessibility and real-OCR tests.

**Slices.** Every task and sub-task carries a Slice label that matches "Delivery slices" in requirements.md and design.md. Slice 1 (tasks 1 to 18) is the only slice needed for acceptance. Every Slice 1 sub-task is required, including every Slice 1 test. Slice 2 (tasks 19 to 24) is optional; its sub-tasks carry the optional marker `*`. No Slice 1 task depends on a Slice 2 task.

**Time estimate for Slice 1.** The estimate per group is in each group title. In working days:

| Group | Days |
|---|---|
| 1 Prerequisite gate | 0 (developer decisions) |
| 2 OCR spike and fixtures | 1.25 (plus developer time on real phones) |
| 3 Shared-file change | 1.25 |
| 4 File recognition and limits | 0.5 |
| 5 Geometry and Document_Model | 1 |
| 6 Answer_Areas and Label_Classifier | 1 |
| 7 Label review and request builder | 0.5 |
| 9 Browser services | 1 |
| 10 Session, wizard logic and read-aloud | 1 |
| 11 Screens | 1.5 |
| 13 End-to-end, privacy and accessibility tests | 1 |
| 14 Real-OCR tests | 0.25 |
| 15 Docs and human checks | 0.25 (plus developer time for sessions) |
| **Total with the cut order applied** | **10.5** |
| 17 Cut-order tasks (Answer_Sheet PDF, "Add another page", Share) | 0.75 |
| Total without the cut | 11.25 |

Slice 1 does not fit seven working days. The cut order from open decision 10 of requirements.md is therefore applied: the downloadable Answer_Sheet PDF (Print stays), "Add another page" for photos (Requirement 7.5, 7.6), and Share (Requirement 19.9) move to group 17, after the Slice 1 acceptance checkpoint. They remain Slice 1 requirements and are built only if time remains. No acceptance scenario depends on them. Even after the cut, the estimate is about 10.5 days, 3.5 days over the target. The requirements name no further cuts, so this plan does not choose any. The developer decides whether to accept the longer schedule or to move more Slice 1 requirements to Slice 2 (task 1.3 records the answer).

**Shared files.** Task 3 makes every change to the files that both specs change: `.kiro/steering/privacy.md`, every locale file, `src/worker/index.ts`, the AiProvider files, `src/shared/schemas.ts` and `src/shared/types.ts`, the country pack modules, `tests/e2e/upload.spec.ts`, `README.md` and `docs/accessibility-checklist.md`. Its sub-tasks are reviewed one by one and land in one commit. Some frontend files that AccessForge reuses also receive additive changes in later tasks: `src/frontend/state.ts`, `wizard-logic.ts`, `App.tsx`, `api.ts`, `screens/Upload.tsx`, `QuestionWizard.tsx`, `ReviewScreen.tsx`, `tokens.css`, `package.json`, `.gitignore` and `playwright.config.ts`. Each such task is marked **Shared file**: pull first, keep the change small, commit it on its own.

**AI and OCR in tests.** No task calls real AI. Every automated test uses the mock AiProvider. Playwright tests use a mock OCR result. Real OCR runs only in the spike (task 2.4) and in the real-OCR tests (task 14.1), started by hand with `npm run test:ocr`.

## Tasks

- [ ] 1. Prerequisite gate (Slice 1, 0 days of coding)
  - [ ] 1.1 Confirm that `accessforge-skeleton` Slice 1 is finished (Slice 1)
    - **Needs the developer.** Every Slice 1 task in `.kiro/specs/accessforge-skeleton/tasks.md` is checked, and `npx vitest --run` and `npm run test:e2e` pass on the current main branch.
    - Task 3 does not start until this is confirmed (design Q10, open decision 4).
    - _Requirements: 24.4, 24.5_
  - [ ] 1.2 Get the developer's approval of the Privacy_Steering wording (Slice 1)
    - **Needs the developer.** The developer approves, or edits, the proposed wording in design Q10 (open decision 3). Task 3.1 uses the approved text word for word.
    - Task 3 does not start until this is approved.
    - _Requirements: 24.4_
  - [ ] 1.3 Record the developer's answers to the open decisions that block tasks (Slice 1)
    - **Needs the developer.** Record each answer under "Open decisions" in design.md: 13 (file-chooser label, blocks 3.16 and 11.3), 14 (push-button-only PDFs, blocks 4.2), 15 (font requests in Original_Label_Mode, blocks 13.10), 16 (re-translation with a zero `contentHash`, blocks 11.10), 17 (digit rule V2, blocks 6.1), and whether the schedule above is accepted or more requirements move to Slice 2.
    - Decisions with a design proposal and no answer are taken as the proposal, and that is written next to the decision.
    - _Requirements: 2.2, 5.2, 11.2, 14.3_
  - [ ] 1.4 Capture the Fillable_Path golden request bodies (Slice 1)
    - Runs before any other code change of this spec. For each bundled fillable fixture, write the exact analyze request body that the current code sends to `tests/golden/fillable-analyze/<fixture>.json`.
    - `tests/unit/fillable-golden.test.ts`: the body built for each fixture is byte-identical to its golden file, and every precomputed fixture cache entry is found and passes schema validation.
    - _Requirements: 5.3_

- [ ] 2. OCR spike and fixtures (Slice 1, about 1.25 days plus developer phone time)
  - [ ] 2.1 Add the OCR engine and the asset copy step (Slice 1)
    - **Shared file:** `package.json`, `.gitignore`.
    - Add `tesseract.js` 7.x and the `eng` and `msa` language data packages, pinned to exact versions (design Research 1 and 2, Q5).
    - `scripts/copy-ocr-assets.ts`: copy `worker.min.js`, the four core builds and the language data into `public/ocr/<tesseract-version>/` and write `manifest.json` with path, bytes and SHA-256 per file. Run it from `predev` and `prebuild`. Add `public/ocr/` to `.gitignore`.
    - `public/_headers`: the `/ocr/*` block of design Q5. If the file already exists, append the block.
    - Add the `test:ocr` script, kept out of the default `npm test`.
    - Unit test: the manifest lists every copied file with its correct size and hash.
    - _Requirements: 8.1, 8.3, 8.8, 25.7_
  - [ ] 2.2 Write the document fixture generator (Slice 1)
    - **Shared file:** `package.json` (`generate-fixtures` also builds the document fixtures).
    - `scripts/create-fixtures/documents.ts` writes every Slice 1 fixture of Requirement 25.1 with synthetic content only: clean English and Malay printed forms as JPEG and PNG; a rotated photo with EXIF orientation 6 and one without a tag; a glary or blurred photo; a mixed PDF without fields (text pages and scanned pages); a 6-page PDF without fields; the prefilled sensitive form with the Canary_Values of design Q1 (one inside a ruled box, one inside an underline, `Nama: ZQXCOLON` after a colon); an RTF and a legacy `.doc` file; a file of 15,728,641 bytes; malformed and truncated PDF, JPEG and PNG files; the 2×1 px EXIF probe JPEG of design Q6.
    - Next to the fixtures, write the expected labels per fixture and the expected Page_Text_Source per page of the mixed PDF, for tests 2.4, 13.3 and 13.5.
    - `tests/unit/document-fixtures.test.ts`: two runs with no arguments write byte-identical files, and no fixture text contains a name or organisation outside the synthetic word list.
    - _Requirements: 25.1_
  - [ ] 2.3 Write the character error rate helper (Slice 1)
    - `tests/ocr/cer.ts`: Levenshtein distance divided by the expected length, after NFKC and whitespace collapsing, and the OCR_Validation_Bar check (at least 90% of expected labels each match one Text_Line at a CER of 10% or less).
    - Unit tests with fixed pairs, including an exact match, one substitution and an empty result.
    - _Requirements: 9.1_
  - [ ] 2.4 Run the desktop spike measurements (Slice 1)
    - `tests/ocr/ocr-spike.spec.ts`, run by hand only. In Playwright Chromium and Firefox, load Tesseract.js from `/ocr/` with `cacheMethod: 'none'` and `workerBlobURL: false`, and record: bytes served per asset for `best_int` and `fast`; that no request goes to another origin; recognition time per clean fixture at 2,200 px; the OCR_Validation_Bar result per label for `eng` and `msa`; word count and mean line confidence for the clean and the glary fixtures; the EXIF probe result per browser.
    - The spec prints a summary only. No raw OCR output is committed.
    - _Requirements: 8.1, 8.9, 9.1, 9.4_
  - [ ] 2.5 Run the phone and throttled measurements (Slice 1)
    - **Needs the developer** (real devices). On the reference mid-range Android phone with Chrome and on an iPhone with iOS 17 Safari: recognition time per clean page, the EXIF probe result, that the second Tesseract fetch is a cache hit, and that cancel responds within 1 second during recognition. On the DevTools "Slow 3G" preset: first-use time and the preset's actual values. On the deployed URL: whether `_headers` is honoured.
    - _Requirements: 8.4, 8.9_
  - [ ] 2.6 Fill in the OCR Spike Result in design.md (Slice 1)
    - Write the exact versions and licences, sizes, the chosen model variant by the rule in Q5, the timings table, the OCR_Validation_Bar results for English and Malay, the threshold values and the browser notes into the "OCR Spike Result" section. State whether Malay passes; Slice 1 offers Malay only if it does. Record any change to `OCR_MIN_WORDS` or `OCR_MIN_MEAN_CONFIDENCE`.
    - _Requirements: 8.9, 9.1, 26.4_

- [ ] 3. Shared-file change, landed as one commit (Slice 1, about 1.25 days)
  - [ ] 3.1 Update the Privacy_Steering (Slice 1)
    - **Shared file:** `.kiro/steering/privacy.md`. Use the wording approved in task 1.2, word for word.
    - _Requirements: 24.4_
  - [ ] 3.2 Update the privacy notices and add every new locale key (Slice 1)
    - **Shared file:** every locale file in `src/packs/language/locales/` (every Core_Language, plus `es` and any experimental file that already carries the FormBridge notice).
    - Rewrite `upload.privacyNotice` and `review.privacyNotice` as Requirement 24.5 states, keep the AccessForge notice keys as they are, and add a Label_Review notice key.
    - Add every `entry.*` and `document.*` key named in the design (entry buttons and help text, refusal messages, limits, page errors, OCR download and progress, language question, Retake_Advice, Label_Review, Original_Label_Mode, Fictional_Examples and help texts per answer type, read-aloud, leave-page warning, Answer_Sheet and Clerk_Summary). A later task that needs a key not listed here adds it in a small follow-up commit to every locale file.
    - _Requirements: 1.2, 23.10, 24.5, 24.6_
  - [ ] 3.3 Write the locale tests for the new keys (Slice 1)
    - `tests/unit/document-locales.test.ts`: every new key is non-empty in every Core_Language file; no `entry.*` string in `en` contains "upload", "PDF", "OCR", "file format" or "MIME" (case-insensitive); no `en` string about the Document_Path contains "accepts anything", "any document", "accurate" or "compliant", and the Document_Path description uses "helps you prepare your answers".
    - _Requirements: 1.2, 23.10, 28.2_
  - [ ] 3.4 Add the label schemas and types (Slice 1)
    - **Shared file:** `src/shared/schemas.ts`, `src/shared/types.ts`. Additions only.
    - `LABEL_ID_PATTERN`, `LabelAnswerTypeSchema`, `KeptLabelSchema`, `LabelAnalysisRequestSchema` (strict, with the uniqueness and id-consistency refinements), `LabelAnalysisSchema`, `LabelBatchReplyEnvelopeSchema`, `LabelAnalysisResponseSchema` and their inferred types, as in design "Data Models".
    - Unit tests: each bound of Requirement 13.2 on both sides, an extra key rejected, a mismatched Label_Id rejected.
    - _Requirements: 13.1, 13.2, 13.5, 13.6_
  - [ ] 3.5 Export the country pack patterns (Slice 1)
    - **Shared file:** `src/packs/country/my.ts`, `us.ts`, `universal.ts`, `dates.ts`. Export `MY_IC_PATTERN`, `MY_IC_SEARCH`, `US_SSN_SEARCH`, `EMAIL_SEARCH` and the `DATE_FORMATS` separators, with no behaviour change.
    - Unit tests: the unanchored search patterns find the value inside surrounding text, and the existing pack tests pass unchanged.
    - _Requirements: 11.2, 16.5_
  - [ ] 3.6 Move language and country detection into a shared module (Slice 1)
    - **Shared file:** `src/frontend/state.ts`. Move `combineVotes` to `src/lib/analysis/detection.ts` and import it back into `state.ts`. Behaviour unchanged; move its existing tests with it.
    - _Requirements: 10.4, 13.3_
  - [ ] 3.7 Add the `analyzeLabels` provider method and prompt (Slice 1)
    - **Shared file:** `src/lib/ai/interface.ts`, `cf-workers.ts`, `mock.ts`, `prompt.ts`.
    - `analyzeLabelsMessages`: system prompt with the data rule of design Q2; user message with `<form_data>` markers and `<` and `>` escaped as `\u003c` and `\u003e` inside the JSON.
    - `MockAiProvider.analyzeLabels`: the deterministic English and Malay keyword table, confidence 0.9 or 0.5, a `[demo]` question and a fixed fictional example per answer type. No call to Workers AI in mock mode.
    - `CfWorkersAiProvider.analyzeLabels`: the existing timeout and `max_completion_tokens: 2000`.
    - _Requirements: 13.3, 13.4, 13.12_
  - [ ] 3.8 Write the property test for prompt delimiting (Slice 1)
    - **Property 11: Prompt data delimiting round trip**
    - **Validates: Requirements 13.4**
    - In `tests/unit/analyze-labels.property.test.ts`, 100 runs, with label texts containing the markers, quotes, backslashes, newlines and instruction-like sentences.
  - [ ] 3.9 Write the property test for mock determinism (Slice 1)
    - **Property 31: Mock label analysis is deterministic**
    - **Validates: Requirements 13.12**
  - [ ] 3.10 Implement the label analysis runner (Slice 1)
    - `src/lib/analysis/run-labels.ts`: batches of 30 in page and reading order, one retry per batch after an invalid envelope or a timeout, `sanitizeLabelEntries` (drop unknown and duplicate ids and disallowed answer types; drop only a failing `explanation` or `example`), `failedLabelIds` for batches that failed twice, detection across batches through `detection.ts`, and the AI-unavailable or AI-timeout error when every batch failed.
    - _Requirements: 13.5, 13.6, 13.7, 13.11_
  - [ ] 3.11 Write the property test for reply sanitising (Slice 1)
    - **Property 12: Reply sanitising**
    - **Validates: Requirements 13.5, 13.6**
  - [ ] 3.12 Write the property test for batching and retry (Slice 1)
    - **Property 13: Batching and retry**
    - **Validates: Requirements 13.7, 13.11**
    - Scripted provider outcomes per call: valid, invalid envelope, timeout, quota.
  - [ ] 3.13 Add the `POST /api/documents/analyze-labels` route (Slice 1)
    - **Shared file:** `src/worker/index.ts` (one `ROUTES` entry with the 163,840-byte limit and `RATE_LIMITER_ANALYZE`).
    - `src/worker/routes/analyze-labels.ts`: body size check, `LabelAnalysisRequestSchema` with schema-path-only details, per-IP rate limit, Language_Registry check, `runAnalyzeLabels`, the shared error shape, and the existing `LogEntry` fields only.
    - Unit tests: success with the mock provider, and every Worker row of the design's error table.
    - _Requirements: 13.2, 13.3, 13.7, 24.3_
  - [ ] 3.14 Write the property test for invalid requests (Slice 1)
    - **Property 32: Invalid requests are rejected with schema paths only**
    - **Validates: Requirements 13.2, 13.13**
  - [ ] 3.15 Write the Worker canary tests (Slice 1)
    - `tests/unit/analyze-labels-canary.test.ts`: a Canary_Value label goes through the route with a recording logger, an invalid body, a provider that throws and a provider that times out. The canary is absent from every log entry and every response. A recording provider receives the canary only between the `<form_data>` markers, and receives no prefilled-fixture canary.
    - _Requirements: 13.13, 24.1, 24.3_
  - [ ] 3.16 Change the existing "no fields" upload test (Slice 1)
    - **Shared file:** `tests/e2e/upload.spec.ts`. The "no interactive form fields" rejection case now asserts routing to the Document_Path. Mark it `test.fixme` with the reason "pending task 11.4, Document_Path routing"; task 11.4 removes the marker. Apply the selector change of open decision 13 as answered in task 1.3, with no other assertion changed.
    - `tests/unit/rejection.test.ts` stays unchanged.
    - _Requirements: 2.4, 5.2_
  - [ ] 3.17 Update the README and the accessibility checklist (Slice 1)
    - **Shared file:** `README.md`, `docs/accessibility-checklist.md`.
    - README: the Document_Path privacy wording, identical to the Privacy_Notice; disclosure rows for Tesseract.js and each language data file with the version and licence recorded in task 2.6; a Document_Path section marked as in development until task 15.1.
    - Checklist: the six entries of Requirement 23.9, each marked "not yet run".
    - _Requirements: 23.9, 24.8, 28.4_

- [ ] 4. File recognition and limits (Slice 1, about 0.5 days)
  - [ ] 4.1 Add the limits module (Slice 1)
    - `src/lib/document/limits.ts` with every constant of design "Limits", including the note that the values may change after the phone tests.
    - _Requirements: 3.7_
  - [ ] 4.2 Implement the File_Sniffer (Slice 1)
    - `src/lib/document/sniff.ts`: `sniffHead` with the signature table of design Q6 (Slice 2 formats return `refused`), `classifyPdf` through the low-level `/AcroForm` lookup (never `getForm()`), and `sniffFile` reading at most 65,536 bytes for non-PDF files. The push-button rule follows the answer to open decision 14.
    - _Requirements: 2.1, 2.2, 2.6, 2.7, 2.8_
  - [ ] 4.3 Write the property test for sniffer totality and soundness (Slice 1)
    - **Property 3: The File_Sniffer is total, sound and ignores names**
    - **Validates: Requirements 2.1, 2.2, 2.7, 25.3**
    - In `tests/unit/document-sniff.property.test.ts`, 100 runs, including truncated and mutated copies of the fixtures.
  - [ ] 4.4 Write the property test for the bounded head read (Slice 1)
    - **Property 4: Sniffing a non-PDF reads a bounded head**
    - **Validates: Requirements 2.8**
  - [ ] 4.5 Write the sniffer example tests (Slice 1)
    - Every fixture kind, the 15 MB file and the file one byte over, the empty file, the push-button-only PDF, the encrypted PDF without fields, an XFA PDF, and a `getForm()` spy that is never called.
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
    - `src/lib/document/model.ts`: `buildPage` (sort, index, clamp boxes), `buildCandidates` (order, `textLang`, `checkYourself`), `labelIdOf`, `checkModel`, and `replacePage` for rotate and retake.
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7, 7.3, 9.5, 10.3_
  - [ ] 5.11 Write the property test for model invariants (Slice 1)
    - **Property 5: Document_Model invariants**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.6, 4.7, 25.4**
  - [ ] 5.12 Write the property test for stable Label_Ids (Slice 1)
    - **Property 6: Label_Ids are stable**
    - **Validates: Requirements 4.3, 25.4**
  - [ ] 5.13 Write the property test for page-local changes (Slice 1)
    - **Property 16: Page-local changes stay local**
    - **Validates: Requirements 7.3, 9.4**
    - Covers rotate and retake. The "Add another page" clause is added in task 17.4 with its feature.
  - [ ] 5.14 Write the property test for OCR quality marking (Slice 1)
    - **Property 21: OCR quality marking**
    - **Validates: Requirements 9.4, 9.5**
  - [ ] 5.15 Write the property test for the `lang` rule (Slice 1)
    - **Property 23: `lang` attribute rule**
    - **Validates: Requirements 10.3**

- [ ] 6. Answer_Areas and the Label_Classifier (Slice 1, about 1 day)
  - [ ] 6.1 Implement the label rules (Slice 1)
    - `src/lib/document/label-rules.ts`: NFKC and Unicode-digit normalisation, the label-ending colon rule, rules V1 to V9 and L1 to L3 with the exact patterns of design Q1, importing the pack pattern exports from task 3.5. Rule V2 follows the answer to open decision 17.
    - _Requirements: 11.2, 11.3, 11.4, 11.8, 11.10_
  - [ ] 6.2 Write one example test per rule (Slice 1)
    - `tests/unit/document-label-rules.test.ts`: one test per rule V1 to V9 and L1 to L3 with its exact pattern, including `10:30` (not a label colon), full-width digits and Tamil digits.
    - _Requirements: 11.8_
  - [ ] 6.3 Implement the Answer_Area detector (Slice 1)
    - `src/lib/document/answer-areas.ts`: `detectRuledAreas` on grey pixels (underline and box), `leaderAreas` and the after-colon area, with the thresholds of design Q1.
    - Unit tests on small synthetic grey images: an underline, a box, a line too short to count, a leader run.
    - _Requirements: 11.2, 11.3_
  - [ ] 6.4 Implement page classification (Slice 1)
    - `src/lib/document/classify.ts`: `classifyPage` (value rules first, the whole-line rule, the colon split), its zod self-check with the `classifier-failed` page status, and `isValueLikeText` for edits.
    - Unit tests: a throwing rule and a failing self-check give no candidate from that page and leave other pages unchanged.
    - _Requirements: 11.1, 11.5, 11.6, 11.9, 12.5_
  - [ ] 6.5 Write the property test for classification rules (Slice 1)
    - **Property 1: Classification is total, deterministic and follows the label rules**
    - **Validates: Requirements 11.1, 11.3, 11.4, 11.10**
    - In `tests/unit/document-classify.property.test.ts`.
  - [ ] 6.6 Write the property test for value exclusion (Slice 1)
    - **Property 2: No Label_Candidate contains a value part**
    - **Validates: Requirements 11.2, 11.5, 11.7, 11.9, 12.2**
    - Value generators include numbers that `validateMyPhone`, `validateUsPhone` and `validateInternationalPhone` accept, which also checks that V4 covers all three packs.
  - [ ] 6.7 Write the prefilled fixture classifier test (Slice 1)
    - Using the text layer and the mock OCR result of the prefilled sensitive fixture: first assert that each Canary_Value is present in the input, then that no Label_Candidate contains any of them.
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
    - From the prefilled sensitive fixture, build requests with the default selections and with every `likely-label` selected; no Canary_Value appears in any request.
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
    - `src/frontend/document/ocr.ts`: `pendingDownloadBytes`, `download` (fetch with progress, length and SHA-256 checked against the manifest, only verified files put into the `reforge-ocr-<version>` cache, 30-second stall notice while the download continues), `recognize` (dynamic `import()`, one worker created on first use and reused, paths under `/ocr/`), `cancel` (terminate and abort).
    - The test-only OCR result hook (`window.__REFORGE_TEST_OCR__`) is read only in the test build and stripped from production builds.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.8, 8.10_
  - [ ] 9.5 Write the OCR service unit tests (Slice 1)
    - With a fake `createWorker` and fake `fetch`: lazy creation, one worker reused, cancel terminates within the test clock's 2 seconds, only the chosen language listed, an aborted or hash-mismatched download leaves no cache entry, the stall notice at 30 seconds, cache keys only manifest paths, and a production-build check that the test hook is absent.
    - Static test: every `createWorker` call passes `workerPath`, `corePath` and `langPath` starting with `/ocr/`.
    - _Requirements: 8.1, 8.2, 8.3, 8.6, 8.8, 8.10, 24.9_

- [ ] 10. Session, wizard logic and read-aloud (Slice 1, about 1 day)
  - [ ] 10.1 Add the document session and Kept_Label mapping (Slice 1)
    - **Shared file:** `src/frontend/state.ts` (`origin`, `arrivalAnswer`, `document`; additions only).
    - `src/frontend/document/session.ts`: Kept_Labels to `FieldState` by the mapping table in design "Data Models"; the Original_Label_Mode analysis and `originalLabelQuestion(text, lang)`; Interface_Language, Form_Language and OCR_Language kept as separate settings; discard of the model, previews and answers on a new file.
    - _Requirements: 4.4, 4.5, 4.8, 10.1, 10.2, 13.8, 13.9, 14.2, 16.2_
  - [ ] 10.2 Extend the wizard logic (Slice 1)
    - **Shared file:** `src/frontend/wizard-logic.ts`. Add `documentReviewStatus`, `documentWizardTotal` and the undo rule. Existing exports keep their behaviour.
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
  - [ ] 10.9 Implement local voice matching and speech control (Slice 1)
    - `src/frontend/speech.ts`: `matchLocalVoice` with the table of Requirement 17.1, re-checked on `voiceschanged`; speak and cancel through `speechSynthesis` only.
    - Unit tests: cancel on step change, unmount and language change within 500 ms (fake timers); no `speechSynthesis` hides the control.
    - _Requirements: 17.1, 17.2, 17.3, 17.4_
  - [ ] 10.10 Write the property test for voice matching (Slice 1)
    - **Property 27: Local voice matching**
    - **Validates: Requirements 17.1, 17.2**
    - In `tests/unit/speech.property.test.ts`.
  - [ ] 10.11 Write the static validation-reuse test (Slice 1)
    - Fails when a module under `src/lib/document/` or `src/frontend/document/` defines an IC, phone, postcode, email or date pattern, or imports a validator other than `validateAnswer`; only `label-rules.ts` may import the pack pattern exports.
    - _Requirements: 16.1, 16.5_
  - [ ] 10.12 Implement the leave-page guard (Slice 1)
    - `src/frontend/document/leave-guard.ts`: `beforeunload` registered while an answer is non-empty or a Document_Model is loaded, removed when neither holds.
    - Unit test: register and remove on the matching state changes.
    - _Requirements: 20.1, 20.3_

- [ ] 11. Screens (Slice 1, about 1.5 days)
  - [ ] 11.1 Add the high-contrast option and Document_Path text scale (Slice 1)
    - **Shared file:** `src/frontend/tokens.css` and the tokens contrast test.
    - `:root[data-contrast='high']` values and `.document-flow` with `--text-scale: 1.25` under the large option, as in the design plan. Extend the contrast test to the high-contrast set (every text pair at least 7:1).
    - _Requirements: 23.2_
  - [ ] 11.2 Add the label analysis client (Slice 1)
    - **Shared file:** `src/frontend/api.ts`. Send the batches one after another with "part 2 of 3" progress; on network error, timeout, quota, rate limit or AI-unavailable, return a result that starts Original_Label_Mode with no automatic retry; `failedLabelIds` and missing ids go to Original_Label_Mode as type `text`.
    - Unit tests for each failure kind and for a partial failure.
    - _Requirements: 13.8, 14.1_
  - [ ] 11.3 Build the Entry_Screen and the refusal message (Slice 1)
    - **Shared file:** `src/frontend/screens/Upload.tsx`, `src/frontend/App.tsx`.
    - `EntryButtons.tsx`: two labelled file inputs (camera with `accept="image/*"` and `capture`; file with no `accept` and no `capture`), at least 64 px tall, focus returned after a cancelled picker; the sample-form link after both, in a quieter style; the handwriting line; the privacy notice; the help text with the tested input kinds in plain words.
    - Routing through `sniffFile`: `fillable-pdf` to the existing flow unchanged, `refused` and `unknown` to the refusal message with the camera control, the 15 MB check.
    - Component tests for each criterion.
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 2.3, 2.5, 3.1, 24.6, 28.1, 28.3_
  - [ ] 11.4 Build the document reading screen (Slice 1)
    - `DocumentReading.tsx` inside `.document-flow`: the 5-page choice, skipped-page and failed-page messages with "continue without this page" and "take a photo of this page instead", whole-file decode and encryption messages, the slow-page notice with "Keep waiting" and "Stop".
    - **Shared file:** `tests/e2e/upload.spec.ts`: remove the `test.fixme` marker added in task 3.16, now that routing reaches this screen.
    - _Requirements: 2.4, 3.2, 3.3, 3.6, 3.8, 6.5, 6.7_
  - [ ] 11.5 Build the language question and OCR progress (Slice 1)
    - `OcrLanguageQuestion.tsx`: Validated_OCR_Languages by native name with `lang`, "Another language" with the "not yet" message, the handwriting line; the choice sets OCR_Language and the initial Form_Language.
    - In `DocumentReading.tsx`: the one-time download notice with the size from the manifest, progress in megabytes, "Reading page 2 of 3", cancel, the load-failed, needs-connection and unsupported-browser messages; a live-region announcer throttled to one message per page change and per 25% of the download.
    - _Requirements: 8.5, 8.6, 8.7, 8.10, 9.2, 9.3, 9.7, 14.5, 14.6, 23.11_
  - [ ] 11.6 Build the page preview, rotate control and Retake_Advice (Slice 1)
    - `RotateControl.tsx` (44 px, 90 degrees per press, page rebuilt through `replacePage`), the preview step for photos, `RetakeAdvice.tsx` (one sentence, retake that replaces only that page, rotate, "Continue with what was read"), and the "We found no labels" screen.
    - _Requirements: 7.2, 7.3, 9.4, 12.10_
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
  - [ ] 11.10 Build the document settings and connect the review to the wizard (Slice 1)
    - `DocumentSettings.tsx`: Form_Country choice with "none of these" for the `universal` pack, and Form_Language choice, for Original_Label_Mode; reuse the existing confirmation screen for low-confidence detection after label analysis.
    - Confirming the Label_Review calls the client of task 11.2 or starts Original_Label_Mode; the Answer_Sheet font is fetched into memory here. Re-translation after a language switch follows the answer to open decision 16.
    - _Requirements: 10.4, 10.5, 10.6, 12.9, 13.8, 14.1_
  - [ ] 11.11 Extend the Question_Wizard for document fields (Slice 1)
    - **Shared file:** `src/frontend/screens/QuestionWizard.tsx`. Everything renders only when `field.origin` is set: the original label with `lang` and page number, the machine-translated label, `CheckYourself.tsx`, `FictionalExample.tsx`, `HelpPanel.tsx` ("I do not know": explanation, skip, ask someone you trust, nothing sent), undo, `ReadAloudButton.tsx`, the Original_Label_Mode notice and question, the sticky Back control, the refresh warning on the first step, and an empty input unless answered before. Validation through `validateAnswer` with `aria-describedby`, `aria-live` and `aria-invalid`.
    - _Requirements: 13.10, 14.2, 14.4, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 16.1, 16.3, 17.5, 20.4, 23.3_
  - [ ] 11.12 Extend the Review_Screen for document fields (Slice 1)
    - **Shared file:** `src/frontend/screens/ReviewScreen.tsx`. Rows with original text and `lang`, page number, Page_Crop, question, answer and one status; edit per row, also for skipped rows; "Make my answer sheet" disabled with a reason while an answer awaits validation; the privacy notice including the "nothing was sent" variant.
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
  - [ ] 11.17 Write the component tests for the new screens (Slice 1)
    - Answer_Sheet: every row has a `th` and `td` pair, every foreign-language element has `lang`, nothing is truncated. Question_Wizard and Review_Screen: no document-only element renders for a Fillable_Path field. Status elements carry text and an icon.
    - _Requirements: 5.1, 19.7, 23.5_

- [ ] 12. Checkpoint: screens in place (Slice 1)
  - Run `npx vitest --run` and `npm run test:e2e`. Ensure all tests pass, ask the user if questions arise.

- [ ] 13. End-to-end, privacy and accessibility tests (Slice 1, about 1 day)
  - [ ] 13.1 Add the mobile project and the mock OCR helpers (Slice 1)
    - **Shared file:** `playwright.config.ts`. Add `mobile-chromium` (Pixel 7 descriptor, 360×640 viewport, touch).
    - `tests/e2e/helpers/document.ts`: inject mock OCR results per fixture through the test hook, record every request URL, header and body, and scan browser storage.
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
    - `tests/e2e/document-privacy.spec.ts`: runs twice, through AI and in Original_Label_Mode. No Canary_Value in any request URL, header or body, except a typed description canary in the one translate request after the press; every request goes to the app's own origin; localStorage, sessionStorage, every IndexedDB database, cookies, Cache Storage (only `reforge-ocr-*` with manifest paths), the URL and `history.state` hold no canary.
    - _Requirements: 4.4, 8.8, 19.11, 20.2, 20.5, 20.6, 24.1, 24.2, 24.7, 24.9, 27.7_
  - [ ] 13.8 Write scenario 9: unsupported file (Slice 1)
    - `tests/e2e/document-refused.spec.ts`: the RTF and `.doc` fixtures show the refusal message and the photo suggestion.
    - _Requirements: 2.5, 27.8_
  - [ ] 13.9 Write scenario 10, automated part: first-time user on a phone (Slice 1)
    - `tests/e2e/document-mobile.spec.ts` on `mobile-chromium` in `zh-Hans`: scenario 2 using only the entry buttons and wizard controls; every primary control measures at least 44 by 44 px and the entry buttons at least 64 px tall; the Back control is visible without scrolling; no horizontal scrolling.
    - _Requirements: 1.1, 15.2, 23.1, 23.7, 27.9_
  - [ ] 13.10 Write the offline and throttled-download tests (Slice 1)
    - `tests/e2e/document-network.spec.ts`: after the Label_Review, `context.setOffline(true)`, then the wizard, Review_Screen and Answer_Sheet complete in Original_Label_Mode with no request attempted (within the answer to open decision 15); with a CDP "Slow 3G" throttle, the download notice shows the size, progress advances, and cancel returns to the Entry_Screen within 2 seconds.
    - _Requirements: 8.5, 8.6, 14.3_
  - [ ] 13.11 Write the axe checks for every new screen (Slice 1)
    - `tests/e2e/document-accessibility.spec.ts`: tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, in `en` and `zh-Hans`, failing on any violation, on every screen of Requirement 23.8, plus a keyboard-only pass through scenario 2 with focus moving to each new heading, and the high-contrast and larger-text options on.
    - _Requirements: 23.2, 23.3, 23.4, 23.7, 23.8_

- [ ] 14. Real-OCR tests (Slice 1, about 0.25 days)
  - [ ] 14.1 Write the real-OCR tests (Slice 1)
    - `tests/ocr/real-ocr.spec.ts`, run by `npm run test:ocr`: real Tesseract.js from `/ocr/` on the clean English photo, the rotated fixtures and the glary or blurred fixture (and Malay when enabled). Fails when the clean fixture is below the OCR_Validation_Bar; asserts a Low_Quality_Page for the glary fixture; prints timings.
    - _Requirements: 25.5_
  - [ ] 14.2 Record the real recognition timings (Slice 1)
    - Run task 14.1 on the desktop and write the measured timings into the OCR Spike Result table in design.md. Phone timings come from the developer's runs in task 2.5. Record any threshold change with its reason.
    - _Requirements: 8.9, 25.5, 26.4_

- [ ] 15. Docs and human checks (Slice 1, about 0.25 days plus developer time)
  - [ ] 15.1 Finish the README Document_Path section (Slice 1)
    - **Shared file:** `README.md`. The tested input kinds, the Validated_OCR_Languages from task 2.6, handwriting not supported, the untagged PDF note, other inputs and languages marked not supported; remove the "in development" mark only after task 16 passes.
    - `tests/unit/readme-ocr-languages.test.ts`: fails when the README's OCR language list differs from the offered Validated_OCR_Languages. Extend the phrase scan of task 3.3 to the README text about the Document_Path.
    - _Requirements: 24.8, 28.1, 28.2, 28.3_
  - [ ] 15.2 Run the manual accessibility checks (Slice 1)
    - **Needs the developer.** Fill in the six entries of Requirement 23.9 in `docs/accessibility-checklist.md` with pass or fail and the date.
    - _Requirements: 23.9_
  - [ ] 15.3 Create the Usability_Test_Record template (Slice 1)
    - `docs/usability-test-record.md`: the completion bar, the per-session fields of Requirement 26.2, participant codes only, and the help definition. No results are written by this task.
    - _Requirements: 26.1, 26.2, 26.3, 26.5_
  - [ ] 15.4 Run the sessions with three representative users (Slice 1)
    - **Needs the developer. Human task, not a coding task.** At least three participants aged 60 or over, or who rarely use apps beyond calls and messaging, complete scenario 2 on a phone with synthetic forms. Record each session and whether the bar was met, with no rounding up. If the bar is not met, list the changes and at least one further session. Any limit or threshold changed afterwards is recorded in design.md.
    - _Requirements: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6_
  - [ ] 15.5 Add Kiro usage log rows for features actually used (Slice 1)
    - **Shared file:** `docs/kiro-usage-log.md`. One row per real use: this spec, each property test that found a bug (with the regression test name and seed), and any hook, steering or MCP use during these tasks. Record only what happened.
    - _Requirements: 28.4_

- [ ] 16. Final Slice 1 acceptance checkpoint (Slice 1)
  - Run `npx vitest --run`, `npm run test:e2e` (scenarios 1, 2, 3, 4, 5, 7, 8, 9 and the automated part of 10, plus the unchanged fillable `MY` and `US` scenarios and the golden test of task 1.4) and `npm run test:ocr`. Confirm task 15.4 records the completion bar result. Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Cut-order tasks, built only if time remains (Slice 1)
  - [ ] 17.1 Add the Answer_Sheet PDF download (Slice 1, cut candidate 1)
    - `src/frontend/document/answer-sheet-pdf.ts`: pdf-lib with fontkit and the bundled Noto Sans, A4, 14 pt body, 18 pt heading, wrapped lines, page numbers; glyph check on every code point; the button hidden with `document.sheet.pdfNotAvailable` for non-Latin Form_Languages or missing glyphs; rebuilt on each press.
    - _Requirements: 19.6, 19.10, 19.11_
  - [ ] 17.2 Write the property test for PDF read-back (Slice 1, cut candidate 1)
    - **Property 29: Answer_Sheet PDF read-back**
    - **Validates: Requirements 19.6**
    - 25 runs, stated in the test tag.
  - [ ] 17.3 Add "Add another page" for photos (Slice 1, cut candidate 2)
    - `appendPage` in `model.ts`; the control while fewer than 5 pages; refusal of a large, undecodable or non-photo file with the matching message, leaving existing pages unchanged.
    - _Requirements: 7.5, 7.6_
  - [ ] 17.4 Extend the page-local property test with appending (Slice 1, cut candidate 2)
    - **Property 16: Page-local changes stay local** (the "Add another page" clause)
    - **Validates: Requirements 7.5**
  - [ ] 17.5 Add Share for the Answer_Sheet (Slice 1, cut candidate 3)
    - Share the PDF when `navigator.canShare({ files })` is true, otherwise the plain text; hidden without Web Share; a cancelled share shows no message.
    - _Requirements: 19.5, 19.9_

- [ ] 18. Checkpoint: cut-order tasks (Slice 1)
  - Run `npx vitest --run` and `npm run test:e2e`, including the axe check on the Answer_Sheet with the new controls. Ensure all tests pass, ask the user if questions arise.

- [ ] 19. Additional input formats (Slice 2)
  - [ ]* 19.1 Recognise WebP, HEIC, SVG, DOCX and TXT in the File_Sniffer (Slice 2)
    - _Requirements: 2.6_
  - [ ]* 19.2 Decode WebP (Slice 2)
    - `src/frontend/document/decode-webp.ts`, within the pixel limit.
    - _Requirements: 21.1_
  - [ ]* 19.3 Decode HEIC with a self-hosted converter (Slice 2)
    - `decode-heic.ts`, converter loaded from the app's origin only for `heic`, EXIF once, two synthetic iPhone photo fixtures.
    - _Requirements: 21.2_
  - [ ]* 19.4 Sanitise and rasterise SVG (Slice 2)
    - `svg-sanitize.ts`: remove scripts, event handlers, external references and `foreignObject`; no network request.
    - _Requirements: 21.3_
  - [ ]* 19.5 Write the SVG sanitiser property test (Slice 2)
    - For any generated SVG, no script, event handler, external reference or `foreignObject` survives.
    - _Requirements: 21.3_
  - [ ]* 19.6 Read DOCX text with size limits (Slice 2)
    - `src/lib/document/docx.ts`: paragraph and table text in order, limits on entry count, uncompressed size and ratio; the Word file is never modified.
    - _Requirements: 21.4_
  - [ ]* 19.7 Write the DOCX limit tests (Slice 2)
    - Zip-bomb and oversized entry fixtures stop reading with the decode message.
    - _Requirements: 21.4_
  - [ ]* 19.8 Read TXT files (Slice 2)
    - `src/lib/document/txt.ts`: UTF-8 only, one Text_Line per non-empty line up to the design's line limit.
    - _Requirements: 21.5_
  - [ ]* 19.9 Extend the sniffer property generators (Slice 2)
    - **Property 3: The File_Sniffer is total, sound and ignores names** (malformed and oversized cases of each delivered format)
    - **Validates: Requirements 21.6**

- [ ] 20. Photo-quality checks and crop (Slice 2)
  - [ ]* 20.1 Implement local photo-quality checks (Slice 2)
    - `src/lib/document/photo-quality.ts`: blur, darkness, glare and small text, one instruction at a time, continue allowed.
    - _Requirements: 22.1_
  - [ ]* 20.2 Write the photo-quality canary test (Slice 2)
    - Nothing from the checks is sent anywhere.
    - _Requirements: 22.5_
  - [ ]* 20.3 Build the crop tool (Slice 2)
    - `CropTool.tsx`: 44 px handles moved by arrow keys; applying a crop recognises the page again.
    - _Requirements: 22.2_
  - [ ]* 20.4 Write the crop tool tests (Slice 2)
    - Keyboard movement, re-recognition, and the axe check.
    - _Requirements: 22.2, 22.5_

- [ ] 21. More OCR languages (Slice 2)
  - [ ]* 21.1 Generate Chinese and Tamil printed form fixtures (Slice 2)
    - _Requirements: 25.6_
  - [ ]* 21.2 Measure `chi_sim`, `chi_tra` and `tam` against the OCR_Validation_Bar (Slice 2)
    - Record per-language quality and warning text in design.md.
    - _Requirements: 9.6_
  - [ ]* 21.3 Offer each language that passes, with its warnings (Slice 2)
    - _Requirements: 9.6_
  - [ ]* 21.4 Write scenario 6 (Slice 2)
    - Chinese and Tamil fixtures show the quality warnings.
    - _Requirements: 27.10_

- [ ] 22. Advanced recovery (Slice 2)
  - [ ]* 22.1 Re-read one page with another Validated_OCR_Language (Slice 2)
    - _Requirements: 22.3_
  - [ ]* 22.2 Move a page to another position (Slice 2)
    - _Requirements: 22.3_
  - [ ]* 22.3 Confirm before discarding answers (Slice 2)
    - State how many answers would be discarded and wait for confirmation.
    - _Requirements: 22.4_
  - [ ]* 22.4 Write the recovery tests (Slice 2)
    - Answers kept for unchanged Label_Id and text; the discard count; the canary test.
    - _Requirements: 22.3, 22.4, 22.5_

- [ ] 23. Overlay and non-Latin Answer_Sheet PDF (Slice 2)
  - [ ]* 23.1 Build the Overlay (Slice 2)
    - `Overlay.tsx`: the user places each answer, a preview before download, no claim of automatic placement.
    - _Requirements: 19.8_
  - [ ]* 23.2 Add CJK and Tamil Answer_Sheet PDF output (Slice 2)
    - Reuse the CJK subsetting of `formbridge-pdf`; Tamil after its shaping check.
    - _Requirements: 19.6_
  - [ ]* 23.3 Write the Overlay and non-Latin PDF tests (Slice 2)
    - _Requirements: 19.6, 19.8_

- [ ] 24. Checkpoint: Slice 2 (Slice 2)
  - Run `npx vitest --run`, `npm run test:e2e` and `npm run test:ocr`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Slice 1 sub-tasks have no optional marker: every Slice 1 test, including every property test, is required. Slice 2 sub-tasks carry `*` because the whole slice is optional.
- Each correctness property of design.md has exactly one property test sub-task in Slice 1, with at least 100 runs (Property 29: 25 runs) and the tag `// Feature: formbridge-any-document, Property {n}: {property title}`. Property 16 is split: task 5.13 covers rotate and retake, task 17.4 adds the append clause with its feature. Task 19.9 extends Property 3 for Slice 2 formats.
- Tasks marked **Needs the developer** (1.1, 1.2, 1.3, 2.5, 15.2, 15.4) cannot be done by code. Task 15.4 is a human study with three people.
- No task calls real AI. Real OCR runs only in tasks 2.4 and 14.1. No raw OCR output, model output, personal data or secrets are committed.
- Open decisions 8 (instruction lines as context) and 9 (choice questions) have no tasks; the design places both in Slice 2 pending the developer's choice.
- The dependency graph below lists leaf sub-tasks only. Checkpoints 8, 12, 16, 18 and 24 run after the waves that finish their groups.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "2.1", "2.3"] },
    { "id": 1, "tasks": ["2.2"] },
    { "id": 2, "tasks": ["2.4"] },
    { "id": 3, "tasks": ["2.5"] },
    { "id": 4, "tasks": ["2.6", "3.1", "3.2", "3.4", "3.5", "3.6"] },
    { "id": 5, "tasks": ["3.3", "3.7", "3.16", "3.17", "4.1"] },
    { "id": 6, "tasks": ["3.8", "3.10", "4.2", "4.6", "5.1"] },
    { "id": 7, "tasks": ["3.9", "3.13", "4.3", "5.2", "5.5"] },
    { "id": 8, "tasks": ["3.11", "3.15", "4.4", "5.3", "5.6"] },
    { "id": 9, "tasks": ["3.12", "4.5", "5.4", "5.9", "6.1"] },
    { "id": 10, "tasks": ["3.14", "5.7", "6.2", "6.3"] },
    { "id": 11, "tasks": ["5.8", "5.10", "6.4"] },
    { "id": 12, "tasks": ["5.11", "6.5", "7.1", "9.1"] },
    { "id": 13, "tasks": ["5.12", "6.6", "7.2", "7.3", "9.4"] },
    { "id": 14, "tasks": ["5.13", "6.7", "7.4", "9.2", "9.5"] },
    { "id": 15, "tasks": ["5.14", "7.5", "9.3", "10.1"] },
    { "id": 16, "tasks": ["5.15", "10.2", "10.9", "10.12"] },
    { "id": 17, "tasks": ["10.3", "10.10", "10.11", "11.1", "11.2"] },
    { "id": 18, "tasks": ["10.4", "11.3"] },
    { "id": 19, "tasks": ["10.5", "11.4"] },
    { "id": 20, "tasks": ["10.6", "11.5", "11.7"] },
    { "id": 21, "tasks": ["10.7", "11.6", "11.13"] },
    { "id": 22, "tasks": ["10.8", "11.8", "11.14"] },
    { "id": 23, "tasks": ["11.9", "11.10", "11.15"] },
    { "id": 24, "tasks": ["11.11", "11.16"] },
    { "id": 25, "tasks": ["11.12"] },
    { "id": 26, "tasks": ["11.17"] },
    { "id": 27, "tasks": ["13.1"] },
    { "id": 28, "tasks": ["13.2", "13.3", "13.4", "13.5", "13.6", "13.7", "13.8", "13.9", "13.10", "13.11", "14.1"] },
    { "id": 29, "tasks": ["14.2", "15.1", "15.2", "15.3"] },
    { "id": 30, "tasks": ["15.4"] },
    { "id": 31, "tasks": ["15.5"] },
    { "id": 32, "tasks": ["17.1", "17.3"] },
    { "id": 33, "tasks": ["17.2", "17.4", "17.5"] },
    { "id": 34, "tasks": ["19.1", "20.1", "21.1", "22.1", "23.1"] },
    { "id": 35, "tasks": ["19.2", "20.2", "20.3", "21.2", "22.2"] },
    { "id": 36, "tasks": ["19.3", "20.4", "21.3", "22.3", "23.2"] },
    { "id": 37, "tasks": ["19.4", "21.4", "22.4", "23.3"] },
    { "id": 38, "tasks": ["19.5", "19.6"] },
    { "id": 39, "tasks": ["19.7", "19.8"] },
    { "id": 40, "tasks": ["19.9"] }
  ]
}
```
