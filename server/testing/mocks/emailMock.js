/**
 * Shared email mock factory for server route tests.
 */
function createEmailMock(overrides = {}) {
  return {
    sendApprovalEmail: jest.fn().mockResolvedValue(undefined),
    sendRejectionEmail: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

module.exports = {
  createEmailMock,
};
