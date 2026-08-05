/**
 * buildFolderPickerBreadcrumbs tests.
 * @see docs/spec/client/utils/buildFolderPickerBreadcrumbs.md
 */
import { buildFolderPickerBreadcrumbs } from '../buildFolderPickerBreadcrumbs';

describe('buildFolderPickerBreadcrumbs', () => {
  it('returns only the shared root breadcrumb for the shared root', () => {
    expect(
      buildFolderPickerBreadcrumbs({
        homeNodeId: 100,
        homeLabel: 'Home',
        sharedLabel: 'Shared',
        navStack: [{ nodeId: null, name: 'Shared', isSharedRoot: true }],
      })
    ).toEqual([{ name: 'Shared', nodeId: null }]);
  });

  it('builds home breadcrumbs from the navigation stack', () => {
    expect(
      buildFolderPickerBreadcrumbs({
        homeNodeId: 100,
        homeLabel: 'Home',
        sharedLabel: 'Shared',
        navStack: [
          { nodeId: 100, name: 'Home' },
          { nodeId: 101, name: 'docs' },
        ],
      })
    ).toEqual([
      { name: 'Home', nodeId: 100 },
      { name: 'docs', nodeId: 101 },
    ]);
  });

  it('normalizes the admin home root nodeId to null', () => {
    expect(
      buildFolderPickerBreadcrumbs({
        homeNodeId: null,
        homeLabel: 'Root',
        sharedLabel: 'Shared',
        navStack: [{ nodeId: null, name: 'Root' }],
      })
    ).toEqual([{ name: 'Root', nodeId: null }]);
  });

  it('falls back to the home crumb when the navStack is empty', () => {
    expect(
      buildFolderPickerBreadcrumbs({
        homeNodeId: 100,
        homeLabel: 'Home',
        sharedLabel: 'Shared',
        navStack: [],
      })
    ).toEqual([{ name: 'Home', nodeId: 100 }]);
  });
});
