import { AsyncLocalStorage } from 'node:async_hooks';
import { createNodeCryptoCapabilities, type NodeCryptoSecrets } from '../../m1-cloudbase/src/runtime/node-crypto-capabilities';
import { createIdentitySessionRuntimeCapabilities } from '../../m1-cloudbase/functions/shared/identity-session-capabilities';
import { installCloudBaseRuntimeProvider } from '../../m1-cloudbase/functions/shared/default-cloudbase-function';
import type { DocumentDatabasePort } from '../../m1-cloudbase/src/repositories/document-database-port';
import { createM2BusinessReadIsolation } from '../../m1-cloudbase/src/seed/m2-business-read-isolation';
import { createLearningProgressDocumentRepository } from '../../m1-cloudbase/src/repositories/learning-progress-document-adapter';
import { createTaskQueryDocumentRepository } from '../../m1-cloudbase/src/repositories/task-query-document-adapter';
import { CloudBasePronunciationInferenceMedia } from '../../m1-cloudbase/src/pronunciation/cloudbase-adapters';
import { PronunciationAsyncJobService } from '../../m1-cloudbase/src/pronunciation/async-job-service';
import { LongPronunciationInference } from '../../m1-cloudbase/src/pronunciation/long-inference-adapter';
import { HmacPronunciationJobDispatcher } from '../../m1-cloudbase/src/pronunciation/job-wire';
import { DocumentPronunciationRepository } from '../../m1-cloudbase/src/pronunciation/document-repository';
import { DocumentPronunciationSource } from '../../m1-cloudbase/src/pronunciation/source-adapter';
import { FreshPronunciationWorkerIdentity } from '../../m1-cloudbase/src/pronunciation/worker-identity-adapter';
import { CloudBaseTeacherSuggestionInference } from '../../m1-cloudbase/src/teacher-ai/cloudbase-inference';
import { DocumentTeacherSuggestionStore } from '../../m1-cloudbase/src/teacher-ai/document-store';
import { AutomaticSuggestionDispatcher, AutomaticSuggestionWorker } from '../../m1-cloudbase/src/teacher-ai/automatic-worker';
import { TeacherSuggestionService } from '../../m1-cloudbase/src/teacher-ai/service';
import { ReviewQueryService } from '../../m1-cloudbase/src/task-query/service';
import { createPronunciationWorkerFunction } from '../../m1-cloudbase/functions/pronunciation-worker/function-entry';
import { handlers, type HandlerName } from './handlers';
import { LocalStorage, uploadAuthorizer } from './storage';
import { JobQueue, PythonInference } from './jobs';
import type { LocalAuth } from './auth';
import { join } from 'node:path';
export { handlers, publicHandlers } from './handlers';
const subject = new AsyncLocalStorage<string>();
export function installRuntime(raw: DocumentDatabasePort,secrets: NodeCryptoSecrets,options?:{data:string;origin:string;namespace:string;inferenceRoot:string;promptVersion:string;auth:LocalAuth}) {
  const documents=createM2BusinessReadIsolation(raw),clock={nowIso:()=>new Date().toISOString()},unix={nowUnix:()=>Math.floor(Date.now()/1000)};
  const crypto=createNodeCryptoCapabilities({clock,secrets});
  const base=createIdentitySessionRuntimeCapabilities({documents,clock,requestIds:crypto.requestIds,cryptography:crypto,sdk:{getWXContext:()=>({UID:subject.getStore()}),database:()=>{throw new Error('Use local documents');}}});
  const common={...base,queryCursorCodec:crypto.queryCursorCodec,batchReviewPreviewCodec:crypto.batchReviewPreviewCodec,bindingCodes:crypto.bindingCodes,bindingCodeDigest:crypto.bindingCodeDigest};
  if(!options){installCloudBaseRuntimeProvider(()=>common);return {...crypto,storage:undefined,authorizeUpload:undefined,queue:undefined};}
  const storage=new LocalStorage(join(options.data,'storage'),options.namespace,options.origin,secrets.cursorSigningKey);
  const queue=new JobQueue(join(options.data,'jobs.sqlite'));
  const transport=new PythonInference(options.inferenceRoot,secrets.batchReviewSigningKey,options.origin,options.promptVersion);
  const tasks=createTaskQueryDocumentRepository(documents);
  const jobs=new PronunciationAsyncJobService(new DocumentPronunciationRepository(documents),new DocumentPronunciationSource(tasks,createLearningProgressDocumentRepository(documents),documents,base.identities,clock),
    new HmacPronunciationJobDispatcher({invokeEvent:(kind,event)=>queue.enqueue(kind,event)},secrets.batchReviewSigningKey,unix),
    new LongPronunciationInference(new CloudBasePronunciationInferenceMedia(storage),transport,secrets.batchReviewSigningKey,new URL(options.origin).hostname,unix),new FreshPronunciationWorkerIdentity(base.identities),clock,600000);
  const pronunciationWorker=createPronunciationWorkerFunction({jobs,secret:secrets.batchReviewSigningKey,clock:unix});
  const modelVersion='qwen3-0.6b-q4_0-b11345',promptVersion=options.promptVersion;
  const inference=new CloudBaseTeacherSuggestionInference(transport,secrets.batchReviewSigningKey,modelVersion,promptVersion,unix);
  const store=new DocumentTeacherSuggestionStore(documents);
  const teacherWorker=new AutomaticSuggestionWorker(base.identities,tasks,new TeacherSuggestionService(new ReviewQueryService({repository:tasks,clock,requestIds:crypto.requestIds}),tasks,inference,store,clock,crypto.identifiers,modelVersion,promptVersion),secrets.batchReviewSigningKey,unix);
  installCloudBaseRuntimeProvider(()=>({...common,environmentId:options.namespace.split('.')[0],recordingStorage:storage,playbackStorage:storage,pronunciationJobs:jobs,pronunciationWorker,
    teacherSuggestion:{inference,modelVersion,promptVersion,dispatcher:new AutomaticSuggestionDispatcher({invokeTeacherSuggestionEvent:event=>queue.enqueue('teacher-suggestion-worker',event)},secrets.batchReviewSigningKey,unix)},teacherSuggestionStore:store,teacherSuggestionWorker:event=>teacherWorker.run(event),nativeAccountProvider:options.auth.nativeProvider(crypto.subjectDigest,options.data)}));
  queue.start((kind,event)=>kind==='pronunciation-worker'?pronunciationWorker(event):kind==='teacher-suggestion-worker'?teacherWorker.run(event):Promise.reject(new Error('Invalid queued job')));
  return {...crypto,storage,authorizeUpload:uploadAuthorizer(documents,base.identities,crypto.subjectDigest),queue};
}
export function invoke(name: HandlerName,uid: string,event: unknown): Promise<unknown> {return subject.run(uid,()=>handlers[name](event));}
