export type TeacherVideoQuestionType = 'single_choice' | 'multiple_choice' | 'fill' | 'subjective'

export interface TeacherVideoQuestion {
  questionId: string
  questionType: TeacherVideoQuestionType
  stem: string
  options: string[]
  correctAnswer: string | string[] | null
  explanation: string
}

export interface TeacherPrivateVideo {
  id: string
  title: string
  status: 'draft' | 'processing' | 'failed' | 'ready' | 'published' | 'offline'
  version: number
  contentVersion: number
  durationMs: number
  questionCount: number
  stagingPath: string | null
  processingError: string | null
}

export interface TeacherPrivateVideoDetail extends TeacherPrivateVideo {
  questions: TeacherVideoQuestion[]
  previewUrl: string | null
}
