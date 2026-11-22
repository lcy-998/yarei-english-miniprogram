import { main as f0 } from '../../m1-cloudbase/functions/activity-command';
import { main as f1 } from '../../m1-cloudbase/functions/activity-query';
import { main as f2 } from '../../m1-cloudbase/functions/admin-session';
import { main as f3 } from '../../m1-cloudbase/functions/admin-task-activity-command';
import { main as f4 } from '../../m1-cloudbase/functions/admin-task-activity-query';
import { main as f5 } from '../../m1-cloudbase/functions/auth-session';
import { main as f6 } from '../../m1-cloudbase/functions/content-query';
import { main as f7 } from '../../m1-cloudbase/functions/learning-progress-command';
import { main as f8 } from '../../m1-cloudbase/functions/learning-progress-query';
import { main as f9 } from '../../m1-cloudbase/functions/learning-stats-query';
import { main as f11 } from '../../m1-cloudbase/functions/native-admin-command';
import { main as f12 } from '../../m1-cloudbase/functions/native-admin-management-command';
import { main as f13 } from '../../m1-cloudbase/functions/native-admin-media-command';
import { main as f14 } from '../../m1-cloudbase/functions/native-admin-operations-command';
import { main as f15 } from '../../m1-cloudbase/functions/native-admin-query';
import { main as f16 } from '../../m1-cloudbase/functions/notification-command';
import { main as f17 } from '../../m1-cloudbase/functions/notification-query';
import { main as f18 } from '../../m1-cloudbase/functions/organization-admin';
import { main as f19 } from '../../m1-cloudbase/functions/parent-query';
import { main as f20 } from '../../m1-cloudbase/functions/phonics-command';
import { main as f21 } from '../../m1-cloudbase/functions/phonics-query';
import { main as f22 } from '../../m1-cloudbase/functions/pronunciation-command';
import { main as f23 } from '../../m1-cloudbase/functions/pronunciation-query';
import { main as f25 } from '../../m1-cloudbase/functions/relationship-command';
import { main as f26 } from '../../m1-cloudbase/functions/review-command';
import { main as f27 } from '../../m1-cloudbase/functions/review-query';
import { main as f28 } from '../../m1-cloudbase/functions/student-task-query';
import { main as f29 } from '../../m1-cloudbase/functions/student-work-command';
import { main as f30 } from '../../m1-cloudbase/functions/student-work-query';
import { main as f31 } from '../../m1-cloudbase/functions/submission-command';
import { main as f32 } from '../../m1-cloudbase/functions/task-command';
import { main as f33 } from '../../m1-cloudbase/functions/task-query';
import { main as f34 } from '../../m1-cloudbase/functions/task-recording-command';
import { main as f35 } from '../../m1-cloudbase/functions/task-recording-query';
import { main as f36 } from '../../m1-cloudbase/functions/task-template-command';
import { main as f37 } from '../../m1-cloudbase/functions/task-template-query';
import { main as f39 } from '../../m1-cloudbase/functions/teacher-student-command';
import { main as f40 } from '../../m1-cloudbase/functions/teacher-student-import-command';
import { main as f41 } from '../../m1-cloudbase/functions/teacher-student-query';
import { main as f42 } from '../../m1-cloudbase/functions/teacher-suggestion-command';
import { main as f44 } from '../../m1-cloudbase/functions/teacher-textbook-command';
import { main as f45 } from '../../m1-cloudbase/functions/teacher-textbook-query';
import { main as f46 } from '../../m1-cloudbase/functions/textbook-admin-command';
import { main as f47 } from '../../m1-cloudbase/functions/textbook-admin-query';
import { main as f48 } from '../../m1-cloudbase/functions/vocabulary-evidence-command';
import { main as f49 } from '../../m1-cloudbase/functions/vocabulary-evidence-query';
export const handlers = {
  'activity-command': f0,
  'activity-query': f1,
  'admin-session': f2,
  'admin-task-activity-command': f3,
  'admin-task-activity-query': f4,
  'auth-session': f5,
  'content-query': f6,
  'learning-progress-command': f7,
  'learning-progress-query': f8,
  'learning-stats-query': f9,
  'native-admin-command': f11,
  'native-admin-management-command': f12,
  'native-admin-media-command': f13,
  'native-admin-operations-command': f14,
  'native-admin-query': f15,
  'notification-command': f16,
  'notification-query': f17,
  'organization-admin': f18,
  'parent-query': f19,
  'phonics-command': f20,
  'phonics-query': f21,
  'pronunciation-command': f22,
  'pronunciation-query': f23,
  'relationship-command': f25,
  'review-command': f26,
  'review-query': f27,
  'student-task-query': f28,
  'student-work-command': f29,
  'student-work-query': f30,
  'submission-command': f31,
  'task-command': f32,
  'task-query': f33,
  'task-recording-command': f34,
  'task-recording-query': f35,
  'task-template-command': f36,
  'task-template-query': f37,
  'teacher-student-command': f39,
  'teacher-student-import-command': f40,
  'teacher-student-query': f41,
  'teacher-suggestion-command': f42,
  'teacher-textbook-command': f44,
  'teacher-textbook-query': f45,
  'textbook-admin-command': f46,
  'textbook-admin-query': f47,
  'vocabulary-evidence-command': f48,
  'vocabulary-evidence-query': f49,
};
export type HandlerName = keyof typeof handlers;
export const publicHandlers = new Set(Object.keys(handlers).filter(name => !name.endsWith('-worker') && name !== 'maintenance-timer'));
