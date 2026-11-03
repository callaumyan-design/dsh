import type { SoulPetAPI } from '../../core/ipc'

declare global {
  interface Window {
    soulpet: SoulPetAPI
  }
}

export const api: SoulPetAPI = window.soulpet
