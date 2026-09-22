import type { AdminCloudResult, AdminConsoleSession } from './admin-cloud-contract';

export const ADMIN_SESSION_FUNCTION_NAME = 'admin-session' as const;

export type AdminSessionAction = 'bootstrap' | 'refresh' | 'getCurrentSession' | 'logout';

export type AdminSessionCall =
  | Readonly<{ action: 'bootstrap' }>
  | Readonly<{ action: 'refresh' | 'getCurrentSession'; businessSessionToken: string }>
  | Readonly<{ action: 'logout'; businessSessionToken: string; operationId: string }>;

export interface AdminSessionWireRequest {
  readonly apiVersion: 'm1.v1';
  readonly action: AdminSessionAction;
  readonly payload: Readonly<Record<string, never>>;
  readonly businessSessionToken?: string;
  readonly operationId?: string;
}

/** Injected platform boundary; this package deliberately provides no default SDK. */
export interface AdminSessionFunctionInvoker {
  invoke(
    functionName: typeof ADMIN_SESSION_FUNCTION_NAME,
    request: AdminSessionWireRequest,
  ): Promise<unknown>;
}

export interface AdminSessionTransport {
  invoke(call: AdminSessionCall): Promise<AdminCloudResult<AdminConsoleSession | null>>;
}

