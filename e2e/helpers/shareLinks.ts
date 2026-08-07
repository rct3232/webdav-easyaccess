import { APIRequestContext, expect, type TestInfo } from '@playwright/test';

import { TEST_FILES, TEST_USERS } from '../fixtures/test-data';

import { ensureApprovedUser, getTestSuffix } from './auth';
import { readTestFileFixture } from './files';
import { resolveNodeId } from './resolvePath';

type CreateShareLinkArgs = {
  bearerToken: string;
  filePath: string;
  expiresInDays?: number | null;
};

type DirectoryShareFixture = {
  dirName: string;
  innerFileName: string;
  dirPath: string;
  innerFilePath: string;
  token: string;
  nodeId: number;
};

export type PublicShareFixtures = {
  approvedUserSuffix: string;
  approvedUsername: string;
  approvedUserHomeNodeId: number;
  invalidShareToken: string;
  anonDir: DirectoryShareFixture;
  addDir: DirectoryShareFixture;
  transitionDir: DirectoryShareFixture;
  leaveDir: DirectoryShareFixture;
  singleFile: {
    fileName: string;
    filePath: string;
    token: string;
    nodeId: number;
  };
};

const imageFixtureBuffer = readTestFileFixture(TEST_FILES.smallImage);

function slugify(value: string) {
  return value.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

/**
 * Creates an authenticated share link token via `POST /api/share-links`.
 * Used by E2E specs to generate deterministic public `/share/:token` entry points.
 */
export async function createShareLink(
  request: APIRequestContext,
  { bearerToken, filePath, expiresInDays = 30 }: CreateShareLinkArgs
) {
  const fileNodeId = await resolveNodeId(request, bearerToken, filePath);

  const res = await request.post('/api/share-links', {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
    data: {
      fileNodeId,
      expiresInDays,
    },
  });

  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body;
}

async function createFolderViaApi(request: APIRequestContext, bearerToken: string, folderPath: string) {
  const segments = folderPath.split('/').filter(Boolean);
  const name = segments[segments.length - 1];
  const parentPath = `/${segments.slice(0, -1).join('/')}`;

  const parentNodeId = await resolveNodeId(request, bearerToken, parentPath);

  const res = await request.post('/api/folders/create', {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
    data: { parentNodeId, name },
  });

  // When retries happen after partial setup, the folder may already exist.
  // Conflict is acceptable for our prerequisite setup.
  if (res.status() === 409) return;
  expect(res.ok()).toBeTruthy();
}

async function uploadFileViaApi(
  request: APIRequestContext,
  bearerToken: string,
  options: { folderPath: string; fileName: string; mimeType: string; buffer: Buffer }
) {
  const parentNodeId = await resolveNodeId(request, bearerToken, options.folderPath);

  const res = await request.post('/api/files/upload', {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
    multipart: {
      file: {
        name: options.fileName,
        mimeType: options.mimeType,
        buffer: options.buffer,
      },
      parentNodeId: String(parentNodeId),
      onConflict: 'overwrite',
    },
  });

  expect(res.ok()).toBeTruthy();
}

export async function createPublicShareFixtures(request: APIRequestContext, testInfo: TestInfo): Promise<PublicShareFixtures> {
  // Deterministic naming across runs and platform projects.
  // We keep the suffix stable per Playwright project to avoid cross-project resource collisions.
  const baseId = `${slugify(testInfo.project.name)}-share-public`;
  const approvedUserSuffix = getTestSuffix(testInfo);
  const approvedUsername = `user1_${approvedUserSuffix}`;
  const invalidShareToken = `invalid-share-${baseId}`;

  const anonDirName = `share-anon-dir-${baseId}`;
  const anonInnerFileName = `share-anon-inner-${baseId}.jpg`;

  const addDirName = `share-add-dir-${baseId}`;
  const addInnerFileName = `share-add-inner-${baseId}.jpg`;

  const transitionDirName = `share-transition-dir-${baseId}`;
  const transitionInnerFileName = `share-transition-inner-${baseId}.jpg`;

  const leaveDirName = `share-leave-dir-${baseId}`;
  const leaveInnerFileName = `share-leave-inner-${baseId}.jpg`;

  const singleFileName = `share-single-${baseId}.jpg`;

  // Ensure the target "approved standard user" exists (the share recipient).
  await ensureApprovedUser(request, 'user1', approvedUserSuffix);

  // The shared content is owned by a second user, not by the recipient (user1):
  // content inside the recipient's own home is already readable by them, which would
  // skip the "add to my permissions" confirmation dialog asserted by the specs.
  const ownerUsername = `user2_${approvedUserSuffix}`;
  const ownerHomePath = `/${ownerUsername}`;
  await ensureApprovedUser(request, 'user2', approvedUserSuffix);

  // Use an authenticated admin token for deterministic fixture creation.
  const adminLogin = await request.post('/api/auth/login', {
    data: {
      username: TEST_USERS.admin.username,
      password: TEST_USERS.admin.password,
    },
  });
  expect(adminLogin.ok()).toBeTruthy();
  const adminLoginBody = await adminLogin.json();
  const bearerToken = adminLoginBody.token as string;

  // Create resources via API (no UI/SpeedDial transitions during setup).
  const anonDirPath = `${ownerHomePath}/${anonDirName}`;
  await createFolderViaApi(request, bearerToken, anonDirPath);
  await uploadFileViaApi(request, bearerToken, {
    folderPath: anonDirPath,
    fileName: anonInnerFileName,
    mimeType: 'image/jpeg',
    buffer: imageFixtureBuffer,
  });

  const addDirPath = `${ownerHomePath}/${addDirName}`;
  await createFolderViaApi(request, bearerToken, addDirPath);
  await uploadFileViaApi(request, bearerToken, {
    folderPath: addDirPath,
    fileName: addInnerFileName,
    mimeType: 'image/jpeg',
    buffer: imageFixtureBuffer,
  });

  const transitionDirPath = `${ownerHomePath}/${transitionDirName}`;
  await createFolderViaApi(request, bearerToken, transitionDirPath);
  await uploadFileViaApi(request, bearerToken, {
    folderPath: transitionDirPath,
    fileName: transitionInnerFileName,
    mimeType: 'image/jpeg',
    buffer: imageFixtureBuffer,
  });

  const leaveDirPath = `${ownerHomePath}/${leaveDirName}`;
  await createFolderViaApi(request, bearerToken, leaveDirPath);
  await uploadFileViaApi(request, bearerToken, {
    folderPath: leaveDirPath,
    fileName: leaveInnerFileName,
    mimeType: 'image/jpeg',
    buffer: imageFixtureBuffer,
  });

  const singleFilePath = `${ownerHomePath}/${singleFileName}`;
  await uploadFileViaApi(request, bearerToken, {
    folderPath: ownerHomePath,
    fileName: singleFileName,
    mimeType: 'image/jpeg',
    buffer: imageFixtureBuffer,
  });

  // Create the share tokens via API.
  const anonDirLink = await createShareLink(request, {
    bearerToken,
    filePath: anonDirPath,
    expiresInDays: 30,
  });
  const addDirLink = await createShareLink(request, {
    bearerToken,
    filePath: addDirPath,
    expiresInDays: 30,
  });
  const transitionDirLink = await createShareLink(request, {
    bearerToken,
    filePath: transitionDirPath,
    expiresInDays: 30,
  });
  const leaveDirLink = await createShareLink(request, {
    bearerToken,
    filePath: leaveDirPath,
    expiresInDays: 30,
  });
  const singleFileLink = await createShareLink(request, {
    bearerToken,
    filePath: singleFilePath,
    expiresInDays: 30,
  });

  const approvedUserHomeNodeId = await resolveNodeId(
    request,
    bearerToken,
    `/${approvedUsername}`,
  );

  return {
    approvedUserSuffix,
    approvedUsername,
    approvedUserHomeNodeId,
    invalidShareToken,
    anonDir: {
      dirName: anonDirName,
      innerFileName: anonInnerFileName,
      dirPath: anonDirPath,
      innerFilePath: `${anonDirPath}/${anonInnerFileName}`,
      token: anonDirLink.token,
      nodeId: anonDirLink.nodeId,
    },
    addDir: {
      dirName: addDirName,
      innerFileName: addInnerFileName,
      dirPath: addDirPath,
      innerFilePath: `${addDirPath}/${addInnerFileName}`,
      token: addDirLink.token,
      nodeId: addDirLink.nodeId,
    },
    transitionDir: {
      dirName: transitionDirName,
      innerFileName: transitionInnerFileName,
      dirPath: transitionDirPath,
      innerFilePath: `${transitionDirPath}/${transitionInnerFileName}`,
      token: transitionDirLink.token,
      nodeId: transitionDirLink.nodeId,
    },
    leaveDir: {
      dirName: leaveDirName,
      innerFileName: leaveInnerFileName,
      dirPath: leaveDirPath,
      innerFilePath: `${leaveDirPath}/${leaveInnerFileName}`,
      token: leaveDirLink.token,
      nodeId: leaveDirLink.nodeId,
    },
    singleFile: {
      fileName: singleFileName,
      filePath: singleFilePath,
      token: singleFileLink.token,
      nodeId: singleFileLink.nodeId,
    },
  };
}

