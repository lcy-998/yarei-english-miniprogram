import { backendBaseUrl } from '../runtime/backend-config'
import { getBackendToken } from './selfhost-sdk'
export function uploadBackendFile(input:Readonly<{cloudPath:string;filePath:string}>):Promise<{fileID:string}> {
  const token=getBackendToken()
  if(!token)return Promise.reject(new Error('UNAUTHENTICATED'))
  return new Promise((resolve,reject)=>{
    wx.uploadFile({url:backendBaseUrl+'/api/media/upload?path='+encodeURIComponent(input.cloudPath),filePath:input.filePath,name:'file',timeout:300000,header:{Authorization:'Bearer '+token},
      success(response){try{const result=JSON.parse(response.data) as {fileID?:unknown};if(response.statusCode!==200||typeof result.fileID!=='string')throw new Error('UPLOAD_FAILED');resolve({fileID:result.fileID})}catch(error){reject(error)}},fail:reject})
  })
}
