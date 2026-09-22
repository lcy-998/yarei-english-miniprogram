import type { AdminSnapshot } from '../domain/models';

export const ADMIN_SEED: AdminSnapshot = {
  schools: [{ id: 'school-demo-001', name: '启航实验学校', status: 'active', version: 1 }],
  classes: [
    { id: 'class-grade3-02', schoolId: 'school-demo-001', name: '三年级 2 班', grade: '三年级', term: '2026 秋季', teacherIds: ['teacher-lin'], studentCount: 36, status: 'active', version: 1 },
    { id: 'class-grade4-01', schoolId: 'school-demo-001', name: '四年级 1 班', grade: '四年级', term: '2026 秋季', teacherIds: ['teacher-chen'], studentCount: 32, status: 'active', version: 1 },
  ],
  users: [
    { id: 'student-xiaoyu', schoolId: 'school-demo-001', name: '小宇', mobileMasked: '138****5621', kind: 'student', roleLabel: '三年级 2 班', classId: 'class-grade3-02', bindingCount: 1, status: 'active', lastLoginAt: '2026-09-15T08:20:00+08:00', version: 1 },
    { id: 'parent-xiaoyu', schoolId: 'school-demo-001', name: '小宇家长', mobileMasked: '139****3816', kind: 'parent', roleLabel: '家长', bindingCount: 1, status: 'active', lastLoginAt: '2026-09-15T08:15:00+08:00', version: 1 },
    { id: 'teacher-lin', schoolId: 'school-demo-001', name: '林老师', mobileMasked: '136****9027', kind: 'teacher', roleLabel: '三年级 2 班教师', classId: 'class-grade3-02', bindingCount: 1, status: 'active', lastLoginAt: '2026-09-15T07:58:00+08:00', version: 1 },
    { id: 'teacher-chen', schoolId: 'school-demo-001', name: '陈老师', mobileMasked: '135****4482', kind: 'teacher', roleLabel: '四年级 1 班教师', classId: 'class-grade4-01', bindingCount: 1, status: 'active', lastLoginAt: '2026-09-14T17:42:00+08:00', version: 1 },
    { id: 'admin-zhou', schoolId: 'school-demo-001', name: '周老师', mobileMasked: '137****6150', kind: 'staff', roleLabel: '超级管理员', bindingCount: 0, status: 'active', lastLoginAt: '2026-09-15T09:05:00+08:00', version: 1 },
  ],
  roles: [
    { id: 'role-super-admin', name: '超级管理员', system: true, memberCount: 1, permissions: ['dashboard.view', 'organization.view', 'organization.create', 'organization.edit', 'organization.disable', 'organization.assignTeacher', 'user.view', 'user.create', 'user.edit', 'user.bind', 'user.resetPassword', 'user.disable', 'permission.view', 'permission.manage', 'audit.view'], dataScope: 'all-schools', schoolIds: ['school-demo-001'], version: 1 },
    { id: 'role-content-reviewer', name: '内容审核员', system: false, memberCount: 6, permissions: ['dashboard.view', 'audit.view'], dataScope: 'selected-schools', schoolIds: ['school-demo-001'], version: 1 },
    { id: 'role-school-admin', name: '学校管理员', system: false, memberCount: 3, permissions: ['dashboard.view', 'organization.view', 'organization.create', 'organization.edit', 'organization.assignTeacher', 'user.view', 'user.create', 'user.edit', 'user.bind', 'user.resetPassword', 'permission.view'], dataScope: 'selected-schools', schoolIds: ['school-demo-001'], version: 1 },
    { id: 'role-teacher-admin', name: '教师管理员', system: false, memberCount: 2, permissions: ['dashboard.view', 'organization.view', 'user.view'], dataScope: 'self-created', schoolIds: ['school-demo-001'], version: 1 },
  ],
  audits: [
    { id: 'audit-seed-1', actorId: 'admin-zhou', action: '创建班级', target: '三年级 2 班', createdAt: '2026-09-15T10:24:00+08:00', result: 'success' },
    { id: 'audit-seed-2', actorId: 'admin-zhou', action: '分配教师', target: '四年级 1 班 / 陈老师', createdAt: '2026-09-15T09:15:00+08:00', result: 'success' },
  ],
};
