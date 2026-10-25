import type { RetentionStoragePort } from './service';
import type { AbandonedStagingStoragePort } from './abandoned-staging';

export interface CloudBaseDeletePort {
  deleteFile(input: Readonly<{ fileList: readonly string[] }>): Promise<Readonly<{
    code?: string;
    fileList?: readonly Readonly<{ fileID: string; code: string }>[];
  }>>;
}
export interface CloudBaseStagingMetadataPort extends CloudBaseDeletePort {
  getUploadMetadata(input: Readonly<{ cloudPath: string }>): Promise<Readonly<{
    data?: Readonly<{ fileId?: string }>;
  }>>;
}

/** The retention service derives the private file ID; this adapter deletes only that one ID. */
export class CloudBaseRetentionStorage implements RetentionStoragePort {
  public constructor(private readonly storage: CloudBaseDeletePort) {}

  public async deleteFile(fileId: string): Promise<'deleted' | 'not_found'> {
    if (!/^cloud:\/\/[^/]+\/.+/.test(fileId)) throw new Error('Invalid retention file ID');
    const result = await this.storage.deleteFile({ fileList: [fileId] });
    if (result.code) throw new Error('CloudBase retention deletion failed');
    const item = result.fileList?.length === 1 ? result.fileList[0] : null;
    if (!item || item.fileID !== fileId) throw new Error('CloudBase retention deletion mismatch');
    if (item.code === 'SUCCESS') return 'deleted';
    if (item.code === 'STORAGE_FILE_NONEXIST') return 'not_found';
    // Other response codes are not evidence that this exact object is absent.
    throw new Error('CloudBase retention deletion unconfirmed');
  }
}

/** Resolves the configured bucket on the server; no client file ID is accepted. */
export class CloudBaseAbandonedStagingStorage implements AbandonedStagingStoragePort {
  public constructor(private readonly storage: CloudBaseStagingMetadataPort) {}

  public async deleteStagingPath(input: Readonly<{ environmentId: string; stagingPath: string }>):
    Promise<'deleted' | 'not_found'> {
    if (!/^[A-Za-z0-9_-]+$/.test(input.environmentId)
      || !/^[A-Za-z0-9_/-]+(?:\.mp3)?$/.test(input.stagingPath)
      || input.stagingPath.includes('//') || input.stagingPath.startsWith('/')) {
      throw new Error('Invalid staging path');
    }
    const metadata = await this.storage.getUploadMetadata({ cloudPath: input.stagingPath });
    const fileId = metadata.data?.fileId;
    const match = typeof fileId === 'string' ? /^cloud:\/\/([^/]+)\/(.+)$/.exec(fileId) : null;
    if (!fileId || !match || (match[1] !== input.environmentId
      && !match[1]?.startsWith(`${input.environmentId}.`))
      || match[2] !== input.stagingPath) throw new Error('Staging bucket mismatch');
    return new CloudBaseRetentionStorage(this.storage).deleteFile(fileId);
  }
}
