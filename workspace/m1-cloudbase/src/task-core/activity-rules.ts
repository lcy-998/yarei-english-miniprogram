export type DailyCondition =
  | Readonly<{ kind: 'reading'; resourceId: string }>
  | Readonly<{ kind: 'vocabulary'; resourceId: string; requiredWordCount: number }>
  | Readonly<{ kind: 'exercise'; resourceId: string; minimumScore: number }>
  | Readonly<{ kind: 'work'; resourceId: string }>;

export type DailyEvidence =
  | Readonly<{ kind: 'reading'; resourceId: string; completed: boolean; submittedAt: string }>
  | Readonly<{ kind: 'vocabulary'; resourceId: string; completedWordCount: number; submittedAt: string }>
  | Readonly<{ kind: 'exercise'; resourceId: string; score: number | null; submittedAt: string }>
  | Readonly<{ kind: 'work'; resourceId: string; workId: string; submittedAt: string }>;

export interface ActivitySchedule {
  readonly classId: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly restDates: readonly string[];
  readonly conditions: readonly DailyCondition[];
  readonly schoolTimeZone: string;
}

export interface ActivityParticipant {
  readonly studentId: string;
  readonly displayNameMasked: string;
}

export interface ActivityDailyRecord {
  readonly studentId: string;
  readonly classId: string;
  readonly date: string;
  readonly evidence: readonly DailyEvidence[];
}

export interface TeacherCheckInOverride {
  readonly studentId: string;
  readonly classId: string;
  readonly date: string;
  readonly active: boolean;
  readonly reason: string;
  readonly changedAt: string;
  readonly version?: number;
}

export interface ActivityRank {
  readonly studentId: string;
  readonly displayNameMasked: string;
  readonly completedDays: number;
  readonly rank: number;
}

export interface ActivityLeaderboard {
  readonly classId: string;
  readonly effectiveDayCount: number;
  readonly finalized: boolean;
  readonly ranks: readonly ActivityRank[];
}

/** All calendar values are school-local YYYY-MM-DD; no client time zone is trusted. */
export function validateActivitySchedule(schedule: ActivitySchedule): boolean {
  if (!schedule.classId.trim() || !validLocalDate(schedule.startsOn) || !validLocalDate(schedule.endsOn)
    || schedule.endsOn < schedule.startsOn || !schedule.conditions.length
    || new Set(schedule.restDates).size !== schedule.restDates.length
    || schedule.restDates.some((date) => !validLocalDate(date) || date < schedule.startsOn || date > schedule.endsOn)) return false;
  if (!schedule.conditions.every(validCondition)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: schedule.schoolTimeZone });
    return true;
  } catch {
    return false;
  }
}

export function activityDays(schedule: ActivitySchedule): readonly string[] {
  if (!validateActivitySchedule(schedule)) return [];
  const days: string[] = [];
  const rest = new Set(schedule.restDates);
  for (let date = schedule.startsOn; date <= schedule.endsOn; date = nextLocalDate(date)) {
    if (!rest.has(date)) days.push(date);
  }
  return days;
}

/** Evidence must come from saved, server-authorized learning/submission records. */
export function isEffectiveActivityDay(
  schedule: ActivitySchedule,
  studentId: string,
  date: string,
  evidence: readonly DailyEvidence[],
  override?: TeacherCheckInOverride,
): boolean {
  if (!validateActivitySchedule(schedule) || !validLocalDate(date) || date < schedule.startsOn || date > schedule.endsOn
    || schedule.restDates.includes(date)) return false;
  if (override?.active && override.studentId === studentId && override.date === date
    && override.classId === schedule.classId && override.reason.trim()) return true;
  return schedule.conditions.every((condition) => evidence.some((entry) => evidenceMatches(condition, entry, date, schedule.schoolTimeZone)));
}

export function rankActivity(
  schedule: ActivitySchedule,
  participants: readonly ActivityParticipant[],
  records: readonly ActivityDailyRecord[],
  overrides: readonly TeacherCheckInOverride[],
  nowIso: string,
): ActivityLeaderboard {
  if (!validateActivitySchedule(schedule)) return { classId: schedule.classId, effectiveDayCount: 0, finalized: false, ranks: [] };
  const days = activityDays(schedule);
  const uniqueParticipants = [...new Map(participants.map((person) => [person.studentId, person])).values()];
  const validParticipantIds = new Set(uniqueParticipants.map((person) => person.studentId));
  const latestOverrides = new Map<string, TeacherCheckInOverride>();
  for (const override of overrides) {
    if (override.classId !== schedule.classId || !validParticipantIds.has(override.studentId)
      || !days.includes(override.date) || !override.reason.trim()) continue;
    const key = `${override.studentId}:${override.date}`;
    const previous = latestOverrides.get(key);
    if (!previous || (override.version ?? 0) > (previous.version ?? 0)
      || ((override.version ?? 0) === (previous.version ?? 0) && previous.changedAt < override.changedAt)) {
      latestOverrides.set(key, override);
    }
  }
  const evidenceByDay = new Map<string, DailyEvidence[]>();
  for (const record of records) {
    if (record.classId !== schedule.classId || !validParticipantIds.has(record.studentId)
      || !days.includes(record.date)) continue;
    const key = `${record.studentId}:${record.date}`;
    evidenceByDay.set(key, [...(evidenceByDay.get(key) ?? []), ...record.evidence]);
  }
  const counts = uniqueParticipants.map((person) => ({
    ...person,
    completedDays: days.filter((date) => {
      const key = `${person.studentId}:${date}`;
      return isEffectiveActivityDay(schedule, person.studentId, date, evidenceByDay.get(key) ?? [], latestOverrides.get(key));
    }).length,
  }));
  counts.sort((a, b) => b.completedDays - a.completedDays || a.studentId.localeCompare(b.studentId));
  const ranks: ActivityRank[] = counts.map((person, index) => ({
    studentId: person.studentId,
    displayNameMasked: person.displayNameMasked,
    completedDays: person.completedDays,
    rank: index > 0 && counts[index - 1]?.completedDays === person.completedDays
      ? (counts.findIndex((item) => item.completedDays === person.completedDays) + 1) : index + 1,
  }));
  return {
    classId: schedule.classId,
    effectiveDayCount: days.length,
    finalized: localDateAt(nowIso, schedule.schoolTimeZone) > schedule.endsOn,
    ranks,
  };
}

function evidenceMatches(condition: DailyCondition, entry: DailyEvidence, date: string, timeZone: string): boolean {
  if (entry.kind !== condition.kind || entry.resourceId !== condition.resourceId
    || localDateAt(entry.submittedAt, timeZone) !== date) return false;
  switch (condition.kind) {
    case 'reading': return entry.kind === 'reading' && entry.completed;
    case 'vocabulary': return entry.kind === 'vocabulary' && Number.isSafeInteger(entry.completedWordCount)
      && entry.completedWordCount >= condition.requiredWordCount;
    case 'exercise': return entry.kind === 'exercise' && entry.score !== null && Number.isFinite(entry.score)
      && entry.score >= condition.minimumScore && entry.score <= 100;
    case 'work': return entry.kind === 'work' && entry.workId.trim().length > 0;
  }
}

function validCondition(condition: DailyCondition): boolean {
  if (!condition.resourceId.trim()) return false;
  switch (condition.kind) {
    case 'reading':
    case 'work': return true;
    case 'vocabulary': return Number.isSafeInteger(condition.requiredWordCount) && condition.requiredWordCount > 0;
    case 'exercise': return Number.isFinite(condition.minimumScore) && condition.minimumScore >= 0 && condition.minimumScore <= 100;
  }
}

function validLocalDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const time = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date;
}

function nextLocalDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function localDateAt(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
