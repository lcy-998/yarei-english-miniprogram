import { describe, expect, it } from 'vitest';
import {
  M1_COLLECTION_NAMES,
  M1_DATABASE_MANIFEST,
  compareDatabaseManifest,
  type ObservedCollectionDefinition,
} from '../../src/deployment/database-manifest';

function completeObservation(): readonly ObservedCollectionDefinition[] {
  return M1_DATABASE_MANIFEST.map((collection) => ({
    name: collection.name,
    clientAccess: collection.clientAccess,
    indexes: collection.indexes
      .filter((item) => item.requirement === 'required')
      .map((item) => ({ name: item.name, fields: item.fields, unique: item.unique })),
  }));
}

describe('M1 数据库机器可读清单', () => {
  it('固定 21 个 ADMINONLY 集合及文档明确要求的索引', () => {
    expect(M1_COLLECTION_NAMES).toHaveLength(21);
    expect(new Set(M1_COLLECTION_NAMES).size).toBe(21);
    expect(M1_DATABASE_MANIFEST.every((item) => item.clientAccess === 'ADMINONLY')).toBe(true);
    expect(M1_DATABASE_MANIFEST.find((item) => item.name === 'reading_progress')?.indexes)
      .toEqual([expect.objectContaining({ unique: true, fields: [
        { field: 'organizationId', direction: 'asc' },
        { field: 'studentId', direction: 'asc' },
        { field: 'resourceId', direction: 'asc' },
      ] })]);
    expect(M1_DATABASE_MANIFEST.find((item) => item.name === 'teacher_class_grants')?.indexes)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ fields: [
          { field: 'organizationId', direction: 'asc' },
          { field: 'classId', direction: 'asc' },
          { field: 'status', direction: 'asc' },
        ] }),
      ]));
    expect(M1_DATABASE_MANIFEST.find((item) => item.name === 'submissions')?.indexes)
      .toEqual(expect.arrayContaining([expect.objectContaining({ unique: true, fields: [
        { field: 'organizationId', direction: 'asc' },
        { field: 'assignmentId', direction: 'asc' },
        { field: 'submissionVersion', direction: 'asc' },
      ] })]));
  });

  it('完整观测无差异，条件索引缺失不误报', () => {
    expect(compareDatabaseManifest(completeObservation())).toEqual([]);
  });

  it('报告缺失集合、权限偏差和字段顺序/唯一性偏差', () => {
    const observed = completeObservation()
      .filter((item) => item.name !== 'migration_runs')
      .map((item) => item.name === 'reading_progress'
        ? {
            ...item,
            clientAccess: 'PRIVATE',
            indexes: [{
              name: 'wrong_reading_index',
              fields: [...item.indexes[0]!.fields].reverse(),
              unique: false,
            }],
          }
        : item);

    expect(compareDatabaseManifest(observed)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'COLLECTION_MISSING', collection: 'migration_runs' }),
      expect.objectContaining({ code: 'CLIENT_ACCESS_MISMATCH', collection: 'reading_progress' }),
      expect.objectContaining({ code: 'INDEX_MISSING', collection: 'reading_progress' }),
    ]));
  });

  it('可选报告未知对象但绝不生成删除动作', () => {
    const observed = [
      ...completeObservation(),
      { name: 'legacy_unknown', clientAccess: 'ADMINONLY', indexes: [] },
    ];
    const issues = compareDatabaseManifest(observed, { reportUnexpected: true });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'COLLECTION_UNEXPECTED', collection: 'legacy_unknown' }),
    ]));
    expect(JSON.stringify(issues)).not.toMatch(/delete|drop|remove/i);
  });
});
