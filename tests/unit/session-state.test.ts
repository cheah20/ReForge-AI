/**
 * tests/unit/session-state.test.ts
 *
 * Session state and browser analysis orchestration (task 26, plus the
 * translate-button gate from task 16.2).
 * Validates: Requirements 5.1, 5.3, 5.7, 5.8, 8.6, 11.1
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ApiClient, ApiReply } from '../../src/frontend/api.js';
import {
  analyzeForm,
  approveTranslation,
  cacheKey,
  combineVotes,
  confirmFormSettings,
  createSession,
  createSessionStore,
  setAnswer,
  switchLanguage,
  translateDescription,
  type SessionStore,
} from '../../src/frontend/state.js';
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  AnswerType,
  FieldEvidence,
  RetranslateRequest,
  RetranslateResponse,
  TranslateRequest,
  TranslateResponse,
} from '../../src/shared/types.js';

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const CANARY = 'CANARY-ANSWER-7731';

function evidence(fieldId: string, extra: Partial<FieldEvidence> = {}): FieldEvidence {
  return {
    fieldId,
    fieldType: 'text',
    tooltip: `Tooltip ${fieldId}`,
    required: false,
    readOnly: false,
    widgets: [{ pageNumber: 1, bbox: { left: 0, top: 20, right: 100, bottom: 0 }, pageSnippet: `Label ${fieldId}` }],
    hasValue: false,
    ...extra,
  };
}

const manyFields = (n: number) => Array.from({ length: n }, (_, i) => evidence(`f${i}`));

interface Detected {
  formLanguage: string;
  formLanguageConfidence: number;
  formCountry: string;
  formCountryConfidence: number;
}

/** Records every request body and lets a test hold a reply until it chooses to release it. */
class FakeApi implements ApiClient {
  analyzeCalls: AnalyzeRequest[] = [];
  retranslateCalls: RetranslateRequest[] = [];
  translateCalls: TranslateRequest[] = [];
  /** All serialized request bodies, for canary checks. */
  bodies: string[] = [];
  aiMode: string | null = 'real';
  detection: Detected[] = [{ formLanguage: 'ms', formLanguageConfidence: 0.9, formCountry: 'MY', formCountryConfidence: 0.95 }];
  answerTypes = new Map<string, AnswerType>();
  hold = false;
  private held: Array<() => void> = [];
  inFlight = 0;
  maxInFlight = 0;

  release(index = 0): void {
    const [next] = this.held.splice(index, 1);
    next?.();
  }

  private async gate<T>(value: T): Promise<ApiReply<T>> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    if (this.hold) await new Promise<void>((resolve) => this.held.push(resolve));
    else await Promise.resolve();
    this.inFlight--;
    return { data: value, aiMode: this.aiMode };
  }

  analyze(request: AnalyzeRequest): Promise<ApiReply<AnalyzeResponse>> {
    const d = this.detection[Math.min(this.analyzeCalls.length, this.detection.length - 1)]!;
    this.analyzeCalls.push(request);
    this.bodies.push(JSON.stringify(request));
    return this.gate({
      ...d,
      fields: request.fields.map((f) => ({
        fieldId: f.fieldId,
        humanLabel: `${request.interfaceLanguage} label ${f.fieldId}`,
        question: `${request.interfaceLanguage} question ${f.fieldId}?`,
        answerType: this.answerTypes.get(f.fieldId) ?? 'text',
        confidence: 0.9,
      })),
    });
  }

  retranslate(request: RetranslateRequest): Promise<ApiReply<RetranslateResponse>> {
    this.retranslateCalls.push(request);
    this.bodies.push(JSON.stringify(request));
    return this.gate({
      fields: request.fields.map((f) => ({
        fieldId: f.fieldId,
        humanLabel: `${request.targetLanguage} label ${f.fieldId}`,
        question: `${request.targetLanguage} question ${f.fieldId}?`,
      })),
    });
  }

  translate(request: TranslateRequest): Promise<ApiReply<TranslateResponse>> {
    this.translateCalls.push(request);
    this.bodies.push(JSON.stringify(request));
    return this.gate({ translation: `translated: ${request.text}` });
  }
}

let ids = 0;
const deps = (api: FakeApi) => ({ api, newId: () => `id-${++ids}` });

function newStore(language = 'zh-Hans'): SessionStore {
  return createSessionStore(createSession(language));
}

/** Let queued promise callbacks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createSession', () => {
  it('starts empty, in memory, with no form and no analysis running', () => {
    const s = createSession('ms');
    expect(s).toMatchObject({
      interfaceLanguage: 'ms',
      contentHash: null,
      fields: [],
      currentStep: 0,
      demoMode: false,
      activeAnalysisId: null,
      needsConfirmation: false,
    });
    expect(s.analysisCache.size).toBe(0);
  });

  it('keys the cache by content hash and interface language', () => {
    expect(cacheKey(HASH, 'zh-Hans')).toBe(`${HASH}:zh-Hans`);
  });
});

describe('analyzeForm (requirements 5.1, 5.8)', () => {
  it('sends 65 fields as batches of 30, 30 and 5, one after another, and keeps every field', async () => {
    const api = new FakeApi();
    const store = newStore();
    const progress: string[] = [];
    const out = await analyzeForm(manyFields(65), HASH, store, { ...deps(api), onProgress: (n, m) => progress.push(`${n}/${m}`) });

    expect(out).toEqual({ status: 'done', fromCache: false });
    expect(api.analyzeCalls.map((c) => c.fields.length)).toEqual([30, 30, 5]);
    expect(api.analyzeCalls.flatMap((c) => c.fields.map((f) => f.fieldId))).toEqual(manyFields(65).map((f) => f.fieldId));
    expect(api.maxInFlight).toBe(1);
    expect(progress).toEqual(['1/3', '2/3', '3/3']);
    expect(api.analyzeCalls.every((c) => c.contentHash === HASH && c.interfaceLanguage === 'zh-Hans')).toBe(true);

    const s = store.get();
    expect(s.fields.map((f) => f.evidence.fieldId)).toEqual(manyFields(65).map((f) => f.fieldId));
    expect(s.fields.every((f) => f.status === 'mapped' && f.analysis?.humanLabel === `zh-Hans label ${f.evidence.fieldId}`)).toBe(true);
    expect(s.analysisCache.get(cacheKey(HASH, 'zh-Hans'))?.fields).toHaveLength(65);
    expect(s.activeAnalysisId).toBeNull();
  });

  it('never sends a field whose name was too long, but still lists it as fill-yourself', async () => {
    const api = new FakeApi();
    const store = newStore();
    await analyzeForm([evidence('a'), evidence('long-field-1', { idTooLong: true }), evidence('b')], HASH, store, deps(api));
    expect(api.analyzeCalls[0]!.fields.map((f) => f.fieldId)).toEqual(['a', 'b']);
    expect(store.get().fields.map((f) => [f.evidence.fieldId, f.status])).toEqual([
      ['a', 'mapped'],
      ['long-field-1', 'fill-yourself'],
      ['b', 'mapped'],
    ]);
  });

  it('reuses the cached analysis for the same file and language without calling the API', async () => {
    const api = new FakeApi();
    const store = newStore();
    await analyzeForm(manyFields(3), HASH, store, deps(api));
    setAnswer(store, 'f0', CANARY);
    const out = await analyzeForm(manyFields(3), HASH, store, deps(api));
    expect(out).toEqual({ status: 'done', fromCache: true });
    expect(api.analyzeCalls).toHaveLength(1);
    expect(store.get().fields).toHaveLength(3);
    // A fresh upload starts with fresh answers.
    expect(store.get().fields[0]!.rawAnswer).toBeUndefined();
  });

  it('drops the replies of an earlier upload that arrive after a new upload (stale guard)', async () => {
    const api = new FakeApi();
    api.hold = true;
    const store = newStore();
    const first = analyzeForm([evidence('old')], HASH, store, deps(api));
    await flush();
    const second = analyzeForm([evidence('new')], OTHER_HASH, store, deps(api));
    await flush();

    api.release(0); // the old file's reply arrives last in the user's eyes, but is handled first here
    expect(await first).toEqual({ status: 'stale' });
    expect(store.get().fields).toEqual([]);
    expect(store.get().contentHash).toBe(OTHER_HASH);

    api.release(0);
    expect(await second).toEqual({ status: 'done', fromCache: false });
    expect(store.get().fields.map((f) => f.evidence.fieldId)).toEqual(['new']);
    expect(store.get().analysisCache.has(cacheKey(HASH, 'zh-Hans'))).toBe(false);
  });

  it('turns on demo mode when the Worker answered with the mock provider', async () => {
    const api = new FakeApi();
    api.aiMode = 'mock';
    const store = newStore();
    await analyzeForm(manyFields(2), HASH, store, deps(api));
    expect(store.get().demoMode).toBe(true);
  });

  it('flags a precomputed (cached) analysis when any batch was served from the fixture cache', async () => {
    const api = new FakeApi();
    const real = api.analyze.bind(api);
    api.analyze = async (req) => {
      const reply = await real(req);
      return { ...reply, data: { ...reply.data, servedFromCache: api.analyzeCalls.length === 2 } };
    };
    const store = newStore();
    await analyzeForm(manyFields(31), HASH, store, deps(api));
    expect(store.get().servedFromCache).toBe(true);
    // A cache hit in the browser keeps the flag.
    await analyzeForm(manyFields(31), HASH, store, deps(api));
    expect(store.get().servedFromCache).toBe(true);
    await analyzeForm(manyFields(2), OTHER_HASH, store, deps(new FakeApi()));
    expect(store.get().servedFromCache).toBe(false);
  });

  it('keeps demo mode off for real AI replies', async () => {
    const api = new FakeApi();
    const store = newStore();
    await analyzeForm(manyFields(2), HASH, store, deps(api));
    expect(store.get().demoMode).toBe(false);
  });

  it('propagates an API error and keeps no partial fields', async () => {
    const api = new FakeApi();
    api.analyze = async () => {
      throw new Error('AI_TIMEOUT');
    };
    const store = newStore();
    await expect(analyzeForm(manyFields(2), HASH, store, deps(api))).rejects.toThrow('AI_TIMEOUT');
    expect(store.get().fields).toEqual([]);
    expect(store.get().analysisCache.size).toBe(0);
  });
});

describe('form language and country detection (requirements 5.3, 5.7)', () => {
  it('skips the confirmation when both confidences are at least 0.7', async () => {
    const api = new FakeApi();
    const store = newStore();
    await analyzeForm(manyFields(2), HASH, store, deps(api));
    expect(store.get()).toMatchObject({ formLanguage: 'ms', formCountry: 'MY', needsConfirmation: false });
  });

  it('asks for confirmation when the language confidence is below 0.7', async () => {
    const api = new FakeApi();
    api.detection = [{ formLanguage: 'ms', formLanguageConfidence: 0.65, formCountry: 'MY', formCountryConfidence: 0.95 }];
    const store = newStore();
    await analyzeForm(manyFields(2), HASH, store, deps(api));
    expect(store.get().needsConfirmation).toBe(true);
    confirmFormSettings(store, 'ms', 'my');
    expect(store.get()).toMatchObject({ formLanguage: 'ms', formCountry: 'MY', needsConfirmation: false });
  });

  it('asks for confirmation when the country confidence alone is low', async () => {
    const api = new FakeApi();
    api.detection = [{ formLanguage: 'en', formLanguageConfidence: 0.95, formCountry: 'US', formCountryConfidence: 0.5 }];
    const store = newStore();
    await analyzeForm(manyFields(2), HASH, store, deps(api));
    expect(store.get().needsConfirmation).toBe(true);
  });

  it('asks for confirmation when two batches disagree confidently (ms 0.9 against en 0.8)', async () => {
    const api = new FakeApi();
    api.detection = [
      { formLanguage: 'ms', formLanguageConfidence: 0.9, formCountry: 'MY', formCountryConfidence: 0.9 },
      { formLanguage: 'en', formLanguageConfidence: 0.8, formCountry: 'MY', formCountryConfidence: 0.9 },
    ];
    const store = newStore();
    await analyzeForm(manyFields(31), HASH, store, deps(api));
    expect(store.get().formLanguage).toBe('ms');
    expect(store.get().detection!.formLanguageConfidence).toBeLessThan(0.7);
    expect(store.get().needsConfirmation).toBe(true);
  });

  it('needs confirmation when no field could be sent at all', async () => {
    const api = new FakeApi();
    const store = newStore();
    await analyzeForm([evidence('long-field-1', { idTooLong: true })], HASH, store, deps(api));
    expect(api.analyzeCalls).toHaveLength(0);
    expect(store.get().needsConfirmation).toBe(true);
  });
});

describe('combineVotes', () => {
  it('returns a single batch unchanged', () => {
    expect(combineVotes([{ value: 'ms', confidence: 0.82 }])).toEqual({ value: 'ms', confidence: 0.82 });
  });

  it('averages agreeing batches', () => {
    expect(combineVotes([{ value: 'ms', confidence: 0.9 }, { value: 'ms', confidence: 0.7 }]).confidence).toBeCloseTo(0.8);
  });

  it('lets a weak dissent lower the confidence without forcing a confirmation', () => {
    const v = combineVotes([
      { value: 'en', confidence: 0.95 },
      { value: 'en', confidence: 0.95 },
      { value: 'en', confidence: 0.95 },
      { value: 'en', confidence: 0.95 },
      { value: 'en', confidence: 0.95 },
      { value: 'ms', confidence: 0.2 },
    ]);
    expect(v.value).toBe('en');
    expect(v.confidence).toBeCloseTo((0.95 * 5) / 6);
    expect(v.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('forces a confirmation when many confident batches outvote one confident dissent (en 0.95 x4 against ms 0.8)', () => {
    const v = combineVotes([
      { value: 'en', confidence: 0.95 },
      { value: 'en', confidence: 0.95 },
      { value: 'en', confidence: 0.95 },
      { value: 'en', confidence: 0.95 },
      { value: 'ms', confidence: 0.8 },
    ]);
    // The plain average would be 0.76, above the threshold.
    expect(v).toEqual({ value: 'en', confidence: 0.69 });
  });

  it('picks the first value seen on a tie', () => {
    expect(combineVotes([{ value: 'ms', confidence: 0.5 }, { value: 'en', confidence: 0.5 }]).value).toBe('ms');
  });

  it('property: the winner has the largest summed confidence, the result stays in [0, 1], and a confident dissent always forces confirmation', () => {
    // Confidences lean high so the generator reaches "several confident winners plus one confident dissent",
    // where only the dissent rule (not the average) keeps the result below 0.7.
    const confidence = fc.oneof(
      { arbitrary: fc.double({ min: 0, max: 1, noNaN: true }), weight: 1 },
      { arbitrary: fc.double({ min: 0.7, max: 1, noNaN: true }), weight: 3 },
    );
    const vote = fc.record({ value: fc.constantFrom('ms', 'en', 'zh-Hans'), confidence });
    // Random lists reached that case in only about 60% of 300-run trials, so one
    // branch builds it on purpose: 4 or 5 confident votes for one value, one confident dissent.
    const outvotedDissent = fc
      .tuple(
        fc.array(fc.double({ min: 0.9, max: 1, noNaN: true }), { minLength: 4, maxLength: 5 }),
        fc.double({ min: 0.7, max: 1, noNaN: true }),
        fc.nat(5),
      )
      .map(([wins, dissent, at]) => {
        const votes = wins.map((c) => ({ value: 'en', confidence: c }));
        votes.splice(at % (votes.length + 1), 0, { value: 'ms', confidence: dissent });
        return votes;
      });
    const votesArb = fc.oneof(fc.array(vote, { minLength: 1, maxLength: 6 }), outvotedDissent);
    let sawDissent = 0;
    let sawDissentAboveAverage = 0;
    let sawAgreementAbove = 0;
    fc.assert(
      fc.property(votesArb, (votes) => {
        const result = combineVotes(votes);
        const sum = (v: string) => votes.filter((x) => x.value === v).reduce((a, x) => a + x.confidence, 0);
        for (const v of votes) expect(sum(result.value)).toBeGreaterThanOrEqual(sum(v.value));
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
        const dissent = votes.some((v) => v.value !== result.value && v.confidence >= 0.7);
        if (dissent) {
          sawDissent++;
          if (sum(result.value) / votes.length >= 0.7) sawDissentAboveAverage++;
          expect(result.confidence).toBeLessThan(0.7);
        }
        if (!dissent && votes.every((v) => v.value === result.value)) {
          expect(result.confidence).toBeCloseTo(sum(result.value) / votes.length);
          if (result.confidence >= 0.7) sawAgreementAbove++;
        }
      }),
      { numRuns: 300 },
    );
    // The generator reached both outcomes, so the property is not passing on one side only.
    expect(sawDissent).toBeGreaterThan(0);
    expect(sawDissentAboveAverage).toBeGreaterThan(0);
    expect(sawAgreementAbove).toBeGreaterThan(0);
  });
});

describe('switchLanguage (requirement 5.8)', () => {
  async function analysedStore(api: FakeApi, n = 3) {
    const store = newStore('zh-Hans');
    await analyzeForm(manyFields(n), HASH, store, deps(api));
    return store;
  }

  it('re-translates only labels and questions and keeps every answer', async () => {
    const api = new FakeApi();
    api.answerTypes.set('f1', 'phone');
    const store = await analysedStore(api);
    setAnswer(store, 'f0', CANARY, CANARY);
    store.set((s) => ({ ...s, currentStep: 2 }));
    const before = store.get().fields;

    expect(await switchLanguage('ms', store, deps(api))).toEqual({ status: 'done', fromCache: false });

    expect(api.analyzeCalls).toHaveLength(1);
    expect(api.retranslateCalls).toHaveLength(1);
    const req = api.retranslateCalls[0]!;
    expect(req).toEqual({
      contentHash: HASH,
      targetLanguage: 'ms',
      fields: before.map((f) => ({ fieldId: f.evidence.fieldId, humanLabel: f.analysis!.humanLabel, question: f.analysis!.question })),
    });

    const after = store.get();
    expect(after.interfaceLanguage).toBe('ms');
    expect(after.currentStep).toBe(2);
    expect(after.fields[0]).toMatchObject({ rawAnswer: CANARY, normalizedOutput: CANARY });
    after.fields.forEach((f, i) => {
      expect(f.analysis!.humanLabel).toBe(`ms label ${f.evidence.fieldId}`);
      expect(f.analysis!.question).toBe(`ms question ${f.evidence.fieldId}?`);
      expect({ ...f, analysis: { ...f.analysis!, humanLabel: '', question: '' } }).toEqual({
        ...before[i]!,
        analysis: { ...before[i]!.analysis!, humanLabel: '', question: '' },
      });
    });
    expect(after.fields[1]!.analysis!.answerType).toBe('phone');
  });

  it('never sends an answer: the canary is in the session but in no request body', async () => {
    const api = new FakeApi();
    const store = await analysedStore(api);
    setAnswer(store, 'f0', CANARY, CANARY);
    setAnswer(store, 'f2', `${CANARY}-2`);
    await switchLanguage('ms', store, deps(api));
    await switchLanguage('ta', store, deps(api));

    expect(JSON.stringify(store.get().fields)).toContain(CANARY);
    expect(api.bodies.length).toBe(3);
    for (const body of api.bodies) expect(body).not.toContain(CANARY);
  });

  it('switching back uses the cache: no API call, the original wording returns', async () => {
    const api = new FakeApi();
    const store = await analysedStore(api);
    const original = store.get().fields.map((f) => f.analysis!.question);
    await switchLanguage('ms', store, deps(api));
    expect(await switchLanguage('zh-Hans', store, deps(api))).toEqual({ status: 'done', fromCache: true });
    expect(await switchLanguage('ms', store, deps(api))).toEqual({ status: 'done', fromCache: true });
    expect(api.retranslateCalls).toHaveLength(1);
    await switchLanguage('zh-Hans', store, deps(api));
    expect(store.get().fields.map((f) => f.analysis!.question)).toEqual(original);
  });

  it('sends 31 fields as batches of 30 and 1', async () => {
    const api = new FakeApi();
    const store = await analysedStore(api, 31);
    await switchLanguage('ms', store, deps(api));
    expect(api.retranslateCalls.map((c) => c.fields.length)).toEqual([30, 1]);
  });

  it('does not send fill-yourself fields without an analysis', async () => {
    const api = new FakeApi();
    const store = newStore();
    await analyzeForm([evidence('a'), evidence('long-field-1', { idTooLong: true })], HASH, store, deps(api));
    await switchLanguage('ms', store, deps(api));
    expect(api.retranslateCalls[0]!.fields.map((f) => f.fieldId)).toEqual(['a']);
  });

  it('only changes the language when no form is loaded', async () => {
    const api = new FakeApi();
    const store = newStore('en');
    await switchLanguage('ta', store, deps(api));
    expect(store.get().interfaceLanguage).toBe('ta');
    expect(api.retranslateCalls).toHaveLength(0);
  });

  it('drops a translation reply that arrives after a new upload', async () => {
    const api = new FakeApi();
    const store = await analysedStore(api);
    api.hold = true;
    const pending = switchLanguage('ms', store, deps(api));
    await flush();
    api.hold = false;
    await analyzeForm([evidence('new')], OTHER_HASH, store, deps(api));
    api.release(0);
    expect(await pending).toEqual({ status: 'stale' });
    expect(store.get().interfaceLanguage).toBe('zh-Hans');
    expect(store.get().fields.map((f) => f.analysis!.humanLabel)).toEqual(['zh-Hans label new']);
  });
});

describe('description translation gate (requirements 8.6, 11.1; task 16.2)', () => {
  async function descriptionStore(api: FakeApi) {
    api.answerTypes.set('notes', 'description');
    const store = newStore('zh-Hans');
    await analyzeForm([evidence('name'), evidence('notes')], HASH, store, deps(api));
    confirmFormSettings(store, 'ms', 'MY');
    return store;
  }

  it('sends nothing while the user answers, switches language and moves on, then exactly one request after the button press', async () => {
    const api = new FakeApi();
    const store = await descriptionStore(api);
    setAnswer(store, 'name', 'Lin Mei');
    setAnswer(store, 'notes', CANARY);
    await switchLanguage('ms', store, deps(api));
    await switchLanguage('zh-Hans', store, deps(api));
    store.set((s) => ({ ...s, currentStep: 1 }));
    expect(api.translateCalls).toHaveLength(0);

    // The translate button's click handler:
    expect(await translateDescription(store, 'notes', deps(api))).toBe('done');
    expect(api.translateCalls).toEqual([{ text: CANARY, sourceLanguage: 'zh-Hans', targetLanguage: 'ms' }]);
    expect(api.bodies.filter((b) => b.includes(CANARY))).toHaveLength(1);
  });

  it('a second press while the first translation runs sends nothing', async () => {
    const api = new FakeApi();
    const store = await descriptionStore(api);
    setAnswer(store, 'notes', CANARY);
    api.hold = true;
    const first = translateDescription(store, 'notes', deps(api));
    expect(store.get().pendingTranslationFieldId).toBe('notes');
    expect(await translateDescription(store, 'notes', deps(api))).toBe('busy');
    api.release(0);
    expect(await first).toBe('done');
    expect(api.translateCalls).toHaveLength(1);
    expect(store.get().pendingTranslationFieldId).toBeUndefined();
  });

  it('refuses non-description fields and blank answers without calling the API', async () => {
    const api = new FakeApi();
    const store = await descriptionStore(api);
    setAnswer(store, 'name', CANARY);
    setAnswer(store, 'notes', '   ');
    expect(await translateDescription(store, 'name', deps(api))).toBe('not-a-description');
    expect(await translateDescription(store, 'notes', deps(api))).toBe('empty');
    expect(await translateDescription(store, 'missing', deps(api))).toBe('not-a-description');
    expect(api.translateCalls).toHaveLength(0);
  });

  it('keeps the translation unapproved and out of the output until the user approves it', async () => {
    const api = new FakeApi();
    const store = await descriptionStore(api);
    setAnswer(store, 'notes', 'sakit kepala', 'sakit kepala');
    await translateDescription(store, 'notes', deps(api));
    const notes = () => store.get().fields.find((f) => f.evidence.fieldId === 'notes')!;
    expect(notes().translation).toMatchObject({ text: 'translated: sakit kepala', approved: false });
    expect(notes().normalizedOutput).toBe('sakit kepala');

    approveTranslation(store, 'notes', 'Sakit kepala sejak semalam ');
    expect(notes().translation).toMatchObject({ text: 'Sakit kepala sejak semalam ', approved: true });
    expect(notes().normalizedOutput).toBe('Sakit kepala sejak semalam');
  });

  it('editing the answer afterwards drops the old translation', async () => {
    const api = new FakeApi();
    const store = await descriptionStore(api);
    setAnswer(store, 'notes', 'first text');
    await translateDescription(store, 'notes', deps(api));
    setAnswer(store, 'notes', 'first text');
    expect(store.get().fields[1]!.translation).toBeDefined();
    setAnswer(store, 'notes', 'second text');
    expect(store.get().fields[1]!.translation).toBeUndefined();
  });

});

describe('in-memory only (requirement 11.1)', () => {
  it('no frontend module uses browser storage or cookies', () => {
    const dir = path.resolve(__dirname, '../../src/frontend');
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f));
    expect(files).toContain('state.ts');
    for (const file of files) {
      const source = readFileSync(path.join(dir, file), 'utf8');
      expect(source, file).not.toMatch(/\b(localStorage|sessionStorage|indexedDB|document\.cookie|caches\.open)\b/);
    }
  });
});
