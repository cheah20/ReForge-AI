# Kiro Usage Log

Running notes for the Devpost "How Kiro was used" write-up. Add an entry whenever a Kiro feature makes a real difference.

| Date | Kiro feature | What we did | Result / impact |
| --- | --- | --- | --- |
| 2026-11-09 | Steering | Added product, tech, and hackathon-rules steering docs | Kiro follows the project goals and contest rules in every session |
| 2026-11-09 | Spec (requirements) | Wrote requirements.md for formbridge-pdf through requirements-first workflow | 16 numbered requirements covering PDF extraction, language registry, country packs, AI analysis, validation, PDF fill, accessibility, fixtures, and tests |
| 2026-11-09 | Spec (design) | Wrote design.md for formbridge-pdf with PBT prework tool | Produced full architecture, repo layout, API design, prompt design, model comparison plan, CJK prototype plan, batch size rationale, 12 correctness properties from prework analysis, and design tokens |
| 2026-11-10 | Hooks | Added three agent hooks: tests on save, locale key sync when `en.json` changes, and a commit guard | The first commit guard blocked every file write under the private notes folder, including Kiro's own progress notes. Kiro rewrote it to check only `git add` and `git commit`, with 7 unit tests for the guard |
| 2026-11-10 | Spec (tasks) | Ran formbridge-pdf tasks 1 to 9 in order, probing each fixture through the extractor | The probe found doubled field names (`clinic.clinic.branchCode`), radio widgets counted as separate fields and a pdf-lib lookup that threw at runtime. All three were fixed, and field counts now match the fixture spec: 22, 10, 14, 5 and 2 |
