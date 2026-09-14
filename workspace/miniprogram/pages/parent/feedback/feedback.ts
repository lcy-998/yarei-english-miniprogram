import { ReviewFeedback } from '../../../domain/types'
import { getParentFeedback } from '../../../services/app-service'
import { getCurrentTaskId, getSession } from '../../../session/session'
Component({data:{loading:true,error:'',feedback:null as ReviewFeedback | null},lifetimes:{attached(){this.loadFeedback()}},methods:{async loadFeedback(){const session=getSession();const taskId=getCurrentTaskId();if(!session||!taskId){wx.navigateBack();return}const result=await getParentFeedback(session.user.id,taskId);if(!result.ok){this.setData({loading:false,error:result.error.message});return}this.setData({loading:false,feedback:result.data})}}})
