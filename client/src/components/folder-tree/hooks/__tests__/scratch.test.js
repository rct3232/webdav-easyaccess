jest.mock('../../../../services/explorerGateway', () => {
  const { createExplorerGatewayMock } = require('../../../../testing/mocks/serviceMocks');
  const g = createExplorerGatewayMock();
  console.log('factory: mock?', g.subscribeToCollections._isMockFunction, 'ret', typeof g.subscribeToCollections());
  return { __esModule: true, default: g };
});
import explorerGateway from '../../../../services/explorerGateway';
it('probe', () => {
  console.log('imported mock?', explorerGateway.subscribeToCollections._isMockFunction);
  console.log('calls:', explorerGateway.subscribeToCollections.mock?.calls?.length);
  const r = explorerGateway.subscribeToCollections(() => {});
  console.log('ret now:', typeof r);
  expect(true).toBe(true);
});
