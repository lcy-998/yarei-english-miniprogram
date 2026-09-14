import { createUnconfiguredFunction } from '../shared/unconfigured-function';

export const main = createUnconfiguredFunction('relationship-command', ['issueBindingCode', 'bindChild', 'unbindChild'] as const);
