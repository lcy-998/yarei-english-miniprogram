import type { JsonObject } from '../shared/protocol';
import { readExerciseQuestionSnapshot } from './exercise-evidence';

/** New hierarchical packs must be complete when a teacher creates a task. */
export function validExerciseSections(resources: readonly Readonly<{ type: string; payload: JsonObject }>[]): boolean {
  const packs = new Map<string, Array<Readonly<{ type: string; payload: JsonObject }>>>();
  for (const resource of resources) {
    if (resource.type !== 'exercise') continue;
    const origin = resource.payload.assetLibrary;
    if (!origin || typeof origin !== 'object' || Array.isArray(origin)) continue;
    const packId = (origin as JsonObject).exercisePackId;
    if (typeof packId !== 'string') continue;
    packs.set(packId, [...packs.get(packId) ?? [], resource]);
  }
  for (const rows of packs.values()) {
    const snapshots = rows.map(row => readExerciseQuestionSnapshot(row.payload));
    if (snapshots.every(row => row?.exerciseSection === undefined)) continue; // legacy frozen pack
    if (snapshots.some(row => row?.exerciseSection === undefined)) return false;
    const sections = new Map<string, typeof snapshots>();
    for (const snapshot of snapshots) {
      const section = snapshot?.exerciseSection;
      if (!section) return false;
      sections.set(section.id, [...sections.get(section.id) ?? [], snapshot]);
    }
    if (sections.size < 2) return false;
    const sectionOrders = new Set<number>();
    for (const entries of sections.values()) {
      if (entries.length < 2) return false;
      const first = entries[0]?.exerciseSection;
      if (!first || sectionOrders.has(first.order)) return false;
      sectionOrders.add(first.order);
      const positions = new Set<number>();
      for (const entry of entries) {
        const current = entry?.exerciseSection;
        if (!current || current.order !== first.order || current.title !== first.title
          || current.instruction !== first.instruction || current.studentMaterial !== first.studentMaterial
          || positions.has(current.questionOrder)) return false;
        positions.add(current.questionOrder);
      }
      if (Math.min(...positions) !== 1 || Math.max(...positions) !== entries.length) return false;
    }
    if (Math.min(...sectionOrders) !== 1 || Math.max(...sectionOrders) !== sections.size) return false;
  }
  return true;
}
