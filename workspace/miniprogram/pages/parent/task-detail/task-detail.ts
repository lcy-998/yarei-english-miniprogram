import { TaskDetailView } from '../../../domain/types'
import { getParentTask } from '../../../services/app-service'
import { getCurrentTaskId, getSession } from '../../../session/session'
import { assignmentStatusLabel } from '../../../shared/assignment-status'
Component({data:{loading:true,error:'',detail:null as TaskDetailView | null,statusLabel:''},lifetimes:{attached(){this.loadTask()}},methods:{async loadTask(){const session=getSession();const taskId=getCurrentTaskId();if(!session||!taskId){wx.navigateBack();return}const result=await getParentTask(session.user.id,taskId);if(!result.ok){this.setData({loading:false,error:result.error.message});return}this.setData({loading:false,detail:result.data,statusLabel:assignmentStatusLabel(result.data.assignment.status,'待点评')})},openFeedback(){wx.navigateTo({url:'/pages/parent/feedback/feedback'})}}})
