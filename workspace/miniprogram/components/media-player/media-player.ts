Component({
  properties: {
    title: { type: String, value: '' },
    playing: { type: Boolean, value: false },
    progress: { type: Number, value: 0 },
    currentTime: { type: String, value: '00:00' },
    duration: { type: String, value: '00:00' },
    speed: { type: String, value: '1.0×' },
    locked: { type: Boolean, value: false },
    earMode: { type: Boolean, value: false },
    state: { type: String, value: 'ready' },
  },
  methods: {
    onToggle() { if (this.properties.state === 'ready') this.triggerEvent('toggle') },
    onSpeed() { if (this.properties.state === 'ready') this.triggerEvent('speed') },
    onEarMode() { if (this.properties.state === 'ready') this.triggerEvent('earmode') },
    onRetry() { this.triggerEvent('retry') },
  },
})
