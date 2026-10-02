let preferred: { userId: string; sessionId: string; materialId: string } | null = null

export function preferDubbingMaterial(userId: string, sessionId: string, materialId: string): void {
  preferred = { userId, sessionId, materialId }
}

export function takePreferredDubbingMaterial(userId: string, sessionId: string): string {
  const materialId = preferred?.userId === userId && preferred.sessionId === sessionId
    ? preferred.materialId : ''
  preferred = null
  return materialId
}
