'use strict';

function isLinkExpired(link) {
  if (!link.expiresAt) {
    return false;
  }
  const now = new Date();
  const expiresAt = new Date(link.expiresAt);
  return now > expiresAt;
}

module.exports = { isLinkExpired };
