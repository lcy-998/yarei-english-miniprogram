import { AsyncLocalStorage } from 'node:async_hooks';

const invocationContext = new AsyncLocalStorage<unknown>();

export function withScfInvocationContext<T>(context: unknown,
  work: () => Promise<T>): Promise<T> {
  return invocationContext.run(context, work);
}

export function currentScfInvocationContext(): unknown {
  return invocationContext.getStore();
}
