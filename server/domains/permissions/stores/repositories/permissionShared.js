'use strict';

/**
 * Shared SQL builders + helpers for the PermissionRepository implementations.
 * The ancestor-JOIN permission lookup is identical across dialects except for
 * the placeholder tokens, so it is built here with explicit placeholders.
 */

/**
 * Effective path permission via the closure table (shallowest ancestor wins).
 * `identityColumn` selects the grant key: `user_id` for user tables, `token`
 * for permissions_shares.
 */
const buildAncestorPermSelect = (table, columns, phIdentity, phNode, limitOne = true, identityColumn = 'user_id') => `
SELECT p.permission, a.depth FROM ${table} p
 JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
 WHERE a.descendant_id = ${phNode} AND p.${identityColumn} = ${phIdentity}
 ORDER BY a.depth ASC ${limitOne ? 'LIMIT 1' : ''}`.trim();

const buildSharedSql = (table, ph1, ph2, excludeOwn) => {
  const exclusion = excludeOwn
    ? ` AND p.file_node_id NOT IN (
        SELECT descendant_id FROM node_ancestors WHERE ancestor_id = ${ph2}
      )`
    : '';
  return `SELECT p.file_node_id, p.permission, n.name, n.type
          FROM ${table} p
          JOIN file_nodes n ON n.id = p.file_node_id
          WHERE p.user_id = ${ph1}${exclusion}`;
};

const buildRemovalSql = (table, ph1, ph2) =>
  `DELETE FROM ${table}
   WHERE user_id = ${ph1} AND file_node_id IN (
     SELECT descendant_id FROM node_ancestors WHERE ancestor_id = ${ph2} AND depth > 0
   )`;

const buildSubtreeRemovalSql = (table, ph1, ph2) =>
  `DELETE FROM ${table}
   WHERE user_id = ${ph1} AND file_node_id IN (
     SELECT descendant_id FROM node_ancestors WHERE ancestor_id = ${ph2}
   )`;

module.exports = {
  buildAncestorPermSelect,
  buildSharedSql,
  buildRemovalSql,
  buildSubtreeRemovalSql,
};
