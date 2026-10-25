import { createHmac } from 'node:crypto';
import type { ScfSynchronousInvocationPort } from '../pronunciation/long-inference-adapter';
import type { TeacherSuggestionInferenceInput, TeacherSuggestionInferenceOutput,
  TeacherSuggestionInferencePort } from './types';

/** Sends only service-projected facts to an HMAC-protected private SCF function. */
export class CloudBaseTeacherSuggestionInference implements TeacherSuggestionInferencePort {
  public constructor(private readonly scf: ScfSynchronousInvocationPort,
    private readonly secret: string, private readonly modelVersion: string,
    private readonly promptVersion: string, private readonly clock: { nowUnix(): number }) {}

  public async generate(input: TeacherSuggestionInferenceInput): Promise<TeacherSuggestionInferenceOutput> {
    if (this.secret.length < 32 || input.modelVersion !== this.modelVersion
      || input.promptVersion !== this.promptVersion || !/^[A-Za-z0-9_-]{8,128}$/.test(input.operationId)
      || input.facts.length < 1 || input.facts.length > 16
      || input.facts.some(fact => !/^[A-Za-z0-9_-]{1,64}$/.test(fact.id)
        || typeof fact.text !== 'string' || fact.text.length > 500)) {
      throw new Error('TEACHER_SUGGESTION_INPUT_INVALID');
    }
    const job = { operationId: input.operationId, modelVersion: input.modelVersion,
      promptVersion: input.promptVersion,
      facts: input.facts.map(fact => ({ id: fact.id, text: fact.text })) };
    const timestamp = this.clock.nowUnix();
    if (!Number.isSafeInteger(timestamp)) throw new Error('TEACHER_SUGGESTION_TIME_INVALID');
    const canonical = JSON.stringify(Object.fromEntries(Object.entries(job)
      .sort(([left], [right]) => left.localeCompare(right))));
    const signature = createHmac('sha256', this.secret).update(`${timestamp}\n${canonical}`).digest('hex');
    const result = await this.scf.invoke({ functionName: 'teacher-suggestion-inference-trial',
      event: { job, timestamp, signature }, timeoutMs: 180000 });
    const body = typeof result === 'string' && result.length <= 12000
      ? JSON.parse(result) as unknown : result;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('TEACHER_SUGGESTION_RESPONSE_INVALID');
    }
    const value = body as Record<string, unknown>;
    if (value.ok !== true || value.modelVersion !== this.modelVersion
      || value.promptVersion !== this.promptVersion
      || typeof value.text !== 'string' || !Array.isArray(value.citedFactIds)
      || value.citedFactIds.some(id => typeof id !== 'string')) {
      throw new Error('TEACHER_SUGGESTION_RESPONSE_REJECTED');
    }
    return { text: value.text, citedFactIds: value.citedFactIds as string[] };
  }
}
