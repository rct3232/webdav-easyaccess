import { PERMISSIONS } from '@webdav-easyaccess/shared/constants';
import { buildPendingRequestState } from '../buildPendingRequestState';

describe('buildPendingRequestState', () => {
  it('returns empty state for missing/non-array input', () => {
    expect(buildPendingRequestState({ requests: null, targetNodeId: 1001, isDirectory: true })).toEqual({
      read: { pending: false, id: null },
      write: { pending: false, id: null },
    });
  });

  it('matches folder requests by node_id', () => {
    const result = buildPendingRequestState({
      requests: [
        { id: 'r1', node_id: 1001, requested_permission: PERMISSIONS.READ },
        { id: 'r2', node_id: 1001, requested_permission: PERMISSIONS.WRITE },
      ],
      targetNodeId: 1001,
      isDirectory: true,
    });

    expect(result).toEqual({
      read: { pending: true, id: 'r1' },
      write: { pending: true, id: 'r2' },
    });
  });

  it('matches file requests by node_id', () => {
    const result = buildPendingRequestState({
      requests: [
        { id: 'r1', node_id: 1001, requested_permission: PERMISSIONS.READ },
      ],
      targetNodeId: 1001,
      isDirectory: false,
    });

    expect(result.read).toEqual({ pending: true, id: 'r1' });
    expect(result.write).toEqual({ pending: false, id: null });
  });
});
