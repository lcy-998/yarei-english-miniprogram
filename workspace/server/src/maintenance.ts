import type { DocumentDatabasePort } from '../../m1-cloudbase/src/repositories/document-database-port';
import { NotificationMaintenance } from '../../m1-cloudbase/src/notification/maintenance';
import { MediaRetentionService } from '../../m1-cloudbase/src/media-retention/service';
import { AbandonedStagingRetentionService } from '../../m1-cloudbase/src/media-retention/abandoned-staging';
import { TaskPronunciationSubmissionLookup } from '../../m1-cloudbase/src/media-retention/pronunciation-submission-lookup';
import { TaskDubbingSubmissionLookup } from '../../m1-cloudbase/src/media-retention/dubbing-submission-lookup';
import { MediaRetentionMaintenance } from '../../m1-cloudbase/src/media-retention/maintenance';
import { createTaskQueryDocumentRepository } from '../../m1-cloudbase/src/repositories/task-query-document-adapter';
import type { LocalStorage } from './storage';
import { mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
/** Retention hides expired media but retains bytes in the protected migration quarantine. */
export function startMaintenance(documents:DocumentDatabasePort,storage:LocalStorage) {
 const clock={nowIso:()=>new Date().toISOString()},ids={next:(prefix:string)=>prefix+'_'+randomUUID()};
 const notifications=new NotificationMaintenance(documents,clock,ids),tasks=createTaskQueryDocumentRepository(documents);
 const remove=async(fileId:string):Promise<'deleted'|'not_found'>=>{const key=storage.key(fileId),from=storage.path(key),to=join(storage.root,'..','retained-media',key);await mkdir(dirname(to),{recursive:true,mode:0o700});try{await rename(from,to);return 'deleted';}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return 'not_found';throw error;}};
 const environmentId=storage.namespace.split('.')[0]!;
 const retention=new MediaRetentionMaintenance(documents,new MediaRetentionService(documents,{deleteFile:remove},environmentId,clock,new TaskPronunciationSubmissionLookup(tasks),new TaskDubbingSubmissionLookup(tasks)),new AbandonedStagingRetentionService(documents,{deleteStagingPath:async input=>{if(input.environmentId!==environmentId)throw new Error('Environment mismatch');return remove('cloud://'+storage.namespace+'/'+input.stagingPath);}},environmentId,clock));
 let busy=false,lastRetention=Date.now();
 const timer=setInterval(()=>{if(busy)return;busy=true;void (async()=>{await notifications.run();if(Date.now()-lastRetention>=3600000){const report=await retention.run();if(report.failed)console.error('Media retention jobs need attention');lastRetention=Date.now();}})().catch(()=>console.error('Maintenance requires retry')).finally(()=>{busy=false;});},60000);timer.unref();return ()=>clearInterval(timer);
}
