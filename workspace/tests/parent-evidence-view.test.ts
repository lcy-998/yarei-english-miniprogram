import { describe, expect, it } from 'vitest'
import { parentEvidenceRows, parentSubmittedRecordingItems,
  parentSubmittedTaskMediaItems } from '../miniprogram/subpackages/parent/task-detail/parent-evidence-view'
import { parentSafeMemoryAnswer } from '../miniprogram/subpackages/parent/services/parent-safe-answer'

describe('G-03 家长提交证据只读展示', () => {
  it('只展示服务端核对摘要，不把录音私有标识或阅读内部证据写入页面', () => {
    const rows = parentEvidenceRows([
      { taskItemId: 'reading_demo', value: JSON.stringify({ kind: 'reading', completedPageCount: 2,
        verifiedPageEvents: [{ privateToken: 'secret_page_proof' }] }) },
      { taskItemId: 'recording_demo', value: JSON.stringify({ kind: 'recording', durationMs: 1400,
        mediaExpired: true, recordingId: 'private_recording_demo', fileId: 'cloud://private/file' }) },
      { taskItemId: 'media_demo', value: JSON.stringify({ kind: 'video', mediaId: 'private_media_demo' }) },
    ], [{ itemId: 'reading_demo', title: '虚构绘本' }, { itemId: 'recording_demo', title: '朗读录音' }])
    expect(rows[0].title).toBe('虚构绘本')
    expect(rows[1].title).toBe('朗读录音')
    expect(rows.map(item => item.summary)).toEqual(['已核对 2 页', '录音时长 2 秒', '视频观看记录未提供'])
    expect(rows[1].note).toContain('已过保留期')
    expect(JSON.stringify(rows)).not.toMatch(/secret_page_proof|private_recording_demo|cloud:\/\/private|private_media_demo/)
  })

  it('M0 回退仓库也剥离录音标识、文件地址和服务端内部字段', () => {
    const answer = parentSafeMemoryAnswer({ taskItemId: 'recording_demo',
      value: JSON.stringify({ kind: 'recording', recordingId: 'private_recording',
        fileId: 'cloud://private/audio', durationMs: 1200 }),
      structuredValue: { kind: 'recording', recordingId: 'private_recording' } },
    [{ id: 'recording_demo', title: '虚构录音', type: 'recording', completionRule: 'recording_upload' }])
    expect(JSON.parse(answer.value)).toEqual({ kind: 'recording', durationMs: 1200 })
    expect(JSON.stringify(answer)).not.toMatch(/private_recording|cloud:\/\/private/)
    expect(parentSubmittedRecordingItems([answer], [
      { itemId: 'recording_demo', title: '虚构录音', type: 'recording' },
      { itemId: 'reading_demo', title: '虚构绘本', type: 'reading' },
    ])).toEqual([{ itemId: 'recording_demo', title: '虚构录音' }])
  })

  it('正式听力、视频和任务配音只显示本人结果，不显示会话或作品私有 ID', () => {
    const rows = parentEvidenceRows([
      { taskItemId: 'listen', value: JSON.stringify({ kind: 'listening', playedSegmentCount: 1,
        requiredSegmentCount: 1, answeredQuestionCount: 1, questions: [{ questionId: 'q1',
          stem: 'Which animal?', response: 'cat', isCorrect: true }], mediaSessionId: 'private_session' }) },
      { taskItemId: 'video', value: JSON.stringify({ kind: 'video', verifiedPlayedMs: 9000,
        durationMs: 10000, answeredQuestionCount: 0, questions: [], mediaId: 'private_media' }) },
      { taskItemId: 'dubbing', value: JSON.stringify({ kind: 'dubbing', submitted: true,
        durationMs: 2300, finalWorkId: 'private_work' }) },
    ], [{ itemId: 'listen', title: '虚构听力' }, { itemId: 'video', title: '虚构视频' },
      { itemId: 'dubbing', title: '虚构配音' }])
    expect(rows.map(item => item.summary)).toEqual(['已核对 1/1 段音频', '有效观看 90%', '最终配音作品已提交'])
    expect(rows[0].questions).toEqual([{ key: 'q1|0', questionId: 'q1',
      stem: 'Which animal?', response: 'cat', result: '正确' }])
    expect(JSON.stringify(rows)).not.toMatch(/private_session|private_media|private_work/)
    expect(parentSubmittedTaskMediaItems([
      { taskItemId: 'listen', value: JSON.stringify({ kind: 'listening' }) },
      { taskItemId: 'video', value: JSON.stringify({ kind: 'video' }) },
      { taskItemId: 'dubbing', value: JSON.stringify({ kind: 'dubbing' }) },
    ], [{ itemId: 'listen', title: '虚构听力', type: 'listening' },
      { itemId: 'video', title: '虚构视频', type: 'video' },
      { itemId: 'dubbing', title: '虚构配音', type: 'dubbing' }]))
      .toEqual([{ itemId: 'listen', title: '虚构听力', kind: 'listening' },
        { itemId: 'video', title: '虚构视频', kind: 'video' },
        { itemId: 'dubbing', title: '虚构配音', kind: 'dubbing' }])
  })
})
