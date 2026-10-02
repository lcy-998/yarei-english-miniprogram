export const TEXTBOOK_DASHBOARD_FIELDS = ['grade', 'studentCount', 'configuredBookCount', 'progress', 'updatedAt'] as const;
export type TextbookDashboardField = (typeof TEXTBOOK_DASHBOARD_FIELDS)[number];
export interface TextbookCenterLayout {
  readonly classTextbooksEnabled: boolean;
  readonly synchronizedTextbooksEnabled: boolean;
  readonly visibleClassIds: readonly string[];
  readonly dashboardFields: readonly TextbookDashboardField[];
}
export interface TextbookCenterSettings {
  readonly id: string;
  readonly organizationId: string;
  readonly draft: TextbookCenterLayout;
  readonly published: TextbookCenterLayout | null;
  readonly status: 'draft' | 'published';
  readonly version: number;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}
export interface TextbookCatalogDraft {
  readonly id: string;
  readonly organizationId: string;
  readonly resourceId: string;
  readonly classIds: readonly string[];
  readonly status: 'draft' | 'published' | 'disabled';
  readonly version: number;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}
export interface AdminTextbookBook {
  readonly id: string;
  readonly title: string;
  readonly grade: string;
  readonly term: string;
  readonly edition: string;
  readonly contentVersion: string;
  readonly chapterCount: number;
  readonly status: 'draft' | 'published' | 'offline';
  readonly visibleClassIds: readonly string[];
  readonly updatedAt: string | null;
  readonly version: number;
  readonly draft: TextbookCatalogDraft | null;
}
export interface AdminTextbookPreview extends AdminTextbookBook {
  readonly chapters: readonly { readonly id: string; readonly title: string;
    readonly lessons: readonly { readonly id: string; readonly title: string }[] }[];
}
export interface AdminTextbookOverview {
  readonly classes: readonly { readonly id: string; readonly name: string; readonly grade: string;
    readonly term: string; readonly status: 'active' | 'archived' }[];
  readonly books: readonly AdminTextbookBook[];
  readonly settings: TextbookCenterSettings | null;
}
