import { describe, expect, it } from 'vitest';
import {
  CLOUD_INTEGRATION_ACCOUNT_NAMES,
  materializeCloudRuntimeSeedPackages,
  type CloudBaseAccountMetadata,
} from '../../src/seed/cloudbase-account-materializer';
import { validateSeedPackage } from '../../src/seed/validator';

const PEPPER = 'xLZ7Jfj7ZK7LnJboPz9Dxmx_eZoFluu0GP41XIlNexg';

describe('CloudBase account runtime seed materializer', () => {
  it('materializes two validated packages without retaining raw UIDs', () => {
    const accounts = validAccounts();
    const result = materializeCloudRuntimeSeedPackages(accounts, PEPPER);

    expect(result.ok, result.ok ? '' : JSON.stringify(result.issues)).toBe(true);
    if (!result.ok) return;
    expect(validateSeedPackage(result.primarySeed, { identityProfile: 'runtime' }).ok).toBe(true);
    expect(validateSeedPackage(result.secondarySeed, { identityProfile: 'runtime' }).ok).toBe(true);
    expect(result.primarySeed.collections.auth_identities).toHaveLength(4);
    expect(result.secondarySeed.collections.auth_identities).toHaveLength(4);
    expect(JSON.stringify(result)).not.toContain('private-platform-uid');
    expect(result.accountNames).toEqual(CLOUD_INTEGRATION_ACCOUNT_NAMES);
  });

  it('requires exact active account types and unique platform identities', () => {
    const blocked = validAccounts();
    blocked[0] = { ...blocked[0]!, status: 'BLOCKED' };
    const wrongType = validAccounts();
    wrongType[3] = { ...wrongType[3]!, type: 'externalUser' };
    const duplicateUid = validAccounts();
    duplicateUid[1] = { ...duplicateUid[1]!, uid: duplicateUid[0]!.uid };

    expect(issueCodes(materializeCloudRuntimeSeedPackages(blocked, PEPPER))).toContain('ACCOUNT_STATE_INVALID');
    expect(issueCodes(materializeCloudRuntimeSeedPackages(wrongType, PEPPER))).toContain('ACCOUNT_STATE_INVALID');
    expect(issueCodes(materializeCloudRuntimeSeedPackages(duplicateUid, PEPPER))).toContain('ACCOUNT_UID_DUPLICATE');
  });

  it('fails closed for malformed account input or unavailable pepper', () => {
    expect(issueCodes(materializeCloudRuntimeSeedPackages({}, PEPPER))).toEqual(['ACCOUNT_SET_INVALID']);
    expect(issueCodes(materializeCloudRuntimeSeedPackages(validAccounts().slice(1), PEPPER))).toEqual(['ACCOUNT_SET_INVALID']);
    expect(issueCodes(materializeCloudRuntimeSeedPackages(validAccounts(), 'short'))).toEqual(['CRYPTOGRAPHY_UNAVAILABLE']);
  });
});

function validAccounts(): CloudBaseAccountMetadata[] {
  return CLOUD_INTEGRATION_ACCOUNT_NAMES.map((name, index) => ({
    name,
    uid: `private-platform-uid-${index}`,
    type: name.endsWith('admin_01') ? 'internalUser' : 'externalUser',
    status: 'ACTIVE',
  }));
}

function issueCodes(result: ReturnType<typeof materializeCloudRuntimeSeedPackages>): readonly string[] {
  return result.ok ? [] : result.issues.map(({ code }) => code);
}
