'use strict';

/**
 * Error-code ↔ i18n mirror completeness (shared-contracts.md rules).
 *
 * Every SERVER_ERROR_CODES key under a camelCase domain maps to the full i18n
 * key `serverErrors.<domain>.<key>`, and the client locale mirror is mandatory:
 * each key must exist in BOTH client/src/locales/en.json and ko.json — and
 * vice versa for the AI-platform domains (`collections`, `ai`): a key present
 * in the locales but missing from SERVER_ERROR_CODES is a drift bug too.
 *
 * Scope: the reverse direction is asserted only for the domains this platform
 * introduced; legacy domains may carry extra locale keys.
 *
 * @see docs/shared-contracts.md §Server Error and Message Codes
 */

const fs = require('fs');
const path = require('path');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

const LOCALE_DIR = path.join(__dirname, '..', '..', 'client', 'src', 'locales');
const NEW_DOMAINS = ['collections', 'ai'];

function loadLocale(name) {
  return JSON.parse(fs.readFileSync(path.join(LOCALE_DIR, name), 'utf8'));
}

function i18nKey(domain, key) {
  return `serverErrors.${domain}.${key}`;
}

describe('SERVER_ERROR_CODES ↔ client locale mirror (collections + ai domains)', () => {
  const en = loadLocale('en.json');
  const ko = loadLocale('ko.json');

  it.each(NEW_DOMAINS)('defines the %s domain in SERVER_ERROR_CODES', (domain) => {
    expect(SERVER_ERROR_CODES[domain]).toBeDefined();
    expect(typeof SERVER_ERROR_CODES[domain]).toBe('object');
    expect(Object.keys(SERVER_ERROR_CODES[domain]).length).toBeGreaterThan(0);
  });

  it.each(NEW_DOMAINS)(
    'maps every SERVER_ERROR_CODES.%s key to serverErrors.%s.<key>',
    (domain) => {
      for (const [key, value] of Object.entries(SERVER_ERROR_CODES[domain])) {
        expect(value).toBe(i18nKey(domain, key));
      }
    }
  );

  it.each([
    ['collections', 'en'],
    ['collections', 'ko'],
    ['ai', 'en'],
    ['ai', 'ko'],
  ])('mirrors every SERVER_ERROR_CODES.%s key into %s.json', (domain, locale) => {
    const serverErrors = (locale === 'en' ? en : ko).serverErrors;
    const block = serverErrors[domain];
    expect(block).toBeDefined();

    const codeKeys = Object.keys(SERVER_ERROR_CODES[domain]);
    expect(codeKeys.length).toBeGreaterThan(0);
    for (const key of codeKeys) {
      expect(block[key]).toBeDefined();
      expect(typeof block[key]).toBe('string');
      expect(block[key].length).toBeGreaterThan(0);
    }
  });

  it.each(NEW_DOMAINS)(
    'has no %s locale key in en.json/ko.json that is missing from SERVER_ERROR_CODES (vice versa)',
    (domain) => {
      const codeKeys = new Set(Object.keys(SERVER_ERROR_CODES[domain]));
      for (const locale of [en, ko]) {
        const localeKeys = Object.keys(locale.serverErrors[domain] || {});
        expect(localeKeys.length).toBeGreaterThan(0);
        for (const key of localeKeys) {
          expect(codeKeys.has(key)).toBe(true);
        }
      }
    }
  );

  it('collections exposes the shared-contracts key set', () => {
    expect(Object.keys(SERVER_ERROR_CODES.collections).sort()).toEqual(
      [
        'alreadyArchived',
        'emptyNodeIds',
        'forbidden',
        'grantNotFound',
        'granteeNotFound',
        'invalidInclude',
        'invalidName',
        'invalidPublishMode',
        'invalidRole',
        'invalidSort',
        'mergeSameCollection',
        'nameRequired',
        'notArchived',
        'notFound',
        'previewTargetRequired',
        'suggestionNotFound',
      ].sort()
    );
  });

  it('ai exposes the shared-contracts key set', () => {
    expect(Object.keys(SERVER_ERROR_CODES.ai).sort()).toEqual([
      'budgetExceeded',
      'notConfigured',
      'providerProbeFailed',
    ]);
  });
});
