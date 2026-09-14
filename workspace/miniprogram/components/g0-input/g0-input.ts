Component({
  properties: {
    value: { type: String, value: '' },
    label: { type: String, value: '' },
    placeholder: { type: String, value: '' },
    type: { type: String, value: 'text' },
    password: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    error: { type: String, value: '' },
  },
  methods: {
    onInput(event: WechatMiniprogram.Input) {
      this.triggerEvent('input', { value: event.detail.value })
    },
    onFocus() { this.triggerEvent('focus') },
    onBlur() { this.triggerEvent('blur') },
  },
})
