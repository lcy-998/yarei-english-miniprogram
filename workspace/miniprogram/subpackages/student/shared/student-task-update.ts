type TaskSubmittedListener = (sessionId: string, taskId: string) => void

const listeners = new Set<TaskSubmittedListener>()

// A successful submission is already acknowledged by the service. Notify visible
// student pages before their next network refresh finishes.
export function notifyStudentTaskSubmitted(sessionId: string, taskId: string): void {
  for (const listener of listeners) listener(sessionId, taskId)
}

export function onStudentTaskSubmitted(listener: TaskSubmittedListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
