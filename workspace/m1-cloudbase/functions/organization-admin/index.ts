import { createUnconfiguredFunction } from '../shared/unconfigured-function';

export const main = createUnconfiguredFunction('organization-admin', ['listClasses', 'createClass', 'updateClass', 'disableClass', 'listUsers', 'createUser', 'disableUser', 'assignRole', 'revokeRole', 'grantTeacherClass', 'revokeTeacherClass'] as const);
