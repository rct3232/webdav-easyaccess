/**
 * settingsService tests.
 * Verifies getPublicSettings (no auth) returns public settings object.
 * @see docs/spec/client/services/settingsService.md
 * @see docs/TESTING_STRATEGY.md
 */
import { get } from '../apiClient';

import { getPublicSettings } from '../settingsService';

jest.mock('../apiClient', () => ({
  get: jest.fn(),
}));

describe('settingsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPublicSettings', () => {
    it('returns object with registration_enabled from GET /settings/public', async () => {
      const settings = { registration_enabled: 'true', email_enabled: 'true' };
      get.mockResolvedValueOnce({ data: settings });

      const result = await getPublicSettings();

      expect(get).toHaveBeenCalledWith('/settings/public');
      expect(result).toHaveProperty('registration_enabled');
      expect(result).toEqual(settings);
    });

    it('rejects when request fails', async () => {
      get.mockRejectedValueOnce(new Error('Network error'));

      await expect(getPublicSettings()).rejects.toThrow();
    });
  });
});
