import type { JsonObject } from '../shared/protocol';

export const SEED_COLLECTION_ORDER = [
  'organizations',
  'classes',
  'users',
  'auth_identities',
  'role_assignments',
  'class_memberships',
  'teacher_class_grants',
  'parent_student_links',
  'learning_resources',
  'tasks',
  'task_assignments',
  'submissions',
  'review_feedback',
] as const;

export type SeedCollectionName = (typeof SEED_COLLECTION_ORDER)[number];

export interface SeedManifest {
  readonly seedVersion: string;
  readonly schemaVersion: number;
  readonly source: 'm0-fixture';
  readonly generatedAt: string;
  readonly contentHash: string;
  readonly seedRunId: string;
  readonly expectedCounts: Readonly<Record<string, number>>;
}

export type SeedCollections = Readonly<Record<SeedCollectionName, readonly JsonObject[]>>;

export interface SeedPackage {
  readonly manifest: SeedManifest;
  readonly collections: SeedCollections;
}

export interface SeedValidationIssue {
  readonly code:
    | 'FORMAT'
    | 'MANIFEST'
    | 'COUNT_MISMATCH'
    | 'DUPLICATE_ID'
    | 'DOCUMENT_SCHEMA'
    | 'REFERENCE'
    | 'ORGANIZATION_MISMATCH'
    | 'SENSITIVE_FIELD'
    | 'SENSITIVE_VALUE'
    | 'CONTENT_HASH';
  readonly path: string;
  readonly message: string;
}

export interface SeedValidationResult {
  readonly ok: boolean;
  readonly issues: readonly SeedValidationIssue[];
  readonly errors: readonly string[];
  readonly counts: Readonly<Record<SeedCollectionName, number>>;
  readonly computedContentHash: string;
}

