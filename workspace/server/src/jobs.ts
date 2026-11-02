import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
export class JobQueue {
  private db:DatabaseSync;private busy=false;private timer:NodeJS.Timeout|undefined;
  constructor(path:string){this.db=new DatabaseSync(path);this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,event TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,available INTEGER NOT NULL); UPDATE jobs SET state='pending' WHERE state='running';");}
  async enqueue(kind:string,event:unknown){const value=JSON.stringify(event),id=createHash('sha256').update(kind+value).digest('hex');this.db.prepare("INSERT OR IGNORE INTO jobs(id,kind,event,state,available) VALUES(?,?,?,'pending',?)").run(id,kind,value,Date.now());}
  start(run:(kind:string,event:unknown)=>Promise<unknown>){this.timer=setInterval(()=>{void this.tick(run).catch(()=>console.error('Worker queue unavailable'));},1000);this.timer.unref();}
  private async tick(run:(kind:string,event:unknown)=>Promise<unknown>){if(this.busy)return;const row=this.db.prepare("SELECT * FROM jobs WHERE state='pending' AND available<=? ORDER BY available LIMIT 1").get(Date.now());if(!row)return;this.busy=true;
    this.db.prepare("UPDATE jobs SET state='running',attempts=attempts+1 WHERE id=?").run(row.id);
    try {const result=await run(String(row.kind),JSON.parse(String(row.event)));const failure=result&&typeof result==='object'&&'ok' in result&&result.ok===false;this.db.prepare('UPDATE jobs SET state=? WHERE id=?').run(failure?'failed':'done',row.id);}
    catch {this.db.prepare('UPDATE jobs SET state=?,available=? WHERE id=?').run(Number(row.attempts)<2?'pending':'failed',Date.now()+60000,row.id);}
    finally{this.busy=false;}}
  stop(){if(this.timer)clearInterval(this.timer);}
}
/** One CPU inference child at a time. Inputs/results never enter logs. */
export class PythonInference {
  private busy=false;
  constructor(private root:string,private secret:string,private origin:string,private promptVersion:string){}
  async invoke(input:{functionName:string;event:Record<string,unknown>;timeoutMs:number}):Promise<unknown>{
    if(this.busy)throw new Error('INFERENCE_BUSY');this.busy=true;
    try{return await new Promise((resolve,reject)=>{
      const voice=input.functionName==='pronunciation-inference';if(!voice&&input.functionName!=='teacher-suggestion-inference-trial'){reject(new Error('Invalid worker'));return;}
      const cwd=join(this.root,input.functionName);
      const script=`import json,sys\nfrom ${voice?'inference':'index'} import main\nevent=json.loads(sys.stdin.read())\nresult=main(event,None)\nprint('YAREI_RESULT:'+json.dumps(result,separators=(',',':')))\n`;
      const child=spawn('/usr/bin/python3.11',['-c',script],{cwd,env:{...process.env,PYTHONPATH:cwd,VOICE_INTERNAL_SECRET:this.secret,VOICE_ALLOWED_MEDIA_HOST:new URL(this.origin).hostname,VOICE_MEDIA_DOWNLOAD_TIMEOUT_SEC:'60',QWEN_TRIAL_INTERNAL_SECRET:this.secret,QWEN_TRIAL_MODEL_VERSION:'qwen3-0.6b-q4_0-b11345',QWEN_TRIAL_PROMPT_VERSION:this.promptVersion},detached:true,stdio:['pipe','pipe','pipe']});
      const kill=()=>{try{if(child.pid)process.kill(-child.pid,'SIGKILL');}catch{/* Already exited. */}};
      const timer=setTimeout(kill,Math.min(290000,input.timeoutMs));let output='';
      child.stdout.on('data',(chunk:Buffer)=>{output+=chunk.toString();if(output.length>1024*1024)kill();});child.stderr.resume();child.stdin.on('error',()=>undefined);
      child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);if(code!==0){reject(new Error('Inference failed'));return;}try{const line=output.split('\n').find(x=>x.startsWith('YAREI_RESULT:'));if(!line)throw new Error();resolve(JSON.parse(line.slice(13)));}catch{reject(new Error('Invalid inference result'));}});child.stdin.end(JSON.stringify(input.event));
    });}finally{this.busy=false;}
  }
}
