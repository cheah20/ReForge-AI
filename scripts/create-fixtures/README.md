# Fixture creation scripts

## create-fixtures.ts

Generates every synthetic PDF fixture in `fixtures/` except `encrypted.pdf`:

```
npm run generate-fixtures
```

The output is byte-reproducible. `tests/unit/fixtures.test.ts` fails if a committed fixture differs from what the script produces.

## encrypted.ts

Generates `fixtures/encrypted.pdf` with qpdf (AES-256):

```
npm run generate-encrypted-fixture
```

The script looks for qpdf in this order:

1. the `QPDF_PATH` environment variable, if set
2. `qpdf` on `PATH`
3. `C:\Program Files\qpdf 12.4.2\bin\qpdf.exe`

- **Tested with:** qpdf 12.4.2
- **Source:** the two-field base form from `create-fixtures.ts` (`probe.name`, `probe.reference`)
- **User password:** `fixture-open-only`
- **Owner password:** `fixture-owner-only`
- **Command:** `qpdf --encrypt <user-pw> <owner-pw> 256 -- base.pdf fixtures/encrypted.pdf`
- **Verify:** `qpdf --show-encryption --password=fixture-open-only fixtures/encrypted.pdf` reports `R = 6` (AES-256). A PDF viewer asks for a password.

AES-256 uses a random IV, so each run produces different bytes with the same structure. The rejection test checks the structure, not the bytes.

## fixtures/chinese-school-form.pdf

Created later by task 41.3.
