import { describe, expect, it, vi } from 'vitest';
import { automaticSuggestionOperationId, signAutomaticSuggestionJob,
  verifyAutomaticSuggestionJob } from '../../src/teacher-ai/automatic-job';
import { AutomaticSuggestionDispatcher, AutomaticSuggestionWorker } from '../../src/teacher-ai/automatic-worker';
import type { IdentityRepository } from '../../src/runtime/ports';
import type { TaskQueryRepository } from '../../src/task-query/repository';
import type { TeacherSuggestionService } from '../../src/teacher-ai/service';

const secret = 'fictional-worker-secret-with-at-least-32-chars';
const job = { organizationId: 'org_demo', submissionId: 'submission_demo' };
const time = 1_760_000_000;

describe('automatic teacher suggestion worker', () => {
  it('dispatches an authenticated Event and rejects modified or old jobs', async () => {
    const invokeTeacherSuggestionEvent = vi.fn(async () => undefined);
    await new AutomaticSuggestionDispatcher({ invokeTeacherSuggestionEvent }, secret,
      { nowUnix: () => time }).dispatch(job);
    const event = invokeTeacherSuggestionEvent.mock.calls[0]?.[0];
    expect(event).toEqual(signAutomaticSuggestionJob(job, secret, time));
    expect(verifyAutomaticSuggestionJob(event, secret, time)).toEqual(job);
    expect(verifyAutomaticSuggestionJob({ ...event, job: { ...job, submissionId: 'other' } }, secret, time))
      .toBeNull();
    expect(verifyAutomaticSuggestionJob(event, secret, time + 61)).toBeNull();
  });

  it('uses current teacher rights and a deterministic operation per submitted version', async () => {
    let active = true;
    const identities = {
      async findUser() { return { status: active ? 'active' : 'disabled', authorizationVersion: 2 }; },
      async findOrganization() { return { status: 'active' }; },
      async listActiveRoles() { return [{ role: 'teacher', status: 'active',
        permissions: ['submission.review'], scopeIds: ['class_demo'] }]; },
    } as unknown as IdentityRepository;
    const tasks = {
      async findSubmission() { return { status: 'submitted', submittedAt: '2026-10-11T08:00:00+08:00',
        taskId: 'task_demo' }; },
      async findTask() { return { creatorTeacherId: 'teacher_demo' }; },
    } as unknown as TaskQueryRepository;
    const generate = vi.fn(async () => ({ ok: true as const, value: { status: 'trial' as const } }));
    const worker = new AutomaticSuggestionWorker(identities, tasks,
      { generate } as unknown as TeacherSuggestionService, secret, { nowUnix: () => time });
    const event = signAutomaticSuggestionJob(job, secret, time);
    expect(await worker.run(event)).toEqual({ ok: true, status: 'generated' });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'teacher_demo',
      actorRole: 'teacher', organizationId: job.organizationId }), job.submissionId,
      automaticSuggestionOperationId(job));
    active = false;
    expect(await worker.run(event)).toEqual({ ok: false, status: 'teacher_unavailable' });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
