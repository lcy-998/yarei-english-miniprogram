import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({initializeRepositories:vi.fn()}))
vi.mock('../../miniprogram/repositories/repository-bootstrap',()=>({initializeRepositories:mocks.initializeRepositories}))
vi.mock('../../miniprogram/session/session',()=>({getSession:()=>null}))
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();vi.resetModules()})
describe('Aliyun startup',()=>{
 it.each(['release','trial','develop'])('uses the fixed HTTPS backend for %s and ignores stored CloudBase endpoints',async version=>{
  let launch:(()=>void)|undefined
  const cloudInit=vi.fn(),request=vi.fn((input:{url:string;success:(value:{statusCode:number;data:unknown})=>void})=>input.success({statusCode:200,data:{accessToken:'a'.repeat(43)}}))
  vi.stubGlobal('App',(definition:{onLaunch:()=>void})=>{launch=definition.onLaunch})
  vi.stubGlobal('wx',{getAccountInfoSync:()=>({miniProgram:{envVersion:version}}),getStorageSync:()=> 'attacker-env',cloud:{init:cloudInit},request})
  mocks.initializeRepositories.mockReturnValue({ok:true})
  await import('../../miniprogram/app');launch?.()
  expect(cloudInit).not.toHaveBeenCalled()
  expect(mocks.initializeRepositories).toHaveBeenCalledWith({mode:'cloudbase',envId:'aliyun-selfhost'},expect.any(Object))
  const sdk=mocks.initializeRepositories.mock.calls[0]![1].clientSdk
  await sdk.init({env:'ignored'}).auth({persistence:'local'}).signInWithPassword({phone:'19900000000',password:'demo-password'})
  expect(request).toHaveBeenCalledWith(expect.objectContaining({url:'https://video.aimanhua.xin/api/auth/login',method:'POST'}))
 })
 it('does not silently fall back to demo data on repository startup failure',async()=>{
  let launch:(()=>void)|undefined;vi.stubGlobal('App',(definition:{onLaunch:()=>void})=>{launch=definition.onLaunch})
  mocks.initializeRepositories.mockReturnValue({ok:false});await import('../../miniprogram/app');expect(()=>launch?.()).toThrow('initialization failed')
 })
})
