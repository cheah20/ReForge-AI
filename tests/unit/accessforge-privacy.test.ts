// @vitest-environment jsdom
/**
 * tests/unit/accessforge-privacy.test.ts
 *
 * accessforge-skeleton task 18.1: canary values typed into the frame before
 * extraction and given as Mirror answers never reach the Page_Model, the
 * analysis request, the prompt, any Worker log entry or any error response;
 * the legacy handler keeps nothing between requests.
 * Validates: Requirements 2.5, 13.1, 13.2, 13.3, 13.5, 13.6, 13.10, 13.12
 */

import { describe, it, expect } from 'vitest';
import { LoopRunner } from '../../src/frontend/accessforge/loop-runner.js';
import { createHandler } from '../../src/worker/index.js';
import { MockAiProvider } from '../../src/lib/ai/mock.js';
import { pageAnalyzeMessages } from '../../src/lib/ai/prompt.js';
import type { AiProvider, PageAnalyzeCall } from '../../src/lib/ai/interface.js';
import type { LogEntry } from '../../src/worker/http.js';
import type { PageAnalyzeRequest, PageAnalyzeResponse } from '../../src/shared/page-schemas.js';
import type { ApiReply } from '../../src/frontend/api.js';
import { TEMPLATES } from '../../src/worker/legacy/generated/templates.js';
import { fill } from '../../src/worker/legacy/render.js';
import { DEPS, VALID, body } from './legacy-helpers.js';
import { TODAY } from './accessforge-machine-helpers.js';

const FRAME = 'CANARY-FRAME-5Q7Z';
const ANSWER = 'CANARY-ANSWER-8K2M';
const ORIGIN = window.location.origin;
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const flush = () => new Promise((r) => setTimeout(r, 0));

/** The registration page with the frame canary typed into every text input. */
function typedPage(): Document {
  const doc = parse(fill(TEMPLATES.register, {}));
  for (const input of Array.from(doc.querySelectorAll('input[type="text"]'))) (input as HTMLInputElement).value = FRAME;
  return doc;
}

/** A provider that records every prompt it would send and answers like the mock. */
function recordingProvider(prompts: string[]): AiProvider {
  const mock = new MockAiProvider();
  return {
    kind: 'real',
    analyze: (c) => mock.analyze(c),
    retranslate: (c) => mock.retranslate(c),
    translate: (c) => mock.translate(c),
    analyzeLabels: (c) => mock.analyzeLabels(c),
    retranslatePage: (c) => mock.retranslatePage(c),
    analyzePage: (c: PageAnalyzeCall) => {
      prompts.push(JSON.stringify(pageAnalyzeMessages(c)));
      return mock.analyzePage(c);
    },
  };
}

describe('AccessForge privacy canaries', () => {
  it('the canaries are really in the frame and the answer (canary check)', () => {
    const doc = typedPage();
    expect((doc.querySelector('input[name="nama"]') as HTMLInputElement).value).toBe(FRAME);
  });

  it('never reach the Page_Model, the analysis request, the prompt, the logs or the responses, even on a second analysis', async () => {
    const prompts: string[] = [];
    const logs: LogEntry[] = [];
    const responses: string[] = [];
    const requests: string[] = [];
    const worker = createHandler({ provider: recordingProvider(prompts), logger: (e) => logs.push(e) });
    const analyze = async (req: PageAnalyzeRequest): Promise<ApiReply<PageAnalyzeResponse>> => {
      const text = JSON.stringify(req);
      requests.push(text);
      const res = await worker.fetch(new Request(`${ORIGIN}/api/pages/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text }), {});
      const out = await res.text();
      responses.push(out);
      return { data: JSON.parse(out) as PageAnalyzeResponse, aiMode: 'real' };
    };

    const frame = { doc: typedPage(), url: new URL('/legacy/register', ORIGIN), src: '' };
    const iframe = { get contentDocument() { return frame.doc; }, get contentWindow() { return { location: frame.url }; }, set src(v: string) { frame.src = v; } };
    const runner = new LoopRunner({ frame: () => iframe as unknown as HTMLIFrameElement, appOrigin: ORIGIN, analyze }, 'en');
    runner.onFrameLoad();
    runner.dispatch({ type: 'REVIVE_PRESSED' });
    runner.dispatch({ type: 'NOTICE_ACKNOWLEDGED' });
    await flush();
    expect(runner.get().phase).toBe('asking');
    expect(JSON.stringify(runner.get().model)).not.toContain(FRAME);

    // A Mirror answer, then a stop and a second revival with the answer kept in memory.
    runner.dispatch({ type: 'NEXT_PRESSED', answer: { kind: 'text', value: ANSWER }, today: TODAY });
    expect((frame.doc.querySelector('input[name="nama"]') as HTMLInputElement).value).toBe(ANSWER);
    frame.doc = typedPage();
    runner.onFrameLoad();
    expect(runner.get().phase).toBe('stopped');
    runner.dispatch({ type: 'RELOAD_PRESSED' });
    frame.doc = typedPage();
    runner.onFrameLoad();
    runner.dispatch({ type: 'REVIVE_PRESSED' });
    runner.dispatch({ type: 'NOTICE_ACKNOWLEDGED' });
    await flush();
    expect(runner.get().fields[0]!.answer).toEqual({ kind: 'text', value: ANSWER });

    expect(requests).toHaveLength(2);
    expect(prompts).toHaveLength(2);
    for (const text of [...requests, ...prompts, ...responses, JSON.stringify(logs)]) {
      expect(text).not.toContain(FRAME);
      expect(text).not.toContain(ANSWER);
    }
  });

  it('keeps the canary out of error responses and logs of the analysis route', async () => {
    const logs: LogEntry[] = [];
    const worker = createHandler({ provider: new MockAiProvider(), logger: (e) => logs.push(e) });
    const res = await worker.fetch(
      new Request(`${ORIGIN}/api/pages/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageModel: { path: ANSWER }, interfaceLanguage: ANSWER }) }),
      {},
    );
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(ANSWER);
    expect(JSON.stringify(logs)).not.toContain(ANSWER);
  });

  it('logs no submitted value from the legacy POST, puts none in the error page, and keeps nothing between requests', async () => {
    const logs: LogEntry[] = [];
    const worker = createHandler({ legacy: DEPS, logger: (e) => logs.push(e) });
    const post = (pairs: Array<[string, string]>) =>
      worker.fetch(new Request(`${ORIGIN}/legacy/register`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body(pairs) }), {});

    const ok = await post(VALID.map(([n, v]): [string, string] => [n, n === 'nama' ? ANSWER : v]));
    expect(ok.status).toBe(200);
    // The confirmation shows the value once, as the legacy portal's own receipt.
    expect(await ok.text()).toContain(ANSWER);

    const bad = await post(VALID.map(([n, v]): [string, string] => [n, n === 'nokp' ? ANSWER : v]));
    expect(bad.status).toBe(422);
    expect(await bad.text()).not.toContain(ANSWER);

    const after = await worker.fetch(new Request(`${ORIGIN}/legacy/register`), {});
    expect(await after.text()).not.toContain(ANSWER);
    expect(logs.length).toBe(3);
    expect(JSON.stringify(logs)).not.toContain(ANSWER);
  });
});
