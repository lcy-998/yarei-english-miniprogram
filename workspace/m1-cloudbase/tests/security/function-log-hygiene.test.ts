import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FUNCTIONS_ROOT = fileURLToPath(new URL('../../functions', import.meta.url));

describe('CloudBase 函数日志静态门禁', () => {
  it('函数源码不直接输出请求、异常堆栈或任意控制台日志', async () => {
    const files = await listTypeScriptFiles(FUNCTIONS_ROOT);
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (/\bconsole\s*\.(?:log|info|warn|error|debug|trace)\s*\(/.test(source)) violations.push(`${file}:console`);
      if (/\b(?:error|exception)\s*\.\s*stack\b/i.test(source)) violations.push(`${file}:stack`);
      if (/JSON\.stringify\s*\(\s*(?:event|request|input|context)\b/i.test(source)) violations.push(`${file}:raw-request`);
    }

    expect(files.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});

async function listTypeScriptFiles(directory: string): Promise<readonly string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listTypeScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(path);
  }
  return result.sort();
}
