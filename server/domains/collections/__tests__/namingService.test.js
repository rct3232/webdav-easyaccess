'use strict';

/**
 * namingService unit tests (collectionsService.md §2.10).
 */
const { templateNamer, createNamer } = require('../namingService');

describe('templateNamer', () => {
  it('keeps the search query verbatim', () => {
    expect(templateNamer({ kind: 'search', query: 'banana harvest festival' })).toBe(
      'banana harvest festival'
    );
  });

  it('names a seed from its file name', () => {
    expect(templateNamer({ kind: 'seed', seedName: 'beach.jpg' })).toBe(
      'beach.jpg and similar files'
    );
  });

  it('uses the top-2 tags for a system cluster', () => {
    expect(
      templateNamer({ kind: 'system', tags: ['mime:image/jpeg', 'ext:jpg', 'month:2026-01'] })
    ).toBe('mime:image/jpeg · ext:jpg photos');
  });

  it('uses parent · diffTag for a split', () => {
    expect(
      templateNamer({ kind: 'split', parentName: 'Travel', diffTag: 'month:2026-02' })
    ).toBe('Travel · month:2026-02');
  });

  it('falls back to Auto collection N for an untaggable system cluster', () => {
    expect(templateNamer({ kind: 'system', tags: [], index: 4 })).toBe('Auto collection 4');
  });
});

describe('createNamer', () => {
  const input = { kind: 'seed', seedName: 'stay.jpg' };

  it('returns the template when chat is not configured', async () => {
    const invokeLlm = jest.fn();
    const namer = createNamer({ chatConfigured: false, invokeLlm });
    await expect(namer(input)).resolves.toBe('stay.jpg and similar files');
    expect(invokeLlm).not.toHaveBeenCalled();
  });

  it('uses the LLM name for a new creation when chat is configured', async () => {
    const namer = createNamer({
      chatConfigured: true,
      invokeLlm: async () => 'Cozy stays',
    });
    await expect(namer(input)).resolves.toBe('Cozy stays');
  });

  it('falls back to the template on an LLM failure', async () => {
    const namer = createNamer({
      chatConfigured: true,
      invokeLlm: async () => {
        throw new Error('provider down');
      },
    });
    await expect(namer(input)).resolves.toBe('stay.jpg and similar files');
  });

  it('falls back to the template on an empty LLM output', async () => {
    const namer = createNamer({
      chatConfigured: true,
      invokeLlm: async () => '   ',
    });
    await expect(namer(input)).resolves.toBe('stay.jpg and similar files');
  });

  it('routes through llmAdapter.chat when no explicit invoke seam is given', async () => {
    const chat = jest.fn(async () => ({ text: 'Beach memories' }));
    const namer = createNamer({ chatConfigured: true, llmAdapter: { chat } });
    await expect(namer(input)).resolves.toBe('Beach memories');
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
