import type { TrustedActorContext } from '../auth/trusted-actor';
import type { FrozenTeacherMediaSnapshot } from '../teacher-media/publish-gate';

export interface AssignedTaskMedia {
  readonly organizationId: string;
  readonly studentId: string;
  readonly assignmentId: string;
  readonly round: number;
  readonly taskId: string;
  readonly itemId: string;
  readonly writable: boolean;
  readonly snapshot: FrozenTeacherMediaSnapshot;
}

export interface TaskMediaSessionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly studentId: string;
  readonly assignmentId: string;
  readonly round: number;
  readonly taskId: string;
  readonly itemId: string;
  readonly mediaId: string;
  readonly mediaVersion: number;
  readonly confirmedThroughMs: number;
  readonly createdAt: string;
  readonly lastHeartbeatAt: string;
  readonly expiresAt: string;
  readonly version: number;
}

export interface TaskMediaPlaybackPort {
  /** Must resolve current student assignment and its immutable published task snapshot. */
  findAssignedMedia(actor: TrustedActorContext, taskId: string, itemId: string): Promise<AssignedTaskMedia | null>;
  findLatestSession(organizationId: string, studentId: string, taskId: string,
    itemId: string): Promise<TaskMediaSessionRecord | null>;
  findSession(sessionId: string): Promise<TaskMediaSessionRecord | null>;
  /** Idempotent by actor and operation key; concurrent calls must not create two sessions. */
  createSession(record: TaskMediaSessionRecord, operationId: string): Promise<TaskMediaSessionRecord>;
  /** CAS update and idempotent heartbeat receipt. */
  advanceSession(record: TaskMediaSessionRecord, expectedVersion: number,
    operationId: string, fingerprint: string): Promise<TaskMediaSessionRecord | null>;
  findHeartbeatReceipt(sessionId: string, operationId: string,
    fingerprint: string): Promise<TaskMediaSessionRecord | 'conflict' | null>;
  signPlayback(assetKey: string, ttlSeconds: 60): Promise<Readonly<{ temporaryUrl: string; expiresAt: string }> | null>;
  nextSessionId(): string;
}

export interface TaskMediaPlaybackView {
  readonly status: 'ready' | 'processing' | 'unavailable' | 'expired';
  readonly mediaId: string;
  readonly mediaVersion: number;
  readonly sessionId: string | null;
  readonly temporaryUrl: string | null;
  readonly expiresAt: string | null;
  readonly confirmedThroughMs: number;
  readonly seekForwardAllowed: false;
  readonly reason?: string;
}

export interface TaskMediaHeartbeatView {
  readonly sessionId: string;
  readonly confirmedThroughMs: number;
  readonly completed: boolean;
}

export type TaskMediaResult<T> = Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CONFLICT'
    | 'SEEK_FORWARD' | 'PLAYBACK_TOO_FAST' | 'SESSION_EXPIRED' | 'SERVICE_UNAVAILABLE' }>;

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SPEED = 2;
const HEARTBEAT_SLACK_MS = 1500;

/** Local trusted business boundary; no client-supplied progress or media ID is accepted. */
export class TaskMediaPlaybackService {
  public constructor(private readonly port: TaskMediaPlaybackPort,
    private readonly clock: Readonly<{ nowIso(): string }>) {}

  public async begin(actor: TrustedActorContext, taskId: string, itemId: string,
    operationId: string): Promise<TaskMediaResult<TaskMediaPlaybackView>> {
    if (!validId(taskId) || !validId(itemId) || !validId(operationId)) return fail('VALIDATION_ERROR');
    const assigned = await this.assigned(actor, taskId, itemId);
    if (!assigned) return fail('FORBIDDEN');
    const previous = await this.port.findLatestSession(actor.organizationId, actor.actorUserId, taskId, itemId);
    if (!assigned.writable) {
      return previous && this.matches(previous, assigned) ? this.project(assigned, previous)
        : fail('FORBIDDEN');
    }
    const now = this.clock.nowIso();
    const session = previous && this.matches(previous, assigned) && Date.parse(previous.expiresAt) > Date.parse(now)
      ? previous : await this.port.createSession({
        id: this.port.nextSessionId(), organizationId: actor.organizationId,
        studentId: actor.actorUserId, assignmentId: assigned.assignmentId,
        round: assigned.round,
        taskId, itemId, mediaId: assigned.snapshot.mediaId,
        mediaVersion: assigned.snapshot.mediaVersion,
        confirmedThroughMs: previous && this.matches(previous, assigned) ? previous.confirmedThroughMs : 0,
        createdAt: now, lastHeartbeatAt: now,
        expiresAt: new Date(Date.parse(now) + SESSION_TTL_MS).toISOString(), version: 1,
      }, operationId);
    if (!this.matches(session, assigned)) return fail('CONFLICT');
    return this.project(assigned, session);
  }

  public async get(actor: TrustedActorContext, taskId: string,
    itemId: string): Promise<TaskMediaResult<TaskMediaPlaybackView>> {
    if (!validId(taskId) || !validId(itemId)) return fail('VALIDATION_ERROR');
    const assigned = await this.assigned(actor, taskId, itemId);
    if (!assigned) return fail('FORBIDDEN');
    const session = await this.port.findLatestSession(actor.organizationId, actor.actorUserId, taskId, itemId);
    if (!session || !this.matches(session, assigned)) return { ok: true, data: {
      status: 'unavailable', mediaId: assigned.snapshot.mediaId,
      mediaVersion: assigned.snapshot.mediaVersion, sessionId: null,
      temporaryUrl: null, expiresAt: null, confirmedThroughMs: 0,
      seekForwardAllowed: false, reason: 'SESSION_NOT_STARTED',
    } };
    return this.project(assigned, session);
  }

  public async heartbeat(actor: TrustedActorContext, input: Readonly<{ sessionId: string;
    playedFromMs: number; playedToMs: number; positionMs: number; operationId: string }>): Promise<TaskMediaResult<TaskMediaHeartbeatView>> {
    if (!validId(input.sessionId) || !validId(input.operationId)
      || ![input.playedFromMs, input.playedToMs, input.positionMs].every(value => Number.isSafeInteger(value) && value >= 0)
      || input.playedFromMs >= input.playedToMs) return fail('VALIDATION_ERROR');
    if (actor.actorRole !== 'student') return fail('FORBIDDEN');
    const session = await this.port.findSession(input.sessionId);
    if (!session || session.organizationId !== actor.organizationId || session.studentId !== actor.actorUserId) {
      return fail('FORBIDDEN');
    }
    const assigned = await this.assigned(actor, session.taskId, session.itemId);
    if (!assigned || !assigned.writable || !this.matches(session, assigned)) return fail('FORBIDDEN');
    const fingerprint = JSON.stringify([input.playedFromMs, input.playedToMs, input.positionMs]);
    const old = await this.port.findHeartbeatReceipt(input.sessionId, input.operationId, fingerprint);
    if (old === 'conflict') return fail('CONFLICT');
    if (old) return { ok: true, data: this.heartbeatView(old, assigned.snapshot) };
    const now = this.clock.nowIso();
    if (Date.parse(session.expiresAt) <= Date.parse(now)) return fail('SESSION_EXPIRED');
    if (input.playedToMs > assigned.snapshot.durationMs || input.positionMs > assigned.snapshot.durationMs) {
      return fail('VALIDATION_ERROR');
    }
    if (input.playedFromMs > session.confirmedThroughMs) return fail('SEEK_FORWARD');
    const elapsedMs = Date.parse(now) - Date.parse(session.lastHeartbeatAt);
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return fail('CONFLICT');
    const newCoverageMs = Math.max(0, input.playedToMs - session.confirmedThroughMs);
    if (newCoverageMs > elapsedMs * MAX_SPEED + HEARTBEAT_SLACK_MS) return fail('PLAYBACK_TOO_FAST');
    const advanced = await this.port.advanceSession({ ...session,
      confirmedThroughMs: Math.max(session.confirmedThroughMs, input.playedToMs),
      lastHeartbeatAt: now, version: session.version + 1,
    }, session.version, input.operationId, fingerprint);
    return advanced && this.matches(advanced, assigned)
      ? { ok: true, data: this.heartbeatView(advanced, assigned.snapshot) } : fail('CONFLICT');
  }

  private async assigned(actor: TrustedActorContext, taskId: string, itemId: string): Promise<AssignedTaskMedia | null> {
    if (actor.actorRole !== 'student') return null;
    const row = await this.port.findAssignedMedia(actor, taskId, itemId);
    return row && row.organizationId === actor.organizationId && row.studentId === actor.actorUserId
      && row.taskId === taskId && row.itemId === itemId
      && row.snapshot.continuousPlaybackEnforced === true ? row : null;
  }

  private matches(session: TaskMediaSessionRecord, assigned: AssignedTaskMedia): boolean {
    return session.organizationId === assigned.organizationId && session.studentId === assigned.studentId
      && session.assignmentId === assigned.assignmentId && session.round === assigned.round
      && session.taskId === assigned.taskId
      && session.itemId === assigned.itemId && session.mediaId === assigned.snapshot.mediaId
      && session.mediaVersion === assigned.snapshot.mediaVersion;
  }

  private async project(assigned: AssignedTaskMedia,
    session: TaskMediaSessionRecord): Promise<TaskMediaResult<TaskMediaPlaybackView>> {
    if (Date.parse(session.expiresAt) <= Date.parse(this.clock.nowIso())) return { ok: true, data: {
      status: 'expired', mediaId: assigned.snapshot.mediaId,
      mediaVersion: assigned.snapshot.mediaVersion, sessionId: null,
      temporaryUrl: null, expiresAt: null, confirmedThroughMs: session.confirmedThroughMs,
      seekForwardAllowed: false, reason: 'SESSION_EXPIRED',
    } };
    const signed = await this.port.signPlayback(assigned.snapshot.mediaAssetKey, 60);
    if (!signed || !/^https:\/\//.test(signed.temporaryUrl)
      || Date.parse(signed.expiresAt) <= Date.parse(this.clock.nowIso())) return fail('SERVICE_UNAVAILABLE');
    return { ok: true, data: { status: 'ready', mediaId: assigned.snapshot.mediaId,
      mediaVersion: assigned.snapshot.mediaVersion, sessionId: session.id,
      temporaryUrl: signed.temporaryUrl, expiresAt: signed.expiresAt,
      confirmedThroughMs: session.confirmedThroughMs, seekForwardAllowed: false } };
  }

  private heartbeatView(session: TaskMediaSessionRecord,
    snapshot: FrozenTeacherMediaSnapshot): TaskMediaHeartbeatView {
    return { sessionId: session.id, confirmedThroughMs: session.confirmedThroughMs,
      completed: session.confirmedThroughMs >= (snapshot.kind === 'video'
        ? Math.ceil(snapshot.durationMs * 0.9) : snapshot.durationMs) };
  }
}

function validId(value: string): boolean { return /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function fail<T>(code: Extract<TaskMediaResult<T>, { ok: false }>['code']): TaskMediaResult<T> {
  return { ok: false, code };
}
