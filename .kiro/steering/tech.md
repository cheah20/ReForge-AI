# Tech Guidelines

- Language: **TypeScript** everywhere.
- Main product: a **web app** (React + Vite) that anyone can open from a public URL with no install.
  - **AccessForge** opens a legacy-style page (our own demo legacy site, served by the app) and presents a modern, accessible view that still operates the original page.
  - **FormBridge** reads PDF form fields (pdf-lib to fill, pdf.js to render), guides the user through each field in their chosen language, validates answers, and produces the filled PDF.
- Backend: **Cloudflare Workers** (static assets + API in one deployment). All AI calls go through Workers using the **Workers AI binding** (`env.AI`) — no API key in the browser or in `.env`. Rate limiting uses the Workers rate-limiting binding (per IP).
- AI: **Cloudflare Workers AI** (free plan, 10,000 neurons/day resetting at 00:00 UTC). One shared `AiProvider` interface behind all callers; swapping the provider requires no caller changes. A deterministic mock provider is used in tests and when the Workers AI binding is not available. Model selection is recorded in design.md per spec after measuring candidates on fixtures.
- Language support: defined by a **language registry** (one module; adding a language = one locale file + one registry entry). Each entry: BCP 47 tag, native name, text direction, Noto font family, translation status (`core` / `experimental`), model language name. Missing keys fall back to English. CSS logical properties are used throughout so RTL support is low-cost. Core languages (Nov 17): `en`, `ms`, `zh-Hans`, `zh-Hant`, `ta`. Experimental (Nov 17): `id`. Experimental (Dec 1): `bn`, `ne`, `my`, `hi`, `vi`, `th`, `tl`, `ja`, `ko`, `ar`, `ur`.
- Validation: zod schemas for API input and for structured AI output.
- i18n: all UI strings in locale files (one per BCP 47 tag). Every AI-generated question or translation is labelled as machine-translated in every language.
- Secrets: no API keys are needed for Workers AI (binding-based). Other secrets via environment variables (`.env`, never committed). Provide `.env.example`.
- Testing: Vitest + fast-check property-based tests for field mapping, validation and PDF filling; Playwright end-to-end and axe accessibility checks on the demo path.
- Optional later: a Chrome extension that runs AccessForge on any site.
- Keep dependencies minimal and well known.
