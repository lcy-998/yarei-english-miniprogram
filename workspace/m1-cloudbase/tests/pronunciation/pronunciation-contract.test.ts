import { describe, expect, it } from 'vitest';
import { validatePronunciationCommandRequest,
  validatePronunciationQueryRequest } from '../../src/contracts/pronunciation-functions';
import { API_VERSION, type FunctionRequest, type JsonObject } from '../../src/shared/protocol';

describe('pronunciation wire boundary', () => {
  it('accepts only source IDs and a stable operation ID for a student recording', () => {
    const valid: FunctionRequest<'beginRecording', JsonObject> = {
      apiVersion: API_VERSION, action: 'beginRecording', operationId: 'begin_virtual_01',
      payload: { source: { kind: 'task', taskId: 'task_virtual_01',
        itemId: 'item_virtual_01', segmentId: 'segment_virtual_01' } },
    };
    expect(validatePronunciationCommandRequest(valid).ok).toBe(true);
    expect(validatePronunciationCommandRequest({ ...valid,
      payload: { ...valid.payload, studentId: 'student_virtual_02' } }).ok).toBe(false);
    expect(validatePronunciationCommandRequest({ ...valid,
      payload: { source: { ...valid.payload.source as JsonObject, referenceText: 'forged' } } }).ok).toBe(false);
    expect(validatePronunciationCommandRequest({ ...valid,
      payload: { source: { kind: 'reading', resourceId: 'book_virtual_01',
        segmentId: 'segment_virtual_01', score: 100 } } }).ok).toBe(false);
  });

  it('rejects client operation fields on read-only teacher evidence', () => {
    const valid: FunctionRequest<'getTeacherEvidence', JsonObject> = {
      apiVersion: API_VERSION, action: 'getTeacherEvidence', payload: {
        taskId: 'task_virtual_01', assignmentId: 'assignment_virtual_01',
        submissionVersion: 1, itemId: 'item_virtual_01', segmentId: 'segment_virtual_01',
      },
    };
    expect(validatePronunciationQueryRequest(valid).ok).toBe(true);
    expect(validatePronunciationQueryRequest({ ...valid, operationId: 'fake_virtual_01' }).ok).toBe(false);
    expect(validatePronunciationQueryRequest({ ...valid,
      payload: { ...valid.payload, organizationId: 'org_virtual_02' } }).ok).toBe(false);
  });
});
