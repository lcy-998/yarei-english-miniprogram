import { describe, expect, it } from 'vitest';
import {
  MAX_TEACHER_STUDENT_EXPORT_ROWS,
  MAX_TEACHER_STUDENT_IMPORT_ROWS,
  TEACHER_STUDENT_EXPORT_HEADERS,
  TEACHER_STUDENT_IMPORT_HEADERS,
  createTeacherStudentImportErrorCsv,
  createTeacherStudentImportTemplate,
  exportTeacherStudentsCsv,
  planTeacherStudentCsvImport,
} from '../../src/teacher-students/bulk-csv';
import type { TeacherStudentListItem } from '../../src/teacher-students/types';

const CLASS_ID = 'class_three_two';

describe('M1 TCH-001 学员批量导入 CSV 计划', () => {
  it('生成带 UTF-8 BOM 的固定模板，并解析引号、逗号和虚构数据为纯命令计划', () => {
    const template = createTeacherStudentImportTemplate();
    expect([...template.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(decode(template)).toBe(`\ufeff${TEACHER_STUDENT_IMPORT_HEADERS.join(',')}\r\n`);

    const plan = planTeacherStudentCsvImport(encode([
      TEACHER_STUDENT_IMPORT_HEADERS.join(','),
      'STU-DEMO-0101,"虚构学生,甲",13800000101,class_three_two',
      'STU-DEMO-0102,虚构学生乙,13800000102,class_three_two',
    ].join('\r\n')), { allowedClassIds: [CLASS_ID] });

    expect(plan).toEqual({
      blocked: false,
      totalRowCount: 2,
      readyRowCount: 2,
      rejectedRowCount: 0,
      commands: [
        {
          sourceLineNumber: 2,
          studentNumber: 'STU-DEMO-0101',
          displayName: '虚构学生,甲',
          mobile: '13800000101',
          classId: CLASS_ID,
        },
        {
          sourceLineNumber: 3,
          studentNumber: 'STU-DEMO-0102',
          displayName: '虚构学生乙',
          mobile: '13800000102',
          classId: CLASS_ID,
        },
      ],
      errors: [],
    });
  });

  it('严格拒绝非 UTF-8、错误表头和破损 CSV，且不生成任何命令', () => {
    expect(planTeacherStudentCsvImport(
      new Uint8Array([0xff, 0xfe, 0x00]),
      { allowedClassIds: [CLASS_ID] },
    )).toMatchObject({
      blocked: true,
      commands: [],
      errors: [{ lineNumber: 1, field: 'file', code: 'INVALID_UTF8' }],
    });

    expect(planTeacherStudentCsvImport(
      encode('display_name,student_number,mobile,class_id\r\n虚构学生,STU-DEMO-1,13800000101,class_three_two'),
      { allowedClassIds: [CLASS_ID] },
    )).toMatchObject({ blocked: true, errors: [{ code: 'INVALID_HEADER' }] });

    expect(planTeacherStudentCsvImport(
      encode(`${TEACHER_STUDENT_IMPORT_HEADERS.join(',')}\r\nSTU-DEMO-1,"未闭合,13800000101,class_three_two`),
      { allowedClassIds: [CLASS_ID] },
    )).toMatchObject({
      blocked: true,
      errors: [{ lineNumber: 2, code: 'INVALID_CSV' }],
    });
  });

  it('按原始行号返回字段错误，阻止公式注入、非法手机号、越权班级和超长字段', () => {
    const longName = '虚'.repeat(51);
    const plan = planTeacherStudentCsvImport(encode([
      TEACHER_STUDENT_IMPORT_HEADERS.join(','),
      'STU-DEMO-0201,虚构学生甲,12800000101,class_three_two',
      'STU-DEMO-0202,虚构学生乙,13800000202,class_not_allowed',
      `STU-DEMO-0203,${longName},13800000203,class_three_two`,
      'STU-DEMO-0204," =HYPERLINK(""https://invalid.example"")",13800000204,class_three_two',
    ].join('\n')), { allowedClassIds: [CLASS_ID] });

    expect(plan).toMatchObject({
      blocked: false,
      totalRowCount: 4,
      readyRowCount: 0,
      rejectedRowCount: 4,
    });
    expect(plan.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ lineNumber: 2, field: 'mobile', code: 'INVALID_MOBILE' }),
      expect.objectContaining({ lineNumber: 3, field: 'class_id', code: 'CLASS_NOT_ALLOWED' }),
      expect.objectContaining({ lineNumber: 4, field: 'display_name', code: 'FIELD_TOO_LONG' }),
      expect.objectContaining({ lineNumber: 5, field: 'display_name', code: 'FORMULA_INJECTION' }),
    ]));
    expect(JSON.stringify(plan.errors)).not.toContain('https://invalid.example');
  });

  it('对文件内和既有账号的学号/手机号重复标记所有相关行，仅保留安全行', () => {
    const plan = planTeacherStudentCsvImport(encode([
      TEACHER_STUDENT_IMPORT_HEADERS.join(','),
      'stu-demo-0301,虚构学生甲,13800000301,class_three_two',
      'STU-DEMO-0301,虚构学生乙,13800000302,class_three_two',
      'STU-DEMO-0303,虚构学生丙,13800000303,class_three_two',
      'STU-DEMO-0304,虚构学生丁,13800000303,class_three_two',
      'STU-DEMO-EXISTING,虚构学生戊,13800000305,class_three_two',
      'STU-DEMO-0306,虚构学生己,13800000999,class_three_two',
      'STU-DEMO-0307,虚构学生庚,13800000307,class_three_two',
    ].join('\r\n')), {
      allowedClassIds: [CLASS_ID],
      existingStudentNumbers: ['STU-DEMO-EXISTING'],
      existingMobiles: ['13800000999'],
    });

    expect(plan).toMatchObject({ totalRowCount: 7, readyRowCount: 1, rejectedRowCount: 6 });
    expect(plan.commands).toEqual([
      expect.objectContaining({ sourceLineNumber: 8, studentNumber: 'STU-DEMO-0307' }),
    ]);
    expect(plan.errors.filter((entry) => entry.code === 'DUPLICATE_STUDENT_NUMBER').map((entry) => entry.lineNumber))
      .toEqual([2, 3, 6]);
    expect(plan.errors.filter((entry) => entry.code === 'DUPLICATE_MOBILE').map((entry) => entry.lineNumber))
      .toEqual([4, 5, 7]);
  });

  it('超过 500 行时在首个超限行失败关闭，不生成部分计划', () => {
    const rows = Array.from({ length: MAX_TEACHER_STUDENT_IMPORT_ROWS + 1 }, (_, index) => (
      `STU-DEMO-${String(index).padStart(4, '0')},虚构学生${index},138${String(index).padStart(8, '0')},${CLASS_ID}`
    ));
    const plan = planTeacherStudentCsvImport(
      encode([TEACHER_STUDENT_IMPORT_HEADERS.join(','), ...rows].join('\n')),
      { allowedClassIds: [CLASS_ID] },
    );
    expect(plan).toMatchObject({
      blocked: true,
      totalRowCount: MAX_TEACHER_STUDENT_IMPORT_ROWS + 1,
      readyRowCount: 0,
      rejectedRowCount: MAX_TEACHER_STUDENT_IMPORT_ROWS + 1,
      commands: [],
      errors: [{ lineNumber: MAX_TEACHER_STUDENT_IMPORT_ROWS + 2, code: 'ROW_LIMIT_EXCEEDED' }],
    });
  });

  it('生成只含行号、字段和安全文案的 UTF-8 错误结果 CSV', () => {
    const bytes = createTeacherStudentImportErrorCsv([{
      lineNumber: 7,
      field: 'mobile',
      code: 'INVALID_MOBILE',
      message: '手机号格式无效。',
    }]);
    const text = decode(bytes);
    expect(text).toContain('\ufeffline_number,field,code,message\r\n');
    expect(text).toContain('"7","mobile","INVALID_MOBILE","手机号格式无效。"');
    expect(text).not.toContain('138');
  });
});

describe('M1 TCH-001 学员筛选导出 CSV', () => {
  it('复用班级、关键词和状态筛选并按固定列导出 UTF-8，危险单元格加前缀防公式执行', () => {
    const normal = item({
      studentId: 'student_a',
      studentNumber: 'STU-DEMO-1001',
      displayName: '=HYPERLINK("https://invalid.example")',
      classId: CLASS_ID,
      accountStatus: 'active',
      needsAttention: false,
    });
    const attention = item({
      studentId: 'student_b',
      studentNumber: 'STU-DEMO-1002',
      displayName: '虚构学生乙',
      classId: CLASS_ID,
      accountStatus: 'active',
      needsAttention: true,
    });
    const disabled = item({
      studentId: 'student_c',
      studentNumber: 'STU-DEMO-2001',
      displayName: '虚构学生丙',
      classId: 'class_four_one',
      accountStatus: 'disabled',
      needsAttention: false,
    });

    const exported = exportTeacherStudentsCsv([normal, attention, disabled], {
      classId: CLASS_ID,
      keyword: '1001',
      status: 'normal',
    });
    expect(exported).toMatchObject({ ok: true, rowCount: 1, mimeType: 'text/csv;charset=utf-8' });
    if (!exported.ok) throw new Error('expected export success');
    const text = decode(exported.bytes);
    expect(text).toContain(`\ufeff${TEACHER_STUDENT_EXPORT_HEADERS.join(',')}\r\n`);
    expect(text).toContain('"STU-DEMO-1001"');
    expect(text).toContain('"\'=HYPERLINK(""https://invalid.example"")"');
    expect(text).not.toContain('STU-DEMO-1002');
    expect(text).not.toContain('STU-DEMO-2001');
  });

  it('超过十万行时失败关闭且不生成部分 CSV', () => {
    const record = item({
      studentId: 'student_limit',
      studentNumber: 'STU-DEMO-LIMIT',
      displayName: '虚构学生',
      classId: CLASS_ID,
      accountStatus: 'active',
      needsAttention: false,
    });
    const result = exportTeacherStudentsCsv(
      Array.from({ length: MAX_TEACHER_STUDENT_EXPORT_ROWS + 1 }, () => record),
      { status: 'all' },
    );
    expect(result).toEqual({
      ok: false,
      code: 'ROW_LIMIT_EXCEEDED',
      message: `单次导出最多 ${MAX_TEACHER_STUDENT_EXPORT_ROWS} 行。`,
    });
  });
});

function encode(value: string): Uint8Array {
  return Buffer.from(value, 'utf8');
}

function decode(value: Uint8Array): string {
  return Buffer.from(value).toString('utf8');
}

function item(input: Readonly<{
  studentId: string;
  studentNumber: string;
  displayName: string;
  classId: string;
  accountStatus: 'active' | 'disabled';
  needsAttention: boolean;
}>): TeacherStudentListItem {
  return {
    studentId: input.studentId,
    studentNumber: input.studentNumber,
    displayName: input.displayName,
    accountStatus: input.accountStatus,
    needsAttention: input.needsAttention,
    classInfo: {
      id: input.classId,
      name: input.classId === CLASS_ID ? '三年级 2 班' : '四年级 1 班',
      grade: input.classId === CLASS_ID ? '三年级' : '四年级',
      term: '上学期',
    },
    performance: {
      assignedCount: 8,
      completedCount: 6,
      overdueCount: 1,
      redoCount: 1,
      completionRate: 0.75,
      averageScore: 86,
    },
  };
}
