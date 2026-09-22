import type {
  AdminSession,
  AdminSnapshot,
  ClassRoom,
  PermissionKey,
  RoleDefinition,
  ServiceResult,
  UserAccount,
  UserKind,
} from '../domain/models';
import type { AdminRepository } from './admin-repository';

export interface CreateClassInput {
  schoolId: string;
  name: string;
  grade: string;
  term: string;
}

export interface CreateUserInput {
  schoolId: string;
  kind: UserKind;
  name: string;
  mobile: string;
  roleLabel: string;
  classId?: string;
}

export interface UpdateRoleInput {
  roleId: string;
  permissions: PermissionKey[];
  dataScope: RoleDefinition['dataScope'];
  schoolIds: string[];
  expectedVersion: number;
}

const fail = <T>(code: string, message: string): ServiceResult<T> => ({ ok: false, code, message });
const ok = <T>(data: T): ServiceResult<T> => ({ ok: true, data });

export class AdminService {
  constructor(
    private readonly repository: AdminRepository,
    private readonly session: AdminSession,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async snapshot(): Promise<ServiceResult<AdminSnapshot>> {
    if (!this.can('dashboard.view')) return fail('FORBIDDEN', '当前账号无后台访问权限');
    const snapshot = await this.repository.read();
    const schools = snapshot.schools.filter((school) => this.inSchoolScope(school.id));
    const schoolIds = new Set(schools.map((school) => school.id));
    return ok({
      ...snapshot,
      schools,
      classes: snapshot.classes.filter((item) => schoolIds.has(item.schoolId)),
      users: snapshot.users.filter((item) => schoolIds.has(item.schoolId)),
    });
  }

  async createClass(input: CreateClassInput): Promise<ServiceResult<ClassRoom>> {
    if (!this.can('organization.create')) return fail('FORBIDDEN', '无新建班级权限');
    if (!this.inSchoolScope(input.schoolId)) return fail('OUT_OF_SCOPE', '不能在未授权学校创建班级');
    if (!input.name.trim() || !input.grade.trim() || !input.term.trim()) return fail('VALIDATION_ERROR', '班级名称、年级和学期均为必填项');
    const snapshot = await this.repository.read();
    if (snapshot.classes.some((item) => item.schoolId === input.schoolId && item.name === input.name.trim() && item.status === 'active')) {
      return fail('DUPLICATE', '该学校已存在同名班级');
    }
    const classRoom: ClassRoom = {
      id: `class-${Date.now().toString(36)}`,
      schoolId: input.schoolId,
      name: input.name.trim(),
      grade: input.grade.trim(),
      term: input.term.trim(),
      teacherIds: [],
      studentCount: 0,
      status: 'active',
      version: 1,
    };
    snapshot.classes.push(classRoom);
    this.audit(snapshot, '创建班级', classRoom.name);
    await this.repository.replace(snapshot);
    return ok(classRoom);
  }

  async updateClass(classId: string, patch: Pick<CreateClassInput, 'name' | 'grade' | 'term'>, expectedVersion: number): Promise<ServiceResult<ClassRoom>> {
    if (!this.can('organization.edit')) return fail('FORBIDDEN', '无编辑班级权限');
    if (!patch.name.trim() || !patch.grade.trim() || !patch.term.trim()) return fail('VALIDATION_ERROR', '班级名称、年级和学期均为必填项');
    const snapshot = await this.repository.read();
    const classRoom = snapshot.classes.find((item) => item.id === classId);
    if (!classRoom || !this.inSchoolScope(classRoom.schoolId)) return fail('NOT_FOUND', '班级不存在或不在授权范围');
    if (classRoom.version !== expectedVersion) return fail('VERSION_CONFLICT', '班级信息已更新，请刷新后重试');
    Object.assign(classRoom, { name: patch.name.trim(), grade: patch.grade.trim(), term: patch.term.trim(), version: classRoom.version + 1 });
    this.audit(snapshot, '编辑班级', classRoom.name);
    await this.repository.replace(snapshot);
    return ok(structuredClone(classRoom));
  }

  async assignTeachers(classId: string, teacherIds: string[], expectedVersion: number): Promise<ServiceResult<ClassRoom>> {
    if (!this.can('organization.assignTeacher')) return fail('FORBIDDEN', '无分配教师权限');
    const snapshot = await this.repository.read();
    const classRoom = snapshot.classes.find((item) => item.id === classId);
    if (!classRoom || !this.inSchoolScope(classRoom.schoolId)) return fail('NOT_FOUND', '班级不存在或不在授权范围');
    if (classRoom.version !== expectedVersion) return fail('VERSION_CONFLICT', '班级信息已更新，请刷新后重试');
    const uniqueIds = [...new Set(teacherIds)];
    const valid = uniqueIds.every((id) => snapshot.users.some((user) => user.id === id && user.kind === 'teacher' && user.schoolId === classRoom.schoolId && user.status === 'active'));
    if (!valid) return fail('INVALID_TEACHER', '选择中包含无效、已停用或跨校教师');
    classRoom.teacherIds = uniqueIds;
    classRoom.version += 1;
    this.audit(snapshot, '分配教师', classRoom.name);
    await this.repository.replace(snapshot);
    return ok(structuredClone(classRoom));
  }

  async disableClass(classId: string, expectedVersion: number): Promise<ServiceResult<ClassRoom>> {
    if (!this.can('organization.disable')) return fail('FORBIDDEN', '无停用班级权限');
    const snapshot = await this.repository.read();
    const classRoom = snapshot.classes.find((item) => item.id === classId);
    if (!classRoom || !this.inSchoolScope(classRoom.schoolId)) return fail('NOT_FOUND', '班级不存在或不在授权范围');
    if (classRoom.version !== expectedVersion) return fail('VERSION_CONFLICT', '班级信息已更新，请刷新后重试');
    if (classRoom.studentCount > 0) return fail('CLASS_HAS_STUDENTS', '班级仍有未迁移学生，不能停用');
    classRoom.status = 'disabled';
    classRoom.version += 1;
    this.audit(snapshot, '停用班级', classRoom.name);
    await this.repository.replace(snapshot);
    return ok(structuredClone(classRoom));
  }

  async createUser(input: CreateUserInput): Promise<ServiceResult<UserAccount>> {
    if (!this.can('user.create')) return fail('FORBIDDEN', '无新建用户权限');
    if (!this.inSchoolScope(input.schoolId)) return fail('OUT_OF_SCOPE', '不能在未授权学校创建账号');
    if (!/^1\d{10}$/.test(input.mobile)) return fail('VALIDATION_ERROR', '请输入正确的 11 位手机号');
    if (!input.roleLabel.trim()) return fail('VALIDATION_ERROR', '角色为必填项');
    const snapshot = await this.repository.read();
    const mobileMasked = `${input.mobile.slice(0, 3)}****${input.mobile.slice(-4)}`;
    if (snapshot.users.some((user) => user.mobileMasked === mobileMasked)) return fail('DUPLICATE', '该手机号对应的账号已存在');
    if (input.classId && !snapshot.classes.some((item) => item.id === input.classId && item.schoolId === input.schoolId && item.status === 'active')) {
      return fail('INVALID_CLASS', '所选班级不可用');
    }
    const user: UserAccount = {
      id: `user-${Date.now().toString(36)}`,
      schoolId: input.schoolId,
      name: input.name.trim() || `${this.kindLabel(input.kind)}新用户`,
      mobileMasked,
      kind: input.kind,
      roleLabel: input.roleLabel.trim(),
      classId: input.classId,
      bindingCount: 0,
      status: 'active',
      version: 1,
    };
    snapshot.users.push(user);
    this.audit(snapshot, '创建用户', user.name);
    await this.repository.replace(snapshot);
    return ok(user);
  }

  async updateUser(userId: string, name: string, roleLabel: string, expectedVersion: number): Promise<ServiceResult<UserAccount>> {
    if (!this.can('user.edit')) return fail('FORBIDDEN', '无编辑用户权限');
    if (!name.trim() || !roleLabel.trim()) return fail('VALIDATION_ERROR', '姓名和角色不能为空');
    const snapshot = await this.repository.read();
    const user = snapshot.users.find((item) => item.id === userId);
    if (!user || !this.inSchoolScope(user.schoolId)) return fail('NOT_FOUND', '用户不存在或不在授权范围');
    if (user.version !== expectedVersion) return fail('VERSION_CONFLICT', '用户信息已更新，请刷新后重试');
    user.name = name.trim();
    user.roleLabel = roleLabel.trim();
    user.version += 1;
    this.audit(snapshot, '编辑用户', user.name);
    await this.repository.replace(snapshot);
    return ok(structuredClone(user));
  }

  async disableUser(userId: string, expectedVersion: number): Promise<ServiceResult<UserAccount>> {
    if (!this.can('user.disable')) return fail('FORBIDDEN', '无停用用户权限');
    if (userId === this.session.actorId) return fail('SELF_LOCK_PROTECTED', '不能停用当前登录账号');
    const snapshot = await this.repository.read();
    const user = snapshot.users.find((item) => item.id === userId);
    if (!user || !this.inSchoolScope(user.schoolId)) return fail('NOT_FOUND', '用户不存在或不在授权范围');
    if (user.version !== expectedVersion) return fail('VERSION_CONFLICT', '用户信息已更新，请刷新后重试');
    user.status = 'disabled';
    user.version += 1;
    this.audit(snapshot, '停用用户', user.name);
    await this.repository.replace(snapshot);
    return ok(structuredClone(user));
  }

  async resetPassword(userId: string): Promise<ServiceResult<{ resetTicket: string }>> {
    if (!this.can('user.resetPassword')) return fail('FORBIDDEN', '无重置密码权限');
    const snapshot = await this.repository.read();
    const user = snapshot.users.find((item) => item.id === userId);
    if (!user || !this.inSchoolScope(user.schoolId)) return fail('NOT_FOUND', '用户不存在或不在授权范围');
    if (user.status !== 'active') return fail('USER_DISABLED', '已停用账号不能发起密码重置');
    const resetTicket = `RST-${Date.now().toString(36).toUpperCase()}`;
    this.audit(snapshot, '重置密码', user.name);
    await this.repository.replace(snapshot);
    return ok({ resetTicket });
  }

  async updateBindingCount(userId: string, delta: 1 | -1, expectedVersion: number): Promise<ServiceResult<UserAccount>> {
    if (!this.can('user.bind')) return fail('FORBIDDEN', '无绑定关系管理权限');
    const snapshot = await this.repository.read();
    const user = snapshot.users.find((item) => item.id === userId);
    if (!user || !this.inSchoolScope(user.schoolId)) return fail('NOT_FOUND', '用户不存在或不在授权范围');
    if (user.version !== expectedVersion) return fail('VERSION_CONFLICT', '用户信息已更新，请刷新后重试');
    const limit = user.kind === 'parent' ? 5 : user.kind === 'student' ? 3 : 0;
    if (limit === 0) return fail('INVALID_RELATION_TYPE', '该用户类型不支持家长孩子绑定');
    const next = user.bindingCount + delta;
    if (next < 0 || next > limit) return fail('BINDING_LIMIT', `绑定数量必须在 0—${limit} 之间`);
    user.bindingCount = next;
    user.version += 1;
    this.audit(snapshot, delta > 0 ? '新增绑定关系' : '解除绑定关系', user.name);
    await this.repository.replace(snapshot);
    return ok(structuredClone(user));
  }

  async updateRole(input: UpdateRoleInput): Promise<ServiceResult<RoleDefinition>> {
    if (!this.can('permission.manage')) return fail('FORBIDDEN', '无权限配置权限');
    if (input.schoolIds.length === 0) return fail('DATA_SCOPE_REQUIRED', '至少选择一个数据范围');
    if (!input.schoolIds.every((id) => this.inSchoolScope(id))) return fail('OUT_OF_SCOPE', '不能扩大到当前账号无权管理的学校');
    const snapshot = await this.repository.read();
    const role = snapshot.roles.find((item) => item.id === input.roleId);
    if (!role) return fail('NOT_FOUND', '角色不存在');
    if (role.version !== input.expectedVersion) return fail('VERSION_CONFLICT', '权限已被其他管理员更新，请刷新后重试');
    if (role.id === 'role-super-admin' && !input.permissions.includes('permission.manage')) {
      return fail('SELF_LOCK_PROTECTED', '不能移除当前超级管理员的必要权限');
    }
    role.permissions = [...new Set(input.permissions)];
    role.dataScope = input.dataScope;
    role.schoolIds = [...new Set(input.schoolIds)];
    role.version += 1;
    this.audit(snapshot, '发布权限配置', role.name);
    await this.repository.replace(snapshot);
    return ok(structuredClone(role));
  }

  private can(permission: PermissionKey): boolean {
    return this.session.permissions.includes(permission);
  }

  private inSchoolScope(schoolId: string): boolean {
    return this.session.schoolIds.includes(schoolId);
  }

  private kindLabel(kind: UserKind): string {
    return { student: '学生', parent: '家长', teacher: '教师', staff: '员工' }[kind];
  }

  private audit(snapshot: AdminSnapshot, action: string, target: string): void {
    snapshot.audits.unshift({
      id: `audit-${Date.now().toString(36)}-${snapshot.audits.length}`,
      actorId: this.session.actorId,
      action,
      target,
      createdAt: this.now(),
      result: 'success',
    });
  }
}
