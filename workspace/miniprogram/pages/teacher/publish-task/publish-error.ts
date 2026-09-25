import { ServiceError } from '../../../domain/types'

const FIELD_ORDER = [
  'title', 'itemRefs', 'target', 'targetClassIds', 'targetStudentIds',
  'startsAt', 'dueAt', 'latePolicy', 'description', 'teacherNote',
] as const

export function publishErrorMessage(error: ServiceError): string {
  const fields = error.fieldErrors
  if (!fields) return error.message
  for (const field of FIELD_ORDER) {
    const message = fields[field] ?? Object.entries(fields).find(([key]) => key.startsWith(`${field}.`) || key.startsWith(`${field}[`))?.[1]
    if (message) return message
  }
  return Object.values(fields)[0] ?? error.message
}
