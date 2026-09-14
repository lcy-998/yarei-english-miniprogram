Component({
  properties: {
    state: { type: String, value: 'loading' },
    message: { type: String, value: '' },
  },
  methods: { onRetry() { this.triggerEvent('retry') } },
})
