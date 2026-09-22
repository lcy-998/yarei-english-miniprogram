Component({
  properties: {
    state: { type: String, value: 'idle' },
    duration: { type: String, value: '00:00' },
    progress: { type: Number, value: 0 },
    attempt: { type: Number, value: 0 },
    maxAttempts: { type: Number, value: 5 },
    message: { type: String, value: '' },
  },
  methods: {
    onPrimary() { this.triggerEvent('primary', { state: this.properties.state }) },
    onPlay() { this.triggerEvent('play') },
    onRedo() { this.triggerEvent('redo') },
    onRetry() { this.triggerEvent('retry') },
  },
})
