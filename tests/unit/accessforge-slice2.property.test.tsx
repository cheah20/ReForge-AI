// @vitest-environment jsdom
/**
 * tests/unit/accessforge-slice2.property.test.ts
 *
 * accessforge-skeleton tasks 27.16 to 27.21 (Slice 2): Properties 21 to 26.
 * 100 runs each; fast-check prints the seed on failure.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createHandler } from '../../src/worker/index.js';
import { MockAiProvider } from '../../src/lib/ai/mock.js';
import type { AiProvider, AiReply, PageAnalyzeCall } from '../../src/lib/ai/interface.js';
import { pageAnalyzeMessages, pageRetranslateMessages } from '../../src/lib/ai/prompt.js';
import { handleLegacy } from '../../src/worker/legacy/handler.js';
import { TEMPLATES } from '../../src/worker/legacy/generated/templates.js';
import { fill } from '../../src/worker/legacy/render.js';
import { validatePlan } from '../../src/lib/accessforge/plan-validator.js';
import { fieldById, isLowConfidence, needsConfidenceCheck, reviewRows, steps } from '../../src/lib/accessforge/agent-machine.js';
import { LoopRunner, type LoopDeps } from '../../src/frontend/accessforge/loop-runner.js';
import { ApiRequestError, type ApiReply } from '../../src/frontend/api.js';
import { RevivalFrame } from '../../src/frontend/accessforge/RevivalFrame.js';
import { namesForeignAddress, REVIVAL_FRAME_SRC } from '../../src/lib/accessforge/scope.js';
import type { LogEntry } from '../../src/worker/http.js';
import type { PageAnalyzeResponse, PageModel, PageRetranslateRequest } from '../../src/shared/page-schemas.js';
import { MODEL } from './accessforge-helpers.js';
import { ANSWERS, TODAY, fresh, send, type Run } from './accessforge-machine-helpers.js';
import { DEPS } from './legacy-helpers.js';
import { render, withApp } from './accessforge-render.js';

const RUNS = { numRuns: 100 };
const ORIGIN = window.location.origin;
const TYPES: Record<string, string> = {
  'f0:text:nama': 'text',
  'f0:text:nokp': 'ic',
  'f0:text:tlahir': 'date',
  'f0:radio:jantina': 'radio',
  'f0:text:tel': 'phone',
  'f0:text:poskod': 'postcode',
  'f0:select:tujuan': 'dropdown',
  'f0:checkbox:akuan': 'checkbox',
};
const FIELD_IDS = Object.keys(TYPES);
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

// ---------------------------------------------------------------------------
// Property 21: invalid analysis requests never reach the provider
// ---------------------------------------------------------------------------
function countingProvider() {
  const mock = new MockAiProvider();
  const p = {
    kind: 'real' as const,
    calls: 0,
    analyze: () => Promise.reject(new Error('unused')),
    retranslate: () => Promise.reject(new Error('unused')),
    translate: () => Promise.reject(new Error('unused')),
    analyzeLabels: () => Promise.reject(new Error('unused')),
    analyzePage: (c: PageAnalyzeCall) => (p.calls++, mock.analyzePage(c)),
    retranslatePage: () => (p.calls++, Promise.reject(new Error('unused'))),
  };
  return p satisfies AiProvider & { calls: number };
}
const VALID_BODY = { pageModel: MODEL, interfaceLanguage: 'en' };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type Mutation = (body: Record<string, unknown>, junk: string) => unknown;
const MUTATIONS: Record<string, Mutation> = {
  dropModel: (b) => (delete b['pageModel'], b),
  dropLanguage: (b) => (delete b['interfaceLanguage'], b),
  extraTopLevel: (b, j) => ({ ...b, [`x${j}`]: 1 }),
  shortLanguage: (b) => ({ ...b, interfaceLanguage: 'e' }),
  longLanguage: (b) => ({ ...b, interfaceLanguage: 'e'.repeat(21) }),
  badVersion: (b, j) => ({ ...b, pageModel: { ...(b['pageModel'] as object), pageVersion: `z${j}` } }),
  wrongPath: (b, j) => ({ ...b, pageModel: { ...(b['pageModel'] as object), path: `/legacy/${j}` } }),
  noEntries: (b) => ({ ...b, pageModel: { ...(b['pageModel'] as object), entries: [] } }),
  tooManyEntries: (b) => {
    const m = b['pageModel'] as PageModel;
    return { ...b, pageModel: { ...m, entries: Array.from({ length: 51 }, () => m.entries[0]) } };
  },
  extraEntryProperty: (b, j) => {
    const m = b['pageModel'] as PageModel;
    return { ...b, pageModel: { ...m, entries: [{ ...m.entries[0], [`selector${j}`]: 'div' }, ...m.entries.slice(1)] } };
  },
  longLabel: (b) => {
    const m = b['pageModel'] as PageModel;
    return { ...b, pageModel: { ...m, entries: [{ ...m.entries[0], labelText: 'a'.repeat(201) }, ...m.entries.slice(1)] } };
  },
  unknownControl: (b, j) => {
    const m = b['pageModel'] as PageModel;
    return { ...b, pageModel: { ...m, entries: [{ ...m.entries[0], control: `c${j}` }, ...m.entries.slice(1)] } };
  },
  notAnObject: (_b, j) => [j],
  nullBody: () => null,
  numberBody: (_b, j) => j.length,
};

describe('Property 21: invalid analysis requests never reach the provider', () => {
  // Feature: accessforge-skeleton, Property 21: Invalid analysis requests never reach the provider
  // Validates: Requirements 6.3, 13.6
  const call = (provider: AiProvider, body: string, logs: LogEntry[] = []) =>
    createHandler({ provider, logger: (e) => logs.push(e), requestId: () => 'req', now: () => 1 }).fetch(
      new Request('https://reforge.example/api/pages/analyze', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body }),
      {},
    );

  it('control: a valid body does reach the provider', async () => {
    const p = countingProvider();
    const res = await call(p, JSON.stringify(VALID_BODY));
    expect(res.status).toBe(200);
    expect(p.calls).toBe(1);
  });

  it('answers 400 or 413 in the shared error shape and makes no provider call', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...Object.keys(MUTATIONS)), fc.stringMatching(/^[a-z0-9]{1,8}$/), async (name, junk) => {
        const p = countingProvider();
        const res = await call(p, JSON.stringify(MUTATIONS[name]!(clone(VALID_BODY) as Record<string, unknown>, junk)));
        const payload = (await res.json()) as { error: { code: string; message: string } };
        expect(res.status, name).toBe(400);
        expect(payload.error.code, name).toBe('BAD_REQUEST');
        expect(p.calls, name).toBe(0);
      }),
      RUNS,
    );
  });

  it('refuses text that is not JSON, and a body over the limit, without a provider call', async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.string({ maxLength: 40 }).filter((s) => { try { JSON.parse(s); return false; } catch { return true; } }), fc.integer({ min: 48 * 1024 + 1, max: 60 * 1024 }).map((n) => 'x'.repeat(n))), async (text) => {
        const p = countingProvider();
        const res = await call(p, text);
        expect([400, 413]).toContain(res.status);
        expect(p.calls).toBe(0);
      }),
      RUNS,
    );
  });

  it('refuses a language the registry does not know before the provider is called', async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[a-z]{2}-[A-Z]{4}$/), async (lang) => {
        const p = countingProvider();
        const res = await call(p, JSON.stringify({ ...VALID_BODY, interfaceLanguage: lang }));
        expect(res.status).toBe(400);
        expect(p.calls).toBe(0);
      }),
      RUNS,
    );
  });

  it('does not echo submitted values in the error or the log', async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^ZQX[A-Z0-9]{10}$/), async (canary) => {
        const logs: LogEntry[] = [];
        const bad = { ...clone(VALID_BODY), pageModel: { ...clone(VALID_BODY).pageModel, pageVersion: canary } };
        const text = JSON.stringify(bad);
        expect(text).toContain(canary);
        const res = await call(countingProvider(), text, logs);
        expect(await res.text()).not.toContain(canary);
        expect(JSON.stringify(logs)).not.toContain(canary);
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Property 22: steps, evidence and review rows follow the plan
// ---------------------------------------------------------------------------
function toFirstQuestion(mapped: readonly string[], confidence: Record<string, number>): Run {
  const plan = validatePlan(
    MODEL,
    mapped.map((elementId) => ({ elementId, humanLabel: 'Label', question: 'Question?', answerType: TYPES[elementId], confidence: confidence[elementId] })),
  );
  let r = fresh();
  r = send(r, { type: 'FRAME_LOADED', generation: 1, page: 'register', versionSupported: true });
  r = send(r, { type: 'REVIVE_PRESSED' });
  r = send(r, { type: 'NOTICE_ACKNOWLEDGED' });
  r = send(r, { type: 'MODEL_READY', generation: 1, model: MODEL });
  return send(r, { type: 'PLAN_READY', generation: 1, analysisMode: 'mock', plan });
}
const NON_BUTTONS = MODEL.entries.filter((e) => e.control !== 'submit' && e.control !== 'reset').map((e) => e.elementId);

describe('Property 22: steps, evidence and review rows follow the plan', () => {
  // Feature: accessforge-skeleton, Property 22: Steps, evidence and review rows follow the plan
  // Validates: Requirements 6.9, 6.11, 6.18, 9.1, 10.4
  const planArb = fc.record({
    mapped: fc.subarray(FIELD_IDS),
    confidence: fc.tuple(...FIELD_IDS.map(() => fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom(0, 0.69, 0.7, 1)))),
    declined: fc.subarray(FIELD_IDS),
  });

  it('asks one question for each mapped field in form order, checks low confidence first, and lists every field once', () => {
    fc.assert(
      fc.property(planArb, ({ mapped, confidence, declined }) => {
        const conf = Object.fromEntries(FIELD_IDS.map((id, i) => [id, confidence[i]!]));
        let r = toFirstQuestion(mapped, conf);
        const expected = NON_BUTTONS.filter((id) => mapped.includes(id));
        expect(steps(r.state)).toEqual(expected);
        for (const f of r.state.fields) {
          expect(f.status === 'do-it-yourself', f.elementId).toBe(!mapped.includes(f.elementId));
          if (f.plan) {
            expect(needsConfidenceCheck(f), f.elementId).toBe(conf[f.elementId]! < 0.7);
            expect(isLowConfidence(f)).toBe(conf[f.elementId]! < 0.7);
          }
        }
        const declinedNow = new Set<string>();
        for (let i = 0; i < 30 && r.state.phase === 'asking'; i++) {
          const field = fieldById(r.state, r.state.current!)!;
          if (needsConfidenceCheck(field)) {
            // No answer input before the check: Next does nothing.
            const before = r.state;
            expect(send(r, { type: 'NEXT_PRESSED', answer: ANSWERS[field.elementId]!, today: TODAY }).state).toEqual(before);
            if (declined.includes(field.elementId)) {
              declinedNow.add(field.elementId);
              r = send(r, { type: 'LOW_CONFIDENCE_DECLINED' });
              continue;
            }
            r = send(r, { type: 'LOW_CONFIDENCE_ACCEPTED' });
          }
          r = send(r, { type: 'NEXT_PRESSED', answer: ANSWERS[r.state.current!]!, today: TODAY });
        }
        expect(r.state.phase).toBe('review');
        const rows = reviewRows(r.state);
        expect(rows.map((row) => row.field.elementId)).toEqual(NON_BUTTONS);
        for (const row of rows) {
          const id = row.field.elementId;
          const isDiy = !mapped.includes(id) || declinedNow.has(id);
          expect(row.status, id).toBe(isDiy ? 'do-it-yourself' : 'filled');
          if (declinedNow.has(id)) expect(row.field.diyReason).toBe('DECLINED');
          if (isDiy) expect(r.frame.values.has(id), `${id} untouched`).toBe(false);
        }
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Property 23: skipping clears what was written
// ---------------------------------------------------------------------------
const OPTIONAL = ['f0:text:tel', 'f0:text:poskod', 'f0:radio:jantina', 'f0:select:tujuan'];
function modelWith(optional: readonly string[]): PageModel {
  return { ...MODEL, entries: MODEL.entries.map((e) => (optional.includes(e.elementId) ? { ...e, required: false } : e)) } as PageModel;
}
function toReview(model: PageModel): Run {
  const plan = validatePlan(model, FIELD_IDS.map((elementId) => ({ elementId, humanLabel: 'Label', question: 'Question?', answerType: TYPES[elementId], confidence: 0.9 })));
  let r = fresh();
  r = send(r, { type: 'FRAME_LOADED', generation: 1, page: 'register', versionSupported: true });
  r = send(r, { type: 'REVIVE_PRESSED' });
  r = send(r, { type: 'NOTICE_ACKNOWLEDGED' });
  r = send(r, { type: 'MODEL_READY', generation: 1, model });
  r = send(r, { type: 'PLAN_READY', generation: 1, analysisMode: 'mock', plan });
  for (let i = 0; i < 20 && r.state.phase === 'asking'; i++) r = send(r, { type: 'NEXT_PRESSED', answer: ANSWERS[r.state.current!]!, today: TODAY });
  return r;
}

describe('Property 23: skipping clears what was written', () => {
  // Feature: accessforge-skeleton, Property 23: Skipping clears what was written
  // Validates: Requirements 8.11, 9.12
  it('leaves each skipped field empty, marks it skipped, and changes no other field', () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(OPTIONAL, { minLength: 1 }), (skipped) => {
        let r = toReview(modelWith(OPTIONAL));
        expect(r.state.phase).toBe('review');
        for (const id of OPTIONAL) expect(r.frame.values.has(id), `${id} written first`).toBe(true);
        const others = new Map([...r.frame.values].filter(([id]) => !skipped.includes(id)));
        const actionsBefore = r.frame.actions.length;
        for (const id of skipped) {
          r = send(r, { type: 'EDIT_PRESSED', elementId: id });
          expect(r.state.current).toBe(id);
          r = send(r, { type: 'SKIP_PRESSED' });
          expect(r.state.phase).toBe('review');
        }
        // One clearing Action for each skipped field, and no other write.
        const cleared = r.frame.actions.slice(actionsBefore);
        expect(cleared).toHaveLength(skipped.length);
        for (const id of skipped) {
          const field = fieldById(r.state, id)!;
          expect(field.status, id).toBe('skipped');
          expect(field.intended).toBeUndefined();
          expect(field.answer).toBeUndefined();
          const read = r.frame.read(id);
          if (typeof read === 'string') throw new Error('unexpected stale read');
          expect(read.kind === 'checkbox' ? read.checked : read.value === null || read.value === '', id).toBe(true);
        }
        for (const [id, value] of others) expect(r.frame.values.get(id), id).toBe(value);
        for (const f of r.state.fields.filter((x) => !skipped.includes(x.elementId))) expect(f.status, f.elementId).toBe('filled');
      }),
      RUNS,
    );
  });

  it('does nothing on a question the legacy form requires', () => {
    fc.assert(
      fc.property(fc.constantFrom(...FIELD_IDS.filter((id) => !OPTIONAL.includes(id))), (id) => {
        const r = toReview(modelWith(OPTIONAL));
        const open = send(r, { type: 'EDIT_PRESSED', elementId: id });
        const after = send(open, { type: 'SKIP_PRESSED' });
        expect(after.state).toBe(open.state);
        expect(after.frame.actions).toEqual(open.frame.actions);
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Property 24: canary values never leave through a forbidden path
// ---------------------------------------------------------------------------
class FakeFrame {
  doc: Document | null = null;
  url = new URL('/legacy/register', ORIGIN);
  src = '';
  get contentDocument() {
    return this.doc;
  }
  get contentWindow() {
    return { location: this.url };
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Property 24: canary values never leave through a forbidden path', () => {
  // Feature: accessforge-skeleton, Property 24: Canary values never leave through a forbidden path
  // Validates: Requirements 13.1, 13.2, 13.3, 13.5, 13.6, 13.10
  it('keeps the typed answer and the value typed into the old page out of requests, prompts, replies and logs', async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^ZQA[A-Z0-9]{10}$/), fc.stringMatching(/^ZQF[A-Z0-9]{10}$/), fc.constantFrom('zh-Hans', 'ms', 'ta'), async (answerCanary, frameCanary, language) => {
        const mock = new MockAiProvider();
        const seen: string[] = [];
        const provider: AiProvider = {
          kind: 'real',
          analyze: () => Promise.reject(new Error('unused')),
          retranslate: () => Promise.reject(new Error('unused')),
          translate: () => Promise.reject(new Error('unused')),
          analyzeLabels: () => Promise.reject(new Error('unused')),
          analyzePage: (c) => (seen.push(JSON.stringify(pageAnalyzeMessages(c))), mock.analyzePage(c)),
          retranslatePage: (c) => (seen.push(JSON.stringify(pageRetranslateMessages(c))), mock.retranslatePage(c)),
        };
        const logs: LogEntry[] = [];
        const handler = createHandler({ provider, logger: (e) => logs.push(e), requestId: () => 'req', now: () => 1 });
        const sent: string[] = [];
        const callApi = async (path: string, body: unknown): Promise<unknown> => {
          const text = JSON.stringify(body);
          sent.push(text);
          const res = await handler.fetch(new Request(`https://reforge.example${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: text }), {});
          const replyText = await res.text();
          seen.push(replyText);
          if (!res.ok) throw new ApiRequestError('FAILED');
          return JSON.parse(replyText);
        };
        const frame = new FakeFrame();
        frame.doc = parse(fill(TEMPLATES.register, {}));
        (frame.doc.querySelector('input[name="nokp"]') as HTMLInputElement).value = frameCanary;
        const deps: Pick<LoopDeps, 'analyze' | 'retranslate'> = {
          analyze: async (request) => ({ data: (await callApi('/api/pages/analyze', request)) as PageAnalyzeResponse, aiMode: null }),
          retranslate: async (request: PageRetranslateRequest) => ({ data: (await callApi('/api/pages/retranslate', request)) as { items: PageRetranslateRequest['items'] }, aiMode: null }),
        };
        const runner = new LoopRunner({ frame: () => frame as unknown as HTMLIFrameElement, appOrigin: ORIGIN, setTimer: () => 0, clearTimer: () => {}, ...deps }, 'en');
        runner.onFrameLoad();
        runner.dispatch({ type: 'REVIVE_PRESSED' });
        runner.dispatch({ type: 'NOTICE_ACKNOWLEDGED' });
        await flush();
        expect(runner.get().phase).toBe('asking');
        runner.dispatch({ type: 'NEXT_PRESSED', answer: { kind: 'text', value: answerCanary }, today: TODAY });
        // The canaries really are in the browser: the old page and the Mirror's answer.
        expect((frame.doc.querySelector('input[name="nokp"]') as HTMLInputElement).value).toBe(frameCanary);
        expect(JSON.stringify(runner.get().fields.map((f) => f.answer))).toContain(answerCanary);
        runner.dispatch({ type: 'LANGUAGE_SET', language });
        await flush();
        expect(runner.get().fields.some((f) => f.wordingLanguage === language)).toBe(true);
        expect(sent).toHaveLength(2);
        const everything = [...sent, ...seen, JSON.stringify(logs)].join('\n');
        expect(everything).not.toContain(answerCanary);
        expect(everything).not.toContain(frameCanary);
      }),
      RUNS,
    );
  });

  it('keeps a canary placed in an invalid request out of the error and the log', async () => {
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^ZQE[A-Z0-9]{10}$/), fc.constantFrom('/api/pages/analyze', '/api/pages/retranslate'), async (canary, path) => {
        const logs: LogEntry[] = [];
        const handler = createHandler({ provider: countingProvider(), logger: (e) => logs.push(e), requestId: () => 'req', now: () => 1 });
        const body = JSON.stringify({ interfaceLanguage: 'en', targetLanguage: 'ms', items: [{ humanLabel: 'a', question: 'b', [canary]: canary }], pageModel: { [canary]: canary } });
        expect(body).toContain(canary);
        const res = await handler.fetch(new Request(`https://reforge.example${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }), {});
        expect(res.status).toBe(400);
        expect(await res.text()).not.toContain(canary);
        expect(JSON.stringify(logs)).not.toContain(canary);
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Property 25: unlisted legacy paths give the not-found document
// ---------------------------------------------------------------------------
describe('Property 25: unlisted legacy paths give the not-found document', () => {
  // Feature: accessforge-skeleton, Property 25: Unlisted legacy paths give the not-found document
  // Validates: Requirements 1.10, 2.6, 4.2
  const segment = fc.oneof(
    fc.stringMatching(/^[A-Za-z0-9._~-]{1,12}$/),
    fc.constantFrom('register', 'Register', 'REGISTER', 'register.html', 'index.html', '%72egister', 'register%20', 'admin', 'api', '.git', 'portal.css', 'legacy'),
  );
  const pathArb = fc.array(segment, { minLength: 1, maxLength: 4 }).chain((segs) => fc.constantFrom('', '/').map((tail) => `/legacy/${segs.join('/')}${tail}`));
  const listed = (p: string) => p === '/legacy/' || p === '/legacy/register';

  it('answers 404 with the not-found page and nothing else for GET and HEAD', async () => {
    const notFound = TEMPLATES.notFound.segments.join('');
    await fc.assert(
      fc.asyncProperty(pathArb, fc.constantFrom('GET', 'HEAD'), async (path, method) => {
        const url = new URL(path, 'https://reforge.example');
        fc.pre(url.pathname.startsWith('/legacy/') && !listed(url.pathname));
        const res = await handleLegacy(new Request(url, { method }), DEPS);
        expect(res.status, url.pathname).toBe(404);
        if (method === 'GET') {
          const text = await res.text();
          expect(text).toBe(notFound);
          expect(text).not.toContain('<form');
        }
      }),
      RUNS,
    );
  });

  it('control: the two listed paths are served', async () => {
    expect((await handleLegacy(new Request('https://reforge.example/legacy/'), DEPS)).status).toBe(200);
    expect((await handleLegacy(new Request('https://reforge.example/legacy/register'), DEPS)).status).toBe(200);
  });

  it('never accepts a post on an unlisted path', async () => {
    await fc.assert(
      fc.asyncProperty(pathArb, async (path) => {
        const url = new URL(path, 'https://reforge.example');
        fc.pre(url.pathname.startsWith('/legacy/') && !listed(url.pathname));
        const res = await handleLegacy(new Request(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'nama=x' }), DEPS);
        expect(res.status).toBe(405);
        expect(res.headers.get('allow')).toBe('GET');
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Property 26: the frame source cannot be redirected
// ---------------------------------------------------------------------------
describe('Property 26: the frame source cannot be redirected', () => {
  // Feature: accessforge-skeleton, Property 26: The frame source cannot be redirected
  // Validates: Requirements 18.1, 18.2
  const address = fc.oneof(
    fc.webUrl(),
    fc.domain().map((d) => `//${d}/form`),
    fc.constantFrom('javascript:alert(1)', 'data:text/html,x', '/legacy/', '/legacy/other', '../x'),
  );
  const keyArb = fc.constantFrom('url', 'src', 'frame', 'page', 'next', 'redirect', 'u');

  it('renders the same sandboxed frame source whatever the address bar says', () => {
    fc.assert(
      fc.property(keyArb, address, fc.constantFrom('query', 'hash', 'path'), (key, target, where) => {
        const suffix = where === 'query' ? `?${key}=${encodeURIComponent(target)}` : where === 'hash' ? `#${target}` : `/${encodeURIComponent(target)}`;
        window.history.replaceState(null, '', `/accessforge${suffix}`);
        const view = render(withApp(<RevivalFrame onLoad={() => {}} />));
        try {
          const frame = view.container.querySelector('iframe')!;
          expect(frame.getAttribute('src')).toBe(REVIVAL_FRAME_SRC);
          expect(frame.getAttribute('sandbox')).toBe('allow-same-origin allow-forms');
        } finally {
          view.unmount();
          window.history.replaceState(null, '', '/');
        }
      }),
      RUNS,
    );
  });

  it('tells the screen when the address names another site', () => {
    fc.assert(
      fc.property(keyArb, fc.webUrl(), (key, target) => {
        const url = new URL(`/accessforge?${key}=${encodeURIComponent(target)}`, 'https://reforge.example');
        expect(namesForeignAddress(url, '/accessforge')).toBe(true);
        expect(REVIVAL_FRAME_SRC).toBe('/legacy/register');
      }),
      RUNS,
    );
  });
});
