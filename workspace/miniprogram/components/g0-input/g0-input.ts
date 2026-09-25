Component({
  properties: {
    value: { type: String, value: '' },
    label: { type: String, value: '' },
    placeholder: { type: String, value: '' },
    type: { type: String, value: 'text' },
    password: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    maxlength: { type: Number, value: 140 },
    error: { type: String, value: '' },
  },
  data: { focused: false },
  methods: {
    focusField() {
      if (!this.properties.disabled) this.setData({ focused: true })
    },
    onInput(event: WechatMiniprogram.Input) {
      this.triggerEvent('input', { value: event.detail.value })
    },
    onFocus() { this.setData({ focused: true }); this.triggerEvent('focus') },
    onBlur() { this.setData({ focused: false }); this.triggerEvent('blur') },
  },
})
