import { spawn } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=resolve(join(fileURLToPath(new URL('.',import.meta.url)),'..'))
const asset=resolve('G:/英语资产/exports/wechat/exercise-web-harvest-20261015-v2')
const script=join(root,'tools/run-m3-public-question-distribution.mjs')
const files=(await readdir(asset)).filter(name=>/^res_question_web2_.*_v1\.json$/u.test(name)).sort()
const results=[]
for(const name of files){
  const input=join(asset,name), review=input.replace(/\.json$/u,'-nonproduction-review.json')
  const result=await new Promise((resolvePromise,rejectPromise)=>{
    const child=spawn(process.execPath,[script,'apply',input,review],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']})
    let buffer='',stderr='',done=false
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);try{child.kill()}catch{};error?rejectPromise(error):resolvePromise(value)}
    const timer=setTimeout(()=>finish(new Error(`APPLY_TIMEOUT_${name}`)),180000)
    child.stdout.on('data',chunk=>{buffer+=chunk.toString();for(const line of buffer.split(/\r?\n/u)){if(!line.includes('"mode":"apply"'))continue;try{const payload=JSON.parse(line);if(payload.mode==='apply'&&Array.isArray(payload.result?.projectedOrganizations)&&payload.result.projectedOrganizations.length===2){finish(null,{sourceId:payload.result.sourceId,projectedOrganizations:payload.result.projectedOrganizations.length});return}}catch{}}})
    child.stderr.on('data',chunk=>{stderr+=chunk.toString();if(stderr.length>4000)stderr=stderr.slice(-4000)})
    child.on('error',error=>finish(error))
    child.on('exit',(code)=>{if(!done)finish(new Error(`APPLY_EXIT_${code}_${name}_${stderr.replace(/[^A-Za-z0-9_-]/gu,'_').slice(-300)}`))})
  })
  results.push(result);process.stdout.write(JSON.stringify({completed:results.length,total:files.length,...result})+'\n')
}
process.stdout.write(JSON.stringify({status:'complete',imported:results.length,projectedOrganizations:2})+'\n')
