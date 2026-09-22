import type { TeacherStudentFilters, TeacherStudentListItem } from './types';

interface CsvBuffer extends Uint8Array {
  toString(): string;
  toString(encoding: 'utf8'): string;
}

interface CsvBufferFactory {
  from(value: string, encoding: 'utf8'): CsvBuffer;
  from(value: Uint8Array): CsvBuffer;
}

declare const Buffer: CsvBufferFactory;

export const TEACHER_STUDENT_IMPORT_HEADERS = [
  'student_number',
  'display_name',
  'mobile',
  'class_id',
] as const;

export const TEACHER_STUDENT_EXPORT_HEADERS = [
  'student_number',
  'display_name',
  'class_id',
  'class_name',
  'account_status',
  'assigned_count',
  'completed_count',
  'overdue_count',
  'redo_count',
  'completion_rate',
  'average_score',
] as const;

export const MAX_TEACHER_STUDENT_IMPORT_BYTES = 1024 * 1024;
export const MAX_TEACHER_STUDENT_IMPORT_ROWS = 500;
export const MAX_TEACHER_STUDENT_EXPORT_ROWS = 100_000;

export type TeacherStudentImportField =
  | (typeof TEACHER_STUDENT_IMPORT_HEADERS)[number]
  | 'file'
  | 'row';

export type TeacherStudentImportErrorCode =
  | 'INVALID_UTF8'
  | 'FILE_TOO_LARGE'
  | 'INVALID_CSV'
  | 'INVALID_HEADER'
  | 'ROW_LIMIT_EXCEEDED'
  | 'EMPTY_IMPORT'
  | 'COLUMN_COUNT_MISMATCH'
  | 'REQUIRED_FIELD'
  | 'FIELD_TOO_LONG'
  | 'UNSAFE_CONTROL_CHARACTER'
  | 'INVALID_STUDENT_NUMBER'
  | 'INVALID_MOBILE'
  | 'INVALID_CLASS_ID'
  | 'FORMULA_INJECTION'
  | 'DUPLICATE_STUDENT_NUMBER'
  | 'DUPLICATE_MOBILE'
  | 'CLASS_NOT_ALLOWED';

export interface TeacherStudentImportError {
  readonly lineNumber: number;
  readonly field: TeacherStudentImportField;
  readonly code: TeacherStudentImportErrorCode;
  readonly message: string;
}

/**
 * A validated local command candidate. This is deliberately not an account or
 * database command: the raw mobile may only be handed to a separately reviewed
 * CloudBase Auth account-creation workflow and must never be logged or stored in
 * the business user document.
 */
export interface TeacherStudentImportCommandPlanRow {
  readonly sourceLineNumber: number;
  readonly studentNumber: string;
  readonly displayName: string;
  readonly mobile: string;
  readonly classId: string;
}

export interface TeacherStudentImportPlan {
  readonly blocked: boolean;
  readonly totalRowCount: number;
  readonly readyRowCount: number;
  readonly rejectedRowCount: number;
  readonly commands: readonly TeacherStudentImportCommandPlanRow[];
  readonly errors: readonly TeacherStudentImportError[];
}

export interface TeacherStudentImportPlanningContext {
  readonly allowedClassIds: readonly string[];
  readonly existingStudentNumbers?: readonly string[];
  readonly existingMobiles?: readonly string[];
}

export type TeacherStudentExportResult =
  | Readonly<{
      ok: true;
      bytes: Uint8Array;
      rowCount: number;
      mimeType: 'text/csv;charset=utf-8';
    }>
  | Readonly<{
      ok: false;
      code: 'ROW_LIMIT_EXCEEDED';
      message: string;
    }>;

interface ParsedCsvRecord {
  readonly lineNumber: number;
  readonly fields: readonly string[];
}

type CsvParseResult =
  | Readonly<{ ok: true; records: readonly ParsedCsvRecord[] }>
  | Readonly<{ ok: false; lineNumber: number }>;

interface CandidateRow extends TeacherStudentImportCommandPlanRow {
  readonly normalizedStudentNumber: string;
}

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

export function createTeacherStudentImportTemplate(): Uint8Array {
  return encodeCsvWithBom(`${TEACHER_STUDENT_IMPORT_HEADERS.join(',')}\r\n`);
}

export function planTeacherStudentCsvImport(
  bytes: Uint8Array,
  context: TeacherStudentImportPlanningContext,
): TeacherStudentImportPlan {
  if (bytes.byteLength > MAX_TEACHER_STUDENT_IMPORT_BYTES) {
    return blockedPlan(error(1, 'file', 'FILE_TOO_LARGE', '导入文件超过 1 MB 上限。'));
  }

  let text: string;
  const decoded = Buffer.from(bytes).toString('utf8');
  if (!sameBytes(Buffer.from(decoded, 'utf8'), bytes)) {
    return blockedPlan(error(1, 'file', 'INVALID_UTF8', '导入文件必须是有效 UTF-8 编码。'));
  }
  text = decoded;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes('\0')) {
    return blockedPlan(error(1, 'file', 'INVALID_CSV', '导入文件包含不支持的控制字符。'));
  }

  const parsed = parseCsv(text);
  if (!parsed.ok) {
    return blockedPlan(error(parsed.lineNumber, 'row', 'INVALID_CSV', 'CSV 引号或分隔符格式无效。'));
  }
  const [header, ...records] = parsed.records;
  if (header === undefined || !sameHeader(header.fields, TEACHER_STUDENT_IMPORT_HEADERS)) {
    return blockedPlan(error(header?.lineNumber ?? 1, 'file', 'INVALID_HEADER', 'CSV 表头或列顺序与固定模板不一致。'));
  }
  if (records.length > MAX_TEACHER_STUDENT_IMPORT_ROWS) {
    return {
      ...blockedPlan(error(
        records[MAX_TEACHER_STUDENT_IMPORT_ROWS]?.lineNumber ?? MAX_TEACHER_STUDENT_IMPORT_ROWS + 2,
        'file',
        'ROW_LIMIT_EXCEEDED',
        `单次导入最多 ${MAX_TEACHER_STUDENT_IMPORT_ROWS} 行。`,
      )),
      totalRowCount: records.length,
      rejectedRowCount: records.length,
    };
  }
  if (records.length === 0) {
    return {
      blocked: false,
      totalRowCount: 0,
      readyRowCount: 0,
      rejectedRowCount: 0,
      commands: [],
      errors: [error(2, 'row', 'EMPTY_IMPORT', '模板中没有可导入的数据行。')],
    };
  }

  const allowedClassIds = new Set(context.allowedClassIds);
  const existingStudentNumbers = new Set(
    (context.existingStudentNumbers ?? []).map(normalizeStudentNumber),
  );
  const existingMobiles = new Set((context.existingMobiles ?? []).map((value) => value.trim()));
  const candidates: CandidateRow[] = [];
  const errors: TeacherStudentImportError[] = [];

  for (const record of records) {
    if (record.fields.length !== TEACHER_STUDENT_IMPORT_HEADERS.length) {
      errors.push(error(
        record.lineNumber,
        'row',
        'COLUMN_COUNT_MISMATCH',
        `每行必须包含 ${TEACHER_STUDENT_IMPORT_HEADERS.length} 列。`,
      ));
      continue;
    }
    const [rawStudentNumber, rawDisplayName, rawMobile, rawClassId] = record.fields;
    if (rawStudentNumber === undefined || rawDisplayName === undefined
      || rawMobile === undefined || rawClassId === undefined) continue;
    const values = {
      student_number: rawStudentNumber.trim(),
      display_name: rawDisplayName.trim(),
      mobile: rawMobile.trim(),
      class_id: rawClassId.trim(),
    } as const;

    for (const field of TEACHER_STUDENT_IMPORT_HEADERS) {
      const raw = record.fields[TEACHER_STUDENT_IMPORT_HEADERS.indexOf(field)] ?? '';
      if (isSpreadsheetFormula(raw)) {
        errors.push(error(record.lineNumber, field, 'FORMULA_INJECTION', '字段不能以电子表格公式字符开头。'));
      }
      if (values[field].length === 0) {
        errors.push(error(record.lineNumber, field, 'REQUIRED_FIELD', '该字段为必填项。'));
      }
    }

    if (values.student_number.length > 64) {
      errors.push(error(record.lineNumber, 'student_number', 'FIELD_TOO_LONG', '学生编号最多 64 个字符。'));
    } else if (values.student_number.length > 0
      && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(values.student_number)) {
      errors.push(error(record.lineNumber, 'student_number', 'INVALID_STUDENT_NUMBER', '学生编号格式无效。'));
    }
    if (values.display_name.length > 50) {
      errors.push(error(record.lineNumber, 'display_name', 'FIELD_TOO_LONG', '姓名最多 50 个字符。'));
    } else if (hasUnsafeControlCharacter(values.display_name)) {
      errors.push(error(
        record.lineNumber,
        'display_name',
        'UNSAFE_CONTROL_CHARACTER',
        '姓名包含不支持的控制字符。',
      ));
    }
    if (values.mobile.length > 0 && !/^1[3-9]\d{9}$/.test(values.mobile)) {
      errors.push(error(record.lineNumber, 'mobile', 'INVALID_MOBILE', '手机号格式无效。'));
    }
    if (values.class_id.length > 128) {
      errors.push(error(record.lineNumber, 'class_id', 'FIELD_TOO_LONG', '班级标识最多 128 个字符。'));
    } else if (values.class_id.length > 0 && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(values.class_id)) {
      errors.push(error(record.lineNumber, 'class_id', 'INVALID_CLASS_ID', '班级标识格式无效。'));
    } else if (values.class_id.length > 0 && !allowedClassIds.has(values.class_id)) {
      errors.push(error(record.lineNumber, 'class_id', 'CLASS_NOT_ALLOWED', '班级不在当前允许范围内。'));
    }

    candidates.push({
      sourceLineNumber: record.lineNumber,
      studentNumber: values.student_number,
      normalizedStudentNumber: normalizeStudentNumber(values.student_number),
      displayName: values.display_name,
      mobile: values.mobile,
      classId: values.class_id,
    });
  }

  const numberLines = groupLines(candidates, (candidate) => candidate.normalizedStudentNumber);
  const mobileLines = groupLines(candidates, (candidate) => candidate.mobile);
  for (const candidate of candidates) {
    if (candidate.normalizedStudentNumber.length > 0
      && (existingStudentNumbers.has(candidate.normalizedStudentNumber)
        || (numberLines.get(candidate.normalizedStudentNumber)?.length ?? 0) > 1)) {
      errors.push(error(
        candidate.sourceLineNumber,
        'student_number',
        'DUPLICATE_STUDENT_NUMBER',
        '学生编号已存在或在文件内重复。',
      ));
    }
    if (candidate.mobile.length > 0
      && (existingMobiles.has(candidate.mobile) || (mobileLines.get(candidate.mobile)?.length ?? 0) > 1)) {
      errors.push(error(candidate.sourceLineNumber, 'mobile', 'DUPLICATE_MOBILE', '手机号已存在或在文件内重复。'));
    }
  }

  const rejectedLines = new Set(errors.map((entry) => entry.lineNumber));
  const commands = candidates
    .filter((candidate) => !rejectedLines.has(candidate.sourceLineNumber))
    .map(({ normalizedStudentNumber: _normalizedStudentNumber, ...command }) => command);
  return {
    blocked: false,
    totalRowCount: records.length,
    readyRowCount: commands.length,
    rejectedRowCount: records.length - commands.length,
    commands,
    errors: sortErrors(errors),
  };
}

export function createTeacherStudentImportErrorCsv(
  errors: readonly TeacherStudentImportError[],
): Uint8Array {
  const rows = errors.map((entry) => [
    String(entry.lineNumber),
    entry.field,
    entry.code,
    entry.message,
  ]);
  return encodeCsvWithBom(toCsv(['line_number', 'field', 'code', 'message'], rows));
}

export function exportTeacherStudentsCsv(
  items: readonly TeacherStudentListItem[],
  filters: TeacherStudentFilters,
): TeacherStudentExportResult {
  const keyword = filters.keyword?.trim().toLocaleLowerCase();
  const selected = items.filter((item) => {
    if (filters.classId !== undefined && item.classInfo.id !== filters.classId) return false;
    if (keyword !== undefined && keyword.length > 0
      && !item.displayName.toLocaleLowerCase().includes(keyword)
      && !item.studentNumber.toLocaleLowerCase().includes(keyword)) return false;
    return matchesStatus(item, filters.status);
  });
  if (selected.length > MAX_TEACHER_STUDENT_EXPORT_ROWS) {
    return {
      ok: false,
      code: 'ROW_LIMIT_EXCEEDED',
      message: `单次导出最多 ${MAX_TEACHER_STUDENT_EXPORT_ROWS} 行。`,
    };
  }

  const rows = selected.map((item) => [
    item.studentNumber,
    item.displayName,
    item.classInfo.id,
    item.classInfo.name,
    item.accountStatus,
    String(item.performance.assignedCount),
    String(item.performance.completedCount),
    String(item.performance.overdueCount),
    String(item.performance.redoCount),
    String(item.performance.completionRate),
    item.performance.averageScore === null ? '' : String(item.performance.averageScore),
  ]);
  return {
    ok: true,
    bytes: encodeCsvWithBom(toCsv(TEACHER_STUDENT_EXPORT_HEADERS, rows)),
    rowCount: rows.length,
    mimeType: 'text/csv;charset=utf-8',
  };
}

function parseCsv(text: string): CsvParseResult {
  const records: ParsedCsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let lineNumber = 1;
  let recordLineNumber = 1;
  let inQuotes = false;
  let afterClosingQuote = false;

  const finishField = (): void => {
    fields.push(field);
    field = '';
    afterClosingQuote = false;
  };
  const finishRecord = (): void => {
    finishField();
    records.push({ lineNumber: recordLineNumber, fields });
    fields = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === undefined) continue;
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterClosingQuote = true;
        }
      } else if (character === '\r' || character === '\n') {
        if (character === '\r' && text[index + 1] === '\n') index += 1;
        field += '\n';
        lineNumber += 1;
      } else {
        field += character;
      }
      continue;
    }

    if (afterClosingQuote && character !== ',' && character !== '\r' && character !== '\n') {
      return { ok: false, lineNumber };
    }
    if (character === '"') {
      if (field.length > 0) return { ok: false, lineNumber };
      inQuotes = true;
      continue;
    }
    if (character === ',') {
      finishField();
      continue;
    }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      finishRecord();
      lineNumber += 1;
      recordLineNumber = lineNumber;
      continue;
    }
    field += character;
  }

  if (inQuotes) return { ok: false, lineNumber: recordLineNumber };
  if (field.length > 0 || fields.length > 0 || afterClosingQuote) finishRecord();
  return { ok: true, records };
}

function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return `${headers.join(',')}\r\n${rows.map((row) => row.map(encodeCsvCell).join(',')).join('\r\n')}${rows.length > 0 ? '\r\n' : ''}`;
}

function encodeCsvCell(value: string): string {
  const protectedValue = isSpreadsheetFormula(value) ? `'${value}` : value;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

function encodeCsvWithBom(value: string): Uint8Array {
  const body = Buffer.from(value, 'utf8');
  const output = new Uint8Array(UTF8_BOM.length + body.length);
  output.set(UTF8_BOM);
  output.set(body, UTF8_BOM.length);
  return output;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameHeader(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function normalizeStudentNumber(value: string): string {
  return value.trim().toLocaleUpperCase('en-US');
}

function isSpreadsheetFormula(value: string): boolean {
  return /^[\u0009\u000a\u000d\u0020]*[=+\-@]/.test(value);
}

function hasUnsafeControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function groupLines(
  candidates: readonly CandidateRow[],
  select: (candidate: CandidateRow) => string,
): ReadonlyMap<string, readonly number[]> {
  const groups = new Map<string, number[]>();
  for (const candidate of candidates) {
    const key = select(candidate);
    if (key.length === 0) continue;
    const lines = groups.get(key) ?? [];
    lines.push(candidate.sourceLineNumber);
    groups.set(key, lines);
  }
  return groups;
}

function matchesStatus(item: TeacherStudentListItem, status: TeacherStudentFilters['status']): boolean {
  if (status === 'all') return true;
  if (status === 'attention') return item.accountStatus === 'active' && item.needsAttention;
  if (status === 'normal') return item.accountStatus === 'active' && !item.needsAttention;
  return item.accountStatus === 'disabled';
}

function blockedPlan(...errors: readonly TeacherStudentImportError[]): TeacherStudentImportPlan {
  return {
    blocked: true,
    totalRowCount: 0,
    readyRowCount: 0,
    rejectedRowCount: 0,
    commands: [],
    errors,
  };
}

function error(
  lineNumber: number,
  field: TeacherStudentImportField,
  code: TeacherStudentImportErrorCode,
  message: string,
): TeacherStudentImportError {
  return { lineNumber, field, code, message };
}

function sortErrors(errors: readonly TeacherStudentImportError[]): readonly TeacherStudentImportError[] {
  return [...errors].sort((left, right) => left.lineNumber - right.lineNumber
    || TEACHER_STUDENT_IMPORT_HEADERS.indexOf(left.field as (typeof TEACHER_STUDENT_IMPORT_HEADERS)[number])
      - TEACHER_STUDENT_IMPORT_HEADERS.indexOf(right.field as (typeof TEACHER_STUDENT_IMPORT_HEADERS)[number])
    || left.code.localeCompare(right.code));
}
