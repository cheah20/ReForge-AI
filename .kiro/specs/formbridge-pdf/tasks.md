# Implementation Plan: FormBridge PDF

## Overview

Build the FormBridge PDF module of ReForge AI: a browser-based form assistant that reads AcroForm PDFs, guides users through each field one at a time in their chosen language, validates answers using country-specific rules, and produces a filled PDF — all without uploading the PDF or answers to the backend.

**Order:** scaffold → shared schemas → Latin fixtures → extraction → minimal Worker with AI binding → Spike 1 (model comparison) → Spike 2 (CJK font prototype) → fill → validation → frontend → accessibility → e2e tests → milestone 1 deploy → US/CJK → milestone 2 deploy.

## Prerequisites

Before starting tasks that require Cloudflare access (Spike 1 — task 13, fixture cache — task 17, deploy — task 37), confirm:
- A Cloudflare account with Workers AI available (free plan is sufficient)
- `wrangler login` completed (or a `CLOUDFLARE_API_TOKEN` env var set)
- Workers AI binding accessible in `wrangler dev`

Tasks that require Cloudflare access are marked **[needs CF access]**. Ask the developer to confirm Cloudflare access before starting those tasks.

## Milestones

- **Milestone 1 — Nov 17:** tasks 1–36 (Nov 17 e2e), then task 37.1 (Malaysian fixture cache) and task 37.2 (deploy + smoke test). Delivers the Chinese → Malaysian clinic form scenario end-to-end on a live public URL.
- **Milestone 2 — Dec 1:** tasks 38–42 (US scenario, CJK if Spike 2 passed), task 43 (README and disclosure). Delivers Spanish → US clinic form and CJK PDF output.

## Tasks

- [ ] 1. Kiro hooks setup
  - [ ] 1.1 Create a PostFileSave hook that runs `vitest run --reporter=verbose` scoped to the changed file's test counterpart when any `src/**/*.ts` or `src/**/*.tsx` file is saved; surface failures in the Kiro panel
    - _Requirements: tech.md (Vitest)_
  - [ ] 1.2 Create a PostFileSave hook that, when `src/packs/language/locales/en.json` is saved, diffs its keys against every other core locale file, lists missing or changed keys, and auto-updates core locale files with machine-translated placeholder values (labelled `[MT]` so translators can find them)
    - _Requirements: 2-L.1, 2-L.6_
  - [x] 1.3 Create a PreToolUse (or manual trigger) hook that checks staged files for: secrets or API key patterns, files named `local-*`, files from `.local/`, and non-English text in source code, comments, or docs (locale files and `fixtures/` are exempt); block commit and report violations
    - _Requirements: local-kiroween-rules.md_

- [ ] 2. MCP configuration
  - [ ] 2.1 Add Context7 MCP server to `.kiro/settings/mcp.json` for up-to-date documentation for pdf-lib, pdf.js, Cloudflare Workers, and Workers AI; record the first real usage (e.g. "looked up pdf-lib AcroForm API") as a row in `docs/kiro-usage-log.md`
    - _Requirements: tech.md_

- [x] 3. Repository scaffold
  - [x] 3.1 Initialise single-package layout (no npm workspaces): root `package.json`, `vite.config.ts` using `@cloudflare/vite-plugin`, `wrangler.toml` with `compatibility_date` + Workers AI binding + rate-limiting binding, `tsconfig.json` (strict, path aliases for `src/`), `vitest.config.ts` (jsdom for frontend tests, node for worker tests), `playwright.config.ts` (Chromium + Firefox, `axe-playwright`), `.env.example`; create `fixtures/`, `scripts/create-fixtures/`, `src/worker/`, `src/frontend/`, `src/shared/`, `src/packs/`, `src/lib/` directories
    - _Requirements: tech.md_
  - [x] 3.2 Add root `README.md` stub: setup steps (`git clone` → `npm install` → `wrangler login` → `npm run dev`), `Pre-existing code disclosure` section placeholder; add `scripts/generate-fixture-cache.ts` stub (runnable, exits 0 with a "not yet implemented" message)
    - _Requirements: tech.md_

- [x] 4. Shared Zod schemas
  - [x] 4.1 Create `src/shared/schemas.ts` with all schemas from design.md §Zod schemas: `FieldOptionSchema`, `WidgetSchema`, `FieldEvidenceSchema`, `FieldAnalysisSchema`, `AnalyzeRequestSchema` (includes `contentHash`), `AnalyzeResponseSchema`, `RetranslateRequestSchema` (includes `contentHash`), `RetranslateResponseSchema`, `TranslateRequestSchema`, `TranslateResponseSchema`, `ApiErrorSchema` — all string and array bounds enforced
    - _Requirements: 4.1, 5.1, 5.4, 5.5_
  - [x] 4.2 Create `src/shared/types.ts` — TypeScript types via `z.infer<>` for all schemas
    - _Requirements: 4.1, 5.4_
  - [x] 4.3 Write unit tests confirming schema acceptance and rejection at boundary values (fieldId at 256/257 chars, humanLabel at 40/41 chars, question at 120/121 chars, fields array at 30/31 items)
    - _Requirements: 5.1, 5.4_

- [x] 5. Language registry and locale files
  - [x] 5.1 Create `src/packs/language/registry.ts` — `LanguageEntry` interface (tag, nativeName, direction, uiFontFamily, pdfFontFamily, status, modelLanguageName) and registry array for all Nov 17 languages: `en`, `ms`, `zh-Hans`, `zh-Hant`, `ta`, `es` (core), `id` (experimental)
    - _Requirements: 2-L.1, 2-L.2, 2-L.5_
  - [x] 5.2 Create `src/packs/language/locales/en.json` with all UI string keys; create `ms.json`, `zh-Hans.json`, `zh-Hant.json`, `ta.json`, `es.json` with all keys translated; create `id.json` with partial keys (fallback to English for missing)
    - _Requirements: 1.4, 2-L.1, 2-L.5_
  - [x] 5.3 Create React i18n provider (`src/frontend/i18n.tsx`): `useTranslation()` hook, fallback to `en.json` for missing keys, `<html lang={tag}>` update, lazy Noto font load per script on language selection
    - _Requirements: 2-L.1, 2-L.3, 13.4_

- [x] 6. Country pack registry
  - [x] 6.1 Create `src/packs/country/interface.ts` (`ValidationResult`, `CountryPack` interface) and `src/packs/country/registry.ts` (registry map, `getCountryPack()` with universal fallback)
    - _Requirements: 3-C.1_
  - [x] 6.2 Create `src/packs/country/universal.ts` — international phone via `libphonenumber-js`, email, permissive date, permissive postcode
    - _Requirements: 3-C.2_
  - [x] 6.3 Write unit tests for the universal pack: valid/invalid email, international phone acceptance, date parsing both formats
    - _Requirements: 3-C.2_

- [ ] 7. Latin-script fixtures
  - [x] 7.1 Create `fixtures/clinic-registration.pdf` — synthetic Malay-language AcroForm (~22 fields): text (name, IC, phone, email, address, postcode), date, radio groups, checkboxes, dropdown, free-text description, empty `/Sig` field; all labels and nearby text in Malay; no real org names or logos
    - _Requirements: 14.1_
  - [x] 7.2 Create `fixtures/school-enrolment.pdf` — synthetic bilingual EN/MS AcroForm: at least one field of each supported type (text, checkbox, radio, dropdown, signature); label some in English, some in Malay
    - _Requirements: 14.2_
  - [x] 7.3 Create `fixtures/no-fields.pdf`, `fixtures/xfa-acroform.pdf`, `fixtures/sig-empty.pdf`, `fixtures/sig-populated.pdf`, `fixtures/prefilled-field.pdf`; create dev script `scripts/create-fixtures/encrypted.ts` + commit `fixtures/encrypted.pdf`
    - _Requirements: 14.3, 14.4, 14.5, 14.6, 14.7, 14.10_
  - [x] 7.4 Create `fixtures/us-community-clinic.pdf` — synthetic English-language US AcroForm: name, phone, ZIP, email, date (MM/DD/YYYY), SSN field; no real agency names
    - _Requirements: 14.9_

- [x] 8. PDF rejection checks
  - [x] 8.1 Create `src/lib/pdf-extract/rejection.ts` — all eight rejection checks in order: size > 10 MB → `TOO_LARGE`; load with `ignoreEncryption: true`, check `isEncrypted` → `ENCRYPTED`, load throws → `INVALID_PDF`; `/XFA` non-empty → `XFA`; pages > 20 → `TOO_MANY_PAGES`; fields > 150 → `TOO_MANY_FIELDS`; `/Sig` widget with value → `SIGNED`; fields === 0 → `NO_FIELDS`
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 8.2 Wire rejection into `src/lib/pdf-extract/index.ts` — `extractFields(pdfBytes: ArrayBuffer): Promise<ExtractionResult>`
    - _Requirements: 1.3, 1.4_
  - [x] 8.3 Write unit tests for each rejection code using fixtures; test > 10 MB fake buffer and non-PDF buffer; confirm `fixtures/sig-empty.pdf` is NOT rejected
    - _Requirements: 1.3_

- [x] 9. Field evidence extraction
  - [x] 9.1 Create `src/lib/pdf-extract/acroform.ts` — fully qualified field names, inherited attributes, widget grouping into `widgets[]`, `/Opt` parsing for both string-array and `[exportValue, displayLabel]` forms, multiline flag, `hasValue` for `/Sig`, required/readOnly flags, list boxes as dropdown
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 9.2 Create `src/lib/pdf-extract/page-text.ts` — per-widget `pageSnippet`: `PDFPageProxy.getTextContent()`, Euclidean distance sort, concatenate nearest items up to 200 chars; **exclude text drawn by form widget annotations** (existing field values must not appear in the snippet, so they are never sent to the AI)
    - _Requirements: 4.1, 4.5, 11.1_
  - [x] 9.3 Integrate into `src/lib/pdf-extract/index.ts`: compute SHA-256 once via Web Crypto API, assemble `ExtractionResult` with `fileHash` and `pageCount`
    - _Requirements: 4.1, 5.8_
  - [x] 9.4 Write unit tests for extraction using `fixtures/clinic-registration.pdf` and `fixtures/school-enrolment.pdf`: verify field count, names, widget grouping, `pageSnippet` presence, correct `fieldType` per type; **write a test that a prefilled fixture field's value never appears in the `pageSnippet` or in any `FieldEvidence` property** (privacy test)
    - _Requirements: 4.1, 11.1_

- [x] 10. Extraction property tests
  - [x] 10.1 Write Property 1 (field completeness) test using fast-check: run `extractFields` on `fixtures/clinic-registration.pdf`, then feed the real extracted field IDs into a generated `AnalyzeResponse`; for any such response, every extracted field is either mapped or fill-yourself — none silently dropped. The generator must produce omissions to allow the property to fail.
    - **Property 1: Field completeness — no silent drops**
    - **Validates: Requirements 5.5, 6.2, 15.1**
  - [x] 10.2 Write Property 7 (page snippet length) test using fast-check: generate arbitrary pdf.js text content arrays and widget bboxes; the returned `pageSnippet` is always ≤ 200 characters
    - **Property 7: Page snippet length invariant**
    - **Validates: Requirements 4.5**
  - [x] 10.3 Write Property 8 (batch count) test using fast-check: implement `batchFields(fields, 30)` as a pure function (used later in session state); for any field count N in [1, 150], the result has exactly ⌈N ÷ 30⌉ batches, each ≤ 30 fields, every field in exactly one batch
    - **Property 8: Batch count invariant**
    - **Validates: Requirements 5.1**

- [x] 11. Checkpoint — extraction and fixtures
  - Build with `tsc --noEmit`; run all Vitest tests added so far (tasks 4–10). All pass. Fixtures exist and open in a PDF viewer. Ask the developer to confirm before continuing.

- [x] 12. Minimal Worker with AI binding [needs CF access]
  - [x] 12.1 Create `src/worker/index.ts` — route dispatch for `POST /api/forms/analyze`, `POST /api/forms/retranslate`, `POST /api/forms/translate`; serve frontend assets for all other routes; 32 KB body-size guard; Workers rate-limiting binding; 25 s timeout; metadata-only logging (`{ requestId, route, status, durationMs, errorCode }` — never bodies or AI responses); `ApiError` JSON on all error paths
    - _Requirements: 12.1, 12.5, 12.6, 12.7_
  - [x] 12.2 Create `src/lib/ai/interface.ts` (`AiProvider` interface), `src/lib/ai/cf-workers.ts` (`CfWorkersAiProvider` using `env.AI.run` with the exact system prompt from design.md; throws typed errors on quota/rate/timeout), `src/lib/ai/mock.ts` (`MockAiProvider` — deterministic, same input → same output; fixed confidences: `formLanguageConfidence` and `formCountryConfidence` configurable per test instance to make confirmation screen path deterministic)
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  - [x] 12.3 Write unit tests for `MockAiProvider`: determinism check, all response fields pass `AnalyzeResponseSchema`; test both high-confidence path (no confirmation) and low-confidence path (triggers confirmation) using separate MockAiProvider instances with different fixed confidence values
    - _Requirements: 12.3, 12.4_

- [x] 13. Spike 1 — Model comparison [needs CF access]
  - Run the 3×2 model comparison defined in design.md §Model Comparison Plan against `fixtures/clinic-registration.pdf`; hand-written evidence JSON is acceptable to unblock if the fixture is not yet wired to the Worker — but must be re-run with real extracted evidence before the spike is considered complete
  - Measure `@cf/google/gemma-4-26b-a4b-it` vs `@cf/qwen/qwen3.8-27b` (`reasoning_effort: "low"`); interface language `zh-Hans`; 3 runs per model
  - Capture: JSON validity (parses + passes `AnalyzeResponseSchema`), field omission count, manual terminology quality 1–5, latency ms, **actual neuron cost from Workers AI response usage object**
  - Selection: ≥ 2/3 valid and ≤ 5% omissions to pass; prefer Gemma unless Qwen is clearly better; fill in `## Model Selection Result` in design.md
  - _Gates: tasks 14 (CfWorkersAiProvider model ID), 15 (analyze route)_

- [x] 14. Spike 2 — CJK font embedding prototype
  - Create `src/lib/pdf-fill/cjk-prototype.ts` as a standalone runnable script; load `fixtures/school-enrolment.pdf`, embed subsetted Noto Sans SC via `@pdf-lib/fontkit`, write a Chinese test name (two Simplified Chinese characters) into one text field using `field.updateAppearances(cjkFont)`, save with `{ updateFieldAppearances: false }`, read back and assert value, render with pdf.js and screenshot in headless Chromium and Firefox; use `font.hasGlyphForCodePoint` (not `encodeText`) for glyph check; record pass/fail and Option A/B in `## CJK Prototype Result` in design.md
  - If Spike 2 fails: add a "Chinese-language forms are not supported yet" message to the ConfirmLanguage screen when `formLanguage` is `zh-Hans` or `zh-Hant`; add a unit test that this message is shown and that `fillPdf` is never called for CJK form output
  - _Gates: tasks 37, 38 (CJK output, if pass); Chinese-fallback message (if fail)_

- [x] 15. POST /api/forms/analyze route
  - [x] 15.1 Create `src/worker/routes/analyze.ts`: validate with `AnalyzeRequestSchema`; call `aiProvider.analyze()` with `max_tokens: 2000` using model from Spike 1; validate AI response with `AnalyzeResponseSchema`; retry once on first failure; on second failure fall back (raw field names, PDF types, confidence 0); apply `answerType` compatibility rules (§5.5a) — pure function that can fail fast-check; filter unrecognised `fieldId`; filter duplicates; return `AnalyzeResponse`
    - _Requirements: 5.1, 5.4, 5.5, 5.5a, 5.6_
  - [x] 15.2 On AI failure (quota, rate, timeout): call `lookupFixtureCache(contentHash, interfaceLanguage)` from `src/worker/cache/fixture-cache.ts` (stub returning null is fine at this stage); if hit → return with `servedFromCache: true`; if miss → `503 AI_UNAVAILABLE`
    - _Requirements: 12.7_
  - [x] 15.3 Write unit tests for analyze route using MockAiProvider: valid → valid; zod fail → 400; body > 32 KB → 413; incompatible answerType corrected; fields absent from AI reply marked fill-yourself
    - _Requirements: 5.1, 5.5a_
  - [x] 15.4 Write Property 2 (answerType compatibility) test using fast-check: for any `(pdfFieldType, aiAnswerType)` pair, the enforcement function returns a compatible type or the PDF's own type at confidence 0 — never incompatible; generator must produce incompatible pairs so the property can fail
    - **Property 2: answerType compatibility enforcement**
    - **Validates: Requirements 5.5a**

- [x] 16. POST /api/forms/retranslate and POST /api/forms/translate routes
  - [x] 16.1 Create `src/worker/routes/retranslate.ts`: validate with `RetranslateRequestSchema`; call `aiProvider.retranslate()`; return only `humanLabel` and `question` updates; validate response with `RetranslateResponseSchema`
    - _Requirements: 5.8_
  - [x] 16.2 Create `src/worker/routes/translate.ts`: validate with `TranslateRequestSchema`; call `aiProvider.translate()`; never store or log request text; **the translate endpoint is only reachable when the user has pressed a "Translate" button** — the route does not need to enforce this, but note it in a comment; add a unit test that simulates the button-gating logic in session state (translate is not called without explicit user trigger)
    - _Requirements: 8.6, 11.1, 11.3_
  - [x] 16.3 Write unit tests for retranslate and translate routes
  - [x] 16.4 Close the gaps between the two routes and the design and requirements (found when task 16 was reconciled on 2026-11-11): (a) rate limits: design says 20 req/min for `/analyze` and 60 for `/translate` and `/retranslate`, but `wrangler.jsonc` has one limiter at 10 per 60 s keyed per route and IP; decide and make design and config agree; (b) a canary test that neither route logs request text (only `/analyze` has one); (c) tests for the error mapping of both routes (`AI_TIMEOUT` to 504, other AI failures and two invalid replies to 503); (d) tests for retranslate's unsupported language and its 48 KB body limit; (e) requirement 12.6 says oversized input gets 400, while the design and code answer 413; decide and make them agree
    - _Requirements: 11.3, 12.6, 12.7_
    - _Requirements: 5.8, 8.6_

- [x] 17. Precomputed fixture cache
  - [x] 17.1 Create `src/worker/cache/fixture-cache.ts`: `lookupFixtureCache(contentHash, interfaceLanguage)` reads from `src/worker/cache/precomputed/<hash>-<bcp47>.json`; returns null on miss
    - _Requirements: 12.7_
  - [x] 17.2 Complete `scripts/generate-fixture-cache.ts`: load each bundled fixture, compute SHA-256, call real Workers AI model for each core language, validate with `AnalyzeResponseSchema`, write output files; document in `scripts/create-fixtures/README.md`
    - _Requirements: 12.7_

- [x] 18. Checkpoint — Worker and AI layer
  - Run `wrangler dev`; confirm all three routes respond with MockAiProvider; all unit tests pass. Ask the developer to confirm before continuing.

- [x] 19. PDF fill core
  - [x] 19.1 Create `src/lib/pdf-fill/index.ts` — `fillPdf(pdfBytes, answers, fontMap)`: skip untouched fields, `hasGlyphForCodePoint` check per code point (not `encodeText`), write values via pdf-lib API (always `exportValue` for dropdowns), `field.updateAppearances(font)` per filled field only, `pdfDoc.save({ updateFieldAppearances: false })`; `CharacterNotRepresentableError` with failing code point on glyph failure
    - _Requirements: 8.7, 10.1, 10.2, 10.3_
  - [x] 19.2 Create `src/lib/pdf-fill/overflow.ts`: single-line — compute width, shrink font to 8pt minimum, throw `TextOverflowError` if still overflowing; multiline — word-wrap at widget width, measure wrapped height accounting for padding on all sides, throw `TextOverflowError` if exceeded at 8pt
    - _Requirements: 10.2_
  - [x] 19.3 Checkbox three-state: `checked` → on-value, `unchecked` → off-value, `skipped` → no call (retains original state)
    - _Requirements: 8.5, 10.3_

- [x] 20. Noto Sans Latin font embedding
  - [x] 20.1 Create `src/lib/pdf-fill/font.ts`: `loadFont(script)` (lazy fetch), `embedFont(pdfDoc, fontBytes)` with `{ subset: true }`, `FontMap` type; Latin script uses Noto Sans Regular
    - _Requirements: 10.1, 10.2_
  - [x] 20.2 Integrate into `fillPdf()`: build `FontMap` for required scripts, select correct font per field
    - _Requirements: 10.2_

- [x] 21. PDF fill property tests
  - [x] 21.1 Write Property 5 (fill/read-back round trip): generate arbitrary field answer subsets for `fixtures/clinic-registration.pdf`; `read(fill(pdf, answers))` returns the same normalized value for every filled field; generator must produce non-trivial answer sets
    - **Property 5: Fill / read-back round trip**
    - **Validates: Requirements 10.1, 10.2, 15.1**
  - [x] 21.2 Write Property 6 (untouched fields unchanged): generate arbitrary subsets S; after `fill(pdf, S)`, every field not in S has the same value and appearance as before; verify using field value reads and appearance stream comparison
    - **Property 6: Untouched fields are unchanged after fill**
    - **Validates: Requirements 10.3, 15.1**
  - [x] 21.3 Write Property 10 (dropdown/radio export value): generate arbitrary fields with options lists and answer strings; validate iff answer is a member `exportValue`; the `exportValue` is always what is written to the PDF; generator must include answers not in the options list
    - **Property 10: Dropdown/radio value containment**
    - **Validates: Requirements 7.8**
  - [x] 21.4 Write Property 11 (max length rejection): generate arbitrary `maxLength` N and answer strings; invalid with non-empty message iff `answer.length > N`; generator must produce strings both sides of the boundary
    - **Property 11: Max length rejection**
    - **Validates: Requirements 7.9, 10.2**

- [x] 22. MY validation pack
  - [x] 22.1 Create `src/packs/country/my.ts`: `MY_IC_BIRTHPLACE_CODES` constant with JPN source URL comment; `validateIc` with YYMMDD parsing (20YY if valid and not later than today; else 19YY; else reject), birthplace code check; `normalizeIc`; no age inference; no checksum claim
    - _Requirements: 7.1, 8.3_
  - [x] 22.2 `validatePhone` in MY pack: MCMC prefix+length table with source URL; `+60`/`60` prefixes; standard grouping output
    - _Requirements: 7.2_
  - [x] 22.3 `validatePostcode` in MY pack: exactly 5 ASCII digits; register MY pack in registry
    - _Requirements: 7.3_
  - [x] 22.4 Unit tests for MY IC: ≥ 10 known valid ICs; impossible date (month 13, day 32); invalid birthplace code; with/without dashes; too short/long; **IC with 20YY date that would be in the future must be rejected and re-tried as 19YY**
    - _Requirements: 7.1_
  - [x] 22.5 Unit tests for MY phone: one valid mobile per prefix type; Klang Valley landline; Sarawak landline; `+60` prefix; no prefix; invalid prefix; wrong digit count
    - _Requirements: 7.2_
  - [x] 22.6 Unit tests for MY postcode: 5 digits valid; 4/6 digits invalid; non-digit chars invalid
    - _Requirements: 7.3_
  - [x] 22.7 Write Property 3 (IC normalization idempotence): generate strings that pass `validateIc`; `normalizeIc(normalizeIc(s)) === normalizeIc(s)` and result is exactly 12 digits; generator must include strings with dashes
    - **Property 3: IC normalization idempotence**
    - **Validates: Requirements 7.1, 8.3**
  - [x] 22.8 Write Property 4 (IC validation correctness): generate arbitrary 12-digit strings; `validateIc(s).valid` iff digits 1–6 are a valid calendar date (20YY if not future, else 19YY) **and** digits 7–8 are in `MY_IC_BIRTHPLACE_CODES`; generator must produce strings that fail each condition independently
    - **Property 4: IC validation correctness**
    - **Validates: Requirements 7.1**

- [x] 23. US validation pack
  - [x] 23.1 Create `src/packs/country/us.ts`: NANP phone (accept `+1`), ZIP/ZIP+4, date (DD/MM/YYYY and YYYY-MM-DD input → MM/DD/YYYY output), SSN format check only (never send to backend, never claim verification); register in registry
    - _Requirements: 7.4, 7.5_
  - [x] 23.2 Unit tests for US pack: valid/invalid NANP phone, ZIP and ZIP+4, invalid ZIP, date parsing → MM/DD/YYYY output, SSN format pass and fail
    - _Requirements: 7.4, 7.5_

- [x] 24. Cross-pack validation (date, email, required, max length)
  - [x] 24.1 `validateDate` (universal): DD/MM/YYYY and YYYY-MM-DD; use explicit format from tooltip/nearby text if available; ask user to confirm format if ambiguous; reject invalid dates; check formatted result against `MaxLen`
    - _Requirements: 7.5_
  - [x] 24.4 Dates need an explicitly confirmed format (review 1, item 19): `validateDate` parses only the confirmed or explicitly hinted format; never fall back to another format and never guess an ambiguous value such as `03/04/2026`; return `needs: 'format'` ("needs format confirmation") when no format is known. Unit tests for each case
    - _Requirements: 7.5_
  - [x] 24.2 `validateEmail`, `validateRequired`, `validateMaxLength` in universal pack: never silently truncate
    - _Requirements: 7.6, 7.7, 7.9_
  - [x] 24.3 Unit tests: valid/invalid email; required field blank; required with answer; at max length; one char over max length
    - _Requirements: 7.6, 7.9_

- [x] 25. Checkpoint — core logic
  - All property-based tests and unit tests for tasks 19–24 pass; `tsc --noEmit` clean. Ask the developer to confirm before continuing.

- [x] 26. Session state and browser analysis orchestration
  - [x] 26.1 Create `src/frontend/state.ts`: `FieldState`, `SessionState` interfaces; `createSession()`; `analysisCache` keyed `${contentHash}:${interfaceLanguage}`; `activeAnalysisId` stale-response guard; `batchFields(fields, 30)` (the same pure function tested in task 10.3)
    - _Requirements: 5.1, 5.8_
  - [x] 26.2 `analyzeForm(fields, session)`: batch sequentially, aggregate `formLanguage`/`formCountry` confidence-weighted across batches, trigger confirmation if final confidence < 0.7 or batches disagree, discard stale via `activeAnalysisId`, cache result
    - _Requirements: 5.1, 5.3, 5.7, 5.8_
  - [x] 26.3 `switchLanguage(newLang, session)`: check cache; if miss call `POST /api/forms/retranslate`; update only `humanLabel` and `question`; never touch answers
    - _Requirements: 5.8_

- [x] 27. Language picker screen
  - [x] 27.1 `src/frontend/screens/LanguagePicker.tsx`: list registry languages; pre-select from `navigator.language`; experimental badge; larger-text toggle; `<html lang>` update; Noto font lazy-load
    - _Requirements: 2-L.7, 2-L.8, 2-L.3, 13.4, 13.9_

- [x] 28. Upload and disclosure screen
  - [x] 28.1 `src/frontend/screens/Upload.tsx`: file input, privacy notice (exact wording from requirements §Overview), "Continue" gated on acknowledgement; trigger `extractFields()`; show rejection errors in active language
    - _Requirements: 1.3, 1.4, 9.5, 11.4_
  - [x] 28.2 On rejection: show error card with i18n message key and "Try another file"; never crash
  - [x] 28.3 Configure the pdf.js worker for the browser (`pdfjs-dist/build/pdf.worker.min.mjs?url` → `GlobalWorkerOptions.workerSrc`) and add a browser extraction check (Playwright: upload a fixture, see its fields extracted) (review 1, item 20)
    - _Requirements: 4.1, 4.5_
  - [x] 28.5 "Try a sample form" entry: a secondary button on the language picker, and the route `SAMPLE_FORM_PATH` exported from `src/shared/app-paths.ts`, both open the clinic registration form on the upload screen as if the user had chosen it, with every field empty. The file is `fixtures/clinic-registration-sample.pdf`, made by the fixture generator from the clinic spec with all values removed (the clinic fixture itself keeps its prefilled read-only code and ticked consent for the untouched-field tests). It is bundled as a static asset, read with the same extraction path, in a fresh session with no answers. No privacy change: the PDF is read in the browser, nothing is sent before the user presses the acknowledgement, and the notice is shown as for any upload. Tests: the constant is a same-origin path with no query string and not under `/legacy/`; the route and the button show the 22 fields; no API request before the acknowledgement; Playwright opens the route in a real browser
    - Prerequisite of `accessforge-skeleton` tasks 1.6, 4.3 and 16.8, which link to `SAMPLE_FORM_PATH`
    - _Requirements: 1.3, 9.5, 11.4, 14.1; accessforge-skeleton 11.5_
  - [x] 28.4 **Demo 1 (non-blocking):** run the dev server; write the URL and exact try-it steps into `.local/kiro-progress.md` under "Demos ready": pick a language, upload each fixture, see the extracted fields listed or the right rejection message

- [x] 29. Analysis loading screen
  - [x] 29.1 `src/frontend/screens/AnalysisLoading.tsx`: batch progress "Analyzing batch N of M"; `DemoModeBanner` if mock provider; on complete navigate to ConfirmLanguage if confidence < 0.7 else QuestionWizard
    - _Requirements: 5.1, 5.3, 12.4_

- [x] 30. Form language/country confirmation screen
  - [x] 30.1 `src/frontend/screens/ConfirmLanguage.tsx`: detected language + country with confidence; user selects from candidates; confirm navigates to QuestionWizard; if Spike 2 failed and detected form language is `zh-Hans`/`zh-Hant`, show "Chinese-language forms are not supported yet" and prevent proceeding to fill
    - _Requirements: 5.3, 3-C.3_

- [x] 31. Question wizard screen
  - [x] 31.1 `src/frontend/screens/QuestionWizard.tsx`: one field per step, step counter, skip read-only/fill-yourself, "Skip this field", "← Back"/"Next →", inline validation, navigate to Review when done
    - _Requirements: 4.3, 6.2, 6.3, 6.4_
  - [x] 31.6 Fields marked `multiSelect` or `unresolvedPage` show as "fill this yourself" (never asked, listed in review) (review 1, item 21); date questions ask the user to confirm the date format before validating when the field gives none (review 1, item 19)
    - _Requirements: 6.2, 7.5, 15.1_
  - [x] 31.2 `src/frontend/components/FieldQuestion.tsx`: `humanLabel`/`question`, `MachineTranslatedLabel` badge, original PDF label (tooltip or snippet, never fabricated); low-confidence confirmation flow; description translation flow — **translate button is the only trigger for the translate API call**, never automatic
    - _Requirements: 2-L.6, 2-L.7, 5.7, 6.1, 8.6, 11.1_
  - [x] 31.3 `MachineTranslatedLabel.tsx`, `ValidationMessage.tsx` (linked via `aria-describedby`, announced via `aria-live="polite"`)
    - _Requirements: 2-L.6, 13.3_
  - [x] 31.4 Wire validation: active country pack on each answer change; block "Next" on invalid; language switcher in header calls `switchLanguage()` without losing answers
    - _Requirements: 7.1–7.9, 5.8, 5.9_
  - [x] 31.5 Write a unit test that simulates the translate flow: mock the translate API; assert the API is NOT called before the "Translate" button is pressed; assert it IS called exactly once after the button is pressed
    - _Requirements: 8.6, 11.1_

- [x] 32. Review screen
  - [x] 32.1 `src/frontend/screens/ReviewScreen.tsx`: semantic HTML list of all fields (original label, question, normalized output, status badge); privacy notice; "Confirm and download PDF"; inline edit opens `FieldQuestion` in-place with re-validation
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 33. Download confirmation screen
  - [x] 33.1 `src/frontend/screens/DownloadConfirm.tsx`: call `fillPdf()`; handle `CharacterNotRepresentableError` and `TextOverflowError`; trigger browser download as `<name>-filled.pdf`
    - _Requirements: 8.7, 10.1, 10.2, 10.4_
  - [x] 33.2 **Demo 2 (non-blocking):** full local flow with the mock AI (language → upload clinic form → answer → review → download, then open the PDF); write step-by-step instructions with the synthetic answers from the fixture spec into `.local/kiro-progress.md` under "Demos ready"

- [x] 34. Design tokens and visual polish
  - [x] 34.1 `src/frontend/tokens.css`: CSS custom properties for color palette and type scale from design.md; `font-family: 'Noto Sans', sans-serif`; max-width 560px on wizard; 68ch line length; CSS logical properties throughout; WCAG AA contrast confirmed for each color pair
    - _Requirements: 13.5, 2-L.4_
  - [x] 34.2 Question card slide-in animation (150ms ease-out, `translateX(24px) → 0`; reverse on back; `prefers-reduced-motion` → 100ms opacity fade, no translate)
    - _Requirements: 13.10_

- [ ] 35. Accessibility pass
  - [ ] 35.1 Audit all screens: `<label for>` on every input; `aria-describedby` on every error; `aria-live="polite"` on validation output; visible focus ring; logical tab order; `lang` on `<html>` and on elements in a different language; touch targets ≥ 44×44 px; 360px layout; 200% zoom; color + icon/text errors; `prefers-reduced-motion`
    - _Requirements: 13.1–13.10_
  - [ ] 35.2 Run `checkA11y()` via `axe-playwright` on every main screen: LanguagePicker, Upload, QuestionWizard (text field, checkbox, radio, dropdown each), ReviewScreen, DownloadConfirm; assert zero violations
    - _Requirements: 13.11_

- [x] 36. Nov 17 end-to-end acceptance test
  - [x] 36.1 Create `tests/e2e/nov17-acceptance.spec.ts` — two variants using MockAiProvider: (a) mock returns high confidence → confirmation screen is skipped; (b) mock returns low confidence → confirmation screen appears and user selects Malay; both variants proceed through: language picker → upload clinic form → disclosure → question wizard (wrong IC rejected, then correct IC) → review → confirm → download
    - _Requirements: 15.2_
  - [x] 36.2 Add pdf.js field-rect verification: for text fields, assert rendered text bounding box is inside the field rectangle; for checkboxes/radios/dropdowns, read field value back from PDF and assert it matches; take visual screenshots of each filled page
    - _Requirements: 15.2_
  - [x] 36.3 Run `checkA11y()` on every screen in the Nov 17 path; assert zero violations
    - _Requirements: 15.2, 13.11_

- [ ] 37. Milestone 1 — Deploy and smoke test [needs CF access]
  - [x] 37.1 Run `scripts/generate-fixture-cache.ts` for `fixtures/clinic-registration.pdf` × all core languages; commit the precomputed JSON files
    - _Requirements: 12.7_
  - [ ] 37.2 Run `wrangler deploy`; confirm app loads at public URL; run the Nov 17 acceptance scenario manually against the live URL using the real Workers AI model (live smoke test); record actual neuron costs observed; add a row to `docs/kiro-usage-log.md`
    - _Requirements: 15.2, tech.md_
  - [ ] 37.3 **Demo 3 (non-blocking):** live public URL with real AI; write try-it steps for desktop and phone into `.local/kiro-progress.md` under "Demos ready"

- [ ] 38. US validation pack (Dec 1 gate)
  - Confirm the US pack from task 23 is fully wired into the country pack registry and e2e path: `getCountryPack("US")` returns the US pack, ZIP and phone validation active in the wizard for US forms

- [ ] 39. Dec 1 end-to-end acceptance test
  - [ ] 39.1 Create `tests/e2e/dec1-acceptance.spec.ts` — two variants (high confidence and low confidence) as in task 36; path: Spanish language picker → US clinic form → disclosure → confirm English (US) + US country (when prompted) → question wizard (wrong ZIP rejected, then correct ZIP) → review → confirm → download
    - _Requirements: 15.3_
  - [ ] 39.2 Add pdf.js field-rect verification and visual screenshots (same approach as task 36.2)
    - _Requirements: 15.3_

- [ ] 40. Locale completeness test
  - [ ] 40.1 Create `tests/unit/locale-completeness.test.ts` — for every BCP 47 tag with status `core` in the language registry and every key in `en.json`, assert the locale file has a non-empty entry
    - **Property 12: Core locale completeness**
    - **Validates: Requirements 1.4, 2-L.1**

- [ ] 41. CJK font embedding in fill pipeline (conditional on Spike 2 passing)
  - [ ] 41.1 Add Noto Sans SC + TC to `src/lib/pdf-fill/font.ts`: lazy-load for `zh-Hans`/`zh-Hant` (Option A or B from Spike 2); update `FontMap` and script-selection; `hasGlyphForCodePoint` check for CJK code points
    - _Requirements: 5.3a, 10.1_
  - [ ] 41.2 Update language registry entries for `zh-Hans`/`zh-Hant`: `pdfFontFamily` to `Noto Sans SC`/`Noto Sans TC`; fill pipeline selects font from registry entry
    - _Requirements: 5.3a, 8.7_
  - [ ] 41.3 Create `fixtures/chinese-school-form.pdf` — synthetic Chinese-language AcroForm; all labels and nearby text in Chinese
    - _Requirements: 14.8_
  - [ ] 41.4 Create `tests/e2e/cjk-output.spec.ts` — acceptance test: Chinese interface + Chinese-language form → fill → verify Chinese characters render correctly in downloaded PDF (pdf.js render + screenshot); assert no `.notdef` boxes
    - _Requirements: 5.3a_

- [ ] 42. Milestone 2 — Deploy and smoke test [needs CF access]
  - [ ] 42.1 Run `scripts/generate-fixture-cache.ts` for `fixtures/us-community-clinic.pdf` × core languages; commit new precomputed JSON files; run `wrangler deploy`; smoke-test Dec 1 acceptance scenario on the live URL; add a row to `docs/kiro-usage-log.md`
    - _Requirements: 12.7, 15.3, tech.md_
  - [ ] 42.2 **Demo 4 (non-blocking):** Spanish → US form and (if Spike 2 passed) the Chinese form on the live URL; write try-it steps into `.local/kiro-progress.md` under "Demos ready"

- [ ] 43. README and disclosure
  - [ ] 43.1 Complete `README.md`: public URL, full setup steps, completed `Pre-existing code disclosure` section listing all notable libraries; update `docs/kiro-usage-log.md` with rows for hooks, MCP usage, and PBT results that actually happened (one row per milestone)
    - _Requirements: tech.md_

## Notes

- Tasks 41.1–41.4 are conditional on Spike 2 (task 14) passing. If Spike 2 fails, CJK PDF output is deferred; the Chinese-fallback message added in task 14 applies.
- Spike 1 (task 13) gates tasks 14–15 (model ID and analyze route). Hand-written evidence is acceptable to start but must be re-run with real extracted evidence.
- Both e2e scenarios (tasks 36 and 39) run with MockAiProvider for determinism. Task 37.2 and 42.1 perform live-AI smoke tests against the deployed URL.
- The translate API (task 16.2) is only triggered by the user pressing a "Translate" button; task 31.5 tests this gate.
- Page snippets (task 9.2) must exclude existing field values to prevent prefilled personal data from being sent to the AI; task 9.4 includes a privacy test for this.
- Property 12 is defined once, in task 40.1. The duplicate in task 5 (locale completeness) was merged here.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.1", "3.1"] },
    { "id": 1, "tasks": ["3.2", "4.1", "5.1"] },
    { "id": 2, "tasks": ["4.2", "4.3", "5.2", "5.3", "6.1"] },
    { "id": 3, "tasks": ["6.2", "6.3", "7.1"] },
    { "id": 4, "tasks": ["7.2", "7.3", "7.4", "8.1"] },
    { "id": 5, "tasks": ["8.2", "8.3", "9.1"] },
    { "id": 6, "tasks": ["9.2", "9.3"] },
    { "id": 7, "tasks": ["9.4", "10.1", "10.2", "10.3"] },
    { "id": 8, "tasks": ["12.1", "12.2"] },
    { "id": 9, "tasks": ["12.3", "13"] },
    { "id": 10, "tasks": ["14", "15.1"] },
    { "id": 11, "tasks": ["15.2", "15.3", "15.4", "16.1", "16.2", "16.3"] },
    { "id": 12, "tasks": ["17.1", "17.2"] },
    { "id": 13, "tasks": ["19.1", "19.2", "19.3"] },
    { "id": 14, "tasks": ["20.1"] },
    { "id": 15, "tasks": ["20.2", "21.1", "21.2", "22.1"] },
    { "id": 16, "tasks": ["21.3", "21.4", "22.2", "22.3"] },
    { "id": 17, "tasks": ["22.4", "22.5", "22.6", "22.7", "22.8", "23.1"] },
    { "id": 18, "tasks": ["23.2", "24.1"] },
    { "id": 19, "tasks": ["24.2", "24.3", "26.1"] },
    { "id": 20, "tasks": ["26.2", "26.3", "34.1"] },
    { "id": 21, "tasks": ["27.1", "34.2"] },
    { "id": 22, "tasks": ["28.1", "28.2"] },
    { "id": 23, "tasks": ["28.5", "29.1"] },
    { "id": 24, "tasks": ["30.1"] },
    { "id": 25, "tasks": ["31.1"] },
    { "id": 26, "tasks": ["31.2", "31.3"] },
    { "id": 27, "tasks": ["31.4", "31.5"] },
    { "id": 28, "tasks": ["32.1"] },
    { "id": 29, "tasks": ["33.1"] },
    { "id": 30, "tasks": ["35.1", "35.2"] },
    { "id": 31, "tasks": ["36.1"] },
    { "id": 32, "tasks": ["36.2", "36.3"] },
    { "id": 33, "tasks": ["37.1"] },
    { "id": 34, "tasks": ["37.2"] },
    { "id": 35, "tasks": ["38", "39.1"] },
    { "id": 36, "tasks": ["39.2", "40.1"] },
    { "id": 37, "tasks": ["41.1"] },
    { "id": 38, "tasks": ["41.2", "41.3"] },
    { "id": 39, "tasks": ["41.4", "42.1"] },
    { "id": 40, "tasks": ["43.1"] }
  ]
}
```
