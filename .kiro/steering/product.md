# Product: ReForge AI

ReForge AI — AI-Powered Legacy Web Modernization & Multilingual Form Assistance.
Built for Kiroween 2026, category **Frankenstein** (stitching different technologies into one powerful app).

Pitch: "ReForge turns unfamiliar forms into guided conversations in your language. Proven first in Malaysia; built to travel."

## Who it is for

People completing essential forms across a language barrier: international migrants, refugees, older adults, and travellers. ReForge AI is a global product. Malaysia is the first deployment and case study — not the limit.

## Modules

- **AccessForge** — understands legacy websites (menus, buttons, flows, form fields) and presents a modern, accessible interface that still operates the original site.
- **FormBridge** — understands PDF and web forms, guides the user field by field in their preferred language, validates answers, and fills the form. Supports any language in the language registry; country-specific validation is handled by pluggable country packs.

Both modules share one AI engine: page/document understanding, translation, field mapping, validation.

## Three independent settings

FormBridge keeps three settings separate:
- **Interface language** — the language the user reads questions and instructions in.
- **Form output language** — the language the form expects answers to be written in (detected from the form, confirmed by the user when uncertain).
- **Form country** — determines which country pack handles field validation (IC, phone, postcode, etc.).

## Country packs

Country-specific validation lives in pluggable country packs with a single registry (same pattern as the language registry):
- **`MY` pack** (Nov 17): Malaysian IC (MyKad), Malaysian phone numbers, 5-digit postcode.
- **`US` pack** (Dec 1): US phone numbers, ZIP and ZIP+4, MM/DD/YYYY date format, SSN format check only (never claim verification, never sent to the backend).
- **Universal fallback pack**: international phone numbers via `libphonenumber-js` (needs a country hint), email, dates with explicit format confirmation, permissive postcodes (unfamiliar formats kept as typed). Permissive fallback, not full validation.

## Non-negotiable principles

1. **Human in control** — never submit a form automatically. The user always reviews and confirms.
2. **No fake automation** — if a field or action cannot be identified reliably, say so and ask the user to do it manually.
3. **Privacy** — do not store personal form data beyond the session; never log personal data.
4. **Accuracy over features** — a complete, working end-to-end demo beats many half-done features.
5. **Honest claims** — never claim "any form in any country". The UI and README list tested countries and languages and mark everything else experimental.

## Demo scenarios (must work end to end)

**Nov 17 (main):** Language picker → Chinese (`zh-Hans`) → upload Malaysian clinic form → FormBridge asks questions in Chinese → Malay answers written to PDF → user confirms.

**Dec 1 (second):** Language picker → Spanish (`es`) → upload US community clinic form → FormBridge asks questions in Spanish → English answers written to PDF, including ZIP validation → user confirms.

**AccessForge path:** Open a legacy-style website → AccessForge shows a modern view → user switches language → FormBridge fills the embedded form → user confirms.
