/**
 * buildFolderPickerBreadcrumbs tests.
 * @see docs/spec/client/utils/buildFolderPickerBreadcrumbs.md
 */
import { buildFolderPickerBreadcrumbs } from '../buildFolderPickerBreadcrumbs';

describe('buildFolderPickerBreadcrumbs', () => {
  it('returns only the shared root breadcrumb for /__shared__', () => {
    expect(
      buildFolderPickerBreadcrumbs({
        selectedPath: '/__shared__',
        user: { username: 'user1', is_admin: false },
        homePath: '/user1',
        homeLabel: 'Home',
        sharedPermissionPaths: new Set(),
        sharedLabel: 'Shared',
      })
    ).toEqual([{ name: 'Shared', path: '/__shared__' }]);
  });

  it('hides the repeated username crumb for non-admin home paths', () => {
    expect(
      buildFolderPickerBreadcrumbs({
        selectedPath: '/user1/docs',
        user: { username: 'user1', is_admin: false },
        homePath: '/user1',
        homeLabel: 'Home',
        sharedPermissionPaths: new Set(),
        sharedLabel: 'Shared',
      })
    ).toEqual([
      { name: 'Home', path: '/user1' },
      { name: 'docs', path: '/user1/docs' },
    ]);
  });

  it('keeps full root-based breadcrumbs for admin home paths', () => {
    expect(
      buildFolderPickerBreadcrumbs({
        selectedPath: '/team/docs',
        user: { username: 'admin', is_admin: true },
        homePath: '/',
        homeLabel: 'Root',
        sharedPermissionPaths: new Set(),
        sharedLabel: 'Shared',
      })
    ).toEqual([
      { name: 'Root', path: '/' },
      { name: 'team', path: '/team' },
      { name: 'docs', path: '/team/docs' },
    ]);
  });

  it('starts shared breadcrumbs at the first matching permission path', () => {
    expect(
      buildFolderPickerBreadcrumbs({
        selectedPath: '/shared/root/child/leaf',
        user: { username: 'user1', is_admin: false },
        homePath: '/user1',
        homeLabel: 'Home',
        sharedPermissionPaths: new Set(['/shared/root']),
        sharedLabel: 'Shared',
      })
    ).toEqual([
      { name: 'Shared', path: '/__shared__' },
      { name: 'root', path: '/shared/root' },
      { name: 'child', path: '/shared/root/child' },
      { name: 'leaf', path: '/shared/root/child/leaf' },
    ]);
  });

  it('falls back to full shared path segments when no permission prefix matches', () => {
    expect(
      buildFolderPickerBreadcrumbs({
        selectedPath: '/external/folder',
        user: { username: 'user1', is_admin: false },
        homePath: '/user1',
        homeLabel: 'Home',
        sharedPermissionPaths: new Set(['/shared/root']),
        sharedLabel: 'Shared',
      })
    ).toEqual([
      { name: 'Shared', path: '/__shared__' },
      { name: 'external', path: '/external' },
      { name: 'folder', path: '/external/folder' },
    ]);
  });
});
