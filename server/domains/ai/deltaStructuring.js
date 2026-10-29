'use strict';

/**
 * deltaStructuring — the §4.22 utterance-merge RULE TABLE behind
 * searchService.md §2.9.
 *
 * PURE module: no IO, no clock, no randomness. The LLM supplies symbols
 * (`add` / `replace` / `exclude` / `exclude_similar` / `$ref:"latest"`);
 * this table decides how those symbols merge onto the session atom set and
 * which base reference — if any — the request is allowed to bind.
 *
 * Rules (searchService.md §2.9):
 * - atoms are canonicalized through the SHARED definition engine (never forked);
 * - per-list field cardinals: path 1, tag 3, like 1, date 1, size 1;
 * - `add` appends and, on overflow, drops the OLDEST same-field atom;
 * - `replace` removes ALL base atoms of the replacement types, then appends;
 * - `exclude` stays a separate SUBTRACTION list (never a new atom type);
 * - `exclude_similar` is sticky (OR across turns);
 * - `$ref:"latest"` binds ONLY the validated request `result_ref` — never an
 *   LLM-supplied string and never a server-global latest;
 * - path atoms are anchored to the requester root display path (`/<username>`);
 *   an already-anchored prefix is left untouched (idempotent).
 *
 * Any invalid atom, unattachable path or unresolvable reference returns
 * `degraded: true`; the service then discards the parse output and serves the
 * parser-free shape (silent structural fallback, never a 4xx/5xx).
 */

const { parseDefinition } = require('../collections/definitionEngine');
const { MAX_ATOM_COUNTS } = require('./nlParser');

const RESULT_REF_PATTERN = /^sr1\.[0-9a-f]{16}$/;

function emptyResult(degraded) {
  return {
    atoms: [],
    excludes: [],
    excludeSimilar: false,
    baseRef: null,
    degraded,
  };
}

function normalizeRootPath(rootPath) {
  if (typeof rootPath !== 'string') return null;
  const trimmed = rootPath.trim();
  if (!trimmed) return null;
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : '/';
}

function anchorPrefix(prefix, rootPath) {
  if (!rootPath || rootPath === '/') return prefix;
  if (prefix === rootPath || prefix.startsWith(`${rootPath}/`)) return prefix;
  if (prefix === '/') return rootPath;
  return `${rootPath}${prefix}`;
}

/**
 * Canonicalize one atom list through the definition engine. `undefined`/`null`
 * is the empty list; any non-array or grammar violation is null.
 * @returns {Array|null}
 */
function canonicalizeAtomList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  try {
    return parseDefinition({ kind: 'predicate', all_of: value }).allOf;
  } catch {
    return null;
  }
}

function withinCardinalities(atoms) {
  const counts = {};
  for (const atom of atoms) {
    counts[atom.type] = (counts[atom.type] || 0) + 1;
    if (counts[atom.type] > MAX_ATOM_COUNTS[atom.type]) return false;
  }
  return true;
}

function hasPathAtoms(atoms) {
  return atoms.some((atom) => atom.type === 'path');
}

function anchorAtoms(atoms, rootPath) {
  return atoms.map((atom) => {
    if (atom.type !== 'path') return atom;
    return { ...atom, prefix: anchorPrefix(atom.prefix, rootPath) };
  });
}

function atomKey(atom) {
  return JSON.stringify(atom);
}

function dedupeAtoms(atoms) {
  const seen = new Set();
  const out = [];
  for (const atom of atoms) {
    const key = atomKey(atom);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(atom);
  }
  return out;
}

/** Append one atom and drop the OLDEST same-field atom while over cardinality. */
function appendWithOverflow(atoms, atom) {
  const next = [...atoms, atom];
  while (next.filter((entry) => entry.type === atom.type).length > MAX_ATOM_COUNTS[atom.type]) {
    const oldestIndex = next.findIndex((entry) => entry.type === atom.type);
    if (oldestIndex === -1) break;
    next.splice(oldestIndex, 1);
  }
  return next;
}

/**
 * Structure a canonical parsed delta onto a base atom/exclusion set.
 *
 * @param {Object} input
 * @param {Object|null} input.delta - canonical parser delta
 *   `{ add, replace, exclude, excludeSimilar, ref }` (snake_case aliases accepted)
 * @param {Array} [input.baseAtoms] - session atoms (request state or replay base)
 * @param {Array} [input.baseExcludes] - accumulated subtraction list
 * @param {boolean} [input.baseExcludeSimilar] - sticky similarity exclusion
 * @param {string|null} [input.requestRef] - the ONLY allowed `$ref` source
 * @param {string|null} [input.rootPath] - requester root display path (`/<username>`)
 * @returns {{ atoms: Array, excludes: Array, excludeSimilar: boolean,
 *   baseRef: string|null, degraded: boolean }}
 */
function structureDelta({
  delta,
  baseAtoms = [],
  baseExcludes = [],
  baseExcludeSimilar = false,
  requestRef = null,
  rootPath = null,
} = {}) {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
    return emptyResult(true);
  }

  const add = canonicalizeAtomList(delta.add);
  const replace = canonicalizeAtomList(delta.replace);
  const exclude = canonicalizeAtomList(delta.exclude);
  const base = canonicalizeAtomList(baseAtoms);
  const baseExclusions = canonicalizeAtomList(baseExcludes);
  if (!add || !replace || !exclude || !base || !baseExclusions) {
    return emptyResult(true);
  }

  const excludeSimilar = delta.excludeSimilar ?? delta.exclude_similar ?? false;
  if (typeof excludeSimilar !== 'boolean') return emptyResult(true);

  const ref = delta.ref ?? delta.$ref ?? null;
  let baseRef = null;
  if (ref !== null && ref !== undefined) {
    if (ref !== 'latest') return emptyResult(true);
    if (typeof requestRef !== 'string' || !RESULT_REF_PATTERN.test(requestRef)) {
      return emptyResult(true);
    }
    baseRef = requestRef;
  }

  const needsRoot =
    hasPathAtoms(base) ||
    hasPathAtoms(baseExclusions) ||
    hasPathAtoms(add) ||
    hasPathAtoms(replace) ||
    hasPathAtoms(exclude);
  const normalizedRoot = normalizeRootPath(rootPath);
  if (needsRoot && !normalizedRoot) return emptyResult(true);

  const anchoredAdd = anchorAtoms(add, normalizedRoot);
  const anchoredReplace = anchorAtoms(replace, normalizedRoot);
  const anchoredExclude = anchorAtoms(exclude, normalizedRoot);
  const anchoredBase = anchorAtoms(base, normalizedRoot);
  const anchoredBaseExclusions = anchorAtoms(baseExclusions, normalizedRoot);

  if (
    !withinCardinalities(anchoredAdd) ||
    !withinCardinalities(anchoredReplace) ||
    !withinCardinalities(anchoredExclude) ||
    !withinCardinalities(anchoredBase) ||
    !withinCardinalities(anchoredBaseExclusions)
  ) {
    return emptyResult(true);
  }

  const replaceTypes = new Set(anchoredReplace.map((atom) => atom.type));
  let atoms = anchoredBase.filter((atom) => !replaceTypes.has(atom.type));
  atoms.push(...anchoredReplace);
  for (const atom of anchoredAdd) {
    atoms = appendWithOverflow(atoms, atom);
  }

  const excludes = dedupeAtoms([...anchoredBaseExclusions, ...anchoredExclude]);

  return {
    atoms,
    excludes,
    excludeSimilar: excludeSimilar || baseExcludeSimilar === true,
    baseRef,
    degraded: false,
  };
}

module.exports = {
  DELTA_REF_LATEST: 'latest',
  RESULT_REF_PATTERN,
  normalizeRootPath,
  anchorPrefix,
  canonicalizeAtomList,
  structureDelta,
};
