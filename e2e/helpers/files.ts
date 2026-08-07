import fs from 'node:fs';
import path from 'node:path';

import { Page, TestInfo } from '@playwright/test';

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
