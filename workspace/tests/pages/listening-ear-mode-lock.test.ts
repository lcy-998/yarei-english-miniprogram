import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

describe('S-13 listening ear mode control', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('does not emit a toggle for fixed student mode, but allows teacher preview to toggle', async () => {
    let definition: { methods: { onEarMode: (this: {
      properties: { earModeLocked: boolean; state: string }; triggerEvent: (name: string) => void
    }) => void } } | null = null
    vi.stubGlobal('Component', (value: typeof definition) => { definition = value })
    await import('../../miniprogram/components/media-player/media-player')
    if (!definition) throw new Error('Media player was not registered')
    const emit = vi.fn()

    definition.methods.onEarMode.call({ properties: { earModeLocked: true, state: 'ready' }, triggerEvent: emit })
    expect(emit).not.toHaveBeenCalled()

    definition.methods.onEarMode.call({ properties: { earModeLocked: false, state: 'ready' }, triggerEvent: emit })
    expect(emit).toHaveBeenCalledExactlyOnceWith('earmode')
  })

  it('presents fixed mode as status text instead of a disabled button', () => {
    const markup = readFileSync(new URL('../../miniprogram/components/media-player/media-player.wxml', import.meta.url), 'utf8')
    expect(markup).toMatch(/<view wx:if="\{\{showEarModeToggle && earModeLocked\}\}"[^>]*>磨耳朵已开启 · 固定<\/view>/)
    expect(markup).toMatch(/<button wx:elif="\{\{showEarModeToggle\}\}"[^>]*bindtap="onEarMode"/)
  })
})
