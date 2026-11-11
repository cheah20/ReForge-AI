# Implementation Plan: AccessForge Skeleton

## Overview

The plan builds the AccessForge walking skeleton in TypeScript, in the order the design's data path runs: the fictional legacy portal and its handler in the Worker, the pure agent logic in the browser (frame checks, extractor, plan validator, heuristic, transformations, executor, verifier), the AI provider methods and the two page API routes, the agent-loop reducer, the Mirror screens, and finally the end-to-end, privacy and accessibility tests on the demo path.

Task 1 is a blocking gate. No other task starts until the developer has approved the privacy changes and the open decisions it lists.

FormBridge (`formbridge-pdf`) is being built in parallel. AccessForge work therefore starts in its own new folders (`src/worker/legacy/`, `src/lib/accessforge/`, `src/frontend/accessforge/`, `src/shared/page-schemas.ts`, `tests/unit/accessforge-*`, `tests/e2e/accessforge-*`). Every task that edits a file FormBridge also uses is marked **Shared file** and must be coordinated with the FormBridge work before it starts (pull first, keep the change small, commit it on its own). Shared files touched by this plan:

- `.kiro/steering/privacy.md` and every interface locale file (tasks 1.1, 1.2, 15.1)
- `src/lib/ai/interface.ts`, `src/lib/ai/mock.ts`, `src/lib/ai/prompt.ts`, `src/lib/ai/cf-workers.ts` (tasks 13.1, 13.2, 13.4)
- `src/worker/index.ts`, `src/worker/http.ts`, `wrangler.jsonc` (tasks 5.10, 13.7)
- `src/frontend/api.ts`, the app shell or router file, the tokens test (tasks 16.1, 16.10, 16.12)
- `scripts/generate-fixture-cache.ts` and `package.json` scripts (task 20.1)
- `README.md`, `docs/kiro-usage-log.md`, `docs/accessibility-checklist.md` (tasks 21.1 to 21.3)

The FormBridge link on the Mirror confirmation screen and on the legacy confirmation page depends on a FormBridge sample-form route that opens `fixtures/clinic-registration.pdf` (design open decision G). That route belongs to FormBridge. Task 16.8 builds the link against a single path constant so it can be switched on once the route exists.

Real AI calls happen only in tasks 20.2 and 23.1, each marked **needs `AI_MODE=real`** with its reason. Every other task and test uses the mock provider.

## Tasks

- [ ] 1. Prerequisite gate: privacy changes and open decisions (developer decides, Kiro only drafts)
  - **Blocking.** No task from 2 onward starts until 1.1 to 1.4 are approved by the developer. Kiro drafts each change as a proposal; the developer reviews, edits and applies or rejects it.
  - [ ] 1.1 Draft the privacy rules change for AccessForge data paths
    - **Shared file:** `.kiro/steering/privacy.md`. Coordinate with FormBridge.
    - Draft two additions for the developer: (a) the Page_Model (control types, names, ids, label, neighbouring-cell, option and nearby text, `required`, `maxlength`, position, Page_Version) and the re-translation payload (existing human labels and questions plus target language) may reach the Worker and the AI service; (b) after the user presses the confirm button, the Legacy_Form POST carries the answers to the Worker's Legacy_Handler, which processes them in memory for that request, renders them back once and never stores or logs them.
    - Developer approves and applies the change. Kiro does not apply it without that approval.
    - _Requirements: 13.1, 13.2, 13.3, 13.5, design open decision A_
  - [ ] 1.2 Draft the privacy notice update in every locale file
    - **Shared file:** every interface locale file (`en`, `ms`, `zh-Hans`, `zh-Hant`, `ta`, `es`, plus experimental files only where they already carry the notice). Coordinate with FormBridge.
    - Draft wording that keeps the FormBridge privacy notice accurate and adds the AccessForge data notice keys listed in design Question 7 (`accessforge.notice.*`), so the notice promises no more than the code does.
    - Developer approves the English source and the translations before task 15.1 writes them.
    - _Requirements: 13.7, 13.9, design open decision A_
  - [ ] 1.3 Resolve where the Malay legacy portal content lives (open decision B)
    - Present the design's recommendation (`src/packs/language/locales/legacy-portal/ms.json`, kept out of the language registry, listed in the README as the only non-English content outside the interface locale files) and the same rule for the mock page-plan table in `fixtures/mock-analysis/legacy-register.json`.
    - Developer confirms or picks another location. Task 4.1 uses the confirmed path.
    - _Requirements: 1.7, design open decision B_
  - [ ] 1.4 Resolve the consent explanation versus the nearby-text rule (open decision F)
    - Present the gap: Requirement 5.6 limits nearby text to the field's own row, while legacy trait 6 puts the consent explanation in another row, so Requirement 9.8's "original legacy wording" cannot come from the Page_Model.
    - Offer the design's recommended requirement change (for a checkbox only, add the visible text of the next control-free row as one more evidence item of at most 200 characters) and the fallback (show the abbreviated consent label as the original wording and point to the frame).
    - If the developer accepts the change, update requirements 5.4, 5.6 and 9.8 and design Question 2 before task 8.1 starts.
    - _Requirements: 5.4, 5.6, 9.8, design open decision F_
  - [ ] 1.5 Record the non-blocking open decisions for the developer
    - List decisions C (hackathon category, which changes README and scope-notice wording), D (answers do not carry into FormBridge), E (frame behind a show control below 1024 px), G (FormBridge sample-form route), H (larger-text scale 1.25 in the Mirror), I (length counted in UTF-16 code units; proposed wording change to 9.9 and 17.8) and J (banner kept at high contrast).
    - Ask the developer to decide each one or mark it deferred. Decision C must be raised again in task 23.2 if still open.
    - _Requirements: 9.9, 11.5, 12.4, 14.11, 17.8, 1.6_

- [ ] 2. Shared page schemas in their own file
  - [ ] 2.1 Create `src/shared/page-schemas.ts`
    - New file, so `src/shared/schemas.ts` stays untouched while FormBridge works there. Reuse `AnswerTypeSchema` by import only.
    - Define `ElementIdSchema`, `ControlTypeSchema`, `PageOptionSchema`, `PageEntrySchema`, `PageModelSchema`, `PagePlanEntrySchema` (strict, plain-text label and question rules), `PagePlanReplySchema`, `AnalysisModeSchema`, `PageAnalyzeRequestSchema`, `PageAnalyzeResponseSchema`, `PageRetranslateRequestSchema`, `PageRetranslateResponseSchema`, `PrecomputedPagePlanSchema` and `ActionSchema`, exactly as in design "Data Models". Export inferred types.
    - _Requirements: 6.3, 6.6, 7.7, 8.1, 13.1_
  - [ ]* 2.2 Write unit tests for the page schemas
    - `tests/unit/accessforge-schemas.test.ts`: strict objects reject extra keys, label and question bounds, markup and URL rejection, confidence bounds, `ActionSchema` rejects `Click` and `submit`, retranslate items carry no Element_Id.
    - _Requirements: 6.6, 8.2, 13.1_

- [ ] 3. Legacy HTML builder and sanitiser
  - [ ] 3.1 Implement `src/worker/legacy/html.ts`
    - `h()`, `sanitizeTree()`, `serialize()` and `findUnsafeConstructs()` with the tag and attribute allow-lists, URL rules and tag-only scanning of design Question 6. No DOM dependency, so the code runs in the Worker and in Vitest.
    - _Requirements: 4.1, 4.8, 2.10_
  - [ ] 3.2 Write property test for the sanitiser
    - **Property 10: Sanitised output contains no active or foreign construct**
    - `tests/unit/legacy-html.test.ts`, at least 100 runs, tag comment `// Feature: accessforge-skeleton, Property 10: ...`. Add the hostile node tree to `tests/e2e/helpers/hostile-pages.ts` (test-only) and assert its raw serialization is caught while the sanitised one is clean.
    - **Validates: Requirements 4.1, 4.8**

- [ ] 4. Legacy portal content, stylesheet and templates
  - [ ] 4.1 Create the legacy form specification and the Malay content file
    - `src/worker/legacy/form-spec.ts` with `LEGACY_FORM` (eight fields, names, controls, `maxlength`, `required`, option and checkbox values) as in design "Legacy form specification".
    - The Malay content file at the location confirmed in task 1.3, with the typed keys of design "Templates and content", and `src/worker/legacy/content.ts` that loads it with typed keys. Only invented names and organisations.
    - _Requirements: 1.3, 1.5, 1.7_
  - [ ] 4.2 Create `public/legacy-assets/portal.css` and its check
    - The 2005-style stylesheet from design "Design Plan: Legacy_Portal" (px sizes at 12 px or less, low-contrast label and body colours, 760 px table layout, nested menu shown with `:hover` and `:focus-within`, readable banner). No `url(` and no `@import`.
    - `tests/unit/legacy-css.test.ts` reads the file and asserts no `url(` or `@import`, and that the deliberate label and body colour pairs stay below 4.5:1.
    - _Requirements: 1.6, 4.1, 1.9_
  - [ ] 4.3 Implement `src/worker/legacy/respond.ts`
    - `LEGACY_CSP` and `legacyResponse()` setting the headers of design Question 6 (`Content-Security-Policy`, `Cache-Control: no-store`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`), for HTML and for shared-error-shape JSON rejections.
    - _Requirements: 2.6, 4.2_
  - [ ] 4.4 Implement `src/worker/legacy/templates.ts`
    - `homePage()`, `registerPage()`, `confirmationPage()`, `errorPage()` and `notFoundPage()` built only with `h()` from one layout: banner first, five-entry menu with the register link nested in "others", content table, footer, `lang="ms"`, `portal-page` and `portal-page-version` meta, one stylesheet link. All visible text from the content file. Registration form with every field empty and the eight legacy traits. Confirmation page with `#ringkasan-diterima`, `#rujukan`, `#mesej-pengesahan` and the FormBridge link path constant. Every page passes through `sanitizeTree()`.
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10, 2.1, 2.3, 2.10, 11.6_
  - [ ] 4.5 Implement Page_Version stamping
    - `src/worker/legacy/page-version.ts` (`stampPageVersion()` with the formula of design Question 1, `crypto.subtle.digest`) and `src/lib/accessforge/supported-versions.ts` with placeholder values that task 5.8 fills in.
    - _Requirements: 3.4, 3.5_
  - [ ]* 4.6 Write example unit tests for the templates
    - `tests/unit/legacy-templates.test.ts`: banner is the first visible element on every page, five menu entries with the register link nested, form structure equals `LEGACY_FORM`, DOM-checkable legacy traits, `lang="ms"`, every text node comes from the content file, empty initial state, no images.
    - _Requirements: 1.2, 1.4, 1.5, 1.6, 1.7, 1.8_

- [ ] 5. Legacy handler and Worker wiring
  - [ ] 5.1 Implement `src/worker/legacy/submission.ts`
    - `parseSubmission()` reads only the body with `URLSearchParams`, keeps order and repeats; `validateSubmission()` applies the rules of Requirement 2.2 against `LEGACY_FORM`, counting length in UTF-16 code units, and returns every failing name.
    - _Requirements: 2.2, 2.7_
  - [ ] 5.2 Implement `src/worker/legacy/reference.ts`
    - `newReferenceNumber(now, randomDigits)` giving `SR-DEMO-YYYYMMDD-NNNNNN` from the UTC date and injected random digits (`crypto.getRandomValues` in production). No submitted value is an input.
    - _Requirements: 2.9_
  - [ ] 5.3 Implement `src/worker/legacy/handler.ts`
    - `handleLegacy(request, deps)` with the dispatch table of design "Request dispatch": GET home and register, POST register (content type, 16,384-byte limit, parse, validate, confirmation 200 or error page 422), other methods `METHOD_NOT_ALLOWED`, unlisted GET paths the not-found document 404. Values rendered as text only, never logged, never in headers or URLs. Fail closed with `INTERNAL_ERROR` when `findUnsafeConstructs()` reports anything.
    - _Requirements: 1.1, 1.10, 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 4.8, 13.5, 13.6_
  - [ ] 5.4 Write property test for submission validation
    - **Property 12: The Legacy_Handler accepts exactly the valid bodies and names every failure**
    - `tests/unit/legacy-handler.test.ts`, at least 100 runs.
    - **Validates: Requirements 2.2, 2.3**
  - [ ] 5.5 Write property test for reference numbers
    - **Property 14: Reference numbers follow the pattern and ignore submitted values**
    - `tests/unit/legacy-handler.test.ts`, at least 100 runs.
    - **Validates: Requirements 2.9**
  - [ ] 5.6 Write property test for the received-fields summary
    - **Property 13: The Received_Fields_Summary round-trips exactly**
    - `tests/unit/legacy-handler.test.ts`, at least 100 runs; values with spaces, mixed case, any Unicode and markup characters; random query strings on the URL.
    - **Validates: Requirements 2.1, 2.4, 2.7, 2.10**
  - [ ] 5.7 Write property test for unlisted legacy paths
    - **Property 25: Unlisted legacy paths give the not-found document**
    - `tests/unit/legacy-handler.test.ts`, at least 100 runs.
    - **Validates: Requirements 1.10, 2.6, 4.2**
  - [ ] 5.8 Record the supported Page_Versions and write the recorded-hash test
    - `tests/unit/accessforge-page-versions.test.ts`: call `handleLegacy` for GET `/legacy/` and GET `/legacy/register`, recompute the hash by the design formula, assert it equals the served meta and `SUPPORTED_PAGE_VERSIONS`, and fail when any file in `src/worker/cache/precomputed/pages/` is keyed by an unsupported version.
    - Fill `src/lib/accessforge/supported-versions.ts` and the Page_Version table in design Question 1 with the computed hashes.
    - _Requirements: 3.4, 3.5_
  - [ ]* 5.9 Write unit tests for handler limits and headers
    - `tests/unit/legacy-handler-limits.test.ts`: 16,384 bytes accepted and 16,385 rejected, JSON content type rejected, PUT and DELETE rejected, no Reference_Number on any rejection, CSP and `no-store` on every response kind.
    - _Requirements: 2.6, 2.8, 4.2_
  - [ ] 5.10 Wire the legacy routes into the Worker
    - **Shared files:** `src/worker/index.ts`, `wrangler.jsonc`. Coordinate with FormBridge.
    - Dispatch `/legacy` and `/legacy/*` to `handleLegacy` before the assets binding; set `assets.run_worker_first` to `["/api/*", "/legacy", "/legacy/*"]`; legacy log entries carry route `/legacy/register` and status only.
    - `tests/unit/legacy-routes.test.ts`: the Worker serves no other `/legacy/` documents than Requirement 1.1 lists, and a legacy POST log entry contains no field name or value.
    - _Requirements: 1.1, 4.7, 13.5_

- [ ] 6. Checkpoint: legacy portal
  - Run `npx vitest --run`. Ensure all tests pass, ask the developer if questions arise.

- [ ] 7. Element_Ids and frame checks
  - [ ] 7.1 Implement `src/lib/accessforge/element-id.ts`
    - `elementIdFor()` and `parseElementId()` with the formula of design Question 2 (`encodeURIComponent` on name and radio value).
    - _Requirements: 5.3, 8.3_
  - [ ] 7.2 Implement `src/lib/accessforge/allow-list.ts`
    - `ALLOW_LIST` with the four entries, `checkFrameDocument()` with the four steps of design Question 1, and `checkFormTarget()` for the form `action`, `method` and the submit button's `formaction`, `formmethod` and `formtarget`.
    - _Requirements: 3.1, 3.2, 3.3, 4.4, 4.9_
  - [ ] 7.3 Write property test for the frame check
    - **Property 15: The frame check accepts exactly the four Allow_List transitions**
    - `tests/unit/accessforge-allow-list.test.ts`, at least 100 runs.
    - **Validates: Requirements 3.2, 18.1**
  - [ ] 7.4 Write property test for the form-target check
    - **Property 20: The form-target check passes only for the legacy handler**
    - `tests/unit/accessforge-allow-list.test.ts`, at least 100 runs, jsdom.
    - **Validates: Requirements 4.4, 4.9**

- [ ] 8. Page extractor
  - [ ] 8.1 Implement `src/lib/accessforge/extract.ts`
    - `extractPageModel(doc, pageVersion)` reading attributes and text nodes only, never `.value`, `.checked`, `.selected` or their defaults, skipping hidden inputs; evidence and limits of Requirement 5.4 and 5.6 (as amended by task 1.4); duplicate ids and unsupported controls marked; refusals `UNREADABLE`, `NO_FORM`, `MULTIPLE_FORMS`, `TOO_MANY_CONTROLS`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8, 5.9, 5.10_
  - [ ] 8.2 Write property test for entered state
    - **Property 4: Entered state never reaches the Page_Model**
    - `tests/unit/accessforge-extract.test.ts`, at least 100 runs, jsdom against `registerPage()` output parsed with `DOMParser`.
    - **Validates: Requirements 5.2, 5.5, 5.7, 17.5**
  - [ ] 8.3 Write property test for Element_Ids
    - **Property 8: Element_Ids are deterministic and injective, collisions become do it yourself**
    - `tests/unit/accessforge-extract.test.ts`, at least 100 runs, generated single-form table pages.
    - **Validates: Requirements 5.3, 5.4, 5.6, 5.8, 5.9**
  - [ ]* 8.4 Write unit tests for extractor refusals
    - `tests/unit/accessforge-extract-limits.test.ts`: 50 controls accepted, 51 refused, no form, two forms, unreadable document.
    - _Requirements: 5.10_

- [ ] 9. Plan validator and heuristic plan
  - [ ] 9.1 Implement `src/lib/accessforge/plan-validator.ts`
    - `validatePlan(model, rawEntries)` with rules 1 to 7 of design Question 3 (envelope, strict entry parse, known target, first wins, compatibility table, coverage, buttons by control type).
    - _Requirements: 6.4, 6.5, 6.6, 6.7, 6.8, 6.12, 6.13, 6.16_
  - [ ] 9.2 Write property test for plan validation
    - **Property 1: Plan validation keeps only trustworthy entries and covers every field**
    - `tests/unit/accessforge-plan-validator.test.ts`, at least 100 runs; generator includes every case of Requirement 17.2 and a fully valid plan that must map every field.
    - **Validates: Requirements 6.4, 6.5, 6.6, 6.7, 6.8, 6.12, 6.13, 6.16, 17.1, 17.2**
  - [ ] 9.3 Implement `src/lib/accessforge/heuristic.ts`
    - `heuristicPlan(model, language)` with the rules table of design Question 3, confidence 0, locale sentence `accessforge.heuristic.question` (English fallback until task 15.1 adds the key), no network.
    - _Requirements: 7.4_
  - [ ] 9.4 Write property test for the heuristic plan
    - **Property 18: The heuristic plan is deterministic and rule-bound**
    - `tests/unit/accessforge-heuristic.test.ts`, at least 100 runs.
    - **Validates: Requirements 7.4**

- [ ] 10. Answer transformations
  - [ ] 10.1 Implement `src/lib/accessforge/transformations.ts`
    - `toIntendedValue()` calling the existing `validateAnswer` with `myPack`, then the legacy length check with `legacyLength()` (UTF-16 code units); date from three parts through `isValidCalendarDate` and `formatDate`; `detectLegacyDateFormat()` with the `HH/BB/TTTT` rule. No change to the shared validators.
    - _Requirements: 9.5, 9.7, 9.9, 9.10, 9.11, 15.4_
  - [ ] 10.2 Write property test for date round-trip
    - **Property 5: Date answers round-trip and invalid dates write nothing**
    - `tests/unit/accessforge-transformations.test.ts`, at least 100 runs.
    - **Validates: Requirements 9.7, 17.6**
  - [ ] 10.3 Write property test for documented transformations
    - **Property 6: Intended_Value equals the documented transformation**
    - `tests/unit/accessforge-transformations.test.ts`, at least 100 runs.
    - **Validates: Requirements 9.5, 9.10, 9.11, 15.5, 17.7**
  - [ ] 10.4 Write property test for the length limit
    - **Property 7: Length limit accepts exactly what fits and never truncates**
    - `tests/unit/accessforge-transformations.test.ts`, at least 100 runs, lengths 0 to `maxlength` + 5 including both edges and characters outside the Basic Multilingual Plane; assert accepted values also pass `validateSubmission`.
    - **Validates: Requirements 9.9, 2.2, 17.8**

- [ ] 11. Executor and verifier
  - [ ] 11.1 Implement `src/lib/accessforge/executor.ts`
    - `execute(action, ctx)`: strict `ActionSchema` parse first, all checks before any write, location through `form.elements` by type, exact name and radio value (no selector from the plan), reset always rejected, submit only while armed, consent rule, Do_It_Yourself rule, version check, `NOT_FOUND` and `AMBIGUOUS`, submit with `form.requestSubmit()` after `checkFormTarget()`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 4.4_
  - [ ] 11.2 Write property test for the executor
    - **Property 2: The Executor accepts exactly the safe actions and changes only their target**
    - `tests/unit/accessforge-executor.test.ts`, at least 100 runs, jsdom against the real registration template.
    - **Validates: Requirements 8.1, 8.2, 8.6, 8.7, 8.8, 8.9, 17.3**
  - [ ] 11.3 Write property test for skip clearing
    - **Property 23: Skipping clears what was written**
    - `tests/unit/accessforge-executor.test.ts`, at least 100 runs.
    - **Validates: Requirements 8.11, 9.12**
  - [ ] 11.4 Implement `src/lib/accessforge/verifier.ts`
    - `readBack()`, `sameValue()` (strict `===`), `parseConfirmation()` and `compareReceived()` as in design Question 8.
    - _Requirements: 10.1, 10.3, 10.10, 10.11, 10.12, 11.7_
  - [ ] 11.5 Write property test for read-back comparison
    - **Property 3: Read-back comparison is exact equality**
    - `tests/unit/accessforge-verifier.test.ts`, at least 100 runs; whitespace, case, normalization-form, empty and one-character pairs.
    - **Validates: Requirements 10.1, 10.3, 17.4**
  - [ ] 11.6 Write property test for received-data comparison
    - **Property 19: Received data is verified against what was intended**
    - `tests/unit/accessforge-verifier.test.ts`, at least 100 runs.
    - **Validates: Requirements 10.10, 10.11, 10.12**

- [ ] 12. Checkpoint: pure agent logic
  - Run `npx vitest --run`. Ensure all tests pass, ask the developer if questions arise.

- [ ] 13. AI provider methods and page API routes
  - [ ] 13.1 Add `analyzePage` and `retranslatePage` to the provider interface and the mock provider
    - **Shared files:** `src/lib/ai/interface.ts`, `src/lib/ai/mock.ts`. Coordinate with FormBridge; additive change only.
    - Add `PageAnalyzeCall`, `PageRetranslateCall` and the two methods. Mock answers from `fixtures/mock-analysis/legacy-register.json` (per-language labels and questions, English fallback, reason for visit at confidence 0.6, generic entry for unknown ids), deterministic.
    - _Requirements: 6.2, 7.1, 7.7_
  - [ ] 13.2 Add the page prompt builders
    - **Shared file:** `src/lib/ai/prompt.ts`. Coordinate with FormBridge; new functions only.
    - `pageAnalyzeMessages()` and `pageRetranslateMessages()` with `<<<FORM_DATA` / `FORM_DATA>>>` delimiters, `<` and `>` escaped as `\u003c` and `\u003e`, and the untrusted-data instruction.
    - _Requirements: 4.5, 13.2_
  - [ ] 13.3 Write property test for prompt delimiting
    - **Property 11: Prompt data stays inside its delimiters**
    - `tests/unit/accessforge-prompt.test.ts`, at least 100 runs.
    - **Validates: Requirements 4.5, 13.2**
  - [ ] 13.4 Implement the two methods in the Workers AI provider
    - **Shared file:** `src/lib/ai/cf-workers.ts`. Coordinate with FormBridge.
    - `PAGE_TIMEOUT_MS = 20_000`, `max_completion_tokens` 1,500 and 2,000, temperature 0.2, same model settings as the existing methods. Tests use a fake binding only.
    - _Requirements: 6.2, 6.10_
  - [ ] 13.5 Implement `src/lib/analysis/run-page.ts`
    - `runPageAnalyze()` and `runPageRetranslate()` with the retry rule of design "Orchestration" (retry once on schema failure or timeout, no retry on quota, rate limit or unavailable; retranslate item count must match).
    - _Requirements: 6.10, 7.9_
  - [ ] 13.6 Implement `src/worker/cache/page-plan-cache.ts`
    - `lookupPagePlanCache(pageVersion, language)` over `import.meta.glob('./precomputed/pages/*.json', { eager: true })`, validated with `PrecomputedPagePlanSchema`; exact version and language match only. Create the empty `precomputed/pages/` folder.
    - _Requirements: 7.2, 3.5_
  - [ ] 13.7 Implement and register the page routes
    - **Shared files:** `src/worker/index.ts` (`ROUTES`), `src/worker/http.ts` (`LogEntry.analysisMode`). Coordinate with FormBridge.
    - `src/worker/routes/page-analyze.ts` (48 KB limit, schema validation, `UNSUPPORTED_LANGUAGE`, decision table of design Question 5, `validatePlan` before reply) and `src/worker/routes/page-retranslate.ts` (48 KB limit, count check, 503 and 504 errors). Both use the existing rate limit with key `route:ip` and metadata-only logs.
    - _Requirements: 6.1, 6.3, 6.10, 7.1, 7.2, 7.3, 7.7, 7.8, 13.5, 13.6_
  - [ ] 13.8 Write property test for analysis modes
    - **Property 17: The Analysis_Mode always names the source of the plan**
    - `tests/unit/accessforge-routes.test.ts`, at least 100 runs, scripted fake provider and injected cache.
    - **Validates: Requirements 3.5, 6.10, 7.1, 7.2, 7.3, 7.8**
  - [ ] 13.9 Write property test for invalid analysis requests
    - **Property 21: Invalid analysis requests never reach the provider**
    - `tests/unit/accessforge-routes.test.ts`, at least 100 runs.
    - **Validates: Requirements 6.3, 13.6**
  - [ ]* 13.10 Write unit tests for the mock provider and re-translation route
    - `tests/unit/accessforge-retranslate.test.ts`: mock determinism for identical inputs, count mismatch treated as invalid, previous wording kept on error codes.
    - _Requirements: 7.1, 7.7, 7.9_

- [ ] 14. Agent-loop reducer
  - [ ] 14.1 Implement `src/lib/accessforge/agent-machine.ts`
    - `agentReducer(state, event)` returning `{ state, effects }` with the states, transitions and rules of design Question 4 (expected loads, one click per confirm press, 15 s timeout state, error-page rewrite, edits, consent, cancel, language change never moves state). Add pure helpers for the step list, low-confidence check (below 0.7) and review rows.
    - _Requirements: 3.3, 3.6, 6.11, 7.7, 9.1, 9.2, 10.2, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.13, 12.1, 12.6, 12.7, 12.8_
  - [ ] 14.2 Write model-based property test for submission safety
    - **Property 16: One confirm press, at most one submit, and only verified fields count as filled**
    - `tests/unit/accessforge-agent-machine.test.ts`, at least 100 runs, generated event sequences.
    - **Validates: Requirements 3.3, 3.6, 7.7, 10.2, 10.6, 10.7, 10.13, 12.1, 12.7**
  - [ ] 14.3 Write property test for instruction-like page text
    - **Property 9: Page text cannot steer the agent**
    - `tests/unit/accessforge-extract.test.ts`, at least 100 runs, injected strings into label, cell, option and nearby texts; checks extractor, plan validator and reducer output.
    - **Validates: Requirements 4.6**
  - [ ] 14.4 Write property test for steps, options and review rows
    - **Property 22: Steps, options and review rows follow the plan**
    - `tests/unit/accessforge-plan-validator.test.ts`, at least 100 runs.
    - **Validates: Requirements 6.9, 6.11, 9.1, 10.4**

- [ ] 15. AccessForge interface strings
  - [ ] 15.1 Add the `accessforge.*` keys to every core locale file
    - **Shared files:** every interface locale file. Coordinate with FormBridge.
    - Keys for the data notice (wording approved in task 1.2), mode notices, scope notice, page-changed notice, heuristic question, steps, review, results, do-it-yourself reasons, errors of design "Error Handling", frame title and larger text. Malay legacy quotes are not stored here.
    - _Requirements: 7.5, 9.4, 11.1, 13.7, 13.9, 18.6_
  - [ ] 15.2 Write the locale completeness test
    - `tests/unit/accessforge-locales.test.ts`: every `accessforge.*` key exists and is non-empty in each core locale (`en`, `ms`, `zh-Hans`, `zh-Hant`, `ta`, `es`) and falls back to English for `id`.
    - _Requirements: 9.4, 13.9_

- [ ] 16. Mirror screens and frame
  - [ ] 16.1 Add `analyzePage` and `retranslatePage` to the API client
    - **Shared file:** `src/frontend/api.ts`. Coordinate with FormBridge; new functions only, each with a 45 s abort.
    - _Requirements: 6.15, 7.9_
  - [ ] 16.2 Implement `RevivalFrame.tsx` and the revival scope check
    - `src/frontend/accessforge/RevivalFrame.tsx`: `sandbox="allow-same-origin allow-forms"`, constant `src="/legacy/register"`, localized title, load events to the loop, write highlight through the CSSOM (4 px `stamp-blue`, 1 to 3 s, no smooth scroll or transition under reduced motion).
    - `src/lib/accessforge/scope.ts`: a pure helper that inspects URL parameters and route values and flags any address other than the portal.
    - _Requirements: 4.3, 8.5, 8.12, 18.1, 18.2_
  - [ ] 16.3 Write property test for the frame source
    - **Property 26: The frame source cannot be redirected**
    - `tests/unit/accessforge-allow-list.test.ts`, at least 100 runs.
    - **Validates: Requirements 18.1, 18.2**
  - [ ] 16.4 Implement `useAgentLoop.ts`
    - Runs reducer effects against the frame and the API: allow-list check on every load, extraction, analysis, execute, read-back, frame reload, 15 s timer, re-translation by mode (design Question 5), `beforeunload` while answers exist. State in memory only, no browser storage.
    - _Requirements: 3.2, 5.1, 6.1, 6.15, 7.7, 7.9, 8.4, 10.1, 10.8, 12.5, 13.4, 13.8_
  - [ ] 16.5 Implement the notice components
    - `DataNotice.tsx` (shown before analysis and again on review, acknowledge control), `ModeNotice.tsx` (icon and text per mode, Demo mode banner in mock), scope notice and page-changed notice; machine-translated label in `live`, `mock` and `cached`.
    - _Requirements: 3.5, 6.14, 7.5, 13.7, 13.8, 18.6_
  - [ ] 16.6 Implement `MirrorStep.tsx` and `LowConfidenceCheck.tsx`
    - One question per step for text, IC, phone, postcode, date (three inputs in a fieldset with format choice when needed), radio, select and consent; step indicator, back, next, skip (when not required), cancel; error tied with `aria-describedby`, `aria-live="polite"`, `aria-invalid`; original evidence with `lang="ms"`; accept or decline for confidence below 0.7.
    - _Requirements: 6.9, 6.11, 9.1, 9.2, 9.5, 9.6, 9.7, 9.8, 9.12, 14.1, 14.6, 14.7_
  - [ ] 16.7 Implement `MirrorReview.tsx` and `DoItYourselfList.tsx`
    - Review rows in Legacy_Form order with label, question, Intended_Value and one status (icon and text); confirm button disabled with a stated reason while a read-back is pending or differs or consent is missing; required do-it-yourself notice; do-it-yourself entries with `lang="ms"` label, reason and a control that scrolls and highlights the frame field.
    - _Requirements: 10.4, 10.5, 10.13, 12.2, 12.3, 12.8, 13.7_
  - [ ] 16.8 Implement `MirrorResult.tsx`
    - Verified completion (locale strings, Reference_Number exactly as read), show-original toggle with `lang="ms"` and focus kept on the control, original-unavailable state, not verified with differences, unknown outcome with the duplicate warning, stopped with reload control, skipped and do-it-yourself list. FormBridge link from one path constant with no answer values; shown only once the FormBridge sample-form route exists (open decision G).
    - _Requirements: 3.3, 10.8, 10.11, 10.12, 11.1, 11.2, 11.3, 11.4, 11.5, 11.7_
  - [ ] 16.9 Implement `RevivalScreen.tsx` and its styles
    - Split layout from design "Design Plan: Mirror screens" (frame beside Mirror at 1024 px and wider, show-original-page toggle below that), logical CSS properties, larger-text option at scale 1.25 in memory only, focus moved to the `h1` or step heading on each screen change, skip link, reduced-motion handling, cancel confirmation dialog with focus return.
    - _Requirements: 12.4, 12.6, 14.1, 14.2, 14.3, 14.4, 14.5, 14.10, 14.11, 14.12, 18.4_
  - [ ] 16.10 Wire the AccessForge screen into the app
    - **Shared file:** the app shell or router file and the language picker entry point. Coordinate with FormBridge.
    - Route to `RevivalScreen` after the language picker, `<html lang>` follows the interface language, no sign-in or saved progress.
    - _Requirements: 9.4, 14.6, 18.3, 18.4_
  - [ ]* 16.11 Write component tests for the Mirror
    - `tests/unit/accessforge-components.test.tsx`: mode notice per mode, machine-translated label in three modes and not in heuristic, `aria-invalid` set and removed, focus moves to the heading, show-original toggle keeps focus, do-it-yourself list and highlight control, scope notice.
    - _Requirements: 6.14, 7.5, 11.3, 12.2, 14.7, 14.10, 18.6_
  - [ ]* 16.12 Add the Mirror contrast pairs to the tokens test
    - **Shared file:** the existing tokens test. Coordinate with FormBridge.
    - Add the write-highlight pairs (against white, `#E0E0E0` and `#D4D0C8`).
    - _Requirements: 8.5, 14.3_

- [ ] 17. Checkpoint: Mirror in place
  - Run `npx vitest --run`. Ensure all tests pass, ask the developer if questions arise.

- [ ] 18. Privacy canary tests
  - [ ] 18.1 Write property test for canary leaks on the Worker side
    - **Property 24: Canary values never leave through a forbidden path**
    - `tests/unit/accessforge-privacy.test.ts`, at least 100 runs: frame-typed and Mirror-answer canaries absent from the Page_Model, analysis and re-translation bodies, prompts (recording fake provider), every Worker log entry (logger spy, including the legacy POST) and every error response.
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.5, 13.6, 13.10**
  - [ ] 18.2 Write the Playwright canary test
    - `tests/e2e/accessforge-privacy.spec.ts` with the mock provider: `CANARY-FRAME-5Q7Z` typed in the frame before revive, `CANARY-ANSWER-8K2M` as the full-name answer carried to confirmation; assert absence from request bodies, request URLs, localStorage, sessionStorage, IndexedDB, cookies and the FormBridge link, and presence only in the one Legacy_Form POST body.
    - _Requirements: 13.3, 13.4, 13.10_

- [ ] 19. End-to-end tests (mock provider)
  - [ ] 19.1 Write the Playwright acceptance scenario
    - `tests/e2e/accessforge-acceptance.spec.ts` at 1280 × 800 in `zh-Hans`, tagged `@smoke`: frame without Mirror, revive, data notice, every step, wrong IC `901301-10-1234` rejected with the `zh-Hans` message and the frame field empty, each frame field holds its Intended_Value within 2 s, low-confidence accept, review with eight `filled`, zero POSTs before confirm and exactly one after, verified result with a matching Reference_Number, original Malay text hidden until shown and then with `lang="ms"`. With `BASE_URL` set it checks by `lang`, step count and Element_Id instead of exact wording and finishes within 120 s.
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_
  - [ ] 19.2 Write the direct-versus-Mirror comparison test
    - `tests/e2e/accessforge-same-data.spec.ts`: two separate browser contexts, direct top-level submission of the Intended_Values and Mirror submission of the answers in design Question 8; identical Received_Fields_Summaries, eight entries in order with no button names, each value equal to its documented transformation, Reference_Number in the frame equal to the one the Mirror shows.
    - _Requirements: 15.1, 15.2, 15.3, 15.5, 15.6, 15.7_
  - [ ] 19.3 Write the navigation tests
    - `tests/e2e/accessforge-navigation.spec.ts`: unlisted path, Allow_List path with a query string and the home page during the question flow each stop the loop, run no Action, submit nothing and show "page is not supported"; a `url` parameter naming another address loads nothing and shows the scope message.
    - _Requirements: 3.7, 18.2_
  - [ ] 19.4 Write the hostile page tests
    - Add the raw hostile document and the instruction-like variant to `tests/e2e/helpers/hostile-pages.ts` (test-only, never under `src/`).
    - `tests/e2e/accessforge-hostile.spec.ts`: serve them with `page.route` and the real `LEGACY_CSP`; script does not run, external resources are not requested, the form-target check stops the loop before any Action, nothing is submitted, no pop-up or top navigation; the instruction-like variant gives the same Element_Ids and Actions as the real page.
    - _Requirements: 4.2, 4.3, 4.4, 4.6, 4.7, 4.9_
  - [ ] 19.5 Write the flow tests
    - `tests/e2e/accessforge-flows.spec.ts`: error page then rewrite and new confirm press, stalled POST gives the unknown outcome after 15 s, a changed frame value stops the loop with a mismatch, cancel confirmed and declined, reload starts fresh, leave-page warning, 360 px frame toggle keeps step and answers, reduced-motion highlight, scripts-disabled direct path from home to confirmation.
    - _Requirements: 1.9, 10.2, 10.8, 10.9, 12.4, 12.5, 12.6, 14.12, 18.4_
  - [ ] 19.6 Write the axe accessibility tests
    - `tests/e2e/accessforge-a11y.spec.ts` with `@axe-core/playwright`, tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`, iframe excluded, in `en` and `zh-Hans`, failing on any violation, for every state listed in Requirement 14.8.
    - _Requirements: 14.8, 14.9_

- [ ] 20. Precomputed page plans
  - [ ] 20.1 Add the page-plan step to the fixture cache script
    - **Shared files:** `scripts/generate-fixture-cache.ts`, `package.json` scripts if a new flag needs one. Coordinate with FormBridge.
    - `--pages`: render the registration page through `handleLegacy`, extract the Page_Model with the same extractor in jsdom, call the provider per core language (`en`, `ms`, `zh-Hans`, `zh-Hant`, `ta`, `es`), validate with `PagePlanReplySchema` and `validatePlan`, write `src/worker/cache/precomputed/pages/<pageVersion>-<bcp47>.json` only for passing replies, exit non-zero on any failure. Test the step with a fake provider: valid replies write files, an invalid reply writes nothing and exits non-zero.
    - _Requirements: 7.6_
  - [ ] 20.2 Generate the precomputed page plans (**needs `AI_MODE=real`**)
    - Reason for the real call: the precomputed page plans that back `cached` mode (Requirement 7.2, 7.6). Estimated cost about 240 neurons for six languages. The developer approves the run before it starts.
    - Run `npm run generate-fixture-cache -- --pages` with `AI_MODE=real`, commit only the schema-validated JSON files, record the measured neurons in design.md, and confirm the stale-plan check of task 5.8 passes. No raw model output is committed.
    - _Requirements: 7.2, 7.6, 13.11_

- [ ] 21. Documentation
  - [ ] 21.1 Add the AccessForge section to the manual accessibility checklist
    - **Shared file:** `docs/accessibility-checklist.md` (create the file if absent).
    - State that the legacy portal fails accessibility on purpose; add entries for a keyboard-only run, a screen-reader pass on the question, review and confirmation screens, 360 px, 200% zoom, reduced motion and larger text, each with pass or fail and the date. The developer records the results.
    - _Requirements: 14.9_
  - [ ] 21.2 Update the README
    - **Shared file:** `README.md`. Coordinate with FormBridge.
    - AccessForge scope section (one fictional portal and one form, tested interface languages and the `MY` pack, others experimental, real websites, cross-origin, login, CAPTCHA, script-driven sites and crawling not supported); pre-existing code disclosure for any library added; asset and font licences for the portal (system fonts, no images); note that the Malay legacy content file is the only non-English content outside the interface locale files; wording for the category per decision C once decided.
    - Apply the project's English writing style. Claim only what the tests in tasks 18 and 19 prove.
    - _Requirements: 1.3, 1.7, 18.5_
  - [ ] 21.3 Add Kiro usage log rows for features actually used
    - **Shared file:** `docs/kiro-usage-log.md`.
    - One row per real use only: this spec (requirements, design, tasks), each property test that found a bug (with the regression test name, per Requirement 17.10), and any hook, steering or MCP use during these tasks. Add rows as each use happens; this sub-task is the final sweep that nothing was missed or invented.
    - _Requirements: 17.10_

- [ ] 22. Final checkpoint
  - Run `npx vitest --run` and `npm run test:e2e`. Ensure all tests pass, ask the developer if questions arise.

- [ ] 23. Deployed acceptance and final review
  - [ ] 23.1 Run the deployed acceptance smoke test (**needs `AI_MODE=real`** on the deployed Worker)
    - Reason for the real call: Requirement 16.2 and 16.7 require the acceptance scenario to pass against the deployed public URL. The developer deploys and starts the run on purpose; it never runs in CI or the default test command.
    - Run `npm run test:e2e -- --grep @smoke` with `BASE_URL` set to the public URL. Record the Analysis_Mode reported, the duration and the result. If it fails, report the failure and do not mark the spec complete.
    - _Requirements: 13.11, 16.2, 16.7_
  - [ ] 23.2 Run the final pre-submission checklist review
    - Report every checklist item as done, not done or not applicable, with evidence (test names, commit hashes, URLs).
    - Raise every decision still open, including the hackathon category (design open decision C), instead of dropping it.
    - _Requirements: 16.7, 18.5_

## Notes

- Tasks marked with `*` are optional example or component tests. Every property test, the canary tests, the acceptance scenario, the direct-versus-Mirror comparison, the hostile page tests, the axe tests and the Page_Version recorded-hash test are required.
- Every property test runs at least 100 cases, prints the fast-check seed on failure, and carries no `skip` or `only`. A property that cannot pass yet stays failing or is marked `todo` with the reason and the fixing task (Requirement 17.9).
- A shrunk counterexample becomes a named regression test with the seed in a comment, confirmed failing before the fix, and gets a usage-log row (Requirement 17.10).
- Tasks marked **Shared file** must be coordinated with the parallel FormBridge work before they start.
- No task commits raw model output, personal data or secrets.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5"] },
    { "id": 1, "tasks": ["2.1", "3.1", "7.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.1", "4.2", "4.3", "7.2"] },
    { "id": 3, "tasks": ["4.4", "7.3", "8.1", "10.1", "13.1"] },
    { "id": 4, "tasks": ["4.5", "4.6", "7.4", "8.2", "9.1", "10.2", "13.2"] },
    { "id": 5, "tasks": ["5.1", "8.3", "9.2", "9.3", "10.3", "11.1", "13.3", "13.4"] },
    { "id": 6, "tasks": ["5.2", "8.4", "9.4", "10.4", "11.2", "11.4", "13.5"] },
    { "id": 7, "tasks": ["5.3", "11.3", "11.5", "13.6"] },
    { "id": 8, "tasks": ["5.4", "5.10", "11.6", "14.1"] },
    { "id": 9, "tasks": ["5.5", "5.9", "13.7", "14.2", "15.1"] },
    { "id": 10, "tasks": ["5.6", "13.8", "14.3", "15.2", "16.1"] },
    { "id": 11, "tasks": ["5.7", "13.9", "13.10", "14.4", "16.2"] },
    { "id": 12, "tasks": ["5.8", "16.3", "16.4", "16.5"] },
    { "id": 13, "tasks": ["16.6", "16.7", "16.8"] },
    { "id": 14, "tasks": ["16.9"] },
    { "id": 15, "tasks": ["16.10", "16.11", "16.12"] },
    { "id": 16, "tasks": ["18.1", "19.1", "19.2", "19.3", "21.1"] },
    { "id": 17, "tasks": ["18.2", "19.4", "19.5", "19.6", "20.1"] },
    { "id": 18, "tasks": ["20.2"] },
    { "id": 19, "tasks": ["21.2"] },
    { "id": 20, "tasks": ["21.3", "23.1"] },
    { "id": 21, "tasks": ["23.2"] }
  ]
}
```
