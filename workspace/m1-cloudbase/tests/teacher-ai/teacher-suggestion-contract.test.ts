import { describe, expect, it } from 'vitest';
import { validateTeacherSuggestionCommandRequest } from '../../src/contracts/teacher-suggestion-functions';

describe('teacher suggestion polling contract', () => {
  it('accepts an exact read request without a write operation ID', () => {
    expect(validateTeacherSuggestionCommandRequest({ apiVersion: 'm1.v1',
      action: 'getSuggestion', payload: { submissionId: 'submission_demo',
        generationOperationId: 'operation_demo_123' } })).toEqual({ ok: true,
      value: { action: 'getSuggestion', submissionId: 'submission_demo',
        generationOperationId: 'operation_demo_123' } });
  });

  it('allows authorized lookup of the suggestion generated after submission', () => {
    expect(validateTeacherSuggestionCommandRequest({ apiVersion: 'm1.v1',
      action: 'getAutomaticSuggestion', payload: { submissionId: 'submission_demo' } }))
      .toEqual({ ok: true, value: { action: 'getAutomaticSuggestion', submissionId: 'submission_demo' } });
    expect(validateTeacherSuggestionCommandRequest({ apiVersion: 'm1.v1',
      action: 'getAutomaticSuggestion', payload: { submissionId: 'submission_demo', teacherId: 'other' } }).ok)
      .toBe(false);
  });

  it('rejects client attempts to add write metadata or extra fields', () => {
    expect(validateTeacherSuggestionCommandRequest({ apiVersion: 'm1.v1',
      action: 'getSuggestion', operationId: 'operation_fake',
      payload: { submissionId: 'submission_demo', generationOperationId: 'operation_demo_123' } }).ok)
      .toBe(false);
    expect(validateTeacherSuggestionCommandRequest({ apiVersion: 'm1.v1',
      action: 'getSuggestion', payload: { submissionId: 'submission_demo',
        generationOperationId: 'operation_demo_123', actorUserId: 'teacher_other' } }).ok)
      .toBe(false);
  });
});
