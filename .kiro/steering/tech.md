# Tech Guidelines

- Language: **TypeScript** everywhere.
- Main product: a **web app** (React + Vite) that anyone can open from a public URL with no install.
  - **AccessForge** opens a legacy-style page (our own demo legacy site, served by the app) and presents a modern, accessible view that still operates the original page.
  - **FormBridge** reads PDF form fields (pdf-lib to fill, pdf.js to render), guides the user through each field in English, Chinese or Malay, validates answers, and produces the filled PDF.
- Backend: a small TypeScript API (serverless functions or a light Node server). It is the only place that calls the AI provider.
- AI: one shared service layer behind an interface (page understanding, field mapping, translation, validation), plus a deterministic mock provider for tests and offline demos.
- Validation: zod schemas for API input and for structured AI output.
- i18n: all UI strings in locale files (en, zh, ms).
- Secrets: API keys only via environment variables (`.env`, never committed). Provide `.env.example`.
- Testing: Vitest + fast-check property-based tests for field mapping, validation and PDF filling; Playwright end-to-end and axe accessibility checks on the demo path.
- Optional later: a Chrome extension that runs AccessForge on any site.
- Keep dependencies minimal and well known.
