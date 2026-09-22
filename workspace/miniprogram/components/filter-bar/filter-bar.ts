Component({
  properties: {
    keyword: { type: String, value: '' },
    placeholder: { type: String, value: '搜索' },
    activeCount: { type: Number, value: 0 },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    onInput(event: WechatMiniprogram.Input) {
      this.triggerEvent('change', { value: event.detail.value })
    },
    onSearch() { if (!this.properties.disabled) this.triggerEvent('search') },
    onFilter() { if (!this.properties.disabled) this.triggerEvent('filter') },
  },
})
