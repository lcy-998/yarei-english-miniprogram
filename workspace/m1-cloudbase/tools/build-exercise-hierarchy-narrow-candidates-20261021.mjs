/** Create read-only candidate bundles by patching the exact remote code baseline. */
import ts from 'typescript'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const baseline = join(root, '.runtime', 'exercise-hierarchy-baseline-20261021')
const candidate = join(root, '.runtime', 'exercise-hierarchy-candidate-20261021')
const report = JSON.parse(await readFile(resolve('G:/英语资产/reports/independent-exercise-function-baseline-2026-10-21.json'), 'utf8'))
const names = ['content-query', 'task-command', 'student-task-query', 'review-query']
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

function parse(code, label) {
  const source = ts.createSourceFile(label, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (source.parseDiagnostics.length) throw new Error(`PARSE_FAILED_${label}`)
  return source
}
function nodes(source, predicate) {
  const hits = []
  function visit(node) { if (predicate(node)) hits.push(node); ts.forEachChild(node, visit) }
  visit(source)
  return hits
}
function one(source, predicate, label) {
  const hits = nodes(source, predicate)
  if (hits.length !== 1) throw new Error(`ANCHOR_COUNT_${label}_${hits.length}`)
  return hits[0]
}
function functionNode(source, name) {
  return one(source, node => ts.isFunctionDeclaration(node) && node.name?.text === name, `function_${name}`)
}
function methodNode(source, name) {
  return one(source, node => ts.isMethodDeclaration(node) && node.name.getText(source) === name, `method_${name}`)
}
function exerciseIf(source) {
  const fn = functionNode(source, 'decodeLearningResource')
  return one(fn, node => ts.isIfStatement(node)
    && node.expression.getText(source) === 'document.type === "exercise"', 'exercise_decode_branch')
}
function evidenceStatement(source) {
  return one(source, node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(decl => decl.name.getText(source) === 'exerciseEvidence'),
  'exercise_evidence_statement')
}
function taskGroupGuard(source) {
  return one(source, node => ts.isIfStatement(node)
    && node.getText(source).includes('习题任务须按题组选择'), 'task_group_guard')
}
function sectionGroupGuard(source) {
  return one(source, node => ts.isIfStatement(node)
    && node.expression.getText(source) === '!validExerciseSections(resolvedResources)', 'section_group_guard')
}
function functionPatch(remote, local, name, helperMap = null) {
  const oldNode = functionNode(remote, name)
  const newNode = functionNode(local, name)
  let replacement = newNode.getText(local)
  if (helperMap) for (const [from, to] of Object.entries(helperMap)) {
    replacement = replacement.replaceAll(new RegExp(`\\b${from}\\b`, 'gu'), to)
  }
  return { start: oldNode.getStart(remote), end: oldNode.end, replacement,
    label: `function:${name}`, oldBytes: oldNode.getText(remote).length,
    newBytes: replacement.length }
}
function nodePatch(remote, local, oldNode, newNode, label) {
  const replacement = newNode.getText(local)
  return { start: oldNode.getStart(remote), end: oldNode.end, replacement,
    label, oldBytes: oldNode.getText(remote).length, newBytes: replacement.length }
}
function publicHelperMap(remote, local) {
  const oldText = functionNode(remote, 'isVerifiedPublicQuestionSource').getText(remote)
  const newText = functionNode(local, 'isVerifiedPublicQuestionSource').getText(local)
  const oldName = oldText.match(/const payload = (object\d*)\(/u)?.[1]
  const newName = newText.match(/const payload = (object\d*)\(/u)?.[1]
  if (!oldName || !newName) throw new Error('PUBLIC_OBJECT_HELPER_UNKNOWN')
  return oldName === newName ? {} : { [newName]: oldName }
}
function apply(code, patches) {
  const sorted = [...patches].sort((a, b) => b.start - a.start)
  let lastStart = code.length + 1
  for (const patch of sorted) {
    if (patch.end > lastStart || patch.start < 0 || patch.end > code.length) {
      throw new Error(`PATCH_OVERLAP_${patch.label}`)
    }
    code = code.slice(0, patch.start) + patch.replacement + code.slice(patch.end)
    lastStart = patch.start
  }
  return code
}

const outputs = []
for (const name of names) {
  const remoteBytes = await readFile(join(baseline, name, 'index.js'))
  const localBytes = await readFile(join(root, 'dist', 'functions', name, 'index.js'))
  const recorded = report.functions.find(row => row.name === name)
  if (!recorded || sha(remoteBytes) !== recorded.remoteSha256 || sha(localBytes) !== recorded.localSha256) {
    throw new Error(`BASELINE_OR_LOCAL_CHANGED_${name}`)
  }
  const remoteCode = remoteBytes.toString('utf8'), localCode = localBytes.toString('utf8')
  const remote = parse(remoteCode, `remote-${name}`), local = parse(localCode, `local-${name}`)
  const patches = []
  if (name === 'content-query') {
    const helperMap = publicHelperMap(remote, local)
    patches.push(functionPatch(remote, local, 'isVerifiedPublicQuestionSource', helperMap))
    patches.push(functionPatch(remote, local, 'hasActivePublicQuestionSource', helperMap))
    patches.push(nodePatch(remote, local, exerciseIf(remote), exerciseIf(local), 'exercise_decode_branch'))
    patches.push(nodePatch(remote, local, methodNode(remote, 'getSchoolQuestion'),
      methodNode(local, 'getSchoolQuestion'), 'teacher_question_detail'))
  }
  if (name === 'task-command') {
    const helperMap = publicHelperMap(remote, local)
    for (const fn of ['isVerifiedPublicQuestionSource', 'hasActivePublicQuestionSource']) {
      patches.push(functionPatch(remote, local, fn, helperMap))
    }
    for (const fn of ['readExerciseQuestionSnapshot', 'evaluateExerciseSubmission', 'answersEqual']) {
      patches.push(functionPatch(remote, local, fn))
    }
    const insertion = functionNode(remote, 'readExerciseQuestionSnapshot').getStart(remote)
    const sectionCode = functionNode(local, 'validExerciseSections').getText(local)
    patches.push({ start: insertion, end: insertion, replacement: sectionCode + '\n',
      label: 'insert:validExerciseSections', oldBytes: 0, newBytes: sectionCode.length + 1 })
    const guard = sectionGroupGuard(local)
    const anchor = taskGroupGuard(remote)
    patches.push({ start: anchor.end, end: anchor.end, replacement: '\n' + guard.getText(local),
      label: 'insert:section_group_guard', oldBytes: 0, newBytes: guard.getText(local).length + 1 })
  }
  if (name === 'student-task-query') {
    for (const fn of ['readExerciseQuestionSnapshot', 'evaluateExerciseSubmission', 'answersEqual', 'safeTaskItem']) {
      patches.push(functionPatch(remote, local, fn))
    }
  }
  if (name === 'review-query') {
    const helperMap = publicHelperMap(remote, local)
    for (const fn of ['isVerifiedPublicQuestionSource', 'hasActivePublicQuestionSource']) {
      patches.push(functionPatch(remote, local, fn, helperMap))
    }
    for (const fn of ['readExerciseQuestionSnapshot', 'safeTaskItem']) {
      patches.push(functionPatch(remote, local, fn))
    }
    patches.push(nodePatch(remote, local, evidenceStatement(remote), evidenceStatement(local),
      'teacher_exercise_evidence'))
  }
  const final = apply(remoteCode, patches)
  parse(final, `candidate-${name}`)
  if (final.length - remoteCode.length > 12000 || final.length - remoteCode.length < 0) {
    throw new Error(`PATCH_SIZE_UNEXPECTED_${name}`)
  }
  const target = join(candidate, name)
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'index.js'), final, { flag: 'wx' })
  await writeFile(join(target, 'package.json'), await readFile(join(baseline, name, 'package.json')),
    { flag: 'wx' })
  outputs.push({ name, baselineSha256: sha(remoteBytes), candidateSha256: sha(final),
    baselineBytes: remoteBytes.length, candidateBytes: Buffer.byteLength(final),
    patches: patches.map(({ label, oldBytes, newBytes }) => ({ label, oldBytes, newBytes })) })
}
await writeFile(resolve('G:/英语资产/reports/independent-exercise-narrow-function-candidates-2026-10-21.json'),
  JSON.stringify({ environmentId: report.environmentId, cloudWritesPerformed: false,
    createdAt: new Date().toISOString(), functions: outputs }, null, 2) + '\n', 'utf8')
process.stdout.write(JSON.stringify(outputs.map(({ name, baselineBytes, candidateBytes, patches }) =>
  ({ name, baselineBytes, candidateBytes, patchCount: patches.length }))) + '\n')
