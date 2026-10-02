import { TaskTemplateView } from '../../../domain/types'
import { copyTaskTemplate, instantiateTaskTemplate, listTaskTemplates, removeTaskTemplate, renameTaskTemplate } from '../../../services/app-service'
import { getSession, setTeacherTemplateSeed } from '../../../session/session'
import { EMPTY_WRITE_INTENT, WriteIntentState, clearWriteIntent, createPageOperationId, prepareWriteIntent } from '../../../shared/write-intent'

Component({
  data: {
    loading: true, error: '', templates: [] as TaskTemplateView[], visibleTemplates: [] as TaskTemplateView[],
    filter: '全部' as '全部' | '系统' | '我的', editingId: '', editTitle: '', busyId: '',
    intents: {} as Record<string, WriteIntentState>,
  },
  lifetimes: { attached() { this.loadTemplates() } },
  pageLifetimes: { show() { this.loadTemplates() } },
  methods: {
    async loadTemplates() {
      const session = getSession()
      if (!session) { wx.redirectTo({ url: '/pages/auth/login/login' }); return }
      this.setData({ loading: true, error: '' })
      const result = await listTaskTemplates(session.user.id)
      if (!result.ok) { this.setData({ loading: false, error: result.error.message }); return }
      this.setData({ loading: false, templates: result.data }, () => this.applyFilter())
    },
    chooseFilter(event: WechatMiniprogram.TouchEvent) {
      const filter = event.currentTarget.dataset.filter as '全部' | '系统' | '我的'
      if (!['全部', '系统', '我的'].includes(filter)) return
      this.setData({ filter }, () => this.applyFilter())
    },
    applyFilter() {
      this.setData({ visibleTemplates: this.data.templates.filter(item => this.data.filter === '全部'
        || (this.data.filter === '系统' ? item.scope === 'system' : item.scope === 'personal')) })
    },
    startRename(event: WechatMiniprogram.TouchEvent) {
      const id = event.currentTarget.dataset.id as string
      const template = this.data.templates.find(item => item.id === id)
      if (!template || template.scope !== 'personal' || this.data.busyId) return
      this.setData({ editingId: id, editTitle: template.title })
    },
    onTitle(event: WechatMiniprogram.Input) { this.setData({ editTitle: event.detail.value }) },
    cancelRename() { this.setData({ editingId: '', editTitle: '' }) },
    async saveRename() {
      const session = getSession()
      const template = this.data.templates.find(item => item.id === this.data.editingId)
      const title = this.data.editTitle.trim()
      if (!session || !template || !title || this.data.busyId) return
      const key = `rename:${template.id}`
      const intent = prepareWriteIntent(this.data.intents[key] ?? EMPTY_WRITE_INTENT,
        JSON.stringify({ version: template.version, title }), () => createPageOperationId('rename_template'))
      this.setData({ busyId: template.id, intents: { ...this.data.intents, [key]: intent } })
      const result = await renameTaskTemplate(session.user.id, template.id, title, template.version, intent.operationId)
      this.setData({ busyId: '' })
      if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      this.setData({ editingId: '', editTitle: '', intents: { ...this.data.intents, [key]: clearWriteIntent() } })
      this.loadTemplates()
    },
    editTemplate(event: WechatMiniprogram.TouchEvent) {
      const template = this.data.templates.find(item => item.id === event.currentTarget.dataset.id)
      if (!template || template.scope !== 'personal' || this.data.busyId) return
      setTeacherTemplateSeed(template)
      wx.navigateTo({ url: `/pages/teacher/publish-task/publish-task?editTemplateId=${encodeURIComponent(template.id)}` })
    },
    async copyTemplate(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      const template = this.data.templates.find(item => item.id === event.currentTarget.dataset.id)
      if (!session || !template || this.data.busyId) return
      const title = `${template.title} 副本`.slice(0, 50)
      const key = `copy:${template.id}`
      const intent = prepareWriteIntent(this.data.intents[key] ?? EMPTY_WRITE_INTENT,
        JSON.stringify({ version: template.version, title }), () => createPageOperationId('copy_template'))
      this.setData({ busyId: template.id, intents: { ...this.data.intents, [key]: intent } })
      const result = await copyTaskTemplate(session.user.id, template.id, title, template.version, intent.operationId)
      this.setData({ busyId: '' })
      if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      this.setData({ intents: { ...this.data.intents, [key]: clearWriteIntent() } })
      wx.showToast({ title: '模板已复制', icon: 'success' }); this.loadTemplates()
    },
    removeTemplate(event: WechatMiniprogram.TouchEvent) {
      const template = this.data.templates.find(item => item.id === event.currentTarget.dataset.id)
      if (!template || template.scope !== 'personal' || this.data.busyId) return
      wx.showModal({ title: '删除个人模板？', content: `“${template.title}”将不再出现在模板列表，已布置任务不受影响。`,
        confirmText: '删除', success: result => { if (result.confirm) this.commitRemove(template) } })
    },
    async commitRemove(template: TaskTemplateView) {
      const session = getSession()
      if (!session || this.data.busyId) return
      const key = `remove:${template.id}`
      const intent = prepareWriteIntent(this.data.intents[key] ?? EMPTY_WRITE_INTENT,
        String(template.version), () => createPageOperationId('remove_template'))
      this.setData({ busyId: template.id, intents: { ...this.data.intents, [key]: intent } })
      const result = await removeTaskTemplate(session.user.id, template.id, template.version, intent.operationId)
      this.setData({ busyId: '' })
      if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      this.setData({ intents: { ...this.data.intents, [key]: clearWriteIntent() } })
      wx.showToast({ title: '模板已删除', icon: 'success' }); this.loadTemplates()
    },
    async useTemplate(event: WechatMiniprogram.TouchEvent) {
      const session = getSession()
      const template = this.data.templates.find(item => item.id === event.currentTarget.dataset.id)
      if (!session || !template || this.data.busyId) return
      const key = `use:${template.id}`
      const intent = prepareWriteIntent(this.data.intents[key] ?? EMPTY_WRITE_INTENT,
        String(template.version), () => createPageOperationId('use_template'))
      this.setData({ busyId: template.id, intents: { ...this.data.intents, [key]: intent } })
      const result = await instantiateTaskTemplate(session.user.id, template.id, template.version, intent.operationId)
      this.setData({ busyId: '' })
      if (!result.ok) { wx.showToast({ title: result.error.message, icon: 'none' }); return }
      this.setData({ intents: { ...this.data.intents, [key]: clearWriteIntent() } })
      wx.navigateTo({ url: `/pages/teacher/publish-task/publish-task?editTaskId=${encodeURIComponent(result.data.taskId)}` })
    },
  },
})
