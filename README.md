# ReForge AI

AI-powered legacy web modernization and multilingual form assistance.

**FormBridge** walks you through a PDF form one field at a time, in your language. It checks each answer and writes the filled PDF in your browser. The PDF and your answers never leave your device: only field names and nearby printed text go to the AI.

Built for Kiroween 2026. It joins two parts in one web app: AccessForge, which gives an old-style website a modern, accessible view, and FormBridge, which guides you through a form in your language.

## Public URL

Added after the Milestone 1 deploy (task 37.2).

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
npm run typecheck       # TypeScript type check
```

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
| Noto Sans (`public/fonts/NotoSans-Regular.ttf`) | Noto project | SIL OFL 1.1 (`public/fonts/OFL.txt`) | PDF and UI text |

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

## Kiro usage log

See [`docs/kiro-usage-log.md`](docs/kiro-usage-log.md).
