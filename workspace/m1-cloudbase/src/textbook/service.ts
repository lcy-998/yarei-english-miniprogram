import type { TrustedActorContext } from '../auth/trusted-actor';
import type { TextbookTransaction, TextbookUnitOfWork } from './repository';
import { TextbookError, type ClassTextbookConfig, type ClassTextbookItem, type TeacherTextbookClass, type TextbookRecord, type TextbookSummary } from './types';
import { TEXTBOOK_DASHBOARD_FIELDS, type TextbookCenterLayout } from './admin-types';

export interface TextbookClock { nowIso(): string }
export interface TextbookListFilters { readonly grade?: string; readonly term?: string; readonly edition?: string;
  readonly unit?: string; readonly lesson?: string; readonly keyword?: string }
export interface TextbookFacetValues { readonly grade: readonly string[]; readonly term: readonly string[];
  readonly edition: readonly string[]; readonly unit: readonly string[]; readonly lesson: readonly string[] }
export interface TextbookSaveInput { readonly classId: string; readonly textbooks: readonly ClassTextbookItem[]; readonly note: string }
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function validOperation(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value); }
function validId(value: string): boolean { return typeof value === 'string' && !!value.trim() && value.length <= 128; }
function safeBook(book: TextbookRecord): TextbookSummary {
  const { visibility: ignoredVisibility, allowedClassIds: ignoredClasses, ...summary } = book;
  void ignoredVisibility; void ignoredClasses;
  return copy(summary);
}

export class TeacherTextbookService {
  public constructor(private readonly repository: TextbookUnitOfWork, private readonly clock: TextbookClock) {}

  public async listClasses(actor: TrustedActorContext): Promise<readonly TeacherTextbookClass[]> {
    this.requireTeacher(actor);
    return this.repository.transaction(async transaction => {
      const settings = await this.centerSettings(transaction, actor);
      if (!settings.classTextbooksEnabled) throw new TextbookError('FORBIDDEN');
      return (await transaction.listTeacherClasses(actor.organizationId, actor.actorUserId))
        .filter(item => actor.scopeIds.includes(item.id) && settings.visibleClassIds.includes(item.id)).map(copy);
    });
  }

  public async getCenterSettings(actor: TrustedActorContext): Promise<TextbookCenterLayout> {
    this.requireTeacher(actor);
    return this.repository.transaction(async transaction => copy(await this.centerSettings(transaction, actor)));
  }

  public async getClass(actor: TrustedActorContext, classId: string): Promise<TeacherTextbookClass> {
    this.requireTeacher(actor);
    return this.repository.transaction(async transaction => {
      const settings = await this.centerSettings(transaction, actor);
      if (!settings.classTextbooksEnabled || !settings.visibleClassIds.includes(classId)) throw new TextbookError('FORBIDDEN');
      return copy(await this.authorizedClass(transaction, actor, classId));
    });
  }

  public async listTextbooks(actor: TrustedActorContext, filters: TextbookListFilters,
    page: Readonly<{ limit: number; offset: number }>, targetClassId?: string): Promise<Readonly<{ items: readonly TextbookSummary[]; nextOffset: number | null }>> {
    this.requireMaterialReader(actor);
    if (!Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 50 || !Number.isSafeInteger(page.offset)
      || page.offset < 0 || page.offset > 10000 || (filters.keyword?.length ?? 0) > 100) throw new TextbookError('VALIDATION_ERROR');
    return this.repository.transaction(async transaction => {
      if ((await transaction.findPublishedCenterLayout(actor.organizationId))?.synchronizedTextbooksEnabled === false) {
        throw new TextbookError('FORBIDDEN');
      }
      void targetClassId;
      const keyword = filters.keyword?.trim().toLocaleLowerCase() ?? '';
      const items: TextbookSummary[] = [];
      let offset = page.offset;
      let hasMore = true;
      let batches = 0;
      while (items.length < page.limit && hasMore && batches < 10) {
        if (offset > 10000) throw new TextbookError('SERVICE_UNAVAILABLE');
        const batch = await transaction.listTextbookPage(actor.organizationId, { limit: 50, offset });
        if (!batch.items.length) { hasMore = false; break; }
        const batchEnd = offset + batch.items.length;
        for (const book of batch.items) {
          offset += 1;
          if (book === null) continue;
          if ((filters.grade && book.grade !== filters.grade) || (filters.term && book.term !== filters.term)
            || (filters.edition && book.edition !== filters.edition)
            || (filters.unit && !book.chapters.some(chapter => chapter.title.includes(filters.unit!)))
            || (filters.lesson && !book.chapters.some(chapter => chapter.lessons.some(lesson => lesson.title.includes(filters.lesson!))))
            || (keyword && !`${book.title} ${book.edition} ${book.chapters.map(chapter => chapter.title).join(' ')}`.toLocaleLowerCase().includes(keyword))) continue;
          items.push(safeBook(book));
          if (items.length === page.limit) break;
        }
        hasMore = batch.nextOffset !== null || offset < batchEnd;
        if (offset === batchEnd && batch.nextOffset !== null) offset = batch.nextOffset;
        batches += 1;
      }
      return { items, nextOffset: hasMore ? offset : null };
    });
  }

  public async listTextbookFacets(actor: TrustedActorContext, selected: TextbookListFilters,
    targetClassId?: string): Promise<TextbookFacetValues> {
    this.requireMaterialReader(actor);
    if (Object.values(selected).some(value => value !== undefined && value.length > 100)) throw new TextbookError('VALIDATION_ERROR');
    return this.repository.transaction(async transaction => {
      if ((await transaction.findPublishedCenterLayout(actor.organizationId))?.synchronizedTextbooksEnabled === false) {
        throw new TextbookError('FORBIDDEN');
      }
      void targetClassId;
      const values = { grade: new Set<string>(), term: new Set<string>(), edition: new Set<string>(),
        unit: new Set<string>(), lesson: new Set<string>() };
      let offset = 0;
      while (true) {
        if (offset > 10000) throw new TextbookError('SERVICE_UNAVAILABLE');
        const page = await transaction.listTextbookPage(actor.organizationId, { limit: 50, offset });
        if (!page.items.length) break;
        for (const book of page.items) {
          if (book === null) continue;
          const keyword = selected.keyword?.trim().toLocaleLowerCase();
          if (keyword && !`${book.title} ${book.edition} ${book.chapters.map(chapter => chapter.title).join(' ')}`
            .toLocaleLowerCase().includes(keyword)) continue;
          values.grade.add(book.grade);
          if (selected.grade && book.grade !== selected.grade) continue;
          values.term.add(book.term);
          if (selected.term && book.term !== selected.term) continue;
          values.edition.add(book.edition);
          if (selected.edition && book.edition !== selected.edition) continue;
          for (const chapter of book.chapters) {
            values.unit.add(chapter.title);
            if (selected.unit && chapter.title !== selected.unit) continue;
            for (const lesson of chapter.lessons) values.lesson.add(lesson.title);
          }
        }
        if (page.nextOffset === null) break;
        if (page.nextOffset <= offset) throw new TextbookError('SERVICE_UNAVAILABLE');
        offset = page.nextOffset;
      }
      const sorted = (set: Set<string>) => [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));
      return { grade: sorted(values.grade), term: sorted(values.term), edition: sorted(values.edition),
        unit: sorted(values.unit), lesson: sorted(values.lesson) };
    });
  }

  public async getTextbook(actor: TrustedActorContext, textbookId: string, targetClassId?: string): Promise<TextbookSummary> {
    this.requireMaterialReader(actor);
    if (!validId(textbookId)) throw new TextbookError('VALIDATION_ERROR');
    return this.repository.transaction(async transaction => {
      if ((await transaction.findPublishedCenterLayout(actor.organizationId))?.synchronizedTextbooksEnabled === false) {
        throw new TextbookError('FORBIDDEN');
      }
      void targetClassId;
      const book = await transaction.findTextbook(actor.organizationId, textbookId);
      if (!book) throw new TextbookError('NOT_FOUND');
      return safeBook(book);
    });
  }

  public async save(actor: TrustedActorContext, input: TextbookSaveInput, expectedVersion: number,
    operationId: string, publish: boolean): Promise<ClassTextbookConfig> {
    this.requireTeacher(actor);
    if (!validId(input.classId) || !validOperation(operationId) || !Number.isSafeInteger(expectedVersion)
      || expectedVersion < 0 || !Array.isArray(input.textbooks) || input.textbooks.length > 20
      || (publish && !input.textbooks.length) || typeof input.note !== 'string' || input.note.length > 100
      || new Set(input.textbooks.map(item => item.textbookId)).size !== input.textbooks.length) throw new TextbookError('VALIDATION_ERROR');
    const fingerprint = JSON.stringify({ input, expectedVersion, publish });
    return this.repository.transaction(async transaction => {
      const settings = await this.centerSettings(transaction, actor);
      if (!settings.classTextbooksEnabled || !settings.visibleClassIds.includes(input.classId)) throw new TextbookError('FORBIDDEN');
      await this.authorizedClass(transaction, actor, input.classId);
      if (!actor.permissions.includes('task.publish')
        || !await transaction.hasClassPermission(actor.organizationId, actor.actorUserId, input.classId, 'task.publish')) {
        throw new TextbookError('FORBIDDEN');
      }
      const receipt = await transaction.findReceipt(actor.organizationId, actor.actorUserId, operationId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw new TextbookError('CONFLICT');
        return copy(receipt.result);
      }
      const previous = await transaction.findConfig(actor.organizationId, input.classId);
      if ((previous?.version ?? 0) !== expectedVersion) throw new TextbookError('CONFLICT');
      for (const item of input.textbooks) {
        const book = await transaction.findTextbook(actor.organizationId, item.textbookId);
        if (!book || !validId(item.textbookId)
          || item.contentVersion !== book.contentVersion || !Array.isArray(item.chapterIds)
          || !Array.isArray(item.lessonIds) || new Set(item.chapterIds).size !== item.chapterIds.length
          || new Set(item.lessonIds).size !== item.lessonIds.length) throw new TextbookError('RESOURCE_OFFLINE');
        const chapterIds = book.chapters.map(chapter => chapter.id);
        const lessonIds = book.chapters.flatMap(chapter => chapter.lessons.map(lesson => lesson.id));
        if (item.chapterIds.length !== chapterIds.length || item.lessonIds.length !== lessonIds.length
          || item.chapterIds.some(id => !chapterIds.includes(id))
          || item.lessonIds.some(id => !lessonIds.includes(id))) throw new TextbookError('VALIDATION_ERROR');
      }
      const now = this.clock.nowIso();
      const result: ClassTextbookConfig = { id: previous?.id ?? `class_textbook_${actor.organizationId}_${input.classId}`,
        organizationId: actor.organizationId, classId: input.classId, status: publish ? 'published' : 'draft',
        textbooks: copy(input.textbooks), note: input.note.trim(), version: expectedVersion + 1,
        publishedTextbooks: publish ? copy(input.textbooks) : copy(previous?.publishedTextbooks ?? []),
        publishedNote: publish ? input.note.trim() : previous?.publishedNote ?? '',
        createdAt: previous?.createdAt ?? now, updatedAt: now,
        publishedAt: publish ? now : previous?.publishedAt ?? null };
      if (!await transaction.saveConfig(result, expectedVersion)
        || !await transaction.saveReceipt(actor.organizationId, actor.actorUserId, operationId, fingerprint, result)) {
        throw new TextbookError('CONFLICT');
      }
      return copy(result);
    });
  }

  private requireTeacher(actor: TrustedActorContext): void {
    if (actor.actorRole !== 'teacher' || !actor.permissions.includes('content.read')) throw new TextbookError('FORBIDDEN');
  }
  private requireMaterialReader(actor: TrustedActorContext): void {
    if (!['student', 'parent', 'teacher', 'admin'].includes(actor.actorRole)) throw new TextbookError('FORBIDDEN');
  }
  private async centerSettings(transaction: TextbookTransaction, actor: TrustedActorContext): Promise<TextbookCenterLayout> {
    const classIds = await transaction.listTeacherClassIds(actor.organizationId, actor.actorUserId);
    const allowed = classIds.filter(id => actor.scopeIds.includes(id));
    if (!allowed.length) throw new TextbookError('FORBIDDEN');
    const published = await transaction.findPublishedCenterLayout(actor.organizationId);
    return published === null ? { classTextbooksEnabled: true, synchronizedTextbooksEnabled: true,
      visibleClassIds: allowed, dashboardFields: TEXTBOOK_DASHBOARD_FIELDS }
      : { ...published, visibleClassIds: allowed.filter(id => published.visibleClassIds.includes(id)) };
  }
  private async authorizedClass(transaction: TextbookTransaction, actor: TrustedActorContext,
    classId: string): Promise<TeacherTextbookClass> {
    if (!actor.scopeIds.includes(classId)) throw new TextbookError('FORBIDDEN');
    const target = await transaction.findTeacherClass(actor.organizationId, actor.actorUserId, classId);
    if (!target) throw new TextbookError('FORBIDDEN');
    return target;
  }
}
