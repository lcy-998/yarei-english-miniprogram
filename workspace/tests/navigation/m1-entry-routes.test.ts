import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const app = JSON.parse(readFileSync(resolve(root, 'miniprogram/app.json'), 'utf8')) as { pages: string[] }

describe('M1 已批准页面入口', () => {
  it('学生首页单词练习指向已注册的 S-02 页面', () => {
    const source = readFileSync(resolve(root, 'miniprogram/pages/index/index.ts'), 'utf8')
    expect(source).toContain("/pages/student/word-practice/word-practice")
    expect(app.pages).toContain('pages/student/word-practice/word-practice')
  })

  it('教师底栏学员入口指向已注册的 T-02 页面', () => {
    const source = readFileSync(resolve(root, 'miniprogram/components/g0-tab-bar/g0-tab-bar.ts'), 'utf8')
    expect(source).toContain("/pages/teacher/student-list/student-list")
    expect(app.pages).toContain('pages/teacher/student-list/student-list')
  })
})
