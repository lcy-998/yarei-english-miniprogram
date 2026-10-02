export type EntityStatus = 'active' | 'disabled';
export type UserKind = 'student' | 'parent' | 'teacher' | 'staff';
export type PermissionKey =
  | 'dashboard.view'
  | 'organization.view'
  | 'organization.create'
  | 'organization.edit'
  | 'organization.disable'
  | 'organization.assignTeacher'
  | 'user.view'
  | 'user.create'
  | 'user.edit'
  | 'user.bind'
  | 'user.resetPassword'
  | 'user.disable'
  | 'permission.view'
  | 'permission.manage'
  | 'audit.view'
  | 'student_work.restore';

export interface School {
  id: string;
  name: string;
  status: EntityStatus;
  version: number;
}

export interface ClassRoom {
  id: string;
  schoolId: string;
  name: string;
  grade: string;
  term: string;
  teacherIds: string[];
  studentCount: number;
  status: EntityStatus;
  version: number;
}

export interface UserAccount {
  id: string;
  schoolId: string;
  name: string;
  mobileMasked: string;
  kind: UserKind;
  roleLabel: string;
  classId?: string;
  bindingCount: number;
  status: EntityStatus;
  lastLoginAt?: string;
  version: number;
}

export interface RoleDefinition {
  id: string;
  name: string;
  system: boolean;
  memberCount: number;
  permissions: PermissionKey[];
  dataScope: 'all-schools' | 'selected-schools' | 'self-created';
  schoolIds: string[];
  version: number;
}

export interface AuditRecord {
  id: string;
  actorId: string;
  action: string;
  target: string;
  createdAt: string;
  result: 'success' | 'failure';
  reason?: string;
}

export interface AdminSession {
  actorId: string;
  actorName: string;
  schoolIds: string[];
  permissions: PermissionKey[];
}

export interface AdminSnapshot {
  schools: School[];
  classes: ClassRoom[];
  users: UserAccount[];
  roles: RoleDefinition[];
  audits: AuditRecord[];
}

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export const ALL_PERMISSIONS: PermissionKey[] = [
  'dashboard.view',
  'organization.view',
  'organization.create',
  'organization.edit',
  'organization.disable',
  'organization.assignTeacher',
  'user.view',
  'user.create',
  'user.edit',
  'user.bind',
  'user.resetPassword',
  'user.disable',
  'permission.view',
  'permission.manage',
  'audit.view',
  'student_work.restore',
];

export const PERMISSION_GROUPS: Array<{ title: string; items: Array<{ key: PermissionKey; label: string }> }> = [
  { title: '工作台', items: [{ key: 'dashboard.view', label: '查看工作台' }] },
  {
    title: '学校/班级管理',
    items: [
      { key: 'organization.view', label: '查看组织' },
      { key: 'organization.create', label: '新建班级' },
      { key: 'organization.edit', label: '编辑班级' },
      { key: 'organization.disable', label: '停用班级' },
      { key: 'organization.assignTeacher', label: '分配教师' },
    ],
  },
  {
    title: '用户管理',
    items: [
      { key: 'user.view', label: '查看用户' },
      { key: 'user.create', label: '新建用户' },
      { key: 'user.edit', label: '编辑用户' },
      { key: 'user.bind', label: '绑定关系' },
      { key: 'user.resetPassword', label: '重置密码' },
      { key: 'user.disable', label: '停用用户' },
      { key: 'student_work.restore', label: '恢复已删作品草稿' },
    ],
  },
  {
    title: '权限管理',
    items: [
      { key: 'permission.view', label: '查看角色' },
      { key: 'permission.manage', label: '配置权限' },
      { key: 'audit.view', label: '查看变更记录' },
    ],
  },
];
