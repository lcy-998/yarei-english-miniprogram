import type { IdentityRepository } from '../runtime/ports';
import type { TaskQueryRepository } from '../task-query/repository';
import type { TrustedActorContext } from '../auth/trusted-actor';
import type { TeacherSuggestionService } from './service';
import { automaticSuggestionOperationId, signAutomaticSuggestionJob,
  verifyAutomaticSuggestionJob, type AutomaticSuggestionJob,
  type SignedAutomaticSuggestionJob } from './automatic-job';

export interface AutomaticSuggestionTransport {
  invokeTeacherSuggestionEvent(event: SignedAutomaticSuggestionJob): Promise<void>;
}

export class AutomaticSuggestionDispatcher {
  public constructor(private readonly transport: AutomaticSuggestionTransport,
    private readonly secret: string, private readonly clock: { nowUnix(): number }) {}

  public async dispatch(job: AutomaticSuggestionJob): Promise<void> {
    await this.transport.invokeTeacherSuggestionEvent(signAutomaticSuggestionJob(
      job, this.secret, this.clock.nowUnix()));
  }
}

/** The signed worker fetches current teacher rights and the submitted task afresh. */
export class AutomaticSuggestionWorker {
  public constructor(private readonly identities: IdentityRepository,
    private readonly tasks: TaskQueryRepository, private readonly suggestions: TeacherSuggestionService,
    private readonly secret: string, private readonly clock: { nowUnix(): number }) {}

  public async run(event: unknown): Promise<Readonly<{ ok: boolean; status: string }>> {
    const job = verifyAutomaticSuggestionJob(event, this.secret, this.clock.nowUnix());
    if (!job) return { ok: false, status: 'forbidden' };
    const submission = await this.tasks.findSubmission(job.organizationId, job.submissionId);
    if (!submission || submission.status !== 'submitted' || !submission.submittedAt) {
      return { ok: false, status: 'stale_submission' };
    }
    const task = await this.tasks.findTask(job.organizationId, submission.taskId);
    const teacherId = task?.creatorTeacherId;
    if (!teacherId) return { ok: false, status: 'task_unavailable' };
    const [user, organization, roles] = await Promise.all([
      this.identities.findUser(teacherId, job.organizationId),
      this.identities.findOrganization(job.organizationId),
      this.identities.listActiveRoles(teacherId, job.organizationId),
    ]);
    const role = roles.find(item => item.role === 'teacher' && item.status === 'active'
      && item.permissions.includes('submission.review'));
    if (!user || user.status !== 'active' || !organization || organization.status !== 'active' || !role) {
      return { ok: false, status: 'teacher_unavailable' };
    }
    const actor: TrustedActorContext = {
      requestId: automaticSuggestionOperationId(job), sessionId: 'server-worker',
      actorUserId: teacherId, actorRole: 'teacher', organizationId: job.organizationId,
      platformSubjectDigest: 'server-worker', permissions: role.permissions, scopeIds: role.scopeIds,
      authzVersion: user.authorizationVersion,
    };
    const result = await this.suggestions.generate(actor, job.submissionId,
      automaticSuggestionOperationId(job));
    return result.ok ? { ok: true, status: 'generated' } : { ok: false, status: result.code };
  }
}
