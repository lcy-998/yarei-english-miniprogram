Component({
  properties: {
    label: { type: String, value: '提交并返回任务详情' },
  },
  methods: {
    onPress() { this.triggerEvent('press') },
  },
})
