'use strict';

/**
 * Definition engine — evaluation core for collection definitions (DEF-25).
 *
 * Kinds (§2.3 collectionsService.md): `{ kind: 'predicate', all_of?, any_of? }`
 * with atoms of type path | tag | like | date | size, and the vector kinds
 * `seed_vector` / `centroid` (vector evaluation attaches with the T1.4
 * vectorStore seam — until then pure vector definitions contribute no derived
 * members and mixed definitions evaluate their predicate part only).
 *
 * As-built mechanism (T0.3): atoms are evaluated per candidate node with
 * point checks injected by the service (path via the loaded ancestor map, size
 * via filecache, likes via fileLikesStore); tag atoms match nothing until the
 * T0.9 tag source lands — identical observable behavior to the §4.12
 * normalized-equality fallback over an empty tag set.
 *
 * Reasons: `path:<value>` / `tag:<value>` / `like` / `date` / `size`; an
 * `all_of` match joins its atom labels with '+' (deterministic, informative).
 */

const ATOM_TYPES = ['path', 'tag', 'like', 'date', 'size'];

const MAX_DATE_WITHIN_DAYS = 3650;
const SIZE_MIN_BYTES = 0;

function serviceError(code, status) {
  const error = new Error(code);
  if (status) error.status = status;
  return error;
}

function asString(value) {
  return typeof value === 'string' ? value : null;
}

function asPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizePathPrefix(value) {
  const raw = String(value).trim();
  if (!raw) return null;
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : '/';
}

function parseAtom(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw serviceError('invalidDefinition', 400);
  }
  const type = raw.type;
  if (!ATOM_TYPES.includes(type)) {
    throw serviceError('invalidDefinition', 400);
  }
  const atom = { type };
  if (type === 'path' || type === 'tag') {
    const value = asString(raw.value);
    if (!value || !value.trim()) {
      throw serviceError('invalidDefinition', 400);
    }
    atom.value = value.trim();
    if (type === 'path') {
      const prefix = normalizePathPrefix(atom.value);
      if (!prefix) throw serviceError('invalidDefinition', 400);
      atom.prefix = prefix;
    }
  } else if (type === 'date') {
    const withinDays = asPositiveNumber(raw.withinDays);
    const after = asString(raw.after);
    const before = asString(raw.before);
    if (withinDays == null && !after && !before) {
      throw serviceError('invalidDefinition', 400);
    }
    if (withinDays != null) {
      if (withinDays > MAX_DATE_WITHIN_DAYS) throw serviceError('invalidDefinition', 400);
      atom.withinDays = withinDays;
    }
    if (after) {
      if (Number.isNaN(new Date(after).getTime())) throw serviceError('invalidDefinition', 400);
      atom.after = after;
    }
    if (before) {
      if (Number.isNaN(new Date(before).getTime())) throw serviceError('invalidDefinition', 400);
      atom.before = before;
    }
  } else if (type === 'size') {
    const min = Number(raw.min);
    const max = Number(raw.max);
    const hasMin =
      raw.min !== undefined && raw.min !== null && Number.isFinite(min) && min >= SIZE_MIN_BYTES;
    const hasMax =
      raw.max !== undefined && raw.max !== null && Number.isFinite(max) && max > SIZE_MIN_BYTES;
    if (!hasMin && !hasMax) throw serviceError('invalidDefinition', 400);
    if (hasMin) atom.min = min;
    if (hasMax) atom.max = max;
  }
  return atom;
}

/**
 * Validate + normalize a definition payload. Throws `invalidDefinition` for
 * malformed payloads (unknown kind, non-object, unknown atom type, bad atom
 * params). Pure vector definitions pass through unchanged (T1.4 evaluates
 * them); predicate atoms are parsed strictly here.
 * @returns {{ kind: string, allOf: Array, anyOf: Array, vector?: Object }}
 */
function parseDefinition(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw serviceError('invalidDefinition', 400);
  }
  const { kind } = definition;
  if (kind === 'seed_vector' || kind === 'centroid') {
    return { kind, allOf: [], anyOf: [], vector: definition };
  }
  if (kind !== 'predicate') {
    throw serviceError('invalidDefinition', 400);
  }
  const parseList = (value) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw serviceError('invalidDefinition', 400);
    return value.map(parseAtom);
  };
  return {
    kind,
    allOf: parseList(definition.all_of ?? definition.allOf),
    anyOf: parseList(definition.any_of ?? definition.anyOf),
  };
}

function hasPredicates(definition) {
  if (!definition || typeof definition !== 'object') return false;
  if (definition.kind !== 'predicate') return false;
  const allOf = definition.all_of ?? definition.allOf;
  const anyOf = definition.any_of ?? definition.anyOf;
  return (Array.isArray(allOf) && allOf.length > 0) || (Array.isArray(anyOf) && anyOf.length > 0);
}

function atomLabel(atom) {
  if (atom.type === 'path') return `path:${atom.value}`;
  if (atom.type === 'tag') return `tag:${atom.value}`;
  return atom.type;
}

/**
 * Stable, cheap definition fingerprint (§2.2): normalized kind + core
 * parameters (θ, tag set, path — never raw centroid values). Pure.
 * @param {Object} definition
 * @returns {string} hex digest
 */
function fingerprintDefinition(definition) {
  const core = definition && typeof definition === 'object' ? { ...definition } : {};
  for (const key of Object.keys(core)) {
    if (/centroid/i.test(key)) delete core[key];
  }
  const stable = JSON.stringify(core, Object.keys(core).sort());
  return require('crypto').createHash('sha256').update(stable).digest('hex');
}

/**
 * Evaluate a parsed definition over candidate nodes.
 * @param {Object} options
 * @param {Object} options.definition parsed definition (parseDefinition output)
 * @param {Array<{ id:number, parentId:number|null, name:string, type:string, createdAt:string|null }>} options.candidateNodes
 * @param {Map<number, Object>} options.nodesById id → row, including ancestors (path resolution)
 * @param {{ likedNodeIds: Set<number>, getSize: (nodeId:number) => Promise<number|null> }} options.providers
 * @param {Date} [options.now]
 * @returns {Promise<Map<number, string>>} admitted nodeId → matched reason
 */
async function evaluateDefinition({
  definition,
  candidateNodes,
  nodesById,
  providers,
  now = new Date(),
}) {
  if (!hasPredicates(definition)) {
    return new Map();
  }
  const parsed = parseDefinition(definition);
  const { likedNodeIds, getSize } = providers;
  const liked = likedNodeIds instanceof Set ? likedNodeIds : new Set(likedNodeIds || []);
  const parentOf = (node) => {
    if (!node || node.parentId == null) return null;
    return nodesById.get(Number(node.parentId)) || null;
  };

  const displayPath = (node) => {
    const segments = [];
    let current = node;
    const seen = new Set();
    while (current && !seen.has(Number(current.id))) {
      seen.add(Number(current.id));
      segments.unshift(String(current.name));
      current = parentOf(current);
    }
    return `/${segments.join('/')}`;
  };

  const matchers = {
    path: (atom, node) => {
      const path = displayPath(node);
      return path === atom.prefix || path.startsWith(`${atom.prefix}/`);
    },
    tag: () => false,
    like: (atom, node) => liked.has(Number(node.id)),
    date: (atom, node) => {
      const createdAt = new Date(node.createdAt);
      if (Number.isNaN(createdAt.getTime())) return false;
      if (atom.withinDays != null) {
        const horizon = now.getTime() - atom.withinDays * 24 * 60 * 60 * 1000;
        if (createdAt.getTime() < horizon) return false;
      }
      if (atom.after && createdAt.getTime() <= new Date(atom.after).getTime()) return false;
      if (atom.before && createdAt.getTime() >= new Date(atom.before).getTime()) return false;
      return true;
    },
  };

  const evaluateAtom = async (atom, node) => {
    if (atom.type === 'size') {
      const size = await getSize(Number(node.id));
      if (size == null) return false;
      if (atom.min != null && size < atom.min) return false;
      if (atom.max != null && size > atom.max) return false;
      return true;
    }
    return matchers[atom.type](atom, node);
  };

  const matched = new Map();
  for (const node of candidateNodes) {
    if (!node || node.deletedAt) continue;
    if (parsed.allOf.length > 0) {
      const labels = [];
      let allMatch = true;
      for (const atom of parsed.allOf) {
        if (!(await evaluateAtom(atom, node))) {
          allMatch = false;
          break;
        }
        labels.push(atomLabel(atom));
      }
      if (!allMatch) continue;
      if (parsed.anyOf.length > 0) {
        const anyLabels = await matchAnyOf(parsed.anyOf, node, evaluateAtom);
        if (!anyLabels) continue;
        matched.set(Number(node.id), [...labels, anyLabels].join('+'));
      } else {
        matched.set(Number(node.id), labels.join('+'));
      }
      continue;
    }
    const label = await matchAnyOf(parsed.anyOf, node, evaluateAtom);
    if (label) matched.set(Number(node.id), label);
  }
  return matched;

  async function matchAnyOf(atoms, node, evaluator) {
    for (const atom of atoms) {
      if (await evaluator(atom, node)) return atomLabel(atom);
    }
    return null;
  }
}

module.exports = {
  ATOM_TYPES,
  parseDefinition,
  hasPredicates,
  fingerprintDefinition,
  evaluateDefinition,
};
