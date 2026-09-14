import type { FunctionName, FunctionRequest, ServiceResult } from '../shared/protocol';

export interface CloudFunctionInvoker {
  call<TAction extends string, TPayload extends object, TResult>(
    functionName: FunctionName,
    request: FunctionRequest<TAction, TPayload>,
  ): Promise<ServiceResult<TResult>>;
}

export interface CloudBaseRepositoryAdapter {
  call<TAction extends string, TPayload extends object, TResult>(
    functionName: FunctionName,
    action: TAction,
    payload: TPayload,
    options?: Readonly<{ operationId?: string; expectedVersion?: number }>,
  ): Promise<ServiceResult<TResult>>;
}

export function createCloudBaseRepositoryAdapter(invoker: CloudFunctionInvoker): CloudBaseRepositoryAdapter {
  return {
    call: async <TAction extends string, TPayload extends object, TResult>(
      functionName: FunctionName,
      action: TAction,
      payload: TPayload,
      options?: Readonly<{ operationId?: string; expectedVersion?: number }>,
    ): Promise<ServiceResult<TResult>> => invoker.call<TAction, TPayload, TResult>(functionName, {
      apiVersion: 'm1.v1',
      action,
      payload,
      ...(options?.operationId === undefined ? {} : { operationId: options.operationId }),
      ...(options?.expectedVersion === undefined ? {} : { expectedVersion: options.expectedVersion }),
    }),
  };
}
