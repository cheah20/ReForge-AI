/**
 * tests/unit/legacy-html.test.ts
 *
 * accessforge-skeleton task 3.2: the tree builder, sanitiser, serialiser and
 * scanner on a hostile tree.
 * Validates: Requirements 4.1, 4.7, 4.8
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { findUnsafeConstructs, h, sanitizeTree, serialize, serializeParts, slot, text, type Node } from '../../src/lib/legacy-build/html.js';
import { HOSTILE_CONSTRUCTS, hostileTree, KEPT_TEXT, REMOVED_TEXT } from '../e2e/helpers/hostile-pages.js';

describe('hostile tree', () => {
  it('the raw serialisation (sanitiser bypassed) reports every hostile construct', () => {
    const findings = findUnsafeConstructs(serialize(hostileTree()));
    for (const [name, pattern] of HOSTILE_CONSTRUCTS) {
      expect(findings.some((f) => pattern.test(f)), `${name} in ${JSON.stringify(findings)}`).toBe(true);
    }
  });

  it('after sanitizeTree nothing unsafe is left', () => {
    expect(findUnsafeConstructs(serialize(sanitizeTree(hostileTree())))).toEqual([]);
  });

  it('text inside a removed element is gone; text in kept elements is unchanged', () => {
    const raw = serialize(hostileTree());
    expect(raw).toContain(REMOVED_TEXT);
    const clean = serialize(sanitizeTree(hostileTree()));
    expect(clean).not.toContain(REMOVED_TEXT);
    expect(clean.split(KEPT_TEXT).length - 1).toBe(2); // title and paragraph
    expect(clean).toContain('<a>Klik di sini</a>'); // the link text stays, the javascript: href goes
  });

  it('the foreign form action and the submit formaction are removed, the controls stay', () => {
    const clean = serialize(sanitizeTree(hostileTree()));
    expect(clean).toContain('<form method="post">');
    expect(clean).toContain('<input type="submit" value="Hantar">');
    expect(clean).not.toContain('evil.example');
  });
});

describe('scanner scans tag text only', () => {
  it('an escaped javascript: text value gives no finding', () => {
    const page = h('p', {}, 'javascript:alert(1) <script>x</script> " onload="x');
    const html = serialize(page);
    expect(html).toContain('javascript:alert(1)');
    expect(findUnsafeConstructs(html)).toEqual([]);
  });

  it.each([
    ['<a href="JaVaScRiPt:x">', /javascript: URL/],
    ['<a href="java&#x09;script:x">', /javascript: URL/],
    ['<a href="&#106;avascript:x">', /javascript: URL/],
    ['<a href="//evil.example/">', /external URL/],
    ['<img src="data:image/png;base64,AA">', /data: URL/],
    ['<div ONCLICK="x">', /inline handler onclick/],
    ['<iframe srcdoc="x">', /iframe element/],
    ['<base href="/">', /base element/],
    ["<meta http-equiv='refresh' content='0'>", /meta refresh/],
    ['<div class="url(x)">', /CSS url\(/],
  ])('finds %s', (html, pattern) => {
    expect(findUnsafeConstructs(html).some((f) => pattern.test(f)), JSON.stringify(findUnsafeConstructs(html))).toBe(true);
  });

  it('allows same-origin relative links', () => {
    expect(findUnsafeConstructs('<a href="/legacy/register">x</a><form action="/legacy/register" method="post">')).toEqual([]);
  });
});

describe('builder and serialiser', () => {
  it('h() refuses a tag outside the allow-list', () => {
    expect(() => h('script' as never)).toThrow(/not an allowed tag/);
  });

  it('escapes & < > " \' in text and attributes and always quotes attributes', () => {
    expect(serialize(h('p', { class: `a"b'c<d>&` }, `1 < 2 & "q" 'r' >`))).toBe(
      '<p class="a&quot;b&#39;c&lt;d&gt;&amp;">1 &lt; 2 &amp; &quot;q&quot; &#39;r&#39; &gt;</p>',
    );
  });

  it('regression (property counterexample, seed -1503770646): text nested in a void element is dropped', () => {
    const tree: Node = { tag: 'input', attrs: {}, children: [{ text: 'a' }] };
    expect(sanitizeTree(tree)).toEqual({ tag: 'input', attrs: {}, children: [] });
  });

  it('regression (hostile tree): a meta that only had http-equiv goes with its content', () => {
    const tree: Node = { tag: 'meta', attrs: { 'http-equiv': 'refresh', content: '0; url=https://evil.example/' }, children: [] };
    expect(serialize(sanitizeTree(tree))).not.toContain('evil.example');
    expect(serialize(sanitizeTree(h('meta', { name: 'portal-page', content: 'register' })))).toBe('<meta name="portal-page" content="register">');
  });

  it('regression (property counterexample, seed 1916771454): javascript: in a non-URL attribute is removed', () => {
    const tree: Node = { tag: 'p', attrs: { class: 'javascript:x' }, children: [] };
    expect(findUnsafeConstructs(serialize(tree))).toEqual(['javascript: URL in class on p']);
    expect(serialize(sanitizeTree(tree))).toBe('<p></p>');
  });

  it('a slot becomes a split point', () => {
    const parts = serializeParts(h('p', {}, 'No. ', slot('reference'), text('.')));
    expect(parts).toEqual({ segments: ['<p>No. ', '.</p>'], slots: ['reference'] });
  });

  it('property: sanitised output of any tree mixing allowed and forbidden parts has no unsafe construct and keeps the text of kept elements', () => {
    const word = fc.stringMatching(/^[A-Za-z]{1,8}$/);
    const value = fc.oneof(
      word,
      fc.constantFrom('javascript:x', 'https://evil.example/', '//x', 'data:x', '/legacy/register', '/legacy/', 'url(x)', 'x" onload="y'),
    );
    const attrName = fc.constantFrom('class', 'href', 'src', 'action', 'onclick', 'onload', 'formaction', 'style', 'srcdoc', 'http-equiv', 'id');
    const tagName = fc.constantFrom('p', 'div', 'a', 'form', 'input', 'span', 'script', 'iframe', 'img', 'base', 'object', 'meta', 'link');
    const tree: fc.Arbitrary<Node> = fc.letrec((tie) => ({
      node: fc.oneof(
        { depthSize: 'small' },
        word.map((t) => ({ text: t }) as Node),
        fc.record({
          tag: tagName,
          attrs: fc.dictionary(attrName, value, { maxKeys: 3 }),
          children: fc.array(tie('node'), { maxLength: 3 }),
        }) as fc.Arbitrary<Node>,
      ),
    })).node;
    let sawUnsafeRaw = 0;
    fc.assert(
      fc.property(tree, (t) => {
        if (findUnsafeConstructs(serialize(t)).length > 0) sawUnsafeRaw++;
        const clean = sanitizeTree(t);
        expect(findUnsafeConstructs(serialize(clean))).toEqual([]);
        // Text of every element the sanitiser kept is unchanged.
        const texts = (n: Node): string[] => ('text' in n ? [n.text] : 'slot' in n ? [] : n.children.flatMap(texts));
        const out = serialize(clean);
        for (const s of texts(clean)) expect(out).toContain(s);
      }),
      { numRuns: 300 },
    );
    expect(sawUnsafeRaw).toBeGreaterThan(0);
  });
});
