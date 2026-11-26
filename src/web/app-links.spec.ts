import { describe, expect, it } from 'vitest';

import { androidAssetLinks, appleAppSiteAssociation } from './app-links.js';

describe('app links', () => {
  it("lets the iOS app open /app/ links once there's a team ID", () => {
    expect(appleAppSiteAssociation(undefined, 'dev.chux.cchess')).toBeNull();
    expect(appleAppSiteAssociation('ABCDE12345', 'dev.chux.cchess')).toEqual({
      applinks: {
        details: [
          {
            appIDs: ['ABCDE12345.dev.chux.cchess'],
            components: [{ '/': '/app/*', comment: 'Account email links' }],
          },
        ],
      },
    });
  });

  it('names the Android package and its certificates', () => {
    expect(androidAssetLinks('dev.chux.cchess', [])).toEqual([]);
    expect(androidAssetLinks('dev.chux.cchess', ['AA:BB'])[0]).toMatchObject({
      target: {
        package_name: 'dev.chux.cchess',
        sha256_cert_fingerprints: ['AA:BB'],
      },
    });
  });
});
