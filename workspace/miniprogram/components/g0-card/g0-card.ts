Component({
  properties: {
    kind: { type: String, value: 'default' },
    interactive: { type: Boolean, value: false },
  },
  methods: {
    onAction() {
      if (this.properties.interactive) this.triggerEvent('action')
    },
  },
})
