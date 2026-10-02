import type { FunctionRequest, JsonObject } from '../shared/protocol';
import { parseExactObject } from '../shared/strict-object';

type Validation<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export const STUDENT_WORK_COMMAND_ACTIONS = ['beginDraft', 'submitWork', 'deleteDraft'] as const;
export const STUDENT_WORK_QUERY_ACTIONS = ['listMaterials', 'searchMaterials', 'listMaterialFacets', 'getMaterial', 'listMine', 'getPlayback', 'getMaterialPlayback'] as const;
export type StudentWorkCommandAction = (typeof STUDENT_WORK_COMMAND_ACTIONS)[number];
export type StudentWorkQueryAction = (typeof STUDENT_WORK_QUERY_ACTIONS)[number];
export type StudentWorkCommandInput = Readonly<{ action: 'beginDraft'; materialId: string; operationId: string }>
  | Readonly<{ action: 'submitWork'; workId: string; stagingFileId: string; note: string;
    expectedVersion: number; operationId: string }>
  | Readonly<{ action: 'deleteDraft'; workId: string; expectedVersion: number; operationId: string }>;
export type StudentWorkQueryInput = Readonly<{ action: 'listMaterials' | 'listMaterialFacets' | 'listMine' }>
  | Readonly<{ action: 'searchMaterials'; keyword: string; offset: number; limit: number;
    grade?: string; textbook?: string; unit?: string }>
  | Readonly<{ action: 'getMaterial'; materialId: string }>
  | Readonly<{ action: 'getPlayback'; workId: string }>
  | Readonly<{ action: 'getMaterialPlayback'; materialId: string }>;

function invalid<T>(field: string, message: string): Validation<T> {
  return { ok: false, fieldErrors: { [field]: message } };
}
function id(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value.length <= 128; }

export function validateStudentWorkCommandRequest(
  request: FunctionRequest<StudentWorkCommandAction, JsonObject>,
): Validation<StudentWorkCommandInput> {
  if (request.operationId === undefined) return invalid('operationId', '作品写入必须提供操作标识。');
  if (request.action === 'beginDraft') {
    if (request.expectedVersion !== 0) return invalid('expectedVersion', '新作品版本必须为零。');
    const exact = parseExactObject(request.payload, ['materialId']);
    if (!exact.ok) return exact;
    if (!id(exact.value.materialId)) return invalid('materialId', '配音素材标识无效。');
    return { ok: true, value: { action: 'beginDraft', materialId: exact.value.materialId,
      operationId: request.operationId } };
  }
  if (request.expectedVersion === undefined || !Number.isSafeInteger(request.expectedVersion)
    || request.expectedVersion < 1) return invalid('expectedVersion', '作品版本无效。');
  if (request.action === 'deleteDraft') {
    const exactDelete = parseExactObject(request.payload, ['workId']);
    if (!exactDelete.ok) return exactDelete;
    return id(exactDelete.value.workId)
      ? { ok: true, value: { action: 'deleteDraft', workId: exactDelete.value.workId,
        expectedVersion: request.expectedVersion, operationId: request.operationId } }
      : invalid('workId', '作品标识无效。');
  }
  const exact = parseExactObject(request.payload, ['workId', 'stagingFileId', 'note']);
  if (!exact.ok) return exact;
  if (!id(exact.value.workId) || typeof exact.value.stagingFileId !== 'string'
    || !exact.value.stagingFileId.startsWith('cloud://') || exact.value.stagingFileId.length > 600
    || typeof exact.value.note !== 'string' || exact.value.note.length > 200) {
    return invalid('workId', '作品、录音或备注无效。');
  }
  return { ok: true, value: { action: 'submitWork', workId: exact.value.workId,
    stagingFileId: exact.value.stagingFileId, note: exact.value.note,
    expectedVersion: request.expectedVersion, operationId: request.operationId } };
}

export function validateStudentWorkQueryRequest(
  request: FunctionRequest<StudentWorkQueryAction, JsonObject>,
): Validation<StudentWorkQueryInput> {
  if (request.operationId !== undefined) return invalid('operationId', '查询不接受写操作标识。');
  if (request.expectedVersion !== undefined) return invalid('expectedVersion', '查询不接受写操作版本。');
  if (request.action === 'getPlayback') {
    const exactPlayback = parseExactObject(request.payload, ['workId']);
    if (!exactPlayback.ok) return exactPlayback;
    return id(exactPlayback.value.workId)
      ? { ok: true, value: { action: 'getPlayback', workId: exactPlayback.value.workId } }
      : invalid('workId', '作品标识无效。');
  }
  if (request.action === 'getMaterialPlayback') {
    const exactMaterial = parseExactObject(request.payload, ['materialId']);
    if (!exactMaterial.ok) return exactMaterial;
    return id(exactMaterial.value.materialId)
      ? { ok: true, value: { action: 'getMaterialPlayback', materialId: exactMaterial.value.materialId } }
      : invalid('materialId', '配音素材标识无效。');
  }
  if (request.action === 'getMaterial') {
    const exactMaterial = parseExactObject(request.payload, ['materialId']);
    if (!exactMaterial.ok) return exactMaterial;
    return id(exactMaterial.value.materialId)
      ? { ok: true, value: { action: 'getMaterial', materialId: exactMaterial.value.materialId } }
      : invalid('materialId', '配音素材标识无效。');
  }
  if (request.action === 'searchMaterials') {
    const exactSearch = parseExactObject(request.payload, ['keyword', 'offset', 'limit'], ['grade', 'textbook', 'unit']);
    if (!exactSearch.ok) return exactSearch;
    const { keyword, offset, limit, grade, textbook, unit } = exactSearch.value;
    if (typeof keyword !== 'string' || keyword.length > 80
      || !Number.isSafeInteger(offset) || (offset as number) < 0
      || !Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 50
      || [grade, textbook, unit].some(value => value !== undefined
        && (typeof value !== 'string' || !value.trim() || value.length > 80))) {
      return invalid('page', '配音素材筛选或分页参数无效。');
    }
    return { ok: true, value: { action: 'searchMaterials', keyword, offset: offset as number, limit: limit as number,
      ...(grade === undefined ? {} : { grade: grade as string }),
      ...(textbook === undefined ? {} : { textbook: textbook as string }),
      ...(unit === undefined ? {} : { unit: unit as string }) } };
  }
  const exact = parseExactObject(request.payload, []);
  return exact.ok ? { ok: true, value: { action: request.action } } : exact;
}
