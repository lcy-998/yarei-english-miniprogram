import { describe, expect, it } from 'vitest';
import { hasPermission, hasScope, hasUntrustedActorFields, isAllowedRole, type TrustedActorContext } from '../../src/auth/trusted-actor';

const actor: TrustedActorContext = { requestId: 'req_actor_test', sessionId: 'ses_test', actorUserId: 'usr_teacher_demo', actorRole: 'teacher', organizationId: 'org_demo', platformSubjectDigest: 'digest_demo', permissions: ['task.publish'], scopeIds: ['cls_grade3_2'], authzVersion: 1 };

describe('可信 actor 上下文', () => {
  it('只从可信上下文判断角色、权限和范围', () => {
    expect(isAllowedRole(actor, ['teacher', 'admin'])).toBe(true);
    expect(hasPermission(actor, 'task.publish')).toBe(true);
    expect(hasScope(actor, 'cls_grade3_2')).toBe(true);
    expect(hasPermission(actor, 'submission.review')).toBe(false);
  });

  it('标记 payload 中伪造的身份字段，供 action schema 明确拒绝', () => {
    expect(hasUntrustedActorFields({ actorUserId: 'usr_other', taskId: 'tsk_1' })).toBe(true);
    expect(hasUntrustedActorFields({ taskId: 'tsk_1' })).toBe(false);
  });
});
