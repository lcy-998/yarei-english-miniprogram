let preferred: { userId: string; sessionId: string; materialId: string } | null = null

function getPreferred(): { userId: string; sessionId: string; materialId: string } | null {
  try { return getApp<IAppOption>().globalData.preferredDubbingMaterial ?? preferred }
  catch { return preferred }
}

function setPreferred(value: { userId: string; sessionId: string; materialId: string } | null): void {
  preferred = value
  try { getApp<IAppOption>().globalData.preferredDubbingMaterial = value ?? undefined }
  catch { /* Keep the same-session fallback for isolated test runtimes. */ }
}

export function preferDubbingMaterial(userId: string, sessionId: string, materialId: string): void {
  setPreferred({ userId, sessionId, materialId })
}

export function takePreferredDubbingMaterial(userId: string, sessionId: string): string {
  const current = getPreferred()
  const materialId = current?.userId === userId && current.sessionId === sessionId
    ? current.materialId : ''
  setPreferred(null)
  return materialId
}
