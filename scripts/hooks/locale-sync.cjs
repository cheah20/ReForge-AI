/**
 * scripts/hooks/locale-sync.cjs
 *
 * Reports, for every core language in the registry, the keys of en.json that
 * its locale file is missing (or still marks as "[MT]" placeholders). It never
 * writes locale files: missing keys must get real translations, because
 * English copies would make the locale completeness test pass without them.
 *
 * Limit: this checks that keys are present and non-empty. It does not check
 * that a translation is correct, natural or even in the right language; that
 * needs a human reader of each language.
 *
 *   node scripts/hooks/locale-sync.cjs   -> exit 0 when complete, 1 otherwise
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** Core language tags parsed from the registry entries. */
function coreTags(root) {
  const src = fs.readFileSync(path.join(root, 'src', 'packs', 'language', 'registry.ts'), 'utf8');
  const tags = [];
  for (const m of src.matchAll(/tag:\s*'([^']+)'[\s\S]*?status:\s*'(core|experimental)'/g)) {
    if (m[2] === 'core') tags.push(m[1]);
  }
  return tags;
}

/** { tag: [missing or placeholder keys] } for every core locale except English. */
function localeGaps(root) {
  const dir = path.join(root, 'src', 'packs', 'language', 'locales');
  const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
  const gaps = {};
  for (const tag of coreTags(root)) {
    if (tag === 'en') continue;
    const file = path.join(dir, `${tag}.json`);
    const strings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const missing = Object.keys(en).filter((k) => {
      const v = strings[k];
      return typeof v !== 'string' || v.trim() === '' || v.startsWith('[MT]');
    });
    if (missing.length) gaps[tag] = missing;
  }
  return gaps;
}

module.exports = { coreTags, localeGaps };

if (require.main === module) {
  const gaps = localeGaps(process.cwd());
  const tags = Object.keys(gaps);
  if (tags.length === 0) {
    console.log('locale-sync: every core locale has every en.json key.');
  } else {
    console.log('locale-sync: core locales are missing keys from en.json.');
    for (const tag of tags) console.log(`  ${tag}.json: ${gaps[tag].join(', ')}`);
    console.log(
      'Translate each key listed above into that language and add it to the locale file. ' +
        'Do not copy the English text and do not add "[MT]" placeholders.',
    );
    process.exitCode = 1;
  }
}
