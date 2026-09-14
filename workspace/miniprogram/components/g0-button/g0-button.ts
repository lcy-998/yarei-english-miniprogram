Component({
  properties: {
    variant: { type: String, value: 'primary' },
    loading: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    formType: { type: String, value: '' },
  },
  methods: {
    onAction() {
      if (!this.properties.loading && !this.properties.disabled) this.triggerEvent('action')
    },
  },
})
