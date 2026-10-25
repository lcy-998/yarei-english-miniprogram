Component({
  data: {},
  properties: {
    title: { type: String, value: '' },
    playing: { type: Boolean, value: false },
    progress: { type: Number, value: 0 },
    currentTime: { type: String, value: '00:00' },
    duration: { type: String, value: '00:00' },
    speed: { type: String, value: '1.0×' },
    locked: { type: Boolean, value: false },
    seekLimit: { type: Number, value: 0 },
    earMode: { type: Boolean, value: false },
    showEarModeToggle: { type: Boolean, value: true },
    earModeLocked: { type: Boolean, value: false },
    state: { type: String, value: 'ready' },
    bare: { type: Boolean, value: false },
    showBufferingText: { type: Boolean, value: true },
  },
  methods: {
    onToggle() { if (this.properties.state === 'ready' || this.properties.state === 'loading') this.triggerEvent('toggle') },
    onSpeed() { if (this.properties.state === 'ready' || this.properties.state === 'loading') this.triggerEvent('speed') },
    onEarMode() {
      if (!this.properties.earModeLocked
        && (this.properties.state === 'ready' || this.properties.state === 'loading')) this.triggerEvent('earmode')
    },
    onRetry() { this.triggerEvent('retry') },
    onSeek(event: WechatMiniprogram.SliderChange) {
      const percent = Number(event.detail.value)
      if (!Number.isFinite(percent)) return
      const confirmedPercent = Math.max(0, Math.min(100, Number(this.properties.seekLimit) || 0))
      if (this.properties.locked && percent > confirmedPercent) {
        this.triggerEvent('seekblocked', { confirmedPercent })
        return
      }
      this.triggerEvent('seek', { percent })
    },
  },
})
