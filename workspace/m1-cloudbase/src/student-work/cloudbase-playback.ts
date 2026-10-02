import type { WorkPlaybackPort } from './repository';
import { StudentWorkError } from './types';

export interface CloudBasePlaybackSdkPort {
  getTempFileURL(input: Readonly<{ fileList: readonly Readonly<{ fileID: string; maxAge: number }>[] }>): Promise<Readonly<{
    fileList?: readonly Readonly<{ fileID: string; tempFileURL?: string; code?: string }>[] }>>;
}

export class CloudBaseWorkPlayback implements WorkPlaybackPort {
  public constructor(private readonly storage: CloudBasePlaybackSdkPort) {}
  public async temporaryUrl(fileId: string): Promise<string> {
    try {
      const result = await this.storage.getTempFileURL({ fileList: [{ fileID: fileId, maxAge: 60 }] });
      const entry = result.fileList?.find(item => item.fileID === fileId);
      if (!entry?.tempFileURL || (entry.code !== undefined && entry.code !== 'SUCCESS')
        || !/^https:\/\//.test(entry.tempFileURL)) throw new StudentWorkError('SERVICE_UNAVAILABLE');
      return entry.tempFileURL;
    } catch (error: unknown) {
      if (error instanceof StudentWorkError) throw error;
      throw new StudentWorkError('SERVICE_UNAVAILABLE');
    }
  }
}
