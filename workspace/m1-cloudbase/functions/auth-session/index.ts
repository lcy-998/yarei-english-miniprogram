import { createUnconfiguredFunction } from '../shared/unconfigured-function';
import { parseExactObject } from '../../src/shared/strict-object';

const AUTH_ACTIONS = ['bootstrap', 'selectRole', 'getCurrentSession', 'logout'] as const;

export const main = createUnconfiguredFunction('auth-session', AUTH_ACTIONS, (action, payload) => {
  const exact = action === 'selectRole'
    ? parseExactObject(payload, ['role'])
    : parseExactObject(payload, []);
  if (!exact.ok) {
    return exact.fieldErrors;
  }
  if (action === 'selectRole') {
    const role = exact.value.role;
    if (role !== 'student' && role !== 'parent' && role !== 'teacher') {
      return { role: '角色必须是学生、家长或教师。' };
    }
  }
  return null;
});
