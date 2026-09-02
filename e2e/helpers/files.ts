import fs from 'node:fs';
import path from 'node:path';

import { APIRequestContext, expect, Page, TestInfo } from '@playwright/test';

export function buildName(testInfo: TestInfo, prefix: string, extension = '') {
  const projectSlug = testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const titleSlug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return `${prefix}-${projectSlug}-${titleSlug}-${Date.now()}${extension}`;
}

export function fileItem(page: Page, filePath: string) {
  return page.locator(`[data-file-path="${filePath}"]`);
}

export function readTestFileFixture(fileName: string) {
  return fs.readFileSync(path.join(process.cwd(), 'e2e', 'fixtures', 'test-files', fileName));
}

export async function createFolderAt(
  request: APIRequestContext,
  token: string,
  parentNodeId: number,
  name: string
): Promise<number> {
  const res = await request.post('/api/folders/create', {
    headers: { Authorization: `Bearer ${token}` },
    data: { parentNodeId, name },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.nodeId as number;
}

export async function uploadFileAt(
  request: APIRequestContext,
  token: string,
  parentNodeId: number,
  fileName: string,
  mimeType: string,
  buffer: Buffer
): Promise<number> {
  const res = await request.post('/api/files/upload', {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: { name: fileName, mimeType, buffer },
      parentNodeId: String(parentNodeId),
      onConflict: 'overwrite',
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.nodeId as number;
}

export async function downloadFile(
  request: APIRequestContext,
  token: string,
  nodeId: number
): Promise<Buffer> {
  const res = await request.get(`/api/files/download?nodeId=${nodeId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  return res.body();
}

export async function listNodeChildren(
  request: APIRequestContext,
  token: string,
  nodeId: number
): Promise<Array<{ nodeId: number; name: string; type: string }>> {
  const res = await request.get(`/api/files/list?nodeId=${nodeId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
  return res.json();
}
