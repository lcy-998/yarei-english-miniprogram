import type { TrustedActorContext } from '../auth/trusted-actor';
import type { ErrorCode, JsonValue } from '../shared/protocol';
import type { Clock, IdentifierGenerator, OperationLogRepository } from '../runtime/ports';

export class OperationAudit {
  public constructor(
    private readonly logs: OperationLogRepository,
    private readonly clock: Clock,
    private readonly ids: IdentifierGenerator,
  ) {}

  public async write(input: Readonly<{
    actor: TrustedActorContext | null;
    requestId: string;
    action: string;
    targetType: string;
    targetId: string | null;
    result: 'succeeded' | 'denied' | 'failed';
    errorCode?: ErrorCode;
    metadata?: Readonly<Record<string, JsonValue>>;
  }>): Promise<void> {
    await this.logs.append({
      id: this.ids.next('log'),
      organizationId: input.actor?.organizationId ?? 'org_unresolved',
      requestId: input.requestId,
      actorUserId: input.actor?.actorUserId ?? null,
      actorRole: input.actor?.actorRole ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      result: input.result,
      errorCode: input.errorCode ?? null,
      occurredAt: this.clock.nowIso(),
      metadata: input.metadata ?? {},
    });
  }
}
