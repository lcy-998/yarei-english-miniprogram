import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, link, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_SHA256 = 'da2572f16c06133561ce56accaa822216f2391ef4d37fba427801cd6736417d4';
const MODEL_BYTES = 428_970_080;
const ENGINE_SHA256 = 'f7e86d010fcaa6082772f2a8d0dea0f887571f43f7575dc3b267ef0aa2c8b613';
const ENGINE_BYTES = 11_040_744;
const MAX_UNCOMPRESSED_BYTES = 500_000_000;

const args = parseArgs(process.argv.slice(2));
const model = resolve(args.model);
const engine = resolve(args.engine);
const output = resolve(args.output);
if (!isAbsolute(args.output) || output.startsWith(`${ROOT}/`) || output.startsWith(`${ROOT}\\`)) {
  throw new Error('OUTPUT_MUST_BE_EXTERNAL_TO_REPOSITORY');
}
const modelHash = await sha256(model);
const engineHash = await sha256(engine);
if (modelHash !== MODEL_SHA256 || engineHash !== ENGINE_SHA256
  || (await stat(model)).size !== MODEL_BYTES || (await stat(engine)).size !== ENGINE_BYTES) {
  throw new Error('QWEN_SOURCE_ARTIFACT_MISMATCH');
}

await mkdir(resolve(output, 'model'), { recursive: true });
await mkdir(resolve(output, 'runtime'), { recursive: true });
await link(model, resolve(output, 'model/Qwen3-0.6B-Q4_0.gguf'));
await copyFile(engine, resolve(output, 'runtime/llama-cli'));
await copyFile(resolve(ROOT, 'functions/teacher-suggestion-inference-trial/index.py'), resolve(output, 'index.py'));
await copyFile(args.license, resolve(output, 'LICENSE-Qwen3'));
await copyFile(args.engineLicense, resolve(output, 'LICENSE-llama.cpp'));
const files = [
  resolve(output, 'index.py'), resolve(output, 'LICENSE-Qwen3'), resolve(output, 'LICENSE-llama.cpp'),
  resolve(output, 'model/Qwen3-0.6B-Q4_0.gguf'),
  resolve(output, 'runtime/llama-cli'),
];
const inventory = await Promise.all(files.map(async path => ({
  path: path.slice(output.length + 1).replaceAll('\\', '/'),
  bytes: (await stat(path)).size,
  sha256: await sha256(path),
})));
if (inventory.find(file => file.path === 'runtime/llama-cli')?.sha256 !== ENGINE_SHA256) {
  throw new Error('STATIC_ENGINE_MISMATCH');
}
const totalBytes = inventory.reduce((sum, file) => sum + file.bytes, 0);
if (totalBytes >= MAX_UNCOMPRESSED_BYTES) throw new Error('QWEN_PACKAGE_EXCEEDS_CLOUDFUNCTION_LIMIT');
const manifest = { modelVersion: 'qwen3-0.6b-q4_0-b11345', promptVersion: 'teacher-v13',
  totalBytes, maxUncompressedBytes: MAX_UNCOMPRESSED_BYTES, files: inventory };
await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
process.stdout.write(JSON.stringify({ output, totalBytes, fileCount: inventory.length,
  modelHashVerified: true, staticEngineHashVerified: true, belowStaticLimit: true }) + '\n');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!['--model', '--engine', '--output', '--license', '--engine-license'].includes(key)
      || typeof value !== 'string' || value.startsWith('--')) throw new Error('INVALID_ARGUMENTS');
    result[key.slice(2)] = value;
  }
  if (!result.model || !result.engine || !result.output || !result.license || !result['engine-license']) throw new Error('INVALID_ARGUMENTS');
  result.engineLicense = result['engine-license'];
  return result;
}

async function sha256(path) {
  const digest = createHash('sha256');
  await new Promise((resolveRead, rejectRead) => {
    const stream = createReadStream(path);
    stream.on('data', chunk => digest.update(chunk));
    stream.on('error', rejectRead);
    stream.on('end', resolveRead);
  });
  return digest.digest('hex');
}
