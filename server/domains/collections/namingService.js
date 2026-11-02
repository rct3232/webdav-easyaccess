'use strict';

/**
 * namingService — collection naming strategies (collectionsService.md §2.10).
 *
 * `templateNamer` is the deterministic DEFAULT and FINAL strategy: search
 * collections keep the query verbatim, seed collections become
 * `{seedFileName} and similar files`, system clusters become
 * `{tag1} · {tag2} photos` (split descendants `{parentName} · {diffTag}`) and
 * the last resort is `Auto collection N`.
 *
 * `createNamer({ llmAdapter, chatConfigured, invokeLlm })` wraps the template
 * with an optional chat-time namer for NEW creations only. Every failure —
 * unconfigured role, provider error, empty/non-string output — falls back to
 * the template string losslessly (the template output is final).
 */

const AUTO_NAME_PREFIX = 'Auto collection';

/** Trim to a non-empty string, else null. */
function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

/**
 * Deterministic §2.10 names.
 *
 * @param {Object} input
 * @param {'search'|'seed'|'system'|'split'} input.kind
 * @param {string} [input.query] search query text (kept verbatim)
 * @param {string} [input.seedName] seed file name
 * @param {string[]} [input.tags] local derived tags (top-2 used for clusters)
 * @param {string} [input.parentName] parent collection name (split clusters)
 * @param {string} [input.diffTag] differentiating tag (split clusters)
 * @param {number} [input.index] fallback sequence number
 * @returns {string}
 */
function templateNamer({ kind, query, seedName, tags, parentName, diffTag, index } = {}) {
  const tagList = (Array.isArray(tags) ? tags : []).map(cleanText).filter((tag) => tag !== null);

  if (kind === 'search') {
    return cleanText(query) ?? `${AUTO_NAME_PREFIX} ${Number(index) || 1}`;
  }

  if (kind === 'seed') {
    const name = cleanText(seedName);
    if (name) return `${name} and similar files`;
    return `${AUTO_NAME_PREFIX} ${Number(index) || 1}`;
  }

  if (kind === 'split') {
    const parent = cleanText(parentName);
    const tag = cleanText(diffTag) ?? tagList[0];
    if (parent && tag) return `${parent} · ${tag}`;
    return `${AUTO_NAME_PREFIX} ${Number(index) || 1}`;
  }

  // System cluster: top-2 tags first, a parent+tag split second, numeric last.
  if (tagList.length >= 2) return `${tagList[0]} · ${tagList[1]} photos`;
  const parent = cleanText(parentName);
  if (parent && tagList.length === 1) return `${parent} · ${tagList[0]}`;
  return `${AUTO_NAME_PREFIX} ${Number(index) || 1}`;
}

/** Prompt material for the optional chat namer (never persisted). */
function buildNamerPrompt({ kind, query, seedName, tags, parentName, diffTag } = {}) {
  const parts = [`Collection kind: ${kind || 'system'}`];
  const add = (label, value) => {
    const text = cleanText(value);
    if (text) parts.push(`${label}: ${text}`);
  };
  add('Search query', query);
  add('Seed file', seedName);
  add('Parent collection', parentName);
  add('Differentiating tag', diffTag);
  if (Array.isArray(tags) && tags.length > 0) add('Tags', tags.join(', '));
  parts.push('Write one short collection name. Reply with the name only.');
  return parts.join('\n');
}

/** Normalize the several chat-client return shapes to one name string. */
function extractName(result) {
  if (typeof result === 'string') return cleanText(result);
  if (!result || typeof result !== 'object') return null;
  if (typeof result.text === 'string') return cleanText(result.text);
  if (typeof result.content === 'string') return cleanText(result.content);
  if (typeof result.name === 'string') return cleanText(result.name);
  return null;
}

/**
 * @param {Object} [deps]
 * @param {Object|null} [deps.llmAdapter] adapter exposing `chat(messages, opts)`
 * @param {boolean} [deps.chatConfigured] chat role gate (default false)
 * @param {Function} [deps.invokeLlm] explicit naming call
 *   `(input, template) => string|Promise<string>` — wins over `llmAdapter`
 * @returns {(input: Object) => Promise<string>} namer
 */
function createNamer({ llmAdapter, chatConfigured = false, invokeLlm } = {}) {
  const hasInvoke = typeof invokeLlm === 'function';
  const hasAdapter = Boolean(llmAdapter) && typeof llmAdapter.chat === 'function';

  return async function namer(input = {}) {
    const template = templateNamer(input);
    // NEW creations only, and only while chat is configured (§2.10).
    if (!chatConfigured) return template;
    if (!hasInvoke && !hasAdapter) return template;

    try {
      const result = hasInvoke
        ? await invokeLlm(input, template)
        : await llmAdapter.chat([
            {
              role: 'system',
              content: 'You name file collections. Reply with the name only.',
            },
            { role: 'user', content: buildNamerPrompt(input) },
          ]);
      const name = extractName(result);
      return name ?? template;
    } catch (error) {
      return template;
    }
  };
}

module.exports = {
  templateNamer,
  createNamer,
  buildNamerPrompt,
};
