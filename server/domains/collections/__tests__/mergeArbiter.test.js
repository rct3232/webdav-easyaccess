/**
 * mergeArbiter — the `merge-arbiter` prompt builder + verdict validator
 * (docs/spec/server/services/evolutionService.md §2.8; AI_FEATURE_PLAN §4.19).
 *
 * L0 unit leg: no DB, no provider — the chat call rides an injected fake
 * adapter (R3 posture: adapter seam only, never E2E). The load-bearing pin is
 * the SYMMETRIC DIFFERENCE: both sides' unique-member counts/ratios and
 * per-side unique samples MUST reach the prompt; feeding only shared-sample +
 * overlap ratio produced the measured all-merge bias (E7).
 */
const {
  MERGE_ARBITER_VERDICTS,
  MERGE_ARBITER_MAX_PAIRS,
  buildArbiterMessages,
  buildArbiterSchema,
  validateArbiterOutput,
  createMergeArbiter,
} = require('../mergeArbiter');

function side(overrides = {}) {
  return {
    collectionId: overrides.collectionId ?? 1,
    name: overrides.name ?? 'Europe',
    size: overrides.size ?? 5,
    topTags: overrides.topTags ?? ['travel', 'photos'],
    uniqueCount: overrides.uniqueCount ?? 1,
    uniqueRatio: overrides.uniqueRatio ?? 0.2,
    memberSummaries: overrides.memberSummaries ?? [{ node_id: 10, summary: 'shared plaza photo' }],
    uniqueSamples: overrides.uniqueSamples ?? [],
  };
}

function pair(overrides = {}) {
  return {
    pairKey: overrides.pairKey ?? '1:2',
    jaccard: overrides.jaccard ?? 0.62,
    intersectionCount: overrides.intersectionCount ?? 4,
    a: overrides.a ?? side({ collectionId: 1, name: 'Europe' }),
    b: overrides.b ?? side({ collectionId: 2, name: '2026 trip' }),
  };
}

/** Parse the user-message payload back into the pair blocks. */
function userPayload(messages) {
  const user = messages.find((m) => m.role === 'user');
  return JSON.parse(user.content);
}

describe('mergeArbiter prompt builder (symmetric difference is law)', () => {
  it('carries BOTH sides unique samples + counts/ratios, never only the intersection', () => {
    const p = pair({
      a: side({
        collectionId: 1,
        name: 'Europe',
        size: 5,
        uniqueCount: 1,
        uniqueRatio: 0.2,
        memberSummaries: [{ node_id: 10, summary: 'shared plaza photo' }],
        uniqueSamples: [{ node_id: 14, summary: 'MADRID-ONLY flea market shot' }],
      }),
      b: side({
        collectionId: 2,
        name: '2026 trip',
        size: 5,
        uniqueCount: 1,
        uniqueRatio: 0.2,
        memberSummaries: [{ node_id: 10, summary: 'shared plaza photo' }],
        uniqueSamples: [{ node_id: 15, summary: 'TOKYO-ONLY street shot' }],
      }),
    });
    const messages = buildArbiterMessages([p]);
    const serialized = JSON.stringify(messages);
    // Both sides' unique samples appear (the anti-bias requirement).
    expect(serialized).toContain('MADRID-ONLY flea market shot');
    expect(serialized).toContain('TOKYO-ONLY street shot');
    // And the intersection evidence is present too (shared sample + counts).
    expect(serialized).toContain('shared plaza photo');

    const payload = userPayload(messages);
    const block = payload.pairs[0];
    expect(block.pair_id).toBe(0);
    expect(block.intersection_count).toBe(4);
    expect(block.a.unique_count).toBe(1);
    expect(block.b.unique_count).toBe(1);
    expect(block.a.unique_ratio).toBe(0.2);
    expect(block.b.unique_ratio).toBe(0.2);
    expect(block.a.unique_samples).toEqual([
      { node_id: 14, summary: 'MADRID-ONLY flea market shot' },
    ]);
    expect(block.b.unique_samples).toEqual([{ node_id: 15, summary: 'TOKYO-ONLY street shot' }]);
    // snake_case response/wire discipline also holds inside the prompt payload.
    expect(block.a.collection_id).toBe(1);
    expect(block.a.top_tags).toEqual(['travel', 'photos']);
  });

  it('asks for the closed verdict vocabulary and one decision per pair_id', () => {
    const messages = buildArbiterMessages([pair()]);
    const system = messages.find((m) => m.role === 'system').content;
    expect(system).toContain('pair_id');
    for (const verdict of MERGE_ARBITER_VERDICTS) expect(system).toContain(verdict);
  });

  it('schema is the closed decision object (no new chat vocabulary)', () => {
    const schema = buildArbiterSchema();
    expect(schema.properties.decisions.items.properties.verdict.enum).toEqual([
      'merge',
      'keep_separate',
      'sibling',
    ]);
    expect(schema.properties.decisions.items.required).toEqual(
      expect.arrayContaining(['pair_id', 'verdict', 'reason'])
    );
  });
});

describe('mergeArbiter output validation', () => {
  it('keeps well-formed decisions and drops unknown verdicts / foreign pair ids', () => {
    const pairs = [pair({ pairKey: '1:2' }), pair({ pairKey: '3:4' })];
    const verdicts = validateArbiterOutput(
      {
        decisions: [
          { pair_id: 0, verdict: 'merge', reason: 'same theme twice' },
          { pair_id: 1, verdict: 'definitely_merge', reason: 'off-contract' },
          { pair_id: 99, verdict: 'sibling', reason: 'foreign pair id' },
        ],
      },
      pairs
    );
    expect(verdicts.get('1:2')).toEqual({ verdict: 'merge', reason: 'same theme twice' });
    expect(verdicts.has('3:4')).toBe(false);
    expect(verdicts.size).toBe(1);
  });

  it('normalizes the reason to one capped line', () => {
    const pairs = [pair()];
    const long = 'x'.repeat(500);
    const verdicts = validateArbiterOutput(
      { decisions: [{ pair_id: 0, verdict: 'keep_separate', reason: `  one\ntwo  ${long}  ` }] },
      pairs
    );
    const reason = verdicts.get('1:2').reason;
    expect(reason).not.toContain('\n');
    expect(reason.length).toBeLessThanOrEqual(200);
  });

  it('resolves garbage (non-JSON object / missing decisions) to an empty verdict map', () => {
    expect(validateArbiterOutput(null, [pair()]).size).toBe(0);
    expect(validateArbiterOutput({ decisions: 'nope' }, [pair()]).size).toBe(0);
    expect(validateArbiterOutput({ decisions: [{}] }, [pair()]).size).toBe(0);
  });
});

describe('createMergeArbiter (one batched call, never throws)', () => {
  function fakeAdapter(reply) {
    const calls = [];
    return {
      calls,
      chat: jest.fn(async (messages, opts) => {
        calls.push({ messages, opts });
        if (reply instanceof Error) throw reply;
        return { json: reply };
      }),
    };
  }

  it('issues AT MOST ONE chat call per pass and caps the batch at 8 pairs', async () => {
    const pairs = [];
    for (let i = 0; i < MERGE_ARBITER_MAX_PAIRS + 4; i += 1) {
      pairs.push(pair({ pairKey: `${i + 1}:${i + 2}`, jaccard: 0.69 - i * 0.001 }));
    }
    const adapter = fakeAdapter({
      decisions: pairs.slice(0, MERGE_ARBITER_MAX_PAIRS).map((_, pairId) => ({
        pair_id: pairId,
        verdict: 'merge',
        reason: `r${pairId}`,
      })),
    });
    const arbiter = createMergeArbiter({ adapter });
    const result = await arbiter.arbitrate(pairs);
    expect(adapter.chat).toHaveBeenCalledTimes(1);
    expect(result.calls).toBe(1);
    expect(userPayload(adapter.calls[0].messages).pairs).toHaveLength(MERGE_ARBITER_MAX_PAIRS);
    expect(result.verdicts.size).toBe(MERGE_ARBITER_MAX_PAIRS);
    // reasoning OFF posture is requested at the call site (§4.19 E5/E7b).
    expect(adapter.calls[0].opts.reasoning).toBe(false);
  });

  it('swallows provider errors (budget/breaker class included) — calls counted, no verdicts', async () => {
    const err = new Error('role paused');
    err.class = 'budget';
    const adapter = fakeAdapter(err);
    const arbiter = createMergeArbiter({ adapter });
    const result = await arbiter.arbitrate([pair()]);
    expect(result.calls).toBe(1);
    expect(result.verdicts.size).toBe(0);
  });

  it('never throws on unparsable chat text and reports zero verdicts', async () => {
    const adapter = { chat: jest.fn(async () => ({ text: 'not json at all' })) };
    const arbiter = createMergeArbiter({ adapter });
    const result = await arbiter.arbitrate([pair()]);
    expect(result.calls).toBe(1);
    expect(result.verdicts.size).toBe(0);
  });

  it('missing adapter or empty pairs ⇒ zero calls', async () => {
    const noAdapter = createMergeArbiter({ adapter: null });
    await expect(noAdapter.arbitrate([pair()])).resolves.toEqual({
      verdicts: expect.any(Map),
      calls: 0,
    });
    const adapter = fakeAdapter({ decisions: [] });
    const arbiter = createMergeArbiter({ adapter });
    await expect(arbiter.arbitrate([])).resolves.toMatchObject({ calls: 0 });
    expect(adapter.chat).not.toHaveBeenCalled();
  });
});
