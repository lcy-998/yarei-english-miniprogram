import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS } from '../src/domain/models';
import { MemoryAdminRepository } from '../src/services/admin-repository';
import { AdminService } from '../src/services/admin-service';
import { ADMIN_SEED } from '../src/services/seed';

const createService = (permissions = ALL_PERMISSIONS) => new AdminService(
  new MemoryAdminRepository(ADMIN_SEED),
  { actorId: 'admin-zhou', actorName: '周老师', schoolIds: ['school-demo-001'], permissions },
  () => '2026-09-16T10:00:00+08:00',
);

describe('M1 管理后台 service', () => {
  it('按组织范围返回虚构数据快照', async () => {
    expect(await createService().snapshot()).toMatchObject({ ok: true, data: { schools: [{ id: 'school-demo-001' }] } });
  });

  it('服务层拒绝绕过界面的无权限写入', async () => {
    const result = await createService(['dashboard.view']).createClass({ schoolId: 'school-demo-001', name: '五年级 1 班', grade: '五年级', term: '2026 秋季' });
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('阻止停用仍有学生的班级', async () => {
    expect(await createService().disableClass('class-grade3-02', 1)).toMatchObject({ ok: false, code: 'CLASS_HAS_STUDENTS' });
  });

  it('创建用户时校验手机号并只保存脱敏值', async () => {
    const service = createService();
    expect(await service.createUser({ schoolId: 'school-demo-001', kind: 'parent', name: '测试家长', mobile: '123', roleLabel: '家长' })).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(await service.createUser({ schoolId: 'school-demo-001', kind: 'parent', name: '测试家长', mobile: '13800008888', roleLabel: '家长' })).toMatchObject({ ok: true, data: { mobileMasked: '138****8888' } });
  });

  it('阻止当前管理员停用自己', async () => {
    expect(await createService().disableUser('admin-zhou', 1)).toMatchObject({ ok: false, code: 'SELF_LOCK_PROTECTED' });
  });

  it('权限配置要求数据范围并保护超级管理员必要权限', async () => {
    const service = createService();
    expect(await service.updateRole({ roleId: 'role-super-admin', permissions: ALL_PERMISSIONS, dataScope: 'selected-schools', schoolIds: [], expectedVersion: 1 })).toMatchObject({ ok: false, code: 'DATA_SCOPE_REQUIRED' });
    expect(await service.updateRole({ roleId: 'role-super-admin', permissions: ALL_PERMISSIONS.filter((item) => item !== 'permission.manage'), dataScope: 'all-schools', schoolIds: ['school-demo-001'], expectedVersion: 1 })).toMatchObject({ ok: false, code: 'SELF_LOCK_PROTECTED' });
  });
});
