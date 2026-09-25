import { describe, expect, it } from 'vitest'
import { publishErrorMessage } from '../../miniprogram/pages/teacher/publish-task/publish-error'

describe('教师发布任务错误提示', () => {
  it('优先展示后端给出的具体校验原因', () => {
    expect(publishErrorMessage({ code: 'VALIDATION_ERROR', message: '输入内容不符合要求，请检查后重试。', retryable: false, fieldErrors: { targetClassIds: '单次发布最多包含 500 名学生。' } })).toBe('单次发布最多包含 500 名学生。')
    expect(publishErrorMessage({ code: 'VALIDATION_ERROR', message: '输入内容不符合要求，请检查后重试。', retryable: false, fieldErrors: { 'itemRefs[0].resourceId': '资源标识格式无效。' } })).toBe('资源标识格式无效。')
  })

  it('没有字段错误时保留原错误提示', () => {
    expect(publishErrorMessage({ code: 'NETWORK_ERROR', message: '网络失败', retryable: true })).toBe('网络失败')
  })
})
