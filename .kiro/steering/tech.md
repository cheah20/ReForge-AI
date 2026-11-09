# Tech Guidelines (initial — finalize in the first spec)

- Language: **TypeScript** everywhere.
- Web mode: browser extension (Chrome Manifest V3) that reads the live page DOM and fills fields.
- PDF mode: web app (React + Vite) using a PDF library (e.g. pdf-lib / pdf.js) to read and fill form fields.
- AI: one shared LLM service layer for page understanding, translation, field mapping, and validation. Keep the provider behind an interface so it can be swapped.
- Secrets: API keys only via environment variables (`.env`, never committed). Provide `.env.example`.
- Testing: unit tests for field mapping and validation logic; include a sample legacy HTML page and a sample PDF form as test fixtures.
- Keep dependencies minimal and well-known.
