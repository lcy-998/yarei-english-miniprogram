import type { AdminSnapshot } from '../domain/models';

export interface AdminRepository {
  read(): Promise<AdminSnapshot>;
  replace(snapshot: AdminSnapshot): Promise<void>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryAdminRepository implements AdminRepository {
  private snapshot: AdminSnapshot;

  constructor(seed: AdminSnapshot) {
    this.snapshot = clone(seed);
  }

  async read(): Promise<AdminSnapshot> {
    return clone(this.snapshot);
  }

  async replace(snapshot: AdminSnapshot): Promise<void> {
    this.snapshot = clone(snapshot);
  }
}

/**
 * 失败关闭的兼容占位。云端 organization-admin 是 action API，不能用整份
 * snapshot replace 模拟；联调必须显式使用 cloud/ 下的独立 transport/client。
 */
export class CloudBaseAdminRepository implements AdminRepository {
  async read(): Promise<AdminSnapshot> {
    throw new Error('CloudBase 管理后台适配器尚未配置');
  }

  async replace(_snapshot: AdminSnapshot): Promise<void> {
    throw new Error('CloudBase 管理后台适配器尚未配置');
  }
}
