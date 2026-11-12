# Implementation Plan: AccessForge Skeleton

## Overview

The plan builds the AccessForge walking skeleton in TypeScript, in the order the design's data path runs. First comes the fictional legacy portal: a build step generates and verifies static Legacy_Templates, and the Worker serves them with escaped dynamic parts. Next is the pure agent logic in the browser (Allow_List, Revival_Generation, extractor, plan validator, transformations, executor, verifier). Then come the AI provider method and the page-analysis route, the agent-loop reducer, and the Mirror screens. The end-to-end, privacy and accessibility tests on the demo path close Slice 1.

**Slices.** Every task carries a Slice label that matches "Delivery slices" in requirements.md and design.md.

- **Slice 1** (tasks 1 to 23) is the complete story and the only slice needed for acceptance. Every Slice 1 sub-task is required.
- **Slice 2** (tasks 24 to 27) is optional and not needed for acceptance. It covers the heuristic analysis mode, generalized control types, language switching with re-translation, skipping, the low-confidence accept-or-decline flow, manual-field recovery, and every property test beyond the five core ones (design Properties 1, 2, 3, 4 and 7). Slice 2 sub-tasks carry the optional marker `*`. No Slice 1 task depends on a Slice 2 task.

**Group 1 runs first.** Decisions A, B, D, E, F, G, H, I and J are approved, and decision C is deferred to gate G2 (Nov 25). Group 1 applies or records them. It is no longer a waiting gate, but it must finish before any other AccessForge task starts. Tasks 1.1 and 1.2 edit shared files and are done as the first implementation step.

FormBridge (`formbridge-pdf`) is being built in parallel. AccessForge work therefore goes into its own new folders (`scripts/build-legacy-templates.ts`, `src/lib/legacy-build/`, `src/worker/legacy/`, `src/lib/accessforge/`, `src/frontend/accessforge/`, `src/shared/page-schemas.ts`, `tests/unit/accessforge-*`, `tests/unit/legacy-*`, `tests/e2e/accessforge-*`). Every task that edits a file FormBridge also uses is marked **Shared file**. Pull first, keep the change small, and commit it on its own. Shared files touched by this plan:

- `.kiro/steering/privacy.md` and every interface locale file (tasks 1.1, 1.2, 15.1, 25.5)
- `src/lib/ai/interface.ts`, `src/lib/ai/mock.ts`, `src/lib/ai/prompt.ts`, `src/lib/ai/cf-workers.ts` (tasks 13.1, 13.2, 13.4, 25.1, 25.2)
- `src/worker/index.ts`, `wrangler.jsonc` (tasks 5.11, 13.7, 25.3, 25.4)
- `package.json` scripts (tasks 4.5, 20.1)
- `playwright.config.ts` (task 19.1)
- `src/frontend/api.ts`, the app shell or router file, the tokens test (tasks 16.1, 16.11, 16.14, 25.5)
- `scripts/generate-fixture-cache.ts` (task 20.1)
- `README.md`, `docs/kiro-usage-log.md`, `docs/accessibility-checklist.md` (tasks 21.1 to 21.3)

**FormBridge sample-form link.** The Mirror confirmation screen (task 16.8) and the legacy confirmation template (task 4.3) link to `SAMPLE_FORM_PATH` from `src/shared/app-paths.ts`, unconditionally. That constant and its route belong to a FormBridge "Try a sample form" task that opens `fixtures/clinic-registration.pdf` with every field empty. That task must be added to the `formbridge-pdf` spec; this file does not add it. Task 1.6 checks that it is done before tasks 4.3 and 16.8 start.

**Real AI.** Automated tests never call real AI; every test uses the mock provider. Real calls happen only in the deployed app while `AI_MODE=real`, in named scripts run by hand, and in smoke tests the developer starts on purpose. In this plan only tasks 20.2 and 23.1 make real calls, each marked **needs `AI_MODE=real`** with its reason.

## Tasks

- [x] 1. Apply and record the approved decisions (Slice 1, runs before every other AccessForge task)
  - [x] 1.1 Apply the approved privacy rule change (Slice 1)
    - **Shared file:** `.kiro/steering/privacy.md`. Done as the first implementation step.
    - Add the decision A text: for AccessForge, the Page_Model (control types, names, ids, label, neighbouring-cell, next-row, option and nearby text, `required`, `maxlength`, position, Page_Version) and, in Slice 2, the re-translation payload (existing human labels and questions plus the target language) may reach the Worker and the AI service. Confirmed answers go only to the Legacy_Handler on the ReForge app's own Worker, which processes them in memory for that request, renders them back once, and never stores or logs them.
    - _Requirements: 13.1, 13.2, 13.3, 13.5, 13.12_
  - [x] 1.2 Apply the approved privacy notice text to every locale file (Slice 1)
    - **Shared file:** every interface locale file (`en`, `ms`, `zh-Hans`, `zh-Hant`, `ta`, `es`, plus experimental files only where they already carry the FormBridge notice). Done as the first implementation step, in the same change as 1.1.
    - Keep the FormBridge notice as it is. Add the Slice 1 AccessForge data notice keys of design Question 7 (`accessforge.notice.title`, `.pageText`, `.answersStay`, `.legacyOnly`, `.acknowledge`). Leave out the Slice 2 key `accessforge.notice.retranslate` (task 25.5 adds it).
    - _Requirements: 13.7, 13.9_
  - [x] 1.3 Record decision B as decided (Slice 1)
    - The Malay portal content lives at `src/packs/language/locales/legacy-portal/ms.json`, outside the Language_Registry. The same rule covers the mock page-plan table `fixtures/mock-analysis/legacy-register.json`. Tasks 4.1, 13.1 and 21.2 use these paths.
    - _Requirements: 1.7, 1.11_
  - [x] 1.4 Record decision F as decided (Slice 1)
    - For a checkbox only, the visible text of the next control-free table row is one more evidence item (`nextRowText`, at most 200 characters). Requirements 5.4, 5.6 and 9.8 and design Question 2 already say so; task 8.1 implements it.
    - _Requirements: 5.4, 5.6, 9.8_
  - [x] 1.5 Record decisions D, E, G, H, I and J as decided and decision C as deferred (Slice 1)
    - D: answers do not carry into FormBridge. E: below 1024 px the frame sits behind a show control. G: the FormBridge sample-form route exports `SAMPLE_FORM_PATH`. H: larger-text scale 1.25 inside the Mirror. I: lengths counted in UTF-16 code units. J: the banner keeps at least 7:1.
    - C (how the module is described in the README, the Mirror scope notice and the submission text) is deferred to gate G2 (Nov 25). Keep those words out of code until it is decided, and raise it again in task 23.2 if still open.
    - _Requirements: 9.9, 11.5, 12.4, 14.11, 17.8, 1.12_
  - [x] 1.6 Check that the FormBridge sample-form route is in place (Slice 1)
    - Prerequisite of tasks 4.3 and 16.8. The FormBridge "Try a sample form" task in the `formbridge-pdf` spec must be done first; this file does not add that task.
    - `tests/unit/accessforge-sample-path.test.ts`: `SAMPLE_FORM_PATH` is exported from `src/shared/app-paths.ts`, is a same-origin path with no query string, and is not under `/legacy/`.
    - _Requirements: 11.5, 11.6_

- [x] 2. Shared page schemas in their own file (Slice 1)
  - [x] 2.1 Create `src/shared/page-schemas.ts` (Slice 1)
    - New file, so `src/shared/schemas.ts` stays untouched. Reuse `AnswerTypeSchema` by import only.
    - Define `ElementIdSchema`, `ControlTypeSchema`, `PageOptionSchema` (with the radio option `elementId`), `PageEntrySchema` (with `nextRowText`), `PageModelSchema`, `PagePlanEntrySchema` (strict, length-capped, non-blank model text), `PagePlanReplySchema`, `AnalysisModeSchema`, `PageAnalyzeRequestSchema`, `PageAnalyzeResponseSchema`, `PrecomputedPagePlanSchema` and `ActionSchema` as in design "Data Models". Export inferred types. The re-translation schemas are added in task 25.1.
    - _Requirements: 6.3, 6.6, 8.1, 8.13, 13.1_
  - [x] 2.2 Write unit tests for the page schemas (Slice 1)
    - `tests/unit/accessforge-schemas.test.ts`: strict objects reject extra keys; label 1 to 80 and question 1 to 200 characters; blank text rejected; confidence bounds; `ActionSchema` rejects `Click` and `submit`; a question containing `<a href="https://example.com">` passes the schema (the schema caps length only and makes no claim about content).
    - _Requirements: 6.6, 6.17, 8.2_

- [ ] 3. Legacy HTML builder and sanitiser, build and test only (Slice 1)
  - [ ] 3.1 Implement `src/lib/legacy-build/html.ts` (Slice 1)
    - `h()`, `sanitizeTree()` (removes elements outside the allow-list together with their whole subtree), `serialize()` (escapes text and attributes, turns slots into split points) and `findUnsafeConstructs()` (scans tag text only), with the tag, attribute and URL rules of design Question 6. No DOM dependency. Never imported by `src/worker/`.
    - _Requirements: 4.1, 4.8, 4.10, 2.10_
  - [ ] 3.2 Write the hostile tree tests (Slice 1)
    - Create `tests/e2e/helpers/hostile-pages.ts` (test-only, never under `src/`) with the hostile node tree: script, inline handler, `javascript:` link, external image and stylesheet, meta refresh, foreign form `action`, submit button with a foreign `formaction`.
    - `tests/unit/legacy-html.test.ts`: `findUnsafeConstructs(serialize(tree))` reports every one of those constructs; `findUnsafeConstructs(serialize(sanitizeTree(tree)))` is empty; text inside a removed element is absent from the output; text in kept elements is unchanged; an escaped `javascript:` text value gives no finding.
    - _Requirements: 4.1, 4.7, 4.8_

- [ ] 4. Legacy portal content, stylesheet and template generator (Slice 1)
  - [ ] 4.1 Create the legacy form specification and the Malay content file (Slice 1)
    - `src/worker/legacy/form-spec.ts` with `LEGACY_FORM` (eight fields, names, controls, `maxlength`, `required`, option and checkbox values) as in design "Legacy form specification".
    - `src/packs/language/locales/legacy-portal/ms.json` with the typed keys of design "Templates and content", and `src/lib/legacy-build/content.ts` that loads it with typed keys. Only invented names and organisations; no real agency name, logo or domain.
    - _Requirements: 1.3, 1.5, 1.7_
  - [ ] 4.2 Create `public/legacy-assets/portal.css` and its check (Slice 1)
    - The 2005-style stylesheet of design "Design Plan: Legacy_Portal": px sizes at 12 px or less, label `#808080` on `#E0E0E0` and body `#999999` on white, 760 px table layout, nested menu with `:hover` and `:focus-within`, banner black on `#FFFF99`. No `url(` and no `@import`.
    - `tests/unit/legacy-css.test.ts`: no `url(` or `@import`; the label and body colour pairs stay below 4.5:1; the banner pair is at least 7:1.
    - _Requirements: 1.6, 1.9, 1.12, 4.1_
  - [ ] 4.3 Implement the template trees in `src/lib/legacy-build/templates.ts` (Slice 1)
    - Requires task 1.6 (`SAMPLE_FORM_PATH`) and task 7.2 (`ALLOW_LIST`).
    - `homePage()`, `registerPage()`, `confirmationPage()`, `errorPage()` and `notFoundPage()` built only with `h()` from one layout: banner first, five-entry menu with the register link nested in the last ("others") entry and the other four plain text or links to `/legacy/`, content table, footer, `lang="ms"`, `portal-page` meta, empty `portal-page-version` meta on home and register, one stylesheet link to `/legacy-assets/portal.css`.
    - Registration form with every field empty and the eight legacy traits; consent explanation in the next control-free row. Confirmation tree with `#ringkasan-diterima`, `#rujukan`, `#mesej-pengesahan`, the slots `reference` and `summaryRows`, and the Malay link to `SAMPLE_FORM_PATH`. Error tree with the `failingNames` slot and a link to `/legacy/register`. Not-found tree with the banner, a short message, no form controls and exactly one link, to `/legacy/`. Row templates for summary rows and failing names.
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10, 2.1, 2.3, 3.11, 4.10, 11.6_
  - [ ] 4.4 Implement `src/lib/legacy-build/page-version.ts` (Slice 1)
    - `computePageVersion(html)`: SHA-256, lowercase hex, of the UTF-8 bytes with the `portal-page-version` content set to the empty string (design Question 1), using `crypto.subtle.digest`.
    - _Requirements: 3.4_
  - [ ] 4.5 Implement the template generator `scripts/build-legacy-templates.ts` (Slice 1)
    - **Shared file:** `package.json` scripts (`build:legacy`, and calls from `prebuild` and `predev`).
    - Build each tree, run `sanitizeTree`, `serialize`, then `findUnsafeConstructs` over the joined segments with every slot replaced by a hostile probe value. On any finding exit non-zero with the template name and the construct. Stamp the Page_Version of the home and registration templates. Write the committed file `src/worker/legacy/generated/templates.ts` with `TEMPLATES`, `ROW_TEMPLATES`, `PAGE_VERSIONS` and the `GeneratedTemplate` and `SlotName` types.
    - _Requirements: 2.11, 3.4, 4.1, 4.8_
  - [ ] 4.6 Write the template tests (Slice 1)
    - `tests/unit/legacy-templates.test.ts`: regenerating every template in memory equals the committed `generated/templates.ts` (stale-file test); no listed construct in any generated template; the generator fails with template name and construct on a hostile tree (fake input); banner is the first visible element on every document; five menu entries with the register link nested in the last; form structure equals `LEGACY_FORM`; DOM-checkable legacy traits; `lang="ms"`; every GET text node comes from the content file; empty initial state; no images; not-found has no form control and exactly one link, to `/legacy/`.
    - _Requirements: 1.2, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10, 4.1, 4.8_

- [ ] 5. Worker serving, legacy handler and wiring (Slice 1)
  - [ ] 5.1 Implement `src/worker/legacy/escape.ts` and `src/worker/legacy/render.ts` (Slice 1)
    - `escapeHtml()` encoding `& < > " '`; `fill(template, values)` that joins segments with already-escaped slot values. No sanitiser, no DOM, no hash.
    - _Requirements: 2.10, 2.11_
  - [ ] 5.2 Implement `src/worker/legacy/respond.ts` (Slice 1)
    - `LEGACY_CSP` (`default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'`) and `legacyResponse()` setting CSP, `Cache-Control: no-store`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` and the content type, for HTML and for shared-error-shape JSON rejections.
    - _Requirements: 2.6, 4.2_
  - [ ] 5.3 Implement `src/worker/legacy/submission.ts` (Slice 1)
    - `parseSubmission()` reads only the body with `URLSearchParams`, keeping order and repeats; `validateSubmission()` applies the rules of Requirement 2.2 against `LEGACY_FORM`, counting length in UTF-16 code units, and returns every failing name plus an `unknownPresent` flag.
    - _Requirements: 2.2, 2.7_
  - [ ] 5.4 Implement `src/worker/legacy/reference.ts` (Slice 1)
    - `newReferenceNumber(now, randomDigits)` giving `SR-DEMO-YYYYMMDD-NNNNNN` from the UTC date and injected digits (`crypto.getRandomValues` in production). No submitted value is an input.
    - _Requirements: 2.9_
  - [ ] 5.5 Implement `src/worker/legacy/handler.ts` (Slice 1)
    - `handleLegacy(request, deps)` with the dispatch table of design "Request dispatch": GET home and register serve `TEMPLATES` unchanged; POST register checks content type and the 16,384-byte limit, parses, validates, and returns the confirmation (200) or error page (422) through `fill`; other methods give `METHOD_NOT_ALLOWED`; unlisted GET paths give the not-found document (404). Values rendered as escaped text only, never logged, never in headers, URLs or redirects. No sanitiser and no hash per request. Imports only `generated/templates.ts`, `escape.ts`, `render.ts` and the modules of this group.
    - _Requirements: 1.1, 1.9, 1.10, 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.11, 13.5, 13.6_
  - [ ] 5.6 Write example tests for submissions and the summary (Slice 1)
    - `tests/unit/legacy-handler-examples.test.ts`: one body per rule of Requirement 2.2 (missing, blank, repeated and unknown names, wrong consent and gender, over `maxlength` in UTF-16 units); the error page names every failing field at once, links to `/legacy/register`, has no Reference_Number, no submitted value and no unknown name; a valid body with markup characters and surrounding spaces gives a summary of eight entries in order with values exactly as received and no added element; a query string on the URL has no effect; the reference with a fixed clock and random source.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 2.9, 2.10_
  - [ ] 5.7 Write example tests for limits, headers and the not-found document (Slice 1)
    - `tests/unit/legacy-handler-limits.test.ts`: 16,384 bytes accepted and 16,385 rejected; a JSON content type rejected; PUT and DELETE rejected; no Reference_Number on any rejection; CSP and `no-store` on every response kind, including JSON rejections and the not-found document; no response header contains a submitted value; `/legacy/x`, `/legacy/register/` and `/legacy/admin` give 404 with the banner, no form control and one link to `/legacy/`.
    - _Requirements: 1.10, 2.6, 2.7, 2.8, 4.2_
  - [ ] 5.8 Write the served-document safety and static-serving tests (Slice 1)
    - `tests/unit/legacy-served-safety.test.ts`: every served document (both GET pages, a confirmation and an error page rendered with values containing markup characters, the not-found document) contains no script, no inline handler, no external resource, no form `action` or `formaction` outside the Worker's origin, and none of the other constructs of Requirement 4.1; `a` links point only to Allow_List GET paths and, on the confirmation, `SAMPLE_FORM_PATH`.
    - Spies show that `handleLegacy` calls neither `sanitizeTree`, `findUnsafeConstructs` nor `crypto.subtle.digest`; no module under `src/worker/` imports `src/lib/legacy-build/`; every text node of a served document is a content-file string or an escaped dynamic part of that response.
    - _Requirements: 2.10, 2.11, 3.11, 4.1, 4.7, 4.10_
  - [ ] 5.9 Record the supported Page_Versions and write the recorded-hash test (Slice 1)
    - Fill `src/lib/accessforge/supported-versions.ts` (`SUPPORTED_PAGE_VERSIONS`) and the Page_Version table in design Question 1 with the generated hashes.
    - `tests/unit/accessforge-page-versions.test.ts`: for GET `/legacy/` and GET `/legacy/register`, the hash recomputed from the served HTML equals the served meta, `PAGE_VERSIONS` and `SUPPORTED_PAGE_VERSIONS`; confirmation, error and not-found documents carry no version meta; the test fails when any file in `src/worker/cache/precomputed/pages/` is keyed by an unsupported version (an absent folder passes).
    - _Requirements: 3.4_
  - [ ] 5.10 Write the CPU measurement test (Slice 1)
    - `tests/unit/legacy-cpu.test.ts`: for GET `/legacy/`, GET `/legacy/register` and a valid POST with values at their `maxlength`, warm up 50 calls of `handleLegacy`, then time 500; fail when the 99th percentile exceeds 2 ms (a fifth of the 10 ms free-plan CPU limit). Record the Node p50 and p99 in the CPU table of design Question 6. The deployed reading is task 23.1.
    - _Requirements: 2.12_
  - [ ] 5.11 Wire the legacy routes into the Worker (Slice 1)
    - **Shared files:** `src/worker/index.ts`, `wrangler.jsonc`.
    - Dispatch `/legacy` and `/legacy/*` to `handleLegacy` before the assets binding; set `assets.run_worker_first` to `["/api/*", "/legacy", "/legacy/*"]`; legacy log entries carry only the allowed log items with route `/legacy/` or `/legacy/register`.
    - `tests/unit/legacy-routes.test.ts`: the Worker serves no `/legacy/` documents other than those Requirement 1.1 lists; a legacy POST log entry contains no field name and no value.
    - _Requirements: 1.1, 4.7, 13.5_

- [ ] 6. Checkpoint: legacy portal (Slice 1)
  - Run `npx vitest --run`. Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Element_Ids, Allow_List and Revival_Generation (Slice 1)
  - [ ] 7.1 Implement `src/lib/accessforge/element-id.ts` (Slice 1)
    - `elementIdFor()` and `parseElementId()` with the formula of design Question 2 (`encodeURIComponent` on name and radio value), including radio option ids.
    - _Requirements: 5.3, 8.3, 8.13_
  - [ ] 7.2 Implement `src/lib/accessforge/allow-list.ts` (Slice 1)
    - `ALLOW_LIST` with the four entries, `checkFrameDocument()` with the four steps of design Question 1 (origin, exact path, no query or hash, page type meta), and `checkFormTarget()` for the form `action`, `method` and the submit button's `formaction`, `formmethod` and `formtarget`. Document in a comment that the check is defence in depth after load.
    - _Requirements: 3.1, 3.2, 3.11, 4.4_
  - [ ] 7.3 Implement `src/lib/accessforge/generation.ts` (Slice 1)
    - `FrameHandle` and `nextGeneration(handle, doc)` as in design "Revival_Generation"; a helper that tells whether an effect's generation and document are still current.
    - `tests/unit/accessforge-generation.test.ts`: the counter increases on every call; a handle with a replaced document is not current even at the same Page_Version.
    - _Requirements: 3.9, 3.10_
  - [ ] 7.4 Write example tests for the frame and form-target checks (Slice 1)
    - `tests/unit/accessforge-allow-list-examples.test.ts` (jsdom, documents from `generated/templates.ts` and `tests/e2e/helpers/hostile-pages.ts`): each of the four transitions accepted; another origin, `/legacy/register/`, a query string, a hash, a missing and an unknown page type refused; the real form passes `checkFormTarget`; the hostile form `action` and the foreign `formaction` fail it.
    - _Requirements: 3.2, 4.4, 4.9_

- [ ] 8. Page extractor (Slice 1)
  - [ ] 8.1 Implement `src/lib/accessforge/extract.ts` (Slice 1)
    - `extractPageModel(doc, pageVersion)` reading attributes and text nodes only, never `.value`, `.checked`, `.selected` or their defaults, skipping hidden inputs; one entry per Legacy_Field with radio groups combined and option Element_Ids listed; evidence of Requirement 5.4 including `nextRowText` for a checkbox; limits of Requirement 5.6; refusals `UNREADABLE`, `NO_FORM`, `MULTIPLE_FORMS`, `TOO_MANY_CONTROLS` and `SUBMIT_COUNT` (zero or more than one submit button). No network request.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.10, 6.19_
  - [ ] 8.2 Write property test for entered state (Slice 1, core)
    - **Property 4: Entered state never reaches the Page_Model**
    - `tests/unit/accessforge-extract.test.ts`, jsdom against `TEMPLATES.register` parsed with `DOMParser`; at least 100 runs, seed printed on failure, no `skip` or `only`; asserts the untouched page has ten entries.
    - **Validates: Requirements 5.2, 5.5, 5.7, 17.5, 17.9**
  - [ ] 8.3 Write example tests for evidence and refusals (Slice 1)
    - `tests/unit/accessforge-extract-examples.test.ts`: the ten Element_Ids of design Question 2; label, neighbouring-cell and nearby text of each field; `nextRowText` set for the consent checkbox and empty for every other control; truncation at 200 characters; 50 controls accepted and 51 refused; no form; two forms; zero and two submit buttons give `SUBMIT_COUNT`; unreadable document; extraction finishes within 1 second with no network request (fetch spy).
    - _Requirements: 5.1, 5.3, 5.4, 5.6, 5.10, 6.19_

- [ ] 9. Plan validator (Slice 1)
  - [ ] 9.1 Implement `src/lib/accessforge/plan-validator.ts` (Slice 1)
    - `validatePlan(model, rawEntries)` with rules 1 to 7 of design Question 3: envelope, strict entry parse, known non-button target, first wins, compatibility table with implied type and confidence 0, coverage (mapped or Do_It_Yourself), buttons by control type alone. Options never come from the plan.
    - _Requirements: 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.12, 6.13_
  - [ ] 9.2 Write property test for plan validation (Slice 1, core)
    - **Property 1: Plan validation keeps only trustworthy entries and covers every field**
    - `tests/unit/accessforge-plan-validator.test.ts`, at least 100 runs, seed printed on failure, no `skip` or `only`; generator includes every case of Requirement 17.2 and a fully valid plan that must map every field.
    - **Validates: Requirements 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.12, 6.13, 17.1, 17.2, 17.9**

- [ ] 10. Answer transformations (Slice 1)
  - [ ] 10.1 Implement `src/lib/accessforge/transformations.ts` (Slice 1)
    - `toIntendedValue()` calling the shared `validateAnswer` with `myPack`, then the legacy length check with `legacyLength()` (UTF-16 code units); the date from three parts through `isValidCalendarDate` and `formatDate`; `detectLegacyDateFormat()` with the shared `detectDateFormat` plus the `HH/BB/TTTT` rule, returning `ambiguous` when two formats are found. No change to the shared validators and no own validation rule.
    - _Requirements: 9.5, 9.7, 9.9, 9.10, 9.11, 9.14, 15.4_
  - [ ] 10.2 Write property test for answer acceptance (Slice 1, core)
    - **Property 7: The Mirror accepts exactly the answers that are present, well-typed and fit**
    - `tests/unit/accessforge-transformations.test.ts`, at least 100 runs, seed printed on failure, no `skip` or `only`; blank and whitespace-only answers, answers failing and passing the `MY` rule, characters outside the Basic Multilingual Plane, lengths 0 to `maxlength` + 5 including both edges; rejected answers kept untruncated; accepted values also pass `validateSubmission`.
    - **Validates: Requirements 9.5, 9.6, 9.9, 2.2, 17.8, 17.9**
  - [ ] 10.3 Write example tests for the documented transformations (Slice 1)
    - `tests/unit/accessforge-transformations-examples.test.ts`: every row of the per-field table in design Question 8; dates 1 January 1990, 29 February 2000 accepted and 29 February 1990, day 32, month 13 rejected with no value; `HH/BB/TTTT` gives `DD/MM/YYYY`; two formats give `ambiguous`.
    - _Requirements: 9.7, 9.10, 9.11, 15.4, 15.5, 15.6_

- [ ] 11. Executor and verifier (Slice 1)
  - [ ] 11.1 Implement `src/lib/accessforge/executor.ts` (Slice 1)
    - `execute(action, ctx)` with checks 1 to 13 of design "Executor" in order, all before any write: strict schema, stale generation or replaced document, Page_Version, membership (entry ids and radio option ids), kind and control type (a `check` on the radio group id rejected), reset, Do_It_Yourself, length, option, consent, submit armed, form target, exactly one element. Location through `form.elements` by type, exact name and radio value; no selector from the plan. Submit with `form.requestSubmit()`.
    - _Requirements: 3.9, 4.4, 4.9, 8.1, 8.2, 8.3, 8.4, 8.6, 8.7, 8.8, 8.9, 8.10, 8.13, 8.14, 10.7_
  - [ ] 11.2 Write property test for the executor (Slice 1, core)
    - **Property 2: The Executor accepts exactly the safe actions and changes only their target**
    - `tests/unit/accessforge-executor.test.ts`, jsdom against `TEMPLATES.register`, at least 100 runs, seed printed on failure, no `skip` or `only`; generator includes every case of Requirement 17.3, including the submit guard before and after the confirm press and after a submission, and Actions from an earlier Revival_Generation.
    - **Validates: Requirements 3.9, 8.1, 8.2, 8.3, 8.6, 8.7, 8.8, 8.9, 8.13, 8.14, 10.7, 17.3, 17.9**
  - [ ] 11.3 Write example tests for executor edge cases (Slice 1)
    - `tests/unit/accessforge-executor-examples.test.ts`: a missing element gives `NOT_FOUND` and a duplicated one `AMBIGUOUS`, both with no write; a write stamped with an old generation or a replaced document is rejected; a changed version meta rejects every Action; on the hostile form the click is rejected with `FORM_TARGET` and nothing is submitted.
    - _Requirements: 3.9, 4.9, 8.10, 8.14_
  - [ ] 11.4 Implement `src/lib/accessforge/verifier.ts` (Slice 1)
    - `readBack()` (with generation check), `sameValue()` (strict `===`), `parseConfirmation()` and `compareReceived()` as in design Question 8.
    - _Requirements: 10.1, 10.3, 10.10, 10.11, 10.12, 11.7_
  - [ ] 11.5 Write property test for read-back comparison (Slice 1, core)
    - **Property 3: Read-back comparison is exact equality**
    - `tests/unit/accessforge-verifier.test.ts`, at least 100 runs, seed printed on failure, no `skip` or `only`; whitespace, case, normalization-form, empty and one-character pairs.
    - **Validates: Requirements 10.1, 10.3, 17.4, 17.9**
  - [ ] 11.6 Write example tests for received-data comparison (Slice 1)
    - `tests/unit/accessforge-verifier-examples.test.ts`: a changed value, a missing `filled` entry, an unknown name, an absent and a malformed reference each give a difference; a checkbox matches on its own `value`; skipped and do-it-yourself fields are not compared; a missing `#mesej-pengesahan` gives `originalText: null`.
    - _Requirements: 10.10, 10.11, 10.12, 11.7_

- [ ] 12. Checkpoint: pure agent logic (Slice 1)
  - Run `npx vitest --run`. Ensure all tests pass, ask the user if questions arise.

- [ ] 13. AI provider method and page-analysis route (Slice 1)
  - [ ] 13.1 Add `analyzePage` to the provider interface and the mock provider (Slice 1)
    - **Shared files:** `src/lib/ai/interface.ts`, `src/lib/ai/mock.ts`. Additive change only.
    - `PageAnalyzeCall` and `analyzePage`. Mock answers from `fixtures/mock-analysis/legacy-register.json` (labels and questions in `en` and `zh-Hans`, English fallback, reason for visit at confidence 0.6, generic entry for unknown ids), deterministic.
    - _Requirements: 1.11, 6.2, 7.1_
  - [ ] 13.2 Add `pageAnalyzeMessages()` to the prompt builders (Slice 1)
    - **Shared file:** `src/lib/ai/prompt.ts`. New function only.
    - Page_Model JSON between `<<<FORM_DATA` and `FORM_DATA>>>`, every `<` and `>` written as `\u003c` and `\u003e`, and the instruction that the block is untrusted form data that cannot change the task or the reply schema.
    - _Requirements: 4.5, 13.2_
  - [ ] 13.3 Write example tests for prompt delimiting (Slice 1)
    - `tests/unit/accessforge-prompt-examples.test.ts`: a Page_Model whose texts contain both markers, angle brackets, quotes and newlines gives exactly one opening and one closing marker, the block parses back to an equal Page_Model, and the untrusted-data instruction is present.
    - _Requirements: 4.5, 13.2_
  - [ ] 13.4 Implement `analyzePage` in the Workers AI provider (Slice 1)
    - **Shared file:** `src/lib/ai/cf-workers.ts`.
    - `PAGE_TIMEOUT_MS = 20_000`, `max_completion_tokens` 1,500, temperature 0.2, same model settings as the existing methods. Tests use a fake binding only.
    - _Requirements: 6.2, 6.10_
  - [ ] 13.5 Implement `runPageAnalyze()` in `src/lib/analysis/run-page.ts` (Slice 1)
    - Retry once on a schema failure or a timeout; no retry on quota, rate limit or unavailable; outcome classified by the last attempt (design "Orchestration").
    - _Requirements: 6.10_
  - [ ] 13.6 Implement `src/worker/cache/page-plan-cache.ts` (Slice 1)
    - `lookupPagePlanCache(pageVersion, language)` over `import.meta.glob('./precomputed/pages/*.json', { eager: true })`, validated with `PrecomputedPagePlanSchema`; exact version and language only, no fallback. Create the empty `precomputed/pages/` folder.
    - _Requirements: 7.2_
  - [ ] 13.7 Implement and register `POST /api/pages/analyze` (Slice 1)
    - **Shared file:** `src/worker/index.ts` (`ROUTES`). `LogEntry` in `src/worker/http.ts` stays unchanged.
    - `src/worker/routes/page-analyze.ts`: 48 KB limit before parsing, `PageAnalyzeRequestSchema`, `UNSUPPORTED_LANGUAGE`, the Slice 1 rows of the decision table in design Question 5 (`mock`; `live`; `cached` after a failed live call; `503 AI_UNAVAILABLE` when no cached plan matches; `500 INTERNAL_ERROR` when the mock reply is invalid twice), `validatePlan` before replying, existing rate limit with key `route:ip`, log entries with only the allowed items.
    - _Requirements: 6.2, 6.3, 6.10, 7.1, 7.2, 7.8, 7.10, 13.1, 13.2, 13.5, 13.6, 13.12_
  - [ ] 13.8 Write example tests for the analysis route (Slice 1)
    - `tests/unit/accessforge-routes-examples.test.ts` with a scripted fake provider and an injected cache: one example per Slice 1 row of the decision table; retry exactly after an invalid reply or a timeout, none after quota; a cached plan for another version or language is never used; an extra property, 51 entries and a bad Page_Version give 400 with schema paths only and zero provider calls; each log entry has only the allowed items; the default Vitest environment resolves the mock provider.
    - _Requirements: 6.3, 6.10, 7.1, 7.2, 7.8, 7.10, 13.5, 13.6, 13.11_
  - [ ] 13.9 Write the mock determinism test (Slice 1)
    - `tests/unit/accessforge-mock.test.ts`: identical Page_Model and language give an identical plan; reason for visit has confidence 0.6; `zh-Hans` and `en` texts come from the table.
    - _Requirements: 7.1_

- [ ] 14. Agent-loop reducer (Slice 1)
  - [ ] 14.1 Implement `src/lib/accessforge/agent-machine.ts` (Slice 1)
    - `agentReducer(state, event)` returning `{ state, effects }` with the Slice 1 states and rules of design Question 4: `versionUnsupported`, `notice` (no analysis effect before acknowledgement), `unreadable` (including `SUBMIT_COUNT`), `analysisFailed` (error, `AI_UNAVAILABLE`, 45 s), expected loads, results with an older generation dropped and `ABORT_PENDING` emitted, one click per confirm press, 15 s `unknownOutcome`, error-page rewrite, edits and `halted`, consent, cancel, required do-it-yourself notice, language picker locked while active.
    - Pure helpers for the step list, the low-confidence check (below 0.7) and review rows.
    - _Requirements: 3.3, 3.6, 3.8, 3.9, 3.10, 5.10, 6.9, 6.11, 6.15, 6.19, 7.10, 7.11, 8.10, 9.1, 9.2, 9.3, 9.8, 10.2, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.13, 12.1, 12.6, 12.7, 12.8, 13.8_
  - [ ] 14.2 Write example tests for submission safety (Slice 1)
    - `tests/unit/accessforge-agent-machine-submit.test.ts`: the acceptance path emits exactly one click after one confirm press; no click on reaching review, Enter or a timeout; a read-back mismatch moves to `halted` with no further Action; an error page leads to reload, rewrite and a new confirm press; a timeout gives `unknownOutcome` and a late confirmation is still verified; `filled` only after an equal read-back.
    - _Requirements: 10.2, 10.6, 10.7, 10.8, 10.9, 10.13, 12.1, 12.7_
  - [ ] 14.3 Write example tests for stops and refusals (Slice 1)
    - `tests/unit/accessforge-agent-machine-stops.test.ts`: a stale analysis reply after a reload is dropped; a reload during the question flow stops the loop; the home page during the flow stops it; an unrecorded registration version gives `versionUnsupported` with no effects; `SUBMIT_COUNT` gives `unreadable` with no analysis effect; `AI_UNAVAILABLE` gives `analysisFailed`; cancel confirmed discards answers and reloads, cancel declined keeps the step; the language picker stays locked while active.
    - _Requirements: 3.3, 3.6, 3.8, 3.9, 5.10, 6.15, 6.19, 7.10, 7.11, 12.6, 13.8_
  - [ ] 14.4 Write the instruction-like page example test (Slice 1)
    - `tests/unit/accessforge-instructions.test.ts`: one variant of the registration template whose label, cell, next-row, option and nearby texts tell the agent to press reset or submit, change answers, follow a URL or use a selector gives the same Element_Ids, control types, option values and allowed Action kinds as the real page, and the reducer emits no Action that does not follow a user answer or a confirm press.
    - _Requirements: 4.6_

- [ ] 15. AccessForge interface strings (Slice 1)
  - [ ] 15.1 Add the `accessforge.*` keys to the locale files (Slice 1)
    - **Shared files:** every interface locale file.
    - Every key complete in `en` and `zh-Hans`: mode notices (the `cached` text says live AI was unavailable and the questions come from an analysis saved when the page was tested, and makes no claim that no live call was made), scope notice, page-changed message, language-locked note, steps, review, results, do-it-yourself reasons, errors of design "Error Handling", frame title, larger text. Other core languages get the keys that exist; the rest fall back to English. No Malay legacy text here.
    - _Requirements: 3.8, 7.5, 7.11, 9.4, 9.13, 11.1, 18.6_
  - [ ] 15.2 Write the locale completeness test (Slice 1)
    - `tests/unit/accessforge-locales.test.ts`: every `accessforge.*` key exists and is non-empty in `en` and `zh-Hans`; the Slice 1 data notice keys exist in every core locale; experimental languages such as `id` fall back to English.
    - _Requirements: 9.4, 9.13, 13.9_

- [ ] 16. Mirror screens and frame (Slice 1)
  - [ ] 16.1 Add `analyzePage` to the API client (Slice 1)
    - **Shared file:** `src/frontend/api.ts`. New function only, with a 45 s abort combined with the AbortController of the current Revival_Generation.
    - _Requirements: 3.9, 6.1, 6.15_
  - [ ] 16.2 Implement `RevivalFrame.tsx` and `src/lib/accessforge/scope.ts` (Slice 1)
    - `sandbox="allow-same-origin allow-forms"`, constant `src="/legacy/register"`, localized title; increment the Revival_Generation before every app-initiated load and on every `load` event, and record the new document; write highlight through the CSSOM (4 px `stamp-blue`, 1 to 3 s, no smooth scroll or transition under reduced motion).
    - `scope.ts`: a pure helper that flags any URL parameter or route value naming an address other than the portal.
    - _Requirements: 3.9, 4.3, 8.5, 8.12, 18.1, 18.2_
  - [ ] 16.3 Implement `useAgentLoop.ts` (Slice 1)
    - Runs reducer effects: `checkFrameDocument` on every load before anything else reads the document, version compare with `SUPPORTED_PAGE_VERSIONS`, extraction, analysis only after acknowledgement, abort of obsolete requests on a new generation, execute, read-back, frame reload, 15 s timer. State in memory only, no browser storage.
    - _Requirements: 3.2, 3.3, 3.8, 3.9, 3.10, 5.1, 6.1, 6.15, 8.4, 10.1, 10.8, 13.4, 13.8_
  - [ ] 16.4 Implement `useLeaveWarning.ts` (Slice 1)
    - Registers a `beforeunload` handler that calls `preventDefault()` and sets `returnValue` while at least one answer exists and no confirmation was received; removes it otherwise; saves nothing.
    - _Requirements: 12.5, 13.4_
  - [ ] 16.5 Implement the notice components (Slice 1)
    - `DataNotice.tsx` (before analysis and again on review, acknowledge control), `ModeNotice.tsx` (icon and text for `live`, `mock` with the Demo mode banner, and `cached`, above the current content), scope notice on the first screen, page-changed message, language-locked note beside the disabled picker, `MachineTranslatedLabel` on plan text in all three modes.
    - _Requirements: 3.8, 6.14, 7.5, 7.11, 13.7, 13.8, 18.6_
  - [ ] 16.6 Implement `mirror-field-adapter.ts` (Slice 1)
    - Converts a `MirrorField` into FormBridge's `FieldState` and `FieldQuestion` props exactly as the adapter table in design "Reuse of FormBridge components and validators" states, with no change to `FieldQuestion`.
    - _Requirements: 9.14_
  - [ ] 16.7 Implement `MirrorStep.tsx`, `DateQuestion.tsx`, `ConsentQuestion.tsx` and `LowConfidenceEvidence.tsx` (Slice 1)
    - `FieldQuestion` through the adapter for text, IC, phone, postcode, radio and select; `DateQuestion` (three inputs in a fieldset, stated format, format choice when ambiguous) and `ConsentQuestion` (one unticked checkbox, original wording on request with `lang="ms"`) built from `ValidationMessage`, `MachineTranslatedLabel` and `StatusMessage`. Step indicator, back, next and cancel; error linked with `aria-describedby`, `aria-live="polite"`, `aria-invalid`; Page_Model options only; low-confidence evidence above the input with `lang="ms"`; plan text rendered as React text only.
    - _Requirements: 6.9, 6.11, 6.17, 9.1, 9.2, 9.5, 9.6, 9.7, 9.8, 9.14, 14.1, 14.6, 14.7_
  - [ ] 16.8 Implement `MirrorResult.tsx` with the FormBridge link (Slice 1)
    - Requires task 1.6: the FormBridge "Try a sample form" route of the `formbridge-pdf` spec must be done first.
    - Verified completion from locale strings with the Reference_Number exactly as read; show-original toggle with `lang="ms"` and focus kept on the control; original-unavailable state; not verified with differences by legacy label; unknown outcome with the duplicate warning; stopped and analysis-failed views with reload or retry; skipped and do-it-yourself list or "every field was filled". The link to `SAMPLE_FORM_PATH` from `src/shared/app-paths.ts` is always shown and carries no answer value.
    - _Requirements: 3.3, 6.15, 10.8, 10.11, 10.12, 11.1, 11.2, 11.3, 11.4, 11.5, 11.7_
  - [ ] 16.9 Implement `MirrorReview.tsx` and `DoItYourselfList.tsx` (Slice 1)
    - Review rows in Legacy_Form order with legacy label, question, Intended_Value and one status (icon and text); confirm button disabled with a stated reason while a read-back is pending or differs or consent is missing; required do-it-yourself notice with the confirm button still available; do-it-yourself entries with `lang="ms"` label and a plain-language reason, no value proposed. The scroll-and-highlight control is task 26.3.
    - _Requirements: 10.4, 10.13, 12.2, 12.3, 12.8, 13.7_
  - [ ] 16.10 Implement `RevivalScreen.tsx` and its styles (Slice 1)
    - Split layout of design "Design Plan: Mirror screens" (frame beside the Mirror at 1024 px and wider, show-original-page toggle below that), logical CSS properties, larger-text option at scale 1.25 in memory only, focus moved to the `h1` or step heading on each screen change, skip link, `header` and `main` landmarks, reduced-motion handling, cancel confirmation dialog with focus return, reload starts at the first step.
    - _Requirements: 9.3, 12.4, 12.6, 14.1, 14.2, 14.3, 14.4, 14.5, 14.10, 14.11, 14.12, 18.4_
  - [ ] 16.11 Wire the AccessForge screen into the app (Slice 1)
    - **Shared file:** the app shell or router file and the language picker entry point.
    - Route to `RevivalScreen` after the language picker; `<html lang>` follows the interface language; no sign-in or saved progress; a foreign address in a URL parameter shows the scope message and loads nothing.
    - _Requirements: 9.4, 14.6, 18.2, 18.3, 18.4_
  - [ ] 16.12 Write component tests for the Mirror (Slice 1)
    - `tests/unit/accessforge-components.test.tsx`: mode notice per Slice 1 mode, the `cached` text mentions that live AI was unavailable; machine-translated label in `live`, `mock` and `cached`; `aria-invalid` set and removed; focus moves to the heading; show-original toggle keeps focus; do-it-yourself list with `lang="ms"`; scope notice; picker locked during the loop.
    - _Requirements: 6.14, 7.5, 7.11, 11.3, 12.2, 14.7, 14.10, 18.6_
  - [ ] 16.13 Write the untrusted model text test (Slice 1)
    - `tests/unit/accessforge-untrusted-text.test.tsx`: a plan whose question is `<a href="https://example.com">x</a> javascript:alert(1) #nama` renders with no `a` element and shows the string literally; no Executor call, Element_Id or navigation follows from it.
    - _Requirements: 6.17_
  - [ ] 16.14 Add the Mirror contrast pairs to the tokens test (Slice 1)
    - **Shared file:** the existing tokens test.
    - The write-highlight pairs against white, `#E0E0E0` and `#D4D0C8`, each at least 3:1.
    - _Requirements: 8.5, 14.3_
  - [ ] 16.15 Write the no-duplicate-validation static test (Slice 1)
    - `tests/unit/accessforge-no-duplicate-validation.test.ts` with the rules of design "No duplicated validation": fails on rule-like regular expressions, validator-like function names or date arithmetic under `src/lib/accessforge/` and `src/frontend/accessforge/`; asserts the shared imports in `transformations.ts`; explicit allow-list for the Reference_Number and date-abbreviation patterns.
    - _Requirements: 9.14, 9.15_
  - [ ] 16.16 Write the leave-warning handler test (Slice 1)
    - `tests/unit/accessforge-leave-warning.test.tsx`: with an answer and no confirmation, `addEventListener('beforeunload', …)` was called and the handler calls `preventDefault`; after confirmation or with no answers the handler is removed; no storage write. The test checks the handler, not a browser dialog.
    - _Requirements: 12.5, 13.4_
  - [ ] 16.17 Write example tests for the frame source (Slice 1)
    - `tests/unit/accessforge-scope.test.ts`: an absolute URL, a protocol-relative URL and an encoded variant in a parameter keep `src` at `/legacy/register` and set the scope message flag.
    - _Requirements: 18.1, 18.2_
  - [ ] 16.18 Write the adapter test (Slice 1)
    - `tests/unit/accessforge-adapter.test.tsx`: for each Slice 1 answer type the adapter output renders in `FieldQuestion` with the question, the original label with `lang="ms"` and the Page_Model options.
    - _Requirements: 9.14_

- [ ] 17. Checkpoint: Mirror in place (Slice 1)
  - Run `npx vitest --run`. Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Privacy canary tests (Slice 1)
  - [ ] 18.1 Write the Worker-side canary test (Slice 1)
    - `tests/unit/accessforge-privacy.test.ts` with `CANARY-FRAME-5Q7Z` typed into the frame before extraction and `CANARY-ANSWER-8K2M` as a Mirror answer: both absent from the Page_Model, the analysis request body, the prompt (recording fake provider), every Worker log entry (logger spy, including the legacy POST) and every error response; the legacy handler keeps nothing between requests.
    - _Requirements: 2.5, 13.1, 13.2, 13.3, 13.5, 13.6, 13.10, 13.12_
  - [ ] 18.2 Write the Playwright canary test (Slice 1)
    - `tests/e2e/accessforge-privacy.spec.ts`, mock provider: both canaries absent from request bodies, request URLs, localStorage, sessionStorage, IndexedDB, cookies and the FormBridge link; `CANARY-ANSWER-8K2M` present only in the one Legacy_Form POST body.
    - _Requirements: 11.5, 13.3, 13.4, 13.10, 13.12_

- [ ] 19. End-to-end tests with the mock provider (Slice 1)
  - [ ] 19.1 Write the Playwright acceptance scenario (Slice 1)
    - **Shared file:** `playwright.config.ts` (exclude `@smoke` unless `BASE_URL` is set).
    - `tests/e2e/accessforge-acceptance.spec.ts` at 1280 × 800 in `zh-Hans`, tagged `@smoke`: frame without Mirror; revive; data notice; one question per step and step count equal to mapped fields; wrong IC `901301-10-1234` rejected with the `zh-Hans` message, frame field empty, then fixed; each frame field holds its Intended_Value within 2 s; low-confidence evidence shown; review with eight `filled`; zero POSTs before confirm and exactly one after; verified result with a matching Reference_Number; original Malay text hidden until shown and then with `lang="ms"`; link to `SAMPLE_FORM_PATH`. With `BASE_URL` set it accepts any Analysis_Mode, checks by `lang`, step count and Element_Id, and finishes within 120 s.
    - _Requirements: 6.11, 8.4, 9.6, 11.1, 11.2, 13.11, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_
  - [ ] 19.2 Write the direct-versus-Mirror comparison test (Slice 1)
    - `tests/e2e/accessforge-same-data.spec.ts`: two browser contexts, direct top-level submission of the Intended_Values and Mirror submission of the answers in design Question 8; identical Received_Fields_Summaries; eight entries in order with no button names; each value equal to its documented transformation; the Reference_Number in the frame equal to the one the Mirror shows.
    - _Requirements: 15.1, 15.2, 15.3, 15.5, 15.6, 15.7_
  - [ ] 19.3 Write the navigation tests (Slice 1)
    - `tests/e2e/accessforge-navigation.spec.ts`: an unlisted path, an Allow_List path with a query string and the home page during the question flow each stop the loop, run no Action, submit nothing and show "page is not supported"; an unrecorded Page_Version (route override) sends no analysis request and shows the page-changed message; a `url` parameter naming another address loads nothing and shows the scope message.
    - _Requirements: 3.3, 3.6, 3.7, 3.8, 18.2_
  - [ ] 19.4 Write the hostile page tests (Slice 1)
    - Add the raw hostile document and the instruction-like variant to `tests/e2e/helpers/hostile-pages.ts`.
    - `tests/e2e/accessforge-hostile.spec.ts`: served with `page.route` and the real `LEGACY_CSP`; script does not run; external resources are not requested; the form-target check stops the loop before any Action; nothing is submitted; no pop-up or top navigation; the instruction-like variant gives the same Element_Ids and Actions as the real page.
    - _Requirements: 4.2, 4.3, 4.4, 4.6, 4.7, 4.9_
  - [ ] 19.5 Write the submission flow tests (Slice 1)
    - `tests/e2e/accessforge-submit-flows.spec.ts`: legacy error page then rewrite and a new confirm press; a stalled POST gives the unknown outcome after 15 s; a frame value changed by a test hook stops the loop with a mismatch; an edit from review re-verifies before confirm.
    - _Requirements: 10.2, 10.5, 10.8, 10.9_
  - [ ] 19.6 Write the session flow tests (Slice 1)
    - `tests/e2e/accessforge-session-flows.spec.ts`: cancel confirmed resets the frame and declined keeps the step; reload starts fresh; the `beforeunload` handler is registered with answers present; at 360 px the frame toggle keeps step and answers; highlight outline at least 3 px and without transition under reduced motion; picker locked during the loop; with scripts disabled a direct run from home to confirmation works.
    - _Requirements: 1.9, 7.11, 8.5, 8.12, 12.4, 12.5, 12.6, 14.12, 18.4_
  - [ ] 19.7 Write the axe accessibility tests (Slice 1)
    - `tests/e2e/accessforge-a11y.spec.ts` with `@axe-core/playwright`, tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`, iframe excluded, in `en` and `zh-Hans`, failing on any violation, for every state listed in Requirement 14.8; plus checks for 24 px and 44 px targets, 16 px body text, and no horizontal scroll at 360 px and at 200% zoom with larger text on.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.11_

- [ ] 20. Precomputed page plans (Slice 1)
  - [ ] 20.1 Add the page-plan step to the fixture cache script (Slice 1)
    - **Shared files:** `scripts/generate-fixture-cache.ts`, `package.json` scripts if a flag needs one.
    - `--pages`: take the registration HTML from `generated/templates.ts`, extract the Page_Model with the same extractor in jsdom, call the provider for `en` and `zh-Hans`, validate with `PagePlanReplySchema` and `validatePlan`, write `src/worker/cache/precomputed/pages/<pageVersion>-<bcp47>.json` only for passing replies, exit non-zero on any failure. Test with a fake provider: valid replies write files; an invalid reply writes nothing for that key and exits non-zero.
    - _Requirements: 7.6_
  - [ ] 20.2 Generate the precomputed page plans (Slice 1, **needs `AI_MODE=real`**)
    - Reason for the real call: the saved plans that back `cached` mode when the daily AI quota runs out. Estimated cost about 80 neurons (two languages). The developer approves the run before it starts.
    - Run `npm run generate-fixture-cache -- --pages` with `AI_MODE=real`; commit only the schema-validated JSON files; record the measured neurons in design.md; confirm the stale-plan check of task 5.9 passes. No raw model output is committed.
    - _Requirements: 7.2, 7.6, 13.11_

- [ ] 21. Documentation (Slice 1)
  - [ ] 21.1 Add the AccessForge section to the manual accessibility checklist (Slice 1)
    - **Shared file:** `docs/accessibility-checklist.md` (create it if absent).
    - State that the Legacy_Portal pages fail accessibility on purpose; add Mirror entries for a keyboard-only run, a screen-reader pass on the question, review and confirmation screens, 360 px, 200% zoom, reduced motion and larger text, each with a pass or fail column and a date column. The developer records the results.
    - _Requirements: 14.9_
  - [ ] 21.2 Update the README (Slice 1)
    - **Shared file:** `README.md`. Apply the project's English writing style.
    - Acceptance criteria:
      - A scope section names the Legacy_Portal as the only supported portal and the Legacy_Form as the only supported form, lists `en` and `zh-Hans` and the `MY` country pack as covered by the automated acceptance tests, marks every other interface language as experimental for AccessForge, and states that real websites, cross-origin pages, login pages, CAPTCHA pages, script-driven sites and general crawling are not supported.
      - The non-English content section lists `src/packs/language/locales/legacy-portal/ms.json` and `fixtures/mock-analysis/legacy-register.json` as the only non-English content outside the interface locale files.
      - The asset section states that the portal uses system fonts and no images.
      - The pre-existing code disclosure lists every library this spec added, or states that none was added.
      - Every AccessForge claim names the test in tasks 18 or 19 that proves it; no sentence claims more than those tests show.
      - No wording that depends on decision C appears while C is open.
    - _Requirements: 1.3, 1.7, 1.11, 9.13, 18.5_
  - [ ] 21.3 Add Kiro usage log rows for features actually used (Slice 1)
    - **Shared file:** `docs/kiro-usage-log.md`.
    - One row per real use: this spec, each property test that found a bug (with the regression test name and seed), and any hook, steering or MCP use during these tasks. Rows are added as each use happens; this is the final sweep that nothing was missed or invented.
    - _Requirements: 17.10_

- [ ] 22. Final checkpoint (Slice 1)
  - Run `npx vitest --run` and `npm run test:e2e`. Ensure all tests pass, ask the user if questions arise.

- [ ] 23. Deployed acceptance and final review (Slice 1)
  - [ ] 23.1 Run the deployed acceptance smoke test and CPU reading (Slice 1, **needs `AI_MODE=real`** on the deployed Worker)
    - Reason for the real call: Requirements 16.2 and 16.7 require the acceptance scenario to pass against the deployed public URL. The developer deploys and starts the run on purpose; it never runs in CI or in the default test command.
    - Run `npm run test:e2e -- --grep @smoke` with `BASE_URL` set to the public URL. Record the Analysis_Mode reported, the duration and the result. Read the CPU time of GET `/legacy/`, GET `/legacy/register` and a valid POST `/legacy/register` in Workers Logs and record it in the CPU table of design Question 6 next to the 10 ms limit. If either fails, report it and do not mark the spec complete.
    - _Requirements: 2.12, 13.11, 16.2, 16.7_
  - [ ] 23.2 Run the final pre-submission checklist review (Slice 1)
    - Acceptance criteria:
      - Every item of the developer's final pre-submission checklist is reported as done, not done or not applicable, each with evidence (test name, commit hash or URL).
      - Task 22 passed on the commit under review, and task 23.1 passed against the public URL, with the run date and Analysis_Mode stated.
      - The CPU table and the Page_Version table in design.md hold measured values, with no placeholder left.
      - Every Slice 1 task in this file is checked, or listed as not done with the reason.
      - Decision C is raised with the developer at gate G2 (Nov 25) if it is still open, and its outcome or new date is recorded; no open decision is dropped silently.
    - _Requirements: 16.7, 18.5_

- [ ] 24. Generalized control types and heuristic analysis (Slice 2, optional)
  - [ ]* 24.1 Extend the extractor and plan validator for duplicate ids, unsupported controls and submit count (Slice 2)
    - Keep both entries of a shared Element_Id and mark them Do_It_Yourself; record unsupported controls; return the model on a submit count other than one and mark the submission step Do_It_Yourself with a message to submit in the frame.
    - _Requirements: 5.8, 5.9, 6.16_
  - [ ]* 24.2 Implement `src/lib/accessforge/heuristic.ts` (Slice 2)
    - `heuristicPlan(model, language)` with the rules table of design Question 3, confidence 0, locale sentence `accessforge.heuristic.question` quoting the legacy text with `lang="ms"`, no network.
    - _Requirements: 7.4_
  - [ ]* 24.3 Add the `heuristic` mode and the page-changed notice (Slice 2)
    - Route: the Slice 2 row of the decision table with `errorCode` `AI_FALLBACK_HEURISTIC` in the log. Mirror: `heuristic` mode notice; for an unrecorded Page_Version, the page-changed notice on every screen and continue, with no cached plan for that version.
    - _Requirements: 3.5, 7.3, 7.5_

- [ ] 25. Language switching after analysis (Slice 2, optional)
  - [ ]* 25.1 Add the re-translation schemas and provider method (Slice 2)
    - **Shared files:** `src/shared/page-schemas.ts`, `src/lib/ai/interface.ts`, `src/lib/ai/mock.ts`, `src/lib/ai/cf-workers.ts`.
    - `PageRetranslateRequestSchema`, `PageRetranslateResponseSchema`, `PageRetranslateCall` and `retranslatePage` (mock by label match; real provider with `max_completion_tokens` 2,000).
    - _Requirements: 7.7, 13.1_
  - [ ]* 25.2 Add `pageRetranslateMessages()` (Slice 2)
    - **Shared file:** `src/lib/ai/prompt.ts`. Same delimiting as task 13.2.
    - _Requirements: 4.5, 13.2_
  - [ ]* 25.3 Implement `runPageRetranslate()` and `POST /api/pages/retranslate` (Slice 2)
    - **Shared file:** `src/worker/index.ts`.
    - 48 KB limit, item count must match, 503 and 504 errors, allowed log items only.
    - _Requirements: 7.7, 7.9, 13.1, 13.5_
  - [ ]* 25.4 Implement `GET /api/pages/cached-plan` (Slice 2)
    - **Shared file:** `src/worker/index.ts`.
    - Query `version` and `lang` validated with zod; reads only the bundled precomputed plans, never calls the provider; 404 when none exists.
    - _Requirements: 7.7_
  - [ ]* 25.5 Wire language switching into the Mirror (Slice 2)
    - **Shared files:** `src/frontend/api.ts`, every interface locale file.
    - Unlock the picker; `LANGUAGE_CHANGED` keeps state, step, answers and statuses; new wording by mode (re-translation, cached-plan route, or heuristic in the browser); on failure keep the previous wording with its `lang` and show the notice; add `accessforge.notice.retranslate` to the data notice in the same change.
    - _Requirements: 7.7, 7.9, 9.4, 13.7_
  - [ ]* 25.6 Write the re-translation tests (Slice 2)
    - `tests/unit/accessforge-retranslate.test.ts`: count mismatch counts as invalid; previous wording kept on every error code; `cached` mode switch makes no page-analysis request; both canaries absent from the re-translation body.
    - _Requirements: 7.7, 7.9, 13.10_

- [ ] 26. Skipping, low-confidence accept-or-decline and manual-field recovery (Slice 2, optional)
  - [ ]* 26.1 Implement skipping (Slice 2)
    - Skip control on non-required steps; one clearing Action per control type in the Executor; status `skipped`.
    - _Requirements: 8.11, 9.12_
  - [ ]* 26.2 Implement `LowConfidenceCheck.tsx` (Slice 2)
    - Accept or decline before the input for confidence below 0.7; declining marks the field Do_It_Yourself.
    - _Requirements: 6.18_
  - [ ]* 26.3 Add the scroll-and-highlight control to `DoItYourselfList.tsx` (Slice 2)
    - The control scrolls the frame to the field and highlights it with the outline of task 16.2.
    - _Requirements: 12.2_

- [ ] 27. Additional property tests (Slice 2, optional)
  - Each property runs at least 100 cases, prints the seed on failure, carries no `skip` or `only`, and starts with the tag comment `// Feature: accessforge-skeleton, Property N: <title>`.
  - [ ]* 27.1 Write property test for date round-trip (Slice 2)
    - **Property 5: Date answers round-trip and invalid dates write nothing**
    - **Validates: Requirements 9.7, 17.6**
  - [ ]* 27.2 Write property test for documented transformations (Slice 2)
    - **Property 6: Intended_Value equals the documented transformation**
    - **Validates: Requirements 9.10, 9.11, 15.5, 17.7**
  - [ ]* 27.3 Write property test for Element_Ids (Slice 2)
    - **Property 8: Element_Ids are deterministic and injective, collisions become do it yourself**
    - **Validates: Requirements 5.3, 5.4, 5.6, 5.8, 5.9**
  - [ ]* 27.4 Write property test for instruction-like page text (Slice 2)
    - **Property 9: Page text cannot steer the agent**
    - **Validates: Requirements 4.6**
  - [ ]* 27.5 Write property test for the sanitiser (Slice 2)
    - **Property 10: Sanitised output contains no active or foreign construct and keeps kept text**
    - **Validates: Requirements 4.1, 4.8**
  - [ ]* 27.6 Write property test for prompt delimiting (Slice 2)
    - **Property 11: Prompt data stays inside its delimiters**
    - **Validates: Requirements 4.5, 13.2**
  - [ ]* 27.7 Write property test for submission validation (Slice 2)
    - **Property 12: The Legacy_Handler accepts exactly the valid bodies and names every failure**
    - **Validates: Requirements 2.2, 2.3**
  - [ ]* 27.8 Write property test for the received-fields summary (Slice 2)
    - **Property 13: The Received_Fields_Summary round-trips exactly**
    - **Validates: Requirements 2.1, 2.4, 2.7, 2.10**
  - [ ]* 27.9 Write property test for reference numbers (Slice 2)
    - **Property 14: Reference numbers follow the pattern and ignore submitted values**
    - **Validates: Requirements 2.9**
  - [ ]* 27.10 Write property test for the frame check (Slice 2)
    - **Property 15: The frame check accepts exactly the four Allow_List transitions**
    - **Validates: Requirements 3.2, 18.1**
  - [ ]* 27.11 Write model-based property test for the agent loop (Slice 2)
    - **Property 16: One confirm press, at most one submit, no stale effects, and only verified fields count as filled**
    - **Validates: Requirements 3.3, 3.6, 3.9, 3.10, 7.7, 10.2, 10.6, 10.7, 10.13, 12.1, 12.7**
  - [ ]* 27.12 Write property test for analysis modes (Slice 2)
    - **Property 17: The Analysis_Mode always names the source of the plan**
    - **Validates: Requirements 6.10, 7.1, 7.2, 7.3, 7.8, 7.10**
  - [ ]* 27.13 Write property test for the heuristic plan (Slice 2)
    - **Property 18: The heuristic plan is deterministic and rule-bound**
    - **Validates: Requirements 7.4**
  - [ ]* 27.14 Write property test for received-data comparison (Slice 2)
    - **Property 19: Received data is verified against what was intended**
    - **Validates: Requirements 10.10, 10.11, 10.12**
  - [ ]* 27.15 Write property test for the form-target check (Slice 2)
    - **Property 20: The form-target check passes only for the legacy handler**
    - **Validates: Requirements 4.4, 4.9**
  - [ ]* 27.16 Write property test for invalid analysis requests (Slice 2)
    - **Property 21: Invalid analysis requests never reach the provider**
    - **Validates: Requirements 6.3, 13.6**
  - [ ]* 27.17 Write property test for steps, evidence and review rows (Slice 2)
    - **Property 22: Steps, evidence and review rows follow the plan**
    - **Validates: Requirements 6.9, 6.11, 6.18, 9.1, 10.4**
  - [ ]* 27.18 Write property test for skip clearing (Slice 2)
    - **Property 23: Skipping clears what was written**
    - **Validates: Requirements 8.11, 9.12**
  - [ ]* 27.19 Write property test for canary values (Slice 2)
    - **Property 24: Canary values never leave through a forbidden path**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.5, 13.6, 13.10**
  - [ ]* 27.20 Write property test for unlisted legacy paths (Slice 2)
    - **Property 25: Unlisted legacy paths give the not-found document**
    - **Validates: Requirements 1.10, 2.6, 4.2**
  - [ ]* 27.21 Write property test for the frame source (Slice 2)
    - **Property 26: The frame source cannot be redirected**
    - **Validates: Requirements 18.1, 18.2**

## Notes

- Slice 1 (tasks 1 to 23) is needed for acceptance and every Slice 1 sub-task is required. Slice 2 (tasks 24 to 27) is optional; its sub-tasks carry `*`.
- The five core property tests (tasks 8.2, 9.2, 10.2, 11.2, 11.5) and every Slice 2 property run at least 100 cases, print the fast-check seed on failure, and carry no `skip` or `only`. A property that cannot pass yet stays failing or is marked `todo` with the reason and the fixing task (Requirement 17.9).
- A shrunk counterexample becomes a named regression test with the seed in a comment, confirmed failing before the fix, and gets a usage-log row (Requirement 17.10).
- Tasks marked **Shared file** must be coordinated with the parallel FormBridge work.
- Only tasks 20.2 and 23.1 call real AI. No task commits raw model output, personal data or secrets.
- External prerequisite: the FormBridge "Try a sample form" task, to be added to the `formbridge-pdf` spec, must be done before task 1.6 can pass. Task 1.6 gates tasks 4.3 and 16.8.
- Checkpoints 6, 12, 17 and 22 appear as nodes in the graph below.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "4.4", "5.2", "5.4", "7.2"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.2", "4.3", "5.3"] },
    { "id": 3, "tasks": ["4.5"] },
    { "id": 4, "tasks": ["4.6", "5.1"] },
    { "id": 5, "tasks": ["5.5"] },
    { "id": 6, "tasks": ["5.6", "5.7", "5.8", "5.9", "5.10", "5.11"] },
    { "id": 7, "tasks": ["6"] },
    { "id": 8, "tasks": ["7.1", "7.3", "7.4", "9.1", "10.1", "11.4"] },
    { "id": 9, "tasks": ["8.1", "9.2", "10.2", "10.3", "11.5", "11.6"] },
    { "id": 10, "tasks": ["8.2", "8.3", "11.1"] },
    { "id": 11, "tasks": ["11.2", "11.3"] },
    { "id": 12, "tasks": ["12"] },
    { "id": 13, "tasks": ["13.1", "13.2", "13.6"] },
    { "id": 14, "tasks": ["13.3", "13.4", "13.5", "14.1", "15.1"] },
    { "id": 15, "tasks": ["13.7", "14.2", "14.3", "14.4", "15.2", "16.1"] },
    { "id": 16, "tasks": ["13.8", "13.9", "16.2", "16.4", "16.5", "16.6"] },
    { "id": 17, "tasks": ["16.3", "16.7", "16.8", "16.9"] },
    { "id": 18, "tasks": ["16.10"] },
    { "id": 19, "tasks": ["16.11"] },
    { "id": 20, "tasks": ["16.12", "16.13", "16.14", "16.15", "16.16", "16.17", "16.18"] },
    { "id": 21, "tasks": ["17"] },
    { "id": 22, "tasks": ["18.1", "18.2", "19.1", "19.2", "19.3", "19.4", "19.5", "19.6", "19.7", "20.1", "21.1"] },
    { "id": 23, "tasks": ["20.2"] },
    { "id": 24, "tasks": ["21.2"] },
    { "id": 25, "tasks": ["21.3"] },
    { "id": 26, "tasks": ["22"] },
    { "id": 27, "tasks": ["23.1"] },
    { "id": 28, "tasks": ["23.2"] },
    { "id": 29, "tasks": ["24.1", "24.2", "25.1", "26.1", "26.3"] },
    { "id": 30, "tasks": ["24.3", "25.2", "26.2"] },
    { "id": 31, "tasks": ["25.3"] },
    { "id": 32, "tasks": ["25.4"] },
    { "id": 33, "tasks": ["25.5"] },
    { "id": 34, "tasks": ["25.6", "27.1", "27.3", "27.5", "27.6", "27.7", "27.10", "27.11", "27.12", "27.13", "27.14", "27.17", "27.18", "27.19"] },
    { "id": 35, "tasks": ["27.2", "27.4", "27.8", "27.15", "27.16"] },
    { "id": 36, "tasks": ["27.9", "27.21"] },
    { "id": 37, "tasks": ["27.20"] }
  ]
}
```
