import type { JsonObject, JsonValue } from '../shared/protocol';

function record(value: JsonValue | undefined): JsonObject | null {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject : null;
}

export function readingPageIdsFromPayload(payload: JsonObject): readonly string[] | null {
  const chapters = payload.chapters;
  if (!Array.isArray(chapters) || !chapters.length) return null;
  const ids: string[] = [];
  for (const rawChapter of chapters) {
    const chapter = record(rawChapter);
    if (!chapter || !Array.isArray(chapter.pages) || !chapter.pages.length) return null;
    for (const rawPage of chapter.pages) {
      const page = record(rawPage);
      if (!page || typeof page.id !== 'string' || !page.id.trim()) return null;
      ids.push(page.id);
    }
  }
  return new Set(ids).size === ids.length ? ids : null;
}

export function selectedReadingPageIds(rule: JsonObject): readonly string[] | null {
  if (rule.pageIds === undefined) return null;
  if (!Array.isArray(rule.pageIds) || !rule.pageIds.length
    || !rule.pageIds.every(id => typeof id === 'string' && !!id.trim())
    || new Set(rule.pageIds).size !== rule.pageIds.length) return null;
  return rule.pageIds as string[];
}

export function supportsReadingRangeSnapshot(resource: Readonly<{ type: string; payload: JsonObject }>,
  rule: JsonObject): boolean {
  if (resource.type !== 'reading' || rule.pageIds === undefined) return true;
  const available = readingPageIdsFromPayload(resource.payload);
  const selected = selectedReadingPageIds(rule);
  return available !== null && selected !== null && selected.length === rule.requiredPageCount
    && selected.every(id => available.includes(id));
}
