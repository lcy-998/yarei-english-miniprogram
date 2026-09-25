export type M1FunctionName = 'auth-session' | 'content-query' | 'learning-progress-query' | 'learning-progress-command' | 'parent-query' | 'relationship-command' | 'teacher-student-query'

export interface M1FunctionRequest {
  apiVersion: 'm1.v1'
  action: string
  payload: Record<string, unknown>
  operationId?: string
  expectedVersion?: number
}

export interface CloudFunctionInvoker {
  invoke(functionName: M1FunctionName, request: M1FunctionRequest): Promise<unknown>
}

