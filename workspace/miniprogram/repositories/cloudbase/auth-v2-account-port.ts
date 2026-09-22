import { ServiceResult } from '../../domain/types'

export interface AuthV2AccountPort {
  requestPasswordCode(mobile: string): Promise<ServiceResult<{ cooldownSeconds: number }>>
  resetPassword(mobile: string, code: string, password: string, confirmation: string): Promise<ServiceResult<true>>
}

