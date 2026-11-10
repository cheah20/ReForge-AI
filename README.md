# ReForge AI

AI-Powered Legacy Web Modernization and Multilingual Form Assistance.

**FormBridge** guides users through PDF forms field by field in their chosen language, validates answers, and produces a filled PDF — all without uploading the PDF or personal answers to the backend.

Built for Kiroween 2026, category **Frankenstein** — stitching different technologies into one powerful app.

---

## Public URL

> To be added after Milestone 1 deploy (task 37.2).

---

## Setup

```bash
git clone <repo-url>
cd reforge-ai
npm install
wrangler login      # or set CLOUDFLARE_API_TOKEN in .env
npm run dev         # starts Vite dev server + local Worker
```

Open [http://localhost:5173](http://localhost:5173).

### Environment variables

Copy `.env.example` to `.env`. Workers AI runs via the binding — no API key is needed for inference.

### Run tests

```bash
npm test                # Vitest unit + property tests
npm run test:e2e        # Playwright end-to-end tests
npm run typecheck       # TypeScript type check
```

### Deploy

```bash
npm run deploy          # builds + wrangler deploy
```

---

## Pre-existing code disclosure

The following notable libraries are used. All are open-source; see their respective licences.

| Library | Version | Licence | Use |
|---------|---------|---------|-----|
| `react` | 19.3.1 | MIT | UI framework |
| `react-dom` | 19.3.1 | MIT | DOM renderer |
| `vite` | 6.x | MIT | Build tool |
| `@vitejs/plugin-react` | 4.x | MIT | Vite React plugin |
| `@cloudflare/vite-plugin` | 1.x | MIT | Vite + Workers integration |
| `wrangler` | 4.x | MIT | Cloudflare Workers CLI |
| `pdf-lib` | 1.17.1 | MIT | AcroForm PDF reading and writing |
| `@pdf-lib/fontkit` | 1.1.0 | MIT | Font subsetting for pdf-lib |
| `pdfjs-dist` | 6.5.438 | Apache-2.0 | PDF rendering and text extraction |
| `zod` | 4.6.7 | MIT | Runtime schema validation |
| `libphonenumber-js` | 1.11.x | MIT | International phone number validation |
| `fast-check` | 4.10.2 | MIT | Property-based testing |
| `vitest` | 3.x | MIT | Unit test runner |
| `@playwright/test` | 1.65.0 | Apache-2.0 | End-to-end tests |
| `@axe-core/playwright` | 4.14.0 | MPL-2.0 | Automated accessibility checks |
| `typescript` | 5.7.x | Apache-2.0 | Type system (TS 7.x deferred — Vite 6.x compatibility) |
| Noto Sans fonts | Various | SIL OFL 1.1 | PDF and UI typography |

No code was copied from other projects.

---

## Supported languages and countries

### Interface languages (Nov 17)

| Language | Status |
|----------|--------|
| English (`en`) | Core |
| Malay (`ms`) | Core |
| Simplified Chinese (`zh-Hans`) | Core |
| Traditional Chinese (`zh-Hant`) | Core |
| Tamil (`ta`) | Core |
| Spanish (`es`) | Core |
| Indonesian (`id`) | Experimental |

### Form validation countries (Nov 17)

| Country | Pack |
|---------|------|
| Malaysia (`MY`) | IC, phone, postcode |
| Universal | International phone, email, dates |

---

## Kiro usage log

See [`docs/kiro-usage-log.md`](docs/kiro-usage-log.md).
