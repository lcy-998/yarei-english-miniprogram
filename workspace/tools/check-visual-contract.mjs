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
const tokenJsonPath = join(visualRoot, '01-foundations', 'design-tokens.json')
const componentContractPath = join(visualRoot, '02-components', 'code-component-contract.json')
const currentPagesRoot = join(visualRoot, '04-pages', 'current')
const productionAssetsRoot = join(visualRoot, '03-assets', 'production')
const iconSourceRoot = join(visualRoot, '03-assets', 'icons')
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
const requiredM2Pages = [
  'P-05', 'S-06', 'S-07', 'S-10', 'S-11', 'S-12', 'G-04', 'T-04',
  'T-09', 'T-10', 'T-11', 'T-12', 'T-13', 'T-14', 'T-15', 'T-16',
  'T-18', 'A-05', 'A-06', 'A-07',
]
const requiredM3ApprovedPages = ['S-05', 'T-20']
const requiredM3Candidates = [
  ['T-19', join(visualRoot, '04-pages', 'history', 'T-19', 'v001.png')],
  ['A-08', join(visualRoot, '04-pages', 'history', 'A-08', 'v001.png')],
]
const requiredComponentBoards = [
  'navigation.png', 'buttons-and-inputs.png', 'cards-and-lists.png',
  'dialogs-drawers-toast.png', 'media-and-recording.png',
  'task-status-and-feedback.png', 'tables-filters-pagination.png',
]
const requiredStateBoards = [
  'common-loading-empty-error.png', 'permission-disabled-offline.png',
  'media-recording-ai.png', 'task-lifecycle.png',
]
const requiredResponsiveBoards = [
  ['landscape', 'S-04.png'], ['landscape', 'S-05.png'], ['landscape', 'S-07.png'],
  ['landscape', 'S-09.png'], ['landscape', 'T-20.png'], ['tablet', 'A-02.png'],
  ['tablet', 'A-03.png'], ['tablet', 'A-08.png'],
  ['supplemental', 'keyboard-weak-network-conflict.png'],
  ['supplemental', 'small-screen-accessibility.png'],
]
const requiredIcons = ['play', 'pause', 'microphone', 'stop', 'headphones', 'lock', 'upload', 'retry', 'search', 'filter', 'check', 'warning']
const requiredFoundationComponents = ['visual-icon', 'status-badge', 'filter-bar', 'media-player', 'recording-panel']
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
  ['机器可读设计令牌', tokenJsonPath],
  ['代码组件契约', componentContractPath],
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

for (const pageId of [...requiredM2Pages, ...requiredM3ApprovedPages]) {
  const pagePath = join(currentPagesRoot, `${pageId}.png`)
  expect(existsSync(pagePath), `缺少 M2/M3 已批准页面主稿：${pageId}`)
  if (existsSync(pagePath)) expect(statSync(pagePath).size > 10_000, `M2/M3 页面主稿文件异常：${pageId}`)
  const row = register.match(new RegExp(`\\| ${pageId} \\|[^\\n]*\\| (已批准) \\|`))
  expect(Boolean(row), `视觉页面台账未将 ${pageId} 标记为“已批准”`)
}

for (const [pageId, candidatePath] of requiredM3Candidates) {
  expect(existsSync(candidatePath), `缺少 M3 待审批候选稿：${pageId}`)
  if (existsSync(candidatePath)) expect(statSync(candidatePath).size > 10_000, `M3 候选稿文件异常：${pageId}`)
  const row = register.match(new RegExp(`\\| ${pageId} \\|[^\\n]*\\| (待审批) \\|`))
  expect(Boolean(row), `视觉页面台账未将 ${pageId} 保持为“待审批”`)
}

for (const board of requiredComponentBoards) {
  const path = join(visualRoot, '02-components', board)
  expect(existsSync(path) && statSync(path).size > 10_000, `缺少或损坏组件状态板：${board}`)
}
for (const board of requiredStateBoards) {
  const path = join(visualRoot, '05-states', board)
  expect(existsSync(path) && statSync(path).size > 10_000, `缺少或损坏公共状态板：${board}`)
}
for (const [group, board] of requiredResponsiveBoards) {
  const path = join(visualRoot, '06-responsive', group, board)
  expect(existsSync(path) && statSync(path).size > 10_000, `缺少或损坏响应式补充稿：${group}/${board}`)
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
  for (const asset of manifest.assets ?? []) {
    expect(asset.status === 'production-ready', `生产素材状态未就绪：${asset.id ?? 'unknown'}`)
    const productionPath = asset.production ? join(projectRoot, asset.production) : ''
    expect(Boolean(productionPath) && existsSync(productionPath), `素材清单引用不存在：${asset.production ?? asset.id}`)
  }
}

if (existsSync(tokenJsonPath)) {
  const tokens = JSON.parse(read(tokenJsonPath))
  expect(tokens.baseline === '0.18.0', '机器可读设计令牌未对齐 0.18.0 基线')
  expect(tokens.colors?.primary?.toLowerCase() === '#1764d8', '机器可读主色令牌错误')
  expect(tokens.colors?.danger?.toLowerCase() === '#d9342b', '机器可读错误色令牌错误')
  const miniTokens = read(join(miniprogramRoot, 'styles', 'design-tokens.less')).toLowerCase()
  const adminTokens = read(join(workspaceRoot, 'admin-console', 'src', 'design-tokens.css')).toLowerCase()
  for (const value of Object.values(tokens.colors ?? {}).map((color) => color.toLowerCase())) {
    expect(miniTokens.includes(value), `小程序令牌镜像缺少色值：${value}`)
    expect(adminTokens.includes(value), `后台令牌镜像缺少色值：${value}`)
  }
}

for (const icon of requiredIcons) {
  const sourcePath = join(iconSourceRoot, `${icon}.svg`)
  const runtimePath = join(miniprogramRoot, 'assets', 'icons', `${icon}.svg`)
  expect(existsSync(sourcePath), `缺少统一 SVG 图标源：${icon}`)
  expect(existsSync(runtimePath), `缺少小程序 SVG 图标副本：${icon}`)
  if (existsSync(sourcePath) && existsSync(runtimePath)) {
    expect(read(sourcePath) === read(runtimePath), `SVG 图标源与运行时副本不一致：${icon}`)
    expect(read(sourcePath).includes('viewBox="0 0 24 24"'), `SVG 图标未使用 24px 网格：${icon}`)
  }
}

for (const component of requiredFoundationComponents) {
  const root = join(miniprogramRoot, 'components', component)
  for (const extension of ['json', 'ts', 'wxml', 'less']) {
    expect(existsSync(join(root, `${component}.${extension}`)), `视觉施工组件不完整：${component}.${extension}`)
  }
}
expect(existsSync(join(workspaceRoot, 'admin-console', 'src', 'components', 'visual-foundation.tsx')), '缺少后台 M2/M3 视觉施工组件')

for (const wxmlPath of walkFiles(miniprogramRoot).filter((path) => path.endsWith('.wxml'))) {
  const source = read(wxmlPath)
  for (const match of source.matchAll(/<image\b[^>]*\bsrc=["'](\/[^"']+)["']/g)) {
    if (match[1].includes('{{')) continue
    const assetPath = join(miniprogramRoot, match[1].slice(1))
    expect(existsSync(assetPath), `小程序页面引用了不存在的本地图片：${match[1]}（${wxmlPath}）`)
  }
}

if (failures.length) {
  console.error(`视觉交付检查失败（${failures.length} 项）：`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('视觉交付检查通过：M0 基线及 M2/M3 施工基础包（主稿、状态板、响应式、令牌、图标、组件契约和生产素材）完整。')
