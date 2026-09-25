import { TeacherStudentListItem } from '../domain/types'

const IMPORT_HEADERS = ['student_number', 'display_name', 'mobile', 'class_id'] as const
const EXPORT_HEADERS = ['student_number', 'display_name', 'class_id', 'class_name', 'account_status', 'assigned_count', 'completed_count', 'overdue_count', 'redo_count', 'completion_rate', 'average_score'] as const
const MAX_IMPORT_BYTES = 1024 * 1024
const MAX_IMPORT_ROWS = 500

export interface ImportIssue { lineNumber: number; field: string; code: string; message: string }
export interface ImportPreview { blocked: boolean; totalRowCount: number; readyRowCount: number; rejectedRowCount: number; errors: ImportIssue[] }
interface CsvRecord { lineNumber: number; fields: string[] }

function issue(lineNumber: number, field: string, code: string, message: string): ImportIssue { return { lineNumber, field, code, message } }
function blocked(error: ImportIssue): ImportPreview { return { blocked: true, totalRowCount: 0, readyRowCount: 0, rejectedRowCount: 0, errors: [error] } }

export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  const parts: string[] = []
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i]!
    if (first <= 0x7f) { parts.push(String.fromCharCode(first)); i += 1; continue }
    const width = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0
    if (!width || i + width > bytes.length) return null
    let point = first & (width === 2 ? 0x1f : width === 3 ? 0x0f : 0x07)
    for (let offset = 1; offset < width; offset++) {
      const next = bytes[i + offset]!
      if (next < 0x80 || next > 0xbf) return null
      point = (point << 6) | (next & 0x3f)
    }
    if ((width === 2 && point < 0x80) || (width === 3 && point < 0x800) || (width === 4 && point < 0x10000)
      || (point >= 0xd800 && point <= 0xdfff) || point > 0x10ffff) return null
    parts.push(String.fromCodePoint(point))
    i += width
  }
  return parts.join('')
}

function parseCsv(text: string): { records: CsvRecord[]; errorLine: 0 } | { records: null; errorLine: number } {
  const records: CsvRecord[] = []
  let fields: string[] = []
  let field = ''
  let inQuotes = false
  let afterQuote = false
  let lineNumber = 1
  let recordLineNumber = 1
  let touched = false
  const finishRecord = () => {
    fields.push(field)
    records.push({ lineNumber: recordLineNumber, fields })
    fields = []
    field = ''
    touched = false
  }
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index++ } else { inQuotes = false; afterQuote = true }
      } else if (character === '\r' || character === '\n') {
        field += '\n'
        if (character === '\r' && text[index + 1] === '\n') index++
        lineNumber++
      } else field += character
      continue
    }
    if (afterQuote && character !== ',' && character !== '\r' && character !== '\n') return { records: null, errorLine: lineNumber }
    if (character === ',') { fields.push(field); field = ''; afterQuote = false; touched = true; continue }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index++
      finishRecord()
      lineNumber++
      recordLineNumber = lineNumber
      afterQuote = false
      continue
    }
    if (character === '"') {
      if (field.length !== 0 || afterQuote) return { records: null, errorLine: lineNumber }
      inQuotes = true
      touched = true
      continue
    }
    field += character
    touched = true
  }
  if (inQuotes) return { records: null, errorLine: recordLineNumber }
  if (touched || field.length || fields.length) finishRecord()
  return { records, errorLine: 0 }
}

function normalized(value: string): string { return value.trim().toLowerCase() }
function hasFormula(value: string): boolean { return /^[\s]*[=+@-]/.test(value) }

export function previewTeacherStudentCsv(bytes: Uint8Array, allowedClassIds: readonly string[], existingStudentNumbers: readonly string[] = []): ImportPreview {
  if (bytes.byteLength > MAX_IMPORT_BYTES) return blocked(issue(1, 'file', 'FILE_TOO_LARGE', '导入文件超过 1 MB 上限。'))
  const decoded = decodeUtf8Strict(bytes)
  if (decoded === null) return blocked(issue(1, 'file', 'INVALID_UTF8', '导入文件必须使用有效 UTF-8 编码。'))
  const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded
  if (text.includes('\0')) return blocked(issue(1, 'file', 'INVALID_CSV', '文件包含不支持的控制字符。'))
  const parsed = parseCsv(text)
  if (parsed.records === null) return blocked(issue(parsed.errorLine, 'row', 'INVALID_CSV', 'CSV 引号或分隔符格式无效。'))
  const [header, ...records] = parsed.records
  if (!header || header.fields.length !== IMPORT_HEADERS.length || header.fields.some((value, index) => value !== IMPORT_HEADERS[index])) {
    return blocked(issue(header?.lineNumber ?? 1, 'file', 'INVALID_HEADER', 'CSV 表头或列顺序与模板不一致。'))
  }
  if (records.length > MAX_IMPORT_ROWS) return { ...blocked(issue(records[MAX_IMPORT_ROWS]?.lineNumber ?? 502, 'file', 'ROW_LIMIT_EXCEEDED', '单次导入最多 500 行。')), totalRowCount: records.length, rejectedRowCount: records.length }
  if (!records.length) return { blocked: false, totalRowCount: 0, readyRowCount: 0, rejectedRowCount: 0, errors: [issue(2, 'row', 'EMPTY_IMPORT', '模板中没有数据行。')] }

  const allowed = new Set(allowedClassIds)
  const existing = new Set(existingStudentNumbers.map(normalized))
  const candidates: Array<{ lineNumber: number; studentNumber: string; mobile: string }> = []
  const errors: ImportIssue[] = []
  for (const record of records) {
    if (record.fields.length !== 4) { errors.push(issue(record.lineNumber, 'row', 'COLUMN_COUNT_MISMATCH', '每行必须包含 4 列。')); continue }
    const [numberRaw, nameRaw, mobileRaw, classRaw] = record.fields as [string, string, string, string]
    const studentNumber = numberRaw.trim()
    const displayName = nameRaw.trim()
    const mobile = mobileRaw.trim()
    const classId = classRaw.trim()
    for (let index = 0; index < 4; index++) {
      const field = IMPORT_HEADERS[index]!
      if (hasFormula(record.fields[index]!)) errors.push(issue(record.lineNumber, field, 'FORMULA_INJECTION', '字段不能以公式字符开头。'))
      if (!record.fields[index]!.trim()) errors.push(issue(record.lineNumber, field, 'REQUIRED_FIELD', '该字段为必填项。'))
    }
    if (studentNumber.length > 64 || (studentNumber && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(studentNumber))) errors.push(issue(record.lineNumber, 'student_number', 'INVALID_STUDENT_NUMBER', '学生编号格式无效。'))
    if (displayName.length > 50 || /[\x00-\x1f\x7f]/.test(displayName)) errors.push(issue(record.lineNumber, 'display_name', 'INVALID_DISPLAY_NAME', '姓名长度或字符无效。'))
    if (mobile && !/^1[3-9]\d{9}$/.test(mobile)) errors.push(issue(record.lineNumber, 'mobile', 'INVALID_MOBILE', '手机号格式无效。'))
    if (classId.length > 128 || (classId && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(classId))) errors.push(issue(record.lineNumber, 'class_id', 'INVALID_CLASS_ID', '班级标识格式无效。'))
    else if (classId && !allowed.has(classId)) errors.push(issue(record.lineNumber, 'class_id', 'CLASS_NOT_ALLOWED', '班级不在当前授权范围。'))
    candidates.push({ lineNumber: record.lineNumber, studentNumber: normalized(studentNumber), mobile })
  }
  const numbers = new Map<string, number>()
  const mobiles = new Map<string, number>()
  for (const row of candidates) { if (row.studentNumber) numbers.set(row.studentNumber, (numbers.get(row.studentNumber) ?? 0) + 1); if (row.mobile) mobiles.set(row.mobile, (mobiles.get(row.mobile) ?? 0) + 1) }
  for (const row of candidates) {
    if (row.studentNumber && (existing.has(row.studentNumber) || (numbers.get(row.studentNumber) ?? 0) > 1)) errors.push(issue(row.lineNumber, 'student_number', 'DUPLICATE_STUDENT_NUMBER', '学生编号已存在或在文件内重复。'))
    if (row.mobile && (mobiles.get(row.mobile) ?? 0) > 1) errors.push(issue(row.lineNumber, 'mobile', 'DUPLICATE_MOBILE', '手机号在文件内重复。'))
  }
  const rejected = new Set(errors.map(error => error.lineNumber))
  return { blocked: false, totalRowCount: records.length, readyRowCount: records.length - rejected.size, rejectedRowCount: rejected.size, errors: errors.sort((a, b) => a.lineNumber - b.lineNumber || a.field.localeCompare(b.field)) }
}

function csvCell(value: string): string { const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value; return `"${safe.replace(/"/g, '""')}"` }
export function createTeacherStudentImportTemplate(): string { return `\uFEFF${IMPORT_HEADERS.join(',')}\r\n` }
export function createTeacherStudentErrorCsv(errors: readonly ImportIssue[]): string {
  return `\uFEFFline_number,field,code,message\r\n${errors.map(item => [String(item.lineNumber), item.field, item.code, item.message].map(csvCell).join(',')).join('\r\n')}`
}
export function exportTeacherStudentsCsv(items: readonly TeacherStudentListItem[]): string {
  const lines = [EXPORT_HEADERS.join(','), ...items.map(item => [
    item.studentNumber, item.displayName, item.classInfo.id, item.classInfo.name, item.accountStatus,
    String(item.performance.assignedCount), String(item.performance.completedCount), String(item.performance.overdueCount),
    String(item.performance.redoCount), String(item.performance.completionRate), item.performance.averageScore === null ? '' : String(item.performance.averageScore),
  ].map(csvCell).join(','))]
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
