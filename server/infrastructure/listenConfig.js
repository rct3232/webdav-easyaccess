'use strict';

// Loopback-only binding while first-run setup is incomplete (WS1,
// docs/features/setup-wizard.md): a server that has not finished setup must
// never listen on a non-loopback interface, so /setup and its unauthenticated
// write endpoints cannot be reached from the network. There is deliberately no
// opt-out env flag. Once setup is complete the server keeps today's behavior
// (no explicit host -> all interfaces) so reverse proxies keep working.
function resolveListenHost(setupComplete) {
  if (setupComplete === false) return '127.0.0.1';
  return undefined;
}

module.exports = { resolveListenHost };
