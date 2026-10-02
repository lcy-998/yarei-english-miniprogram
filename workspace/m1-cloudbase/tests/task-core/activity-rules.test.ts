import { describe, expect, it } from 'vitest';
import {
  activityDays,
  isEffectiveActivityDay,
  rankActivity,
  validateActivitySchedule,
  type ActivitySchedule,
} from '../../src/task-core/activity-rules';

const schedule: ActivitySchedule = {
  classId: 'cls_demo_3_2',
  startsOn: '2026-09-25',
  endsOn: '2026-09-28',
  restDates: ['2026-09-27'],
  conditions: [
    { kind: 'reading', resourceId: 'res_reading_demo' },
    { kind: 'vocabulary', resourceId: 'res_words_demo', requiredWordCount: 3 },
  ],
  schoolTimeZone: 'Asia/Shanghai',
};

describe('M2 activity calendar and ranking', () => {
  it('excludes rest dates from generated daily instances and the denominator', () => {
    expect(activityDays(schedule)).toEqual(['2026-09-25', '2026-09-26', '2026-09-28']);
    expect(isEffectiveActivityDay(schedule, 'usr_student_01', '2026-09-27', [], {
      studentId: 'usr_student_01', classId: schedule.classId, date: '2026-09-27',
      active: true, reason: '教师补记', changedAt: '2026-09-27T12:00:00+08:00',
    })).toBe(false);
  });

  it('requires every selected condition on the student school-local submission date', () => {
    const reading = { kind: 'reading' as const, resourceId: 'res_reading_demo', completed: true, submittedAt: '2026-09-25T23:40:00+08:00' };
    const words = { kind: 'vocabulary' as const, resourceId: 'res_words_demo', completedWordCount: 3, submittedAt: '2026-09-25T16:05:00Z' };
    expect(isEffectiveActivityDay(schedule, 'usr_student_01', '2026-09-25', [reading, words])).toBe(false);
    expect(isEffectiveActivityDay(schedule, 'usr_student_01', '2026-09-26', [reading, words])).toBe(false);
    expect(isEffectiveActivityDay(schedule, 'usr_student_01', '2026-09-25', [reading, { ...words, submittedAt: '2026-09-25T15:05:00Z' }])).toBe(true);
    expect(isEffectiveActivityDay(schedule, 'usr_student_01', '2026-09-25', [], {
      studentId: 'usr_student_02', classId: schedule.classId, date: '2026-09-25',
      active: true, reason: '他人补记', changedAt: '2026-09-25T10:00:00+08:00',
    })).toBe(false);
  });

  it('ranks valid days with competition ties and filters other classes', () => {
    const participants = [
      { studentId: 'usr_student_01', displayNameMasked: '小宇' },
      { studentId: 'usr_student_02', displayNameMasked: '小星' },
      { studentId: 'usr_student_03', displayNameMasked: '小云' },
      { studentId: 'usr_student_04', displayNameMasked: '小河' },
    ];
    const record = (studentId: string, date: string, classId = schedule.classId) => ({
      studentId, classId, date, evidence: [
        { kind: 'reading' as const, resourceId: 'res_reading_demo', completed: true, submittedAt: `${date}T09:00:00+08:00` },
        { kind: 'vocabulary' as const, resourceId: 'res_words_demo', completedWordCount: 3, submittedAt: `${date}T10:00:00+08:00` },
      ],
    });
    const board = rankActivity(schedule, participants, [
      record('usr_student_01', '2026-09-25'), record('usr_student_01', '2026-09-26'),
      record('usr_student_02', '2026-09-25'), record('usr_student_02', '2026-09-26'),
      record('usr_student_03', '2026-09-25'),
      record('usr_student_04', '2026-09-25', 'cls_other'),
    ], [], '2026-09-26T15:59:59Z');
    expect(board.effectiveDayCount).toBe(3);
    expect(board.finalized).toBe(false);
    expect(board.ranks.map(({ rank, completedDays }) => [rank, completedDays])).toEqual([[1, 2], [1, 2], [3, 1], [4, 0]]);
    expect(board.ranks.every(({ displayNameMasked }) => !displayNameMasked.includes('手机号'))).toBe(true);
  });

  it('recalculates immediately when a teacher supplements and revokes a day', () => {
    const participant = [{ studentId: 'usr_student_01', displayNameMasked: '小宇' }];
    const supplement = { studentId: 'usr_student_01', classId: schedule.classId, date: '2026-09-25',
      active: true, reason: '核对纸质作品后补记', changedAt: '2026-09-26T08:00:00+08:00' };
    expect(rankActivity(schedule, participant, [], [supplement], '2026-09-29T00:00:00+08:00').ranks[0]?.completedDays).toBe(1);
    expect(rankActivity(schedule, participant, [], [supplement, {
      ...supplement, active: false, reason: '撤销误记', changedAt: '2026-09-26T08:01:00+08:00',
    }], '2026-09-29T00:00:00+08:00')).toMatchObject({ finalized: true, ranks: [{ completedDays: 0, rank: 1 }] });
  });

  it('rejects invalid dates, out-of-range rest days and unsupported AI conditions', () => {
    expect(validateActivitySchedule({ ...schedule, startsOn: '2026-09-31' })).toBe(false);
    expect(validateActivitySchedule({ ...schedule, restDates: ['2026-09-29'] })).toBe(false);
    expect(validateActivitySchedule({ ...schedule, restDates: ['2026-09-27', '2026-09-27'] })).toBe(false);
    expect(validateActivitySchedule({ ...schedule, schoolTimeZone: 'Not/AZone' })).toBe(false);
    expect(rankActivity({ ...schedule, schoolTimeZone: 'Not/AZone' }, [], [], [], '2026-09-29T00:00:00+08:00').ranks).toEqual([]);
    expect(validateActivitySchedule({
      ...schedule,
      conditions: [{ kind: 'exercise', resourceId: 'res_exercise_demo', minimumScore: 101 }],
    })).toBe(false);
  });
});
