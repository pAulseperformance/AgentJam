import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { decideWithJev, jevConfigFromEnv, buildJevState, JEV_QUESTIONS } from './jev';

const cfg = {
  endpoint: 'https://example.test/systemone',
  model: 'typesafe/jev-1.13',
  apiKey: 'test-key',
  timeoutMs: 50,
};

/** The answer envelope the endpoint actually returned on 2026-10-29 (OpenRouter alpha decisions). */
const LIVE_ANSWER = {
  model: 'typesafe/jev-1.13-20260917',
  answers: {
    role: { type: 'choice', choice: 'answer', confidence: 0.81 },
    relation: { type: 'choice', choice: 'vary', confidence: 0.7 },
    density: { type: 'choice', choice: 'sparse', probabilities: { sparse: 0.62, medium: 0.31, dense: 0.07 }, confidence: 0.43 },
    register: { type: 'choice', choice: 'mid', probabilities: { low: 0.2, mid: 0.7, high: 0.1 }, confidence: 0.6 },
    veto: { type: 'noul', noul: 0.3 },
  },
};

describe('Jev decision layer', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('has no config without a key, and then never calls out', async () => {
    expect(jevConfigFromEnv({})).toBeNull();
    expect(await decideWithJev(null, { key: 'C major', bpm: 120, style: 'jazz', phrase: 'they played C4 and E4', motif: 'none', activity: 'played 1 of the last 2 bars', peers: 1 })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('defaults to the router slug, which differs from the direct one', () => {
    const c = jevConfigFromEnv({ JEV_API_KEY: 'k' });
    expect(c?.model).toBe('typesafe/jev-1.13');
    expect(c?.endpoint).toBe('https://openrouter.ai/api/alpha/decisions');
  });

  it('turns a live answer into a brief', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => LIVE_ANSWER } as Response);

    const brief = await decideWithJev(cfg, { key: 'C major', bpm: 120, style: 'jazz', phrase: 'they played C4 and E4', motif: 'none', activity: 'played 1 of the last 2 bars', peers: 2 });

    expect(brief).toMatchObject({ role: 'answer', relation: 'vary', density: 'sparse', register: 'mid', play: true });
    expect(brief?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('gates on noul >= 0.5, not on confidence', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ answers: { density: { choice: 'sparse' }, register: { choice: 'low' }, veto: { noul: 0.72 } } }),
    } as Response);

    const brief = await decideWithJev(cfg, { key: 'C', bpm: 120, style: 'ambient', phrase: 'x', motif: 'y', activity: 'played 2 of the last 4 bars', peers: 3 });
    expect(brief?.play).toBe(false);
  });

  it('reads a router answer that omits confidence entirely (OrcaRouter shape)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ answers: { density: { choice: 'dense' }, register: { choice: 'high' }, veto: { noul: 0.05 } } }),
    } as Response);

    const brief = await decideWithJev(cfg, { key: 'C', bpm: 120, style: 'funk', phrase: 'they played C4 and E4', motif: 'none', activity: 'played 1 of the last 2 bars', peers: 1 });
    expect(brief).toMatchObject({ density: 'dense', register: 'high' });
  });

  it('fails open on a non-200 (a spent key reads like an outage)', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403, json: async () => ({}) } as Response);
    expect(await decideWithJev(cfg, { key: 'C', bpm: 120, style: 'jazz', phrase: 'they played C4 and E4', motif: 'none', activity: 'played 1 of the last 2 bars', peers: 1 })).toBeNull();
  });

  it('fails open when the answer is slow: a decision that misses the measure is worthless', async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      const signal = (init as RequestInit).signal;
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));

    expect(await decideWithJev(cfg, { key: 'C', bpm: 120, style: 'jazz', phrase: 'they played C4 and E4', motif: 'none', activity: 'played 1 of the last 2 bars', peers: 1 })).toBeNull();
  });

  it('rejects an answer outside the closed set', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ answers: { density: { choice: 'blistering' }, register: { choice: 'low' } } }),
    } as Response);
    expect(await decideWithJev(cfg, { key: 'C', bpm: 120, style: 'jazz', phrase: 'they played C4 and E4', motif: 'none', activity: 'played 1 of the last 2 bars', peers: 1 })).toBeNull();
  });

  it('sends one battery per call, all three questions in one body', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => LIVE_ANSWER } as Response);

    await decideWithJev(cfg, { key: 'C major', bpm: 120, style: 'jazz', phrase: 'they played C4 and E4', motif: 'none', activity: 'played 1 of the last 2 bars', peers: 2 });

    const body = JSON.parse(String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body));
    expect(Object.keys(body.questions)).toEqual(['role', 'relation', 'density', 'register', 'veto']);
    expect(body.model).toBe(cfg.model);
    expect(body.state).toContain('120 BPM');
  });

  it('states the room in words a decision model can judge', () => {
    const s = buildJevState({
      key: 'C major', bpm: 120, style: 'jazz',
      phrase: '3 notes, contour rising, mid register, short articulation',
      motif: 'E4@0.00, G4@1.00',
      activity: 'played 3 of the last 4 bars',
      peers: 2,
    });
    expect(s).toContain('2 player(s)');
    expect(s).toContain('120 BPM');
    expect(s).toContain('What the others are playing');
    expect(s).toContain('motif');
  });

  it('asks the five questions a partner answers, in one battery', () => {
    expect(Object.keys(JEV_QUESTIONS)).toEqual(['role', 'relation', 'density', 'register', 'veto']);
  });

  it('treats role rest as a decision not to play', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        answers: {
          role: { choice: 'rest' }, relation: { choice: 'new' },
          density: { choice: 'sparse' }, register: { choice: 'mid' }, veto: { noul: 0.1 },
        },
      }),
    } as Response);

    const brief = await decideWithJev(cfg, { key: 'C', bpm: 120, style: 'jazz', phrase: 'x', motif: 'y', activity: 'played 2 of the last 4 bars', peers: 1 });
    expect(brief?.role).toBe('rest');
    expect(brief?.play).toBe(false);
  });
});
