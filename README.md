# ReForge AI

**AI-Powered Legacy Web Modernization & Multilingual Form Assistance**

Built for the **Kiroween 2026** hackathon (Category: **Frankenstein**) using [Kiro](https://kiro.dev).

ReForge AI stitches two systems into one assistant:

| Module | What it does |
| --- | --- |
| **AccessForge** — 老旧网站智能改造 | Reads outdated, hard-to-use websites and rebuilds them as a clean, modern, accessible interface that still operates the original site. |
| **FormBridge** — 多语言 PDF 与网页智能填表 | Understands PDF and web forms, asks the user questions in their own language (e.g. Chinese, Malay, English), validates the answers, and fills the form. |

## How it works

1. The user opens a legacy website (or uploads a PDF form).
2. **AccessForge** analyzes the page structure — menus, buttons, form fields — and presents a simplified, modern view.
3. **FormBridge** walks the user through each field in their preferred language and validates the input.
4. ReForge AI fills the original form. **The user always reviews and confirms before anything is submitted.**
5. Anything the AI cannot identify safely is flagged for the user to handle manually.

## Status

🚧 In development for Kiroween 2026 (submission deadline: Dec 4, 2026, 2:00 PM PT).

## How Kiro is used

Kiro project files live in [`/.kiro`](.kiro):

- **Steering** (`.kiro/steering/`) — product, tech, and structure guidelines Kiro follows.
- **Specs** (`.kiro/specs/`) — requirements, design, and task plans for each feature.
- **Hooks** (`.kiro/hooks/`) — automated checks during development.

A full write-up of how Kiro was used will be added before submission.

## Pre-existing code disclosure

This project was created from scratch during the Kiroween 2026 Submission Period. Open source libraries used will be listed here.

## License

[MIT](LICENSE)
