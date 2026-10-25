import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')
const app = JSON.parse(readFileSync(resolve(root, 'miniprogram/app.json'), 'utf8')) as {
  pages: string[]
  subPackages: Array<{ root: string; pages: string[] }>
}
const registeredPages = [
  ...app.pages,
  ...app.subPackages.flatMap(pack => pack.pages.map(page => `${pack.root}/${page}`)),
]

describe('M1 已批准页面入口', () => {
  it('学生首页单词练习指向已注册的 S-02 页面', () => {
    const source = readFileSync(resolve(root, 'miniprogram/subpackages/student/home/index.ts'), 'utf8')
    expect(source).toContain("/subpackages/student/vocabulary/vocabulary")
    expect(registeredPages).toContain('subpackages/student/vocabulary/vocabulary')
  })

  it('教师底栏学员入口指向已注册的 T-02 页面', () => {
    const source = readFileSync(resolve(root, 'miniprogram/components/g0-tab-bar/g0-tab-bar.ts'), 'utf8')
    expect(source).toContain("/subpackages/teacher/student-list/student-list")
    expect(registeredPages).toContain('subpackages/teacher/student-list/student-list')
  })
})
