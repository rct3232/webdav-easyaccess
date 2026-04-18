import { APIRequestContext, expect, type TestInfo } from '@playwright/test';

import { TEST_FILES, TEST_USERS } from '../fixtures/test-data';

import { ensureApprovedUser, getTestSuffix } from './auth';
import { readTestFileFixture } from './files';

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
};

export type PublicShareFixtures = {
  invalidShareToken: string;
  anonDir: DirectoryShareFixture;
  addDir: DirectoryShareFixture;
  transitionDir: DirectoryShareFixture;
  leaveDir: DirectoryShareFixture;
  singleFile: {
    fileName: string;
    filePath: string;
    token: string;
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
  const res = await request.post('/api/share-links', {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
    data: {
      filePath,
      expiresInDays,
    },
  });

  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body;
}

async function createFolderViaApi(request: APIRequestContext, bearerToken: string, folderPath: string) {
  const res = await request.post('/api/folders/create', {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
    data: { path: folderPath },
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
      path: options.folderPath,
      onConflict: 'overwrite',
    },
  });

  expect(res.ok()).toBeTruthy();
}

export async function createPublicShareFixtures(request: APIRequestContext, testInfo: TestInfo): Promise<PublicShareFixtures> {
  // Deterministic naming across runs and platform projects.
  // We keep the suffix stable per Playwright project to avoid cross-project resource collisions.
  const baseId = `${slugify(testInfo.project.name)}-share-public`;
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

  // Ensure the target "approved standard user" exists.
  await ensureApprovedUser(request, 'user1', getTestSuffix(testInfo));

  // Use an authenticated admin token for deterministic WebDAV-backed fixture creation.
  const adminLogin = await request.post('/api/auth/login', {
    data: {
      username: TEST_USERS.admin.username,
      password: TEST_USERS.admin.password,
    },
  });
  expect(adminLogin.ok()).toBeTruthy();
  const adminLoginBody = await adminLogin.json();
  const bearerToken = adminLoginBody.token as string;

  // Create WebDAV-backed resources via API (no UI/SpeedDial transitions during setup).
  const anonDirPath = `/${anonDirName}`;
  await createFolderViaApi(request, bearerToken, anonDirPath);
  await uploadFileViaApi(request, bearerToken, {
    folderPath: anonDirPath,
    fileName: anonInnerFileName,
    mimeType: 'image/jpeg',
    buffer: imageFixtureBuffer,
  });

  const addDirPath = `/${addDirName}`;
  await createFolderViaApi(request, bearerToken, addDirPath);
  await uploadFileViaApi(request, bearerToken, {
    folderPath: addDirPath,
    fileName: addInnerFileName,
    mimeType: 'image/jpeg',
    buffer: imageFixtureBuffer,
  });

  const transitionDirPath = `/${transitionDirName}`;
  await createFolderViaApi(request, bearerToken, transitionDirPath);
  await uploadFileViaApi(request, bearerToken, {
    folderPath: transitionDirPath,
    fileName: transitionInnerFileName,
    mimeType: 'image/jpeg',
    buffer: imageFixtureBuffer,
  });

  const leaveDirPath = `/${leaveDirName}`;
  await createFolderViaApi(request, bearerToken, leaveDirPath);
  await uploadFileViaApi(request, bearerToken, {
    folderPath: leaveDirPath,
    fileName: leaveInnerFileName,
    mimeType: 'image/jpeg',
    buffer: imageFixtureBuffer,
  });

  await uploadFileViaApi(request, bearerToken, {
    folderPath: '/',
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
    filePath: `/${singleFileName}`,
    expiresInDays: 30,
  });

  return {
    invalidShareToken,
    anonDir: {
      dirName: anonDirName,
      innerFileName: anonInnerFileName,
      dirPath: anonDirPath,
      innerFilePath: `/${anonDirName}/${anonInnerFileName}`,
      token: anonDirLink.token,
    },
    addDir: {
      dirName: addDirName,
      innerFileName: addInnerFileName,
      dirPath: addDirPath,
      innerFilePath: `/${addDirName}/${addInnerFileName}`,
      token: addDirLink.token,
    },
    transitionDir: {
      dirName: transitionDirName,
      innerFileName: transitionInnerFileName,
      dirPath: transitionDirPath,
      innerFilePath: `/${transitionDirName}/${transitionInnerFileName}`,
      token: transitionDirLink.token,
    },
    leaveDir: {
      dirName: leaveDirName,
      innerFileName: leaveInnerFileName,
      dirPath: leaveDirPath,
      innerFilePath: `/${leaveDirName}/${leaveInnerFileName}`,
      token: leaveDirLink.token,
    },
    singleFile: {
      fileName: singleFileName,
      filePath: `/${singleFileName}`,
      token: singleFileLink.token,
    },
  };
}

