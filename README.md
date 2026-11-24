# ReForge AI

AI-powered legacy web modernization and multilingual form assistance, built for Kiroween 2026.

ReForge AI helps people who are stuck with a form they cannot read or a website they cannot use. It asks one plain question at a time, in the language the person reads, checks each answer, and writes the result in the way the form needs. It never says a form is accepted or correct: it helps you prepare your answers, and it always asks you to check them.

## What it does

| Part | What you give it | What you get |
|------|------------------|--------------|
| **FormBridge, fillable PDF** | A PDF form with fields | One question per field in your language, checks on each answer, and the filled PDF, written in your browser |
| **FormBridge, photo or scan** | A photo or scan of a paper form (JPEG or PNG) | The app reads the page in your browser and shows you the lines it found. You choose which lines the AI may see. Then it asks the questions and gives you a large-print answer sheet to copy onto the form or show at the desk |
| **AccessForge** | A legacy web page (the demonstration portal served under `/legacy/`) | A plain, accessible set of questions beside the old page. Each answer is written into the old page and read back, and the old form is sent only when you press confirm |

Privacy by design: your files, photos and answers stay in your browser. Only the text of form labels (and, on request, one answer you ask to translate) can go to the AI service. Nothing is stored or logged.

## Public URL

<https://reforge-ai.cheah20.workers.dev>

The public site is rebuilt from this repository at each deploy. The table below says what is finished and what is not on the public site yet.

| Part | State |
|------|-------|
| FormBridge, fillable PDF | Finished and deployed (Malaysian and US forms; English, Malay, Chinese, Tamil and Spanish questions) |
| FormBridge, photo or scan | In progress. The reading, line review, questions and answer sheet work locally; the public site gets them at the next deploy |
| AccessForge | The first slice is finished locally. The acceptance run against the public URL needs a deploy and has not happened yet |

## Setup

```bash
git clone <repo-url>
cd reforge-ai
npm install
npm run dev         # Vite dev server and the local Worker
```

Open [http://localhost:5173](http://localhost:5173).

`npm install` also turns on the repository's git pre-commit hook (`scripts/git-hooks/pre-commit`). The hook blocks a commit that stages private notes, likely secrets, or non-English text outside the locale files, fixtures and tests.

By default the app runs with the **mock AI provider**, so it works offline and costs nothing. To use real Workers AI, run `wrangler login` (or set `CLOUDFLARE_API_TOKEN` in `.env`) and set `AI_MODE` to `real`. Real AI in local development reaches Cloudflare and spends neurons from your daily free allocation (10,000 per day), because Workers AI has no local simulation.

### Environment variables

Copy `.env.example` to `.env`. Workers AI uses the binding, so inference needs no API key.

### Run tests

```bash
npm test                # Vitest unit and property tests
npm run test:e2e        # Playwright end-to-end tests
npm run test:cpu        # CPU time of the legacy portal routes, run on its own
npm run test:ocr        # real text recognition on the sample photos (run by hand)
npm run typecheck       # TypeScript type check
```

The browser tests run in an installed Chrome when `PW_CHANNEL=chrome` is set (PowerShell: `$env:PW_CHANNEL='chrome'`). `npm run test:ocr` needs `npm run copy-ocr-assets` once.

### Regenerate fixtures

```bash
npx tsx scripts/create-fixtures/create-fixtures.ts   # all synthetic PDFs, reproducible
npx tsx scripts/create-fixtures/encrypted.ts         # encrypted.pdf, needs qpdf
```

### Deploy

```bash
npm run deploy          # vite build, then wrangler deploy
```

## Tooling versions

The project uses TypeScript 5.7, Vite 6 and Vitest 4. These are the newest versions that Vite, Vitest and the Cloudflare Vite plugin officially support together. TypeScript 7 and Vite 8 are not supported by that combination yet.

## Pre-existing code disclosure

The project uses these open-source libraries and assets. No code was copied from other projects.

| Library | Version | Licence | Use |
|---------|---------|---------|-----|
| `react`, `react-dom` | 19.3.1 | MIT | UI |
| `vite` | 6.4.6 | MIT | Build tool |
| `@vitejs/plugin-react` | 4.7.0 | MIT | Vite React plugin |
| `@cloudflare/vite-plugin` | 1.68.0 | MIT | Vite and Workers integration |
| `wrangler` | 4.159.0 | MIT OR Apache-2.0 | Cloudflare Workers CLI |
| `pdf-lib` | 1.17.1 | MIT | AcroForm reading and writing |
| `@pdf-lib/fontkit` | 1.1.0 | MIT | Font embedding for pdf-lib |
| `pdfjs-dist` | 6.5.438 | Apache-2.0 | PDF rendering and text extraction |
| `zod` | 4.6.7 | MIT | Schema validation |
| `libphonenumber-js` | 1.11.14 | MIT | International phone number checks |
| `fast-check` | 4.10.2 | MIT | Property-based tests |
| `vitest` | 4.1.12 | MIT | Unit test runner |
| `jsdom` | 26.1.0 | MIT | DOM for frontend unit tests |
| `@playwright/test` | 1.65.0 | Apache-2.0 | End-to-end tests |
| `@axe-core/playwright` | 4.14.0 | MPL-2.0 | Automated accessibility checks |
| `typescript` | 5.7.3 | Apache-2.0 | Type checking |
| `tesseract.js` (with `tesseract.js-core` 7.0.0) | 7.0.0 | Apache-2.0 | In-browser text recognition for photos and scans, served from the app's own origin |
| `@tesseract.js-data/eng`, `@tesseract.js-data/msa` | 1.0.0 | MIT (package); the models come from the Tesseract `tessdata` project, Apache-2.0 | English and Malay language data for the text recognition |
| Noto Sans (`public/fonts/NotoSans-Regular.ttf`) | Noto project | SIL OFL 1.1 (`public/fonts/OFL.txt`) | PDF and UI text |

## FormBridge: photos and scans

### Scope

- Input: JPEG and PNG photos and scans. A fillable PDF keeps the original path. A PDF without fillable fields, and every other file type, is recognised and refused with a plain message that suggests taking a photo. Reading scanned PDF pages is not built yet.
- The photo is decoded and read in this browser with an open-source text reader (Tesseract.js). The reader and its English and Malay language data are served from the app's own origin and are downloaded once, with the size shown first.
- **You choose what the AI sees.** The page shows the lines it found, with nothing ticked. Only the lines you tick are sent, as label text, and the page shows exactly what will be sent. A line that looks like an answer already written on the form (a number, an email, text after a colon, or a short line directly below a question) is not offered. The check is a set of fixed rules, not a promise: a long sentence already written under a question can still be offered, so read what the page says will be sent before you send it.
- The result is a large-print answer sheet in page order, with a short summary in the form's language for the person at the desk. Print is the main output.
- If the AI or the network is unavailable, the original labels are still asked, and the answer sheet still works.

### Honest limits

- Handwriting is not supported. Blurry, dark, glary or very small photos give poor reading: the app says so and suggests a retake.
- Clean printed English and Malay forms are the tested case. Chinese and Tamil forms are not promised.
- Holding the phone at an angle lowers reading quality more than most other problems we simulated.
- Every check is a format check; the answer sheet is not an official form.

### What the tests show

| Claim | Test |
|-------|------|
| A clean photo goes from the line review through every question to an answer sheet that lists every kept label | `tests/e2e/document-photo.spec.ts` |
| With a prefilled sensitive form, no answer, ID number or free text leaves the browser or is kept in it, even when every offered line is ticked | `tests/e2e/document-privacy.spec.ts` |
| Axe finds no violation on any screen of the photo path in English and Simplified Chinese, with focus on the heading of the language question, line review, confirm and answer sheet screens, and with larger text | `tests/e2e/document-accessibility.spec.ts` |
| Real text recognition passes the validation bar on the clean English and Malay photos and on both rotated photos, and the glary photo is reported as a low-quality page | `tests/ocr/real-ocr.spec.ts` |
| The answer sheet lists every kept label, falls back to English per string, and prints only on the button press with no request | `tests/unit/answer-sheet.test.ts`, `tests/unit/answer-sheet-screen.test.tsx` |

Reading was also measured on a private set of real forms from the internet. Only counts are kept, never the images or text: every offered line passed the value rules, and the photos that were small or compressed read much worse than clean ones.

## Supported languages and countries

### Interface languages

| Language | Status |
|----------|--------|
| English (`en`) | Core |
| Malay (`ms`) | Core |
| Simplified Chinese (`zh-Hans`) | Core |
| Traditional Chinese (`zh-Hant`) | Core |
| Tamil (`ta`) | Core |
| Spanish (`es`) | Core |
| Indonesian (`id`) | Experimental: missing text shows in English |

### Form countries

| Country | Checks | Status |
|---------|--------|--------|
| Malaysia (`MY`) | IC (MyKad), phone, postcode | In progress (task 22) |
| United States (`US`) | Phone, ZIP and ZIP+4, dates, SSN format | In progress (task 23) |
| Any other country | International phone numbers, email, dates, postcodes kept as typed | Fallback only: permissive, not full validation |

Every check is a format check. Passing does not verify that an identity number, phone number or postcode exists.

## AccessForge (legacy portal revival)

AccessForge shows an old registration page next to a plain, accessible set of questions. You answer the questions in your language. The app writes each answer into the old page, reads it back, and sends the old form only when you press the confirm button. The old page still does the work: its own handler receives the data and answers with its own confirmation.

### Scope

- The only supported portal is the fictional demonstration portal that this app serves under `/legacy/`. The only supported form is its one registration form.
- English and Simplified Chinese (`zh-Hans`) are covered by the automated acceptance test, with the Malaysian (`MY`) validation rules. The Malay, Traditional Chinese, Tamil and Spanish interface strings exist but are not covered by that test. Indonesian shows the data notice and English for the rest of AccessForge. Treat every language other than English and Simplified Chinese as experimental for AccessForge.
- Not supported: real websites, pages from another origin, login pages, CAPTCHA pages, sites that need scripts to work, and crawling.
- The questions come from live AI, from saved plans (English and Simplified Chinese only) when live AI is unavailable, or from a simulated demonstration provider. The screen says which one.
- The same acceptance scenario has not yet been run against the public URL.

### What the tests show

| Claim | Test |
|-------|------|
| The scenario works from the old page to a verified confirmation in Simplified Chinese, with a wrong IC number rejected and one submission only | `tests/e2e/accessforge-acceptance.spec.ts` |
| Answering through AccessForge sends the same data as typing directly into the old form | `tests/e2e/accessforge-same-data.spec.ts` |
| Nothing is submitted before the confirm press, and one press gives one submission | `tests/unit/accessforge-agent-machine-submit.test.ts` |
| Values typed into the old page and your answers do not reach the AI service, the logs or browser storage. The answers go only to the old form's own submission. Labels and nearby text from the old page do go to the AI service, and the data notice says so | `tests/unit/accessforge-privacy.test.ts`, `tests/e2e/accessforge-privacy.spec.ts` |
| The app stops on a page that is not allowed, a changed page version, or a form that posts elsewhere | `tests/e2e/accessforge-navigation.spec.ts`, `tests/e2e/accessforge-hostile.spec.ts` |
| Text planted in the old page cannot steer the app | `tests/unit/accessforge-instructions.test.ts`, `tests/e2e/accessforge-hostile.spec.ts` |
| Axe finds no violation in the AccessForge screens in English and Simplified Chinese | `tests/e2e/accessforge-a11y.spec.ts` |

Axe cannot judge focus order, wording or screen reader use. The manual checks are listed in [`docs/accessibility-checklist.md`](docs/accessibility-checklist.md) and none has been recorded yet.

### Also in AccessForge (second slice)

- **Skip:** a question the old form does not require can be skipped; a value written earlier is cleared and read back.
- **Accept or decline:** a question the AI is unsure about (confidence below 0.7) is shown with the old page's own wording and asked to be accepted before any input shows. Declining leaves the field for you.
- **Show on the old page:** on the review screen, a field left for you can be scrolled into view and outlined on the old page.
- **No AI available:** when live AI is down and no saved plan exists, the questions are built from the old page's own wording by fixed rules. The screen says that no AI was used.

### Non-English content and assets

Outside the interface locale files, the only non-English content is the Malay text of the demonstration portal in `src/packs/language/locales/legacy-portal/ms.json` and the Malay and Chinese texts of the simulated provider in `fixtures/mock-analysis/legacy-register.json`. The portal uses system fonts and no images.

### Libraries added for AccessForge

None. AccessForge uses the libraries in the table above.

## How Kiro was used

This project was built in Kiro, spec first.

- **Specs:** three specs in `.kiro/specs/` (`formbridge-pdf`, `accessforge-skeleton`, `formbridge-any-document`), each with requirements, design and tasks. The tasks were run in order, and the usage log records what each step found.
- **Steering:** `.kiro/steering/` holds the product, tech, privacy, accessibility and testing rules that every session follows.
- **Hooks:** an agent hook translates new locale keys into the core languages whenever `en.json` is saved. A save-time test hook exists but is switched off for unattended runs. A git pre-commit guard blocks private notes, likely secrets and non-English text outside the locale files.
- **MCP:** the Context7 documentation server is configured in `.kiro/settings/mcp.json`.
- **Property-based tests:** fast-check properties cover the invariants that matter most (no field silently dropped, answers never sent, one submit per confirm, the legacy handler accepts exactly the valid bodies). A property found real bugs; each is named in the usage log.
- **Usage log:** [`docs/kiro-usage-log.md`](docs/kiro-usage-log.md) lists what was done with each Kiro feature and what it changed.

## Kiro usage log

See [`docs/kiro-usage-log.md`](docs/kiro-usage-log.md).
