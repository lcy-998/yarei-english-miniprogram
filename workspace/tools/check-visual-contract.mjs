import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const workspaceRoot = resolve(import.meta.dirname, '..')
const projectRoot = resolve(workspaceRoot, '..')
const docsRoot = join(projectRoot, 'docs')
const visualRoot = join(projectRoot, 'visual-design')

const baselinePath = join(docsRoot, 'visual-system-baseline.md')
const deliveryPath = join(docsRoot, 'visual-design-delivery-plan.md')
const registerPath = join(docsRoot, 'visual-page-register.md')
const reviewLogPath = join(visualRoot, '00-governance', 'review-log.md')
const componentMapPath = join(visualRoot, '07-handoff', 'component-map.md')
const assetMapPath = join(visualRoot, '07-handoff', 'page-asset-map.md')
const qaChecklistPath = join(visualRoot, '07-handoff', 'visual-qa-checklist.md')
const assetManifestPath = join(visualRoot, '03-assets', 'asset-manifest.json')
const currentPagesRoot = join(visualRoot, '04-pages', 'current')
const productionAssetsRoot = join(visualRoot, '03-assets', 'production')
const miniprogramRoot = join(workspaceRoot, 'miniprogram')

const requiredM0Pages = [
  'P-01', 'P-02', 'S-01', 'S-08', 'S-09', 'G-01', 'G-03',
  'G-05', 'T-01', 'T-05', 'T-06', 'T-07', 'T-08', 'T-17',
]
const requiredProductionAssets = [
  'brand-logo.png',
  'mascot-learning-blue.png',
  'student-public-natural-background-v1.png',
]
const failures = []
const expect = (condition, message) => { if (!condition) failures.push(message) }
const read = (path) => existsSync(path) ? readFileSync(path, 'utf8') : ''
const walkFiles = (root) => readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
  const path = join(root, entry.name)
  return entry.isDirectory() ? walkFiles(path) : [path]
})

for (const [label, path] of [
  ['视觉系统基线', baselinePath],
  ['视觉交付计划', deliveryPath],
  ['视觉页面台账', registerPath],
  ['视觉评审记录', reviewLogPath],
  ['组件映射', componentMapPath],
  ['页面素材映射', assetMapPath],
  ['视觉 QA 清单', qaChecklistPath],
  ['素材清单', assetManifestPath],
]) expect(existsSync(path), `缺少${label}：${path}`)

const baseline = read(baselinePath)
const delivery = read(deliveryPath)
const register = read(registerPath)
const reviewLog = read(reviewLogPath)

expect(baseline.includes('自然高饱和卡通 1.0'), '视觉系统未声明当前“自然高饱和卡通 1.0”方向')
expect(baseline.includes('color-primary') && baseline.includes('#1764D8'), '视觉系统缺少品牌主色令牌')
expect(delivery.includes('M0 页面样式准入'), '视觉交付计划缺少 M0 分阶段准入规则')
expect(delivery.includes('M4 前完成 G5'), '视觉交付计划缺少 M4/G5 最终交付规则')
expect(reviewLog.includes('G0 全部通过'), 'G0 视觉母版尚未通过审批')
expect(reviewLog.includes('G1 全部通过'), 'G1 M0 页面尚未通过审批')

for (const pageId of requiredM0Pages) {
  const pagePath = join(currentPagesRoot, `${pageId}.png`)
  expect(existsSync(pagePath), `缺少 M0 已批准页面主稿：${pageId}`)
  if (existsSync(pagePath)) expect(statSync(pagePath).size > 10_000, `M0 页面主稿文件异常：${pageId}`)
  const row = register.match(new RegExp(`\\| ${pageId} \\|[^\\n]*\\| (已批准) \\|`))
  expect(Boolean(row), `视觉页面台账未将 ${pageId} 标记为“已批准”`)
}

for (const assetName of requiredProductionAssets) {
  const assetPath = join(productionAssetsRoot, assetName)
  expect(existsSync(assetPath), `缺少 M0 生产素材：${assetName}`)
  if (existsSync(assetPath)) expect(statSync(assetPath).size > 10_000, `M0 生产素材文件异常：${assetName}`)
}

if (existsSync(assetManifestPath)) {
  const manifest = JSON.parse(read(assetManifestPath))
  const readyAssets = new Set((manifest.assets ?? [])
    .filter((asset) => asset.status === 'production-ready')
    .map((asset) => asset.production?.split('/').at(-1)))
  for (const assetName of requiredProductionAssets) {
    expect(readyAssets.has(assetName), `素材清单未登记为 production-ready：${assetName}`)
  }
}

for (const wxmlPath of walkFiles(miniprogramRoot).filter((path) => path.endsWith('.wxml'))) {
  const source = read(wxmlPath)
  for (const match of source.matchAll(/<image\b[^>]*\bsrc=["'](\/[^"']+)["']/g)) {
    const assetPath = join(miniprogramRoot, match[1].slice(1))
    expect(existsSync(assetPath), `小程序页面引用了不存在的本地图片：${match[1]}（${wxmlPath}）`)
  }
}

if (failures.length) {
  console.error(`视觉交付检查失败（${failures.length} 项）：`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('视觉交付检查通过：M0 的 G0/G1 主稿、视觉系统、组件映射和生产素材已冻结。')
