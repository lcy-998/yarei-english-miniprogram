import { readFile,writeFile,unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {createHash,createHmac} from 'node:crypto';
import {LocalStorage} from '../src/storage';
import {PythonInference} from '../src/jobs';
import {LongPronunciationInference} from '../../m1-cloudbase/src/pronunciation/long-inference-adapter';
import {CloudBasePronunciationInferenceMedia,CloudBasePronunciationSeal} from '../../m1-cloudbase/src/pronunciation/cloudbase-adapters';
async function main(){
 const root='/var/lib/yarei-v0128',secrets=JSON.parse(await readFile(join(root,'secrets.json'),'utf8')) as Record<string,string>;
 const origin='https://video.aimanhua.xin',storage=new LocalStorage(join(root,'storage'),'cloud1-d8ggzrwwedb786e41.636c-cloud1-d8ggzrwwedb786e41-1486593797',origin,secrets.cursorSigningKey!);
 const transport=new PythonInference('/opt/yarei/inference',secrets.batchReviewSigningKey!,origin,'teacher-v13');
 const data=await readFile('/opt/yarei/inference/synthetic-example.mp3'),organizationId='org_synthetic_check',studentId='student_synthetic_check',recordingId='recording_synthetic_check';
 const owner=createHash('sha256').update(JSON.stringify([organizationId,studentId])).digest('hex');
 const key=`pronunciation/staging/${owner}/${recordingId}.mp3`,file=await storage.uploadFile({cloudPath:key,fileContent:data});
 const sealed=await new CloudBasePronunciationSeal(storage,'cloud1-d8ggzrwwedb786e41').seal({stagingPath:key,stagingFileId:file.fileID,organizationId,studentId,recordingId});
 try {
  const started=Date.now(),inference=new LongPronunciationInference(new CloudBasePronunciationInferenceMedia(storage),transport,secrets.batchReviewSigningKey!,new URL(origin).hostname,{nowUnix:()=>Math.floor(Date.now()/1000)});
  const voice=await inference.infer({operationId:'migration_check_voice',recordingId:'migration_check_recording',fileId:sealed.fileId,contentSha256:sealed.contentSha256,sizeBytes:sealed.sizeBytes,durationMs:sealed.durationMs});
  const job={action:'health',operationId:'migration_check_teacher'},timestamp=Math.floor(Date.now()/1000),signature=createHmac('sha256',secrets.batchReviewSigningKey!).update(`${timestamp}\n${JSON.stringify(job)}`).digest('hex');
  const teacher=await transport.invoke({functionName:'teacher-suggestion-inference-trial',event:{job,timestamp,signature},timeoutMs:30000}) as {ok:boolean};if(!teacher.ok)throw new Error('Teacher inference bridge failed');
  const report={voice:{model:voice.modelVersion,durationMs:voice.durationMs,words:voice.words.length,elapsedMs:Date.now()-started},teacherBridge:teacher,viaPublicSignedHttps:true};await writeFile(join(root,'inference-end-to-end.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
 }finally{await unlink(storage.path(key));await unlink(storage.path(storage.key(sealed.fileId)));}
}
void main().catch(()=>{console.error('End-to-end inference verification failed');process.exitCode=1;});
