export interface TextbookChapter {
  readonly id: string;
  readonly title: string;
  readonly lessons: readonly { readonly id: string; readonly title: string }[];
}

export interface TextbookSummary {
  readonly id: string;
  readonly title: string;
  readonly grade: string;
  readonly term: string;
  readonly edition: string;
  readonly contentVersion: string;
  readonly chapters: readonly TextbookChapter[];
}

export interface TextbookRecord extends TextbookSummary {
  readonly visibility: 'organization' | 'classes';
  readonly allowedClassIds: readonly string[];
}

export interface ClassTextbookItem {
  readonly textbookId: string;
  readonly chapterIds: readonly string[];
  readonly lessonIds: readonly string[];
  readonly contentVersion: string;
}

export interface ClassTextbookConfig {
  readonly id: string;
  readonly organizationId: string;
  readonly classId: string;
  readonly status: 'draft' | 'published';
  readonly textbooks: readonly ClassTextbookItem[];
  readonly note: string;
  readonly publishedTextbooks: readonly ClassTextbookItem[];
  readonly publishedNote: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export interface TeacherTextbookClass {
  readonly id: string;
  readonly name: string;
  readonly grade: string;
  readonly term: string;
  readonly studentCount: number;
  readonly config: ClassTextbookConfig | null;
}

export type TextbookErrorCode = 'VALIDATION_ERROR' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'RESOURCE_OFFLINE' | 'SERVICE_UNAVAILABLE';
export class TextbookError extends Error {
  public constructor(public readonly code: TextbookErrorCode) { super(code); this.name = 'TextbookError'; }
}
