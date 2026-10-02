import type { FunctionRequest, JsonObject, JsonValue } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';
import type { SaveTaskDraftInput, SubmissionAnswer, UpdatePublishedTaskInput } from '../task-core/types';
import type { PageRequest, StudentTaskFilters } from '../task-query/types';

export const TASK_COMMAND_ACTIONS = ['saveDraft', 'copyTaskSnapshot', 'instantiateTemplate', 'publishTask', 'updatePublishedTask', 'withdrawTask', 'recycleTask'] as const;
export type TaskCommandAction = (typeof TASK_COMMAND_ACTIONS)[number];

export const SUBMISSION_COMMAND_ACTIONS = ['saveDraft', 'submit'] as const;
export type SubmissionCommandAction = (typeof SUBMISSION_COMMAND_ACTIONS)[number];

export const REVIEW_COMMAND_ACTIONS = ['publishReview', 'publishBatchComment'] as const;
export type ReviewCommandAction = (typeof REVIEW_COMMAND_ACTIONS)[number];

export const PARENT_QUERY_ACTIONS = ['listChildren', 'getHome', 'listChildTasks', 'getChildTask', 'getFeedback'] as const;
export type ParentQueryAction = (typeof PARENT_QUERY_ACTIONS)[number];

export type BoundaryValidation<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export type TaskCommandInput =
  | Readonly<{
      action: 'saveDraft';
      input: SaveTaskDraftInput;
      expectedVersion: number;
      operationId: string;
    }>
  | Readonly<{
      action: 'copyTaskSnapshot';
      sourceTaskId: string;
      expectedVersion: number;
      operationId: string;
    }>
  | Readonly<{
      action: 'instantiateTemplate';
      templateId: string;
      expectedVersion: number;
      operationId: string;
    }>
  | Readonly<{
      action: 'publishTask';
      taskId: string;
      expectedVersion: number;
      operationId: string;
    }>
  | Readonly<{
      action: 'updatePublishedTask';
      input: UpdatePublishedTaskInput;
      expectedVersion: number;
      operationId: string;
    }>
  | Readonly<{
      action: 'withdrawTask' | 'recycleTask';
      taskId: string;
      reason: string;
      expectedVersion: number;
      operationId: string;
    }>;

export type SubmissionCommandInput = Readonly<{
  action: SubmissionCommandAction;
  taskId: string;
  answers: readonly SubmissionAnswer[];
  expectedAssignmentVersion: number;
  expectedDraftRecordVersion: number | undefined;
  operationId: string;
}>;

export type ReviewCommandInput =
  | Readonly<{
      action: 'publishReview';
      input: Readonly<{
        submissionId: string;
        decision: 'approved' | 'returned';
        score?: number;
        itemScores?: readonly Readonly<{ itemId: string; score: number }>[];
        textComment?: string;
        returnReason?: string;
        overrideReason?: string;
        expectedSubmissionVersion: number;
      }>;
      expectedAssignmentVersion: number;
      operationId: string;
    }>
  | Readonly<{
      action: 'publishBatchComment';
      previewToken: string;
      previewVersion: number;
      textComment: string;
      operationId: string;
    }>;

export type ParentQueryInput =
  | Readonly<{ action: 'listChildren' }>
  | Readonly<{ action: 'getHome'; childId: string }>
  | Readonly<{ action: 'listChildTasks'; childId: string; filters: StudentTaskFilters; page: PageRequest }>
  | Readonly<{ action: 'getChildTask'; childId: string; taskId: string }>
  | Readonly<{ action: 'getFeedback'; childId: string; feedbackId: string }>;

export function validateTaskCommandRequest(
  request: FunctionRequest<TaskCommandAction, JsonObject>,
): BoundaryValidation<TaskCommandInput> {
  if (request.operationId === undefined) return invalid('operationId', '写操作必须提供操作标识。');
  if (request.action === 'copyTaskSnapshot') {
    const exact = parseExactObject(request.payload, ['sourceTaskId']);
    if (!exact.ok) return { ok: false, fieldErrors: exact.fieldErrors };
    const sourceTaskId = requiredId(exact.value.sourceTaskId, 'sourceTaskId');
    if (!sourceTaskId.ok) return sourceTaskId;
    if (request.expectedVersion === undefined) return invalid('expectedVersion', '再次布置必须提供原任务当前版本。');
    return { ok: true, value: { action: 'copyTaskSnapshot', sourceTaskId: sourceTaskId.value,
      expectedVersion: request.expectedVersion, operationId: request.operationId } };
  }
  if (request.action === 'instantiateTemplate') {
    const exact = parseExactObject(request.payload, ['templateId']);
    if (!exact.ok) return { ok: false, fieldErrors: exact.fieldErrors };
    const templateId = requiredId(exact.value.templateId, 'templateId');
    if (!templateId.ok) return templateId;
    if (request.expectedVersion === undefined) return invalid('expectedVersion', '模板布置必须提供模板当前版本。');
    return { ok: true, value: { action: 'instantiateTemplate', templateId: templateId.value,
      expectedVersion: request.expectedVersion, operationId: request.operationId } };
  }
  if (request.action === 'withdrawTask' || request.action === 'recycleTask') {
    const exact = parseExactObject(request.payload, ['taskId', 'reason']);
    if (!exact.ok) return { ok: false, fieldErrors: exact.fieldErrors };
    const taskId = requiredId(exact.value.taskId, 'taskId');
    if (!taskId.ok) return taskId;
    const reason = requiredString(exact.value.reason, 'reason');
    if (!reason.ok) return reason;
    if (request.expectedVersion === undefined) return invalid('expectedVersion', '任务生命周期操作必须提供当前版本。');
    return {
      ok: true,
      value: { action: request.action, taskId: taskId.value, reason: reason.value, expectedVersion: request.expectedVersion, operationId: request.operationId },
    };
  }
  if (request.action === 'updatePublishedTask') {
    const exact = parseExactObject(
      request.payload,
      ['taskId'],
      ['title', 'itemRefs', 'target', 'startsAt', 'dueAt', 'latePolicy', 'description', 'teacherNote'],
    );
    if (!exact.ok) return { ok: false, fieldErrors: exact.fieldErrors };
    const taskId = requiredId(exact.value.taskId, 'taskId');
    if (!taskId.ok) return taskId;
    if (request.expectedVersion === undefined) return invalid('expectedVersion', '更新已发布任务必须提供当前版本。');
    const title = optionalString(exact.value.title, 'title');
    if (!title.ok) return title;
    const itemRefs = exact.value.itemRefs === undefined
      ? { ok: true as const, value: undefined }
      : parseItemRefs(exact.value.itemRefs);
    if (!itemRefs.ok) return itemRefs;
    const target = exact.value.target === undefined
      ? { ok: true as const, value: undefined }
      : parseTaskTarget(exact.value.target);
    if (!target.ok) return target;
    const startsAt = optionalString(exact.value.startsAt, 'startsAt');
    if (!startsAt.ok) return startsAt;
    const dueAt = optionalString(exact.value.dueAt, 'dueAt');
    if (!dueAt.ok) return dueAt;
    const latePolicy = exact.value.latePolicy === undefined
      ? { ok: true as const, value: undefined }
      : parseLatePolicy(exact.value.latePolicy);
    if (!latePolicy.ok) return latePolicy;
    const description = optionalString(exact.value.description, 'description');
    if (!description.ok) return description;
    const teacherNote = optionalString(exact.value.teacherNote, 'teacherNote');
    if (!teacherNote.ok) return teacherNote;
    return {
      ok: true,
      value: {
        action: 'updatePublishedTask',
        input: {
          taskId: taskId.value,
          ...(title.value === undefined ? {} : { title: title.value }),
          ...(itemRefs.value === undefined ? {} : { itemRefs: itemRefs.value }),
          ...(target.value === undefined ? {} : {
            targetType: target.value.type,
            targetClassIds: target.value.classIds,
            targetStudentIds: target.value.studentIds,
          }),
          ...(startsAt.value === undefined ? {} : { startsAt: startsAt.value }),
          ...(dueAt.value === undefined ? {} : { dueAt: dueAt.value }),
          ...(latePolicy.value === undefined ? {} : { latePolicy: latePolicy.value }),
          ...(description.value === undefined ? {} : { description: description.value }),
          ...(teacherNote.value === undefined ? {} : { teacherNote: teacherNote.value }),
        },
        expectedVersion: request.expectedVersion,
        operationId: request.operationId,
      },
    };
  }
  if (request.action === 'publishTask') {
    const exact = parseExactObject(request.payload, ['taskId']);
    if (!exact.ok) return { ok: false, fieldErrors: exact.fieldErrors };
    const taskId = requiredId(exact.value.taskId, 'taskId');
    if (!taskId.ok) return taskId;
    if (request.expectedVersion === undefined) return invalid('expectedVersion', '发布任务必须提供当前版本。');
    return { ok: true, value: { action: 'publishTask', taskId: taskId.value, expectedVersion: request.expectedVersion, operationId: request.operationId } };
  }

  const exact = parseExactObject(
    request.payload,
    ['title', 'itemRefs', 'target', 'startsAt', 'dueAt', 'latePolicy'],
    ['taskId', 'description', 'teacherNote'],
  );
  if (!exact.ok) return { ok: false, fieldErrors: exact.fieldErrors };
  const taskId = optionalId(exact.value.taskId, 'taskId');
  if (!taskId.ok) return taskId;
  if (taskId.value === undefined && request.expectedVersion !== undefined) {
    return invalid('expectedVersion', '新建草稿不应提供版本号。');
  }
  if (taskId.value !== undefined && request.expectedVersion === undefined) {
    return invalid('expectedVersion', '更新草稿必须提供当前版本。');
  }
  const title = requiredString(exact.value.title, 'title');
  if (!title.ok) return title;
  const itemRefs = parseItemRefs(exact.value.itemRefs);
  if (!itemRefs.ok) return itemRefs;
  const target = parseTaskTarget(exact.value.target);
  if (!target.ok) return target;
  const startsAt = requiredString(exact.value.startsAt, 'startsAt');
  if (!startsAt.ok) return startsAt;
  const dueAt = requiredString(exact.value.dueAt, 'dueAt');
  if (!dueAt.ok) return dueAt;
  const latePolicy = parseLatePolicy(exact.value.latePolicy);
  if (!latePolicy.ok) return latePolicy;
  const description = optionalString(exact.value.description, 'description');
  if (!description.ok) return description;
  const teacherNote = optionalString(exact.value.teacherNote, 'teacherNote');
  if (!teacherNote.ok) return teacherNote;
  return {
    ok: true,
    value: {
      action: 'saveDraft',
      input: {
        ...(taskId.value === undefined ? {} : { taskId: taskId.value }),
        title: title.value,
        itemRefs: itemRefs.value,
        targetType: target.value.type,
        targetClassIds: target.value.classIds,
        targetStudentIds: target.value.studentIds,
        startsAt: startsAt.value,
        dueAt: dueAt.value,
        latePolicy: latePolicy.value,
        ...(description.value === undefined ? {} : { description: description.value }),
        ...(teacherNote.value === undefined ? {} : { teacherNote: teacherNote.value }),
      },
      expectedVersion: request.expectedVersion ?? 0,
      operationId: request.operationId,
    },
  };
}

export function validateSubmissionCommandRequest(
  request: FunctionRequest<SubmissionCommandAction, JsonObject>,
): BoundaryValidation<SubmissionCommandInput> {
  const optionalKeys = request.action === 'submit' ? ['draftSubmissionId', 'draftVersion'] : ['draftVersion'];
  const exact = parseExactObject(request.payload, ['taskId', 'answers'], optionalKeys);
  if (!exact.ok) return { ok: false, fieldErrors: exact.fieldErrors };
  if (request.operationId === undefined) return invalid('operationId', '写操作必须提供操作标识。');
  if (request.expectedVersion === undefined) return invalid('expectedVersion', '提交操作必须提供当前任务关系版本。');
  const taskId = requiredId(exact.value.taskId, 'taskId');
  if (!taskId.ok) return taskId;
  const answers = parseAnswers(exact.value.answers);
  if (!answers.ok) return answers;
  const draftVersion = optionalPositiveInteger(exact.value.draftVersion, 'draftVersion');
  if (!draftVersion.ok) return draftVersion;
  if (request.action === 'submit' && exact.value.draftSubmissionId !== undefined) {
    const draftSubmissionId = requiredId(exact.value.draftSubmissionId, 'draftSubmissionId');
    if (!draftSubmissionId.ok) return draftSubmissionId;
    return invalid('draftSubmissionId', '当前本地核心尚不支持按草稿标识提交。');
  }
  return {
    ok: true,
    value: {
      action: request.action,
      taskId: taskId.value,
      answers: answers.value,
      expectedAssignmentVersion: request.expectedVersion,
      expectedDraftRecordVersion: draftVersion.value,
      operationId: request.operationId,
    },
  };
}

export function validateReviewCommandRequest(
  request: FunctionRequest<ReviewCommandAction, JsonObject>,
): BoundaryValidation<ReviewCommandInput> {
  if (request.action === 'publishBatchComment') {
    const exact = parseExactObject(request.payload, ['previewToken', 'previewVersion', 'textComment']);
    if (!exact.ok) return { ok: false, fieldErrors: exact.fieldErrors };
    if (request.operationId === undefined) return invalid('operationId', '批量发布点评必须提供操作标识。');
    if (request.expectedVersion !== undefined) return invalid('expectedVersion', '批量发布点评的预览版本必须放在请求数据中。');
    const previewToken = requiredString(exact.value.previewToken, 'previewToken');
    if (!previewToken.ok) return previewToken;
    if (previewToken.value.length > 512) return invalid('previewToken', '批量点评预览令牌格式无效。');
    const previewVersion = requiredPositiveInteger(exact.value.previewVersion, 'previewVersion');
    if (!previewVersion.ok) return previewVersion;
    const textComment = requiredString(exact.value.textComment, 'textComment');
    if (!textComment.ok || textComment.value.trim().length === 0 || textComment.value.length > 300) {
      return invalid('textComment', '批量点评须为 1—300 字。');
    }
    return {
      ok: true,
      value: {
        action: 'publishBatchComment',
        previewToken: previewToken.value,
        previewVersion: previewVersion.value,
        textComment: textComment.value,
        operationId: request.operationId,
      },
    };
  }
  const exact = parseExactObject(
    request.payload,
    ['submissionId', 'decision', 'expectedSubmissionVersion'],
    ['score', 'itemScores', 'textComment', 'returnReason', 'overrideReason'],
  );
  if (!exact.ok) return { ok: false, fieldErrors: exact.fieldErrors };
  if (request.operationId === undefined) return invalid('operationId', '发布点评必须提供操作标识。');
  if (request.expectedVersion === undefined) return invalid('expectedVersion', '发布点评必须提供当前任务关系版本。');
  const submissionId = requiredId(exact.value.submissionId, 'submissionId');
  if (!submissionId.ok) return submissionId;
  if (exact.value.decision !== 'approved' && exact.value.decision !== 'returned') return invalid('decision', '点评决定无效。');
  const expectedSubmissionVersion = requiredPositiveInteger(exact.value.expectedSubmissionVersion, 'expectedSubmissionVersion');
  if (!expectedSubmissionVersion.ok) return expectedSubmissionVersion;
  const score = optionalFiniteNumber(exact.value.score, 'score');
  if (!score.ok) return score;
  const itemScores = exact.value.itemScores;
  if (itemScores !== undefined && (!Array.isArray(itemScores) || !itemScores.length
    || itemScores.some(item => {
      const entry = parseExactObject(item, ['itemId', 'score']);
      return !entry.ok || typeof entry.value.itemId !== 'string' || !entry.value.itemId.trim()
        || typeof entry.value.score !== 'number' || !Number.isFinite(entry.value.score)
        || entry.value.score < 0 || entry.value.score > 100;
    }) || new Set(itemScores.map(item => (item as { itemId: string }).itemId)).size !== itemScores.length)) {
    return invalid('itemScores', '逐项评分无效。');
  }
  const textComment = optionalString(exact.value.textComment, 'textComment');
  if (!textComment.ok) return textComment;
  const returnReason = optionalString(exact.value.returnReason, 'returnReason');
  if (!returnReason.ok) return returnReason;
  const overrideReason = optionalString(exact.value.overrideReason, 'overrideReason');
  if (!overrideReason.ok) return overrideReason;
  return {
    ok: true,
    value: {
      action: 'publishReview',
      input: {
        submissionId: submissionId.value,
        decision: exact.value.decision,
        expectedSubmissionVersion: expectedSubmissionVersion.value,
        ...(score.value === undefined ? {} : { score: score.value }),
        ...(itemScores === undefined ? {} : { itemScores: itemScores as Array<{ itemId: string; score: number }> }),
        ...(textComment.value === undefined ? {} : { textComment: textComment.value }),
        ...(returnReason.value === undefined ? {} : { returnReason: returnReason.value }),
        ...(overrideReason.value === undefined ? {} : { overrideReason: overrideReason.value }),
      },
      expectedAssignmentVersion: request.expectedVersion,
      operationId: request.operationId,
    },
  };
}

export function validateParentQueryRequest(
  request: FunctionRequest<ParentQueryAction, JsonObject>,
): BoundaryValidation<ParentQueryInput> {
  if (request.operationId !== undefined) return invalid('operationId', '查询操作不支持操作标识。');
  if (request.expectedVersion !== undefined) return invalid('expectedVersion', '查询操作不支持版本号。');
  if (request.action === 'listChildren') {
    const exact = parseExactObject(request.payload, []);
    return exact.ok ? { ok: true, value: { action: 'listChildren' } } : { ok: false, fieldErrors: exact.fieldErrors };
  }
  if (request.action === 'getHome') {
    const exact = parseExactObject(request.payload, ['childId']);
    if (!exact.ok) return { ok: false, fieldErrors: exact.fieldErrors };
    const childId = requiredId(exact.value.childId, 'childId');
    return childId.ok ? { ok: true, value: { action: 'getHome', childId: childId.value } } : childId;
  }
  if (request.action === 'listChildTasks') {
    const exact = parseExactObject(request.payload, ['childId', 'filters', 'page']);
    if (!exact.ok) return { ok: false, fieldErrors: exact.fieldErrors };
    const childId = requiredId(exact.value.childId, 'childId');
    if (!childId.ok) return childId;
    const filters = parseParentTaskFilters(exact.value.filters);
    if (!filters.ok) return filters;
    const page = parseParentPage(exact.value.page);
    if (!page.ok) return page;
    return { ok: true, value: { action: 'listChildTasks', childId: childId.value, filters: filters.value, page: page.value } };
  }
  if (request.action === 'getFeedback') {
    const exact = parseExactObject(request.payload, ['childId', 'feedbackId']);
    if (!exact.ok) return { ok: false, fieldErrors: exact.fieldErrors };
    const childId = requiredId(exact.value.childId, 'childId');
    if (!childId.ok) return childId;
    const feedbackId = requiredId(exact.value.feedbackId, 'feedbackId');
    return feedbackId.ok ? { ok: true, value: { action: 'getFeedback', childId: childId.value, feedbackId: feedbackId.value } } : feedbackId;
  }
  const exact = parseExactObject(request.payload, ['childId', 'taskId']);
  if (!exact.ok) return { ok: false, fieldErrors: exact.fieldErrors };
  const childId = requiredId(exact.value.childId, 'childId');
  if (!childId.ok) return childId;
  const taskId = requiredId(exact.value.taskId, 'taskId');
  if (!taskId.ok) return taskId;
  return { ok: true, value: { action: 'getChildTask', childId: childId.value, taskId: taskId.value } };
}

function parseParentTaskFilters(value: unknown): BoundaryValidation<StudentTaskFilters> {
  const exact = parseExactObject(value, [], ['status', 'keyword']);
  if (!exact.ok) return prefixErrors('filters', exact.fieldErrors);
  const statuses = ['not_started', 'in_progress', 'awaiting_review', 'completed', 'redo_required', 'overdue'] as const;
  if (exact.value.status !== undefined && !statuses.includes(exact.value.status as typeof statuses[number])) {
    return invalid('filters.status', '学生任务状态无效。');
  }
  const keyword = optionalString(exact.value.keyword, 'filters.keyword');
  if (!keyword.ok) return keyword;
  if ((keyword.value?.length ?? 0) > 50) return invalid('filters.keyword', '关键词最多 50 字。');
  return {
    ok: true,
    value: {
      ...(exact.value.status === undefined ? {} : { status: exact.value.status as typeof statuses[number] }),
      ...(keyword.value === undefined ? {} : { keyword: keyword.value }),
    },
  };
}

function parseParentPage(value: unknown): BoundaryValidation<PageRequest> {
  const exact = parseExactObject(value, ['limit'], ['cursor']);
  if (!exact.ok) return prefixErrors('page', exact.fieldErrors);
  if (typeof exact.value.limit !== 'number' || !Number.isInteger(exact.value.limit) || exact.value.limit < 1 || exact.value.limit > 100) {
    return invalid('page.limit', '分页大小必须是 1 到 100 的整数。');
  }
  const cursor = optionalString(exact.value.cursor, 'page.cursor');
  if (!cursor.ok) return cursor;
  if ((cursor.value?.length ?? 0) > 128) return invalid('page.cursor', '分页游标格式无效。');
  return { ok: true, value: { limit: exact.value.limit, ...(cursor.value === undefined ? {} : { cursor: cursor.value }) } };
}

export function parseItemRefs(value: unknown): BoundaryValidation<SaveTaskDraftInput['itemRefs']> {
  if (!Array.isArray(value)) return invalid('itemRefs', '任务内容必须是数组。');
  const result: SaveTaskDraftInput['itemRefs'][number][] = [];
  for (const [index, item] of value.entries()) {
    const exact = parseExactObject(item, ['id', 'resourceId', 'completionRule', 'scoringRule', 'order']);
    if (!exact.ok) return prefixErrors(`itemRefs[${index}]`, exact.fieldErrors);
    const id = requiredId(exact.value.id, `itemRefs[${index}].id`);
    if (!id.ok) return id;
    const resourceId = requiredId(exact.value.resourceId, `itemRefs[${index}].resourceId`);
    if (!resourceId.ok) return resourceId;
    const completionRule = parseJsonObject(exact.value.completionRule, `itemRefs[${index}].completionRule`);
    if (!completionRule.ok) return completionRule;
    const scoringRule = parseJsonObject(exact.value.scoringRule, `itemRefs[${index}].scoringRule`);
    if (!scoringRule.ok) return scoringRule;
    const order = requiredPositiveInteger(exact.value.order, `itemRefs[${index}].order`);
    if (!order.ok) return order;
    result.push({
      id: id.value,
      resourceId: resourceId.value,
      completionRule: completionRule.value,
      scoringRule: scoringRule.value,
      order: order.value,
    });
  }
  return { ok: true, value: result };
}

function parseTaskTarget(value: unknown): BoundaryValidation<Readonly<{
  type: 'classes' | 'students';
  classIds: readonly string[];
  studentIds: readonly string[];
}>> {
  const header = parseExactObject(value, ['type'], ['classIds', 'studentIds']);
  if (!header.ok) return prefixErrors('target', header.fieldErrors);
  if (header.value.type !== 'classes' && header.value.type !== 'students') return invalid('target.type', '布置对象类型无效。');
  const requiredKey = header.value.type === 'classes' ? 'classIds' : 'studentIds';
  const forbiddenKey = header.value.type === 'classes' ? 'studentIds' : 'classIds';
  if (header.value[forbiddenKey] !== undefined) return invalid(`target.${forbiddenKey}`, '布置对象不能同时包含班级和学员。');
  const ids = header.value[requiredKey];
  if (!Array.isArray(ids)) return invalid(`target.${requiredKey}`, '布置对象标识必须是数组。');
  const parsed: string[] = [];
  for (const [index, valueItem] of ids.entries()) {
    const id = requiredId(valueItem, `target.${requiredKey}[${index}]`);
    if (!id.ok) return id;
    if (parsed.includes(id.value)) return invalid(`target.${requiredKey}[${index}]`, '布置对象标识不能重复。');
    parsed.push(id.value);
  }
  return {
    ok: true,
    value: {
      type: header.value.type,
      classIds: header.value.type === 'classes' ? parsed : [],
      studentIds: header.value.type === 'students' ? parsed : [],
    },
  };
}

function parseLatePolicy(value: unknown): BoundaryValidation<SaveTaskDraftInput['latePolicy']> {
  const exact = parseExactObject(value, ['allowLate', 'lateDays']);
  if (!exact.ok) return prefixErrors('latePolicy', exact.fieldErrors);
  if (typeof exact.value.allowLate !== 'boolean') return invalid('latePolicy.allowLate', '补交开关必须是布尔值。');
  const lateDays = requiredPositiveInteger(exact.value.lateDays, 'latePolicy.lateDays');
  if (!lateDays.ok) return lateDays;
  return { ok: true, value: { allowLate: exact.value.allowLate, lateDays: lateDays.value } };
}

function parseAnswers(value: unknown): BoundaryValidation<readonly SubmissionAnswer[]> {
  if (!Array.isArray(value)) return invalid('answers', '作答内容必须是数组。');
  const answers: SubmissionAnswer[] = [];
  for (const [index, answer] of value.entries()) {
    const exact = parseExactObject(answer, ['itemId', 'value']);
    if (!exact.ok) return prefixErrors(`answers[${index}]`, exact.fieldErrors);
    const itemId = requiredId(exact.value.itemId, `answers[${index}].itemId`);
    if (!itemId.ok) return itemId;
    const answerValue = parseJsonValue(exact.value.value, `answers[${index}].value`);
    if (!answerValue.ok) return answerValue;
    answers.push({ itemId: itemId.value, value: answerValue.value });
  }
  return { ok: true, value: answers };
}

function requiredId(value: unknown, field: string): BoundaryValidation<string> {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) return invalid(field, '标识格式无效。');
  return { ok: true, value };
}

function optionalId(value: unknown, field: string): BoundaryValidation<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  return requiredId(value, field);
}

function requiredString(value: unknown, field: string): BoundaryValidation<string> {
  if (typeof value !== 'string') return invalid(field, '字段必须是字符串。');
  return { ok: true, value };
}

function optionalString(value: unknown, field: string): BoundaryValidation<string | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  return requiredString(value, field);
}

function requiredPositiveInteger(value: unknown, field: string): BoundaryValidation<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return invalid(field, '字段必须是正整数。');
  return { ok: true, value };
}

function optionalPositiveInteger(value: unknown, field: string): BoundaryValidation<number | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  return requiredPositiveInteger(value, field);
}

function optionalFiniteNumber(value: unknown, field: string): BoundaryValidation<number | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== 'number' || !Number.isFinite(value)) return invalid(field, '字段必须是有效数字。');
  return { ok: true, value };
}

function parseJsonObject(value: unknown, field: string): BoundaryValidation<JsonObject> {
  const parsed = parseJsonValue(value, field);
  if (!parsed.ok) return parsed;
  if (parsed.value === null || Array.isArray(parsed.value) || typeof parsed.value !== 'object') {
    return invalid(field, '字段必须是 JSON 对象。');
  }
  return { ok: true, value: parsed.value as JsonObject };
}

function parseJsonValue(value: unknown, field: string, ancestors: Set<object> = new Set()): BoundaryValidation<JsonValue> {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { ok: true, value } : invalid(field, '数字必须是有限值。');
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return invalid(field, 'JSON 值不能循环引用。');
    ancestors.add(value);
    const result: JsonValue[] = [];
    for (const [index, item] of value.entries()) {
      const parsed = parseJsonValue(item, `${field}[${index}]`, ancestors);
      if (!parsed.ok) return parsed;
      result.push(parsed.value);
    }
    ancestors.delete(value);
    return { ok: true, value: result };
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return invalid(field, '字段必须是普通 JSON 对象。');
    if (ancestors.has(value)) return invalid(field, 'JSON 值不能循环引用。');
    ancestors.add(value);
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const [key, item] of Object.entries(value)) {
      const parsed = parseJsonValue(item, `${field}.${key}`, ancestors);
      if (!parsed.ok) return parsed;
      result[key] = parsed.value;
    }
    ancestors.delete(value);
    return { ok: true, value: result };
  }
  return invalid(field, '字段必须是有效 JSON 值。');
}

function prefixErrors<T>(prefix: string, errors: Readonly<Record<string, string>>): BoundaryValidation<T> {
  return {
    ok: false,
    fieldErrors: Object.fromEntries(Object.entries(errors).map(([field, message]) => [field === 'payload' ? prefix : `${prefix}.${field}`, message])),
  };
}

function invalid<T>(field: string, message: string): BoundaryValidation<T> {
  return { ok: false, fieldErrors: { [field]: message } };
}
