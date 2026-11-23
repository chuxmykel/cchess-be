/** What iOS fetches from /.well-known/apple-app-site-association to let the
 * app open this server's /app/ links (email verification, password reset)
 * instead of the browser. Null until the team ID is set. */
export function appleAppSiteAssociation(
  teamId: string | undefined,
  bundleId: string,
): object | null {
  if (!teamId) return null;
  return {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${bundleId}`],
          components: [{ '/': '/app/*', comment: 'Account email links' }],
        },
      ],
    },
  };
}

/** Android's counterpart, /.well-known/assetlinks.json: the app, by its
 * package and signing certificates, may open this server's links. */
export function androidAssetLinks(
  bundleId: string,
  fingerprints: string[],
): object[] {
  if (fingerprints.length === 0) return [];
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: bundleId,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}
