import { describe, expect, it } from 'vitest'
import { dubbingRecordingIssue } from '../../miniprogram/shared/dubbing-recording-validation'

describe('配音录音校验提示', () => {
  it('区分无效文件、时长不足、超时和过大的文件', () => {
    expect(dubbingRecordingIssue(2000, 0, 'wxfile://empty.mp3')).toContain('文件无效')
    expect(dubbingRecordingIssue(2000, 1000, '')).toContain('文件无效')
    expect(dubbingRecordingIssue(500, 1000, 'wxfile://short.mp3')).toContain('不足 1 秒')
    expect(dubbingRecordingIssue(300001, 1000, 'wxfile://long.mp3')).toContain('超过 5 分钟')
    expect(dubbingRecordingIssue(2000, 20 * 1024 * 1024 + 1, 'wxfile://large.mp3')).toContain('超过 20 MB')
    expect(dubbingRecordingIssue(2000, 1000, 'wxfile://valid.mp3')).toBe('')
  })
})
