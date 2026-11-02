import { startMaintenance } from './maintenance';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteDocuments } from './database';
import { LocalAuth } from './auth';
import { installRuntime } from './runtime';
import { createHttpServer } from './http';
import { readSecrets } from './config';
process.umask(0o077);
const data = process.env.YAREI_DATA_DIR ?? '/var/lib/yarei';
mkdirSync(data,{recursive:true,mode:0o700});
const documents = new SqliteDocuments(join(data,'business.sqlite'));
const auth = new LocalAuth(join(data,'auth.sqlite'));

const origin = process.env.YAREI_ORIGIN;
if (!origin || !origin.startsWith('https://')) throw new Error('YAREI_ORIGIN must be an HTTPS origin');
const runtime=installRuntime(documents,readSecrets(join(data,'secrets.json')),{data,origin,namespace:process.env.YAREI_STORAGE_NAMESPACE??'',inferenceRoot:process.env.YAREI_INFERENCE_ROOT??'/opt/yarei/inference',promptVersion:process.env.YAREI_PROMPT_VERSION??'teacher-v13',auth});
if(!runtime.storage)throw new Error('Missing media runtime');
const stopMaintenance=process.env.YAREI_MAINTENANCE==='1'?startMaintenance(documents,runtime.storage):()=>undefined;
const server = createHttpServer(auth,{origin,staticRoot:process.env.YAREI_ADMIN_DIR??'/opt/yarei/admin',trustProxy:true,migrationComplete:existsSync(join(data,'migration-report.json')),storage:runtime.storage,authorizeUpload:runtime.authorizeUpload});
server.listen(Number(process.env.PORT??'3200'),'127.0.0.1',()=>console.log('Yarei backend listening on loopback; 0.128.0 local runtime.'));
async function shutdown() {stopMaintenance();runtime.queue?.stop();server.close(async()=>{await documents.close();auth.close();process.exit(0);});setTimeout(()=>process.exit(1),15_000).unref();}
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
