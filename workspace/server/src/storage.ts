import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Busboy from 'busboy';
import type { DocumentDatabasePort } from '../../m1-cloudbase/src/repositories/document-database-port';
import type { IdentityRepository, SubjectDigestPort } from '../../m1-cloudbase/src/runtime/ports';

export class MediaError extends Error {constructor(readonly status:number){super('Media request rejected');}}
export class LocalStorage {
  private uploads=0;
  constructor(readonly root:string,readonly namespace:string,readonly origin:string,private readonly secret:string) {
    if (!namespace.startsWith('cloud1-') || secret.length<32) throw new Error('Invalid media configuration');
  }
  path(key:string):string {
    if (!key || key.length>1024 || key.split('/').some(p=>!p || p==='.' || p==='..') || /[\\\x00-\x1f]/.test(key)) throw new MediaError(400);
    const path=resolve(this.root,key);if (!path.startsWith(resolve(this.root)+'/')) throw new MediaError(400);return path;
  }
  key(fileID:string):string {const prefix='cloud://'+this.namespace+'/';if (!fileID.startsWith(prefix)) throw new MediaError(400);const key=fileID.slice(prefix.length);this.path(key);return key;}
  async downloadFile({fileID}:{fileID:string}) {const file=this.path(this.key(fileID));if ((await stat(file)).size>200*1024*1024) throw new MediaError(413);return {fileContent:await readFile(file)};}
  async uploadFile({cloudPath,fileContent}:{cloudPath:string;fileContent:Buffer}) {
    const file=this.path(cloudPath);await mkdir(dirname(file),{recursive:true,mode:0o700});
    try {await writeFile(file,fileContent,{flag:'wx',mode:0o600});}
    catch(error) {if ((error as NodeJS.ErrnoException).code!=='EEXIST' || !(await readFile(file)).equals(fileContent)) throw error;}
    return {fileID:'cloud://'+this.namespace+'/'+cloudPath};
  }
  async getTempFileURL({fileList}:{fileList:readonly {fileID:string;maxAge:number}[]}) {
    return {fileList:await Promise.all(fileList.map(async item=>{
      const key=this.key(item.fileID);await stat(this.path(key));
      const t=Math.floor(Date.now()/1000),exp=t+Math.max(30,Math.min(item.maxAge===360000?300:3600,Math.trunc(item.maxAge)||60));
      const encoded=Buffer.from(key).toString('base64url');
      return {fileID:item.fileID,code:'SUCCESS',tempFileURL:`${this.origin}/media/${encoded}?t=${t}&exp=${exp}&sign=${this.signature(encoded,t,exp)}`};
    }))};
  }
  private signature(key:string,t:number,exp:number) {return createHmac('sha256',this.secret).update('yarei:media:v1\0'+JSON.stringify([key,t,exp])).digest('hex').slice(0,32);}
  async serve(url:URL,req:IncomingMessage,res:ServerResponse) {
    const encoded=url.pathname.slice('/media/'.length),t=Number(url.searchParams.get('t')),exp=Number(url.searchParams.get('exp')),sign=url.searchParams.get('sign')??'';
    const now=Math.floor(Date.now()/1000);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded) || !Number.isSafeInteger(t)||!Number.isSafeInteger(exp)||t>now+10||exp<now||exp>t+3600||exp<t||!/^[a-f0-9]{32}$/.test(sign)||!timingSafeEqual(Buffer.from(sign),Buffer.from(this.signature(encoded,t,exp)))) throw new MediaError(403);
    const file=this.path(Buffer.from(encoded,'base64url').toString('utf8'));const info=await stat(file);if(!info.isFile())throw new MediaError(404);
    let start=0,end=info.size-1,status=200;
    if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!m||(!m[1]&&!m[2]))throw new MediaError(416);
      if(!m[1]){start=Math.max(0,info.size-Number(m[2]));}else{start=Number(m[1]);if(m[2])end=Number(m[2]);}
      end=Math.min(end,info.size-1);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=info.size)throw new MediaError(416);status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`);}
    const mime:Record<string,string>={'.mp3':'audio/mpeg','.mp4':'video/mp4','.m4a':'audio/mp4','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.wav':'audio/wav'};
    res.writeHead(status,{'Content-Type':mime[extname(file).toLowerCase()]??'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes','Content-Security-Policy':"default-src 'none'; sandbox"});
    if(req.method==='HEAD'){res.end();return;}await pipeline(createReadStream(file,{start,end}),res);
  }
  async acceptUpload(req:IncomingMessage,key:string,authorize:()=>Promise<void>) {
    if(this.uploads>=2)throw new MediaError(503);
    await authorize();const target=this.path(key),temporary=target+'.upload-'+randomBytes(12).toString('hex');
    await mkdir(dirname(target),{recursive:true,mode:0o700});
    const limit=(key.startsWith('teacher-videos/staging/')?200:20)*1024*1024;let count=0,invalid=false;const writes:Promise<void>[]=[];
    this.uploads++;
    try {
      const parser=Busboy({headers:req.headers,limits:{files:1,fields:0,parts:1,fileSize:limit}});
      parser.on('file',(name,file)=>{count++;if(name!=='file')invalid=true;file.on('limit',()=>{invalid=true;});writes.push(pipeline(file,createWriteStream(temporary,{flags:'wx',mode:0o600})));});
      parser.on('filesLimit',()=>{invalid=true;});parser.on('fieldsLimit',()=>{invalid=true;});
      await pipeline(req,parser);await Promise.all(writes);if(invalid||count!==1||(await stat(temporary)).size===0)throw new MediaError(413);
      await authorize(); // Re-check revocation and draft state after streaming.
      await rename(temporary,target);return {fileID:'cloud://'+this.namespace+'/'+key};
    } finally {this.uploads--;await Promise.allSettled(writes);await unlink(temporary).catch(()=>undefined);}
  }
}
export function uploadAuthorizer(documents:DocumentDatabasePort,identities:IdentityRepository,digest:SubjectDigestPort) {
  return async(uid:string,key:string)=>{
    const identity=await identities.findIdentityByDigest(digest.digest('cloudbase:username:'+uid));
    if(!identity||identity.status!=='active')throw new MediaError(403);
    const [user,org,roles]=await Promise.all([identities.findUser(identity.userId,identity.organizationId),identities.findOrganization(identity.organizationId),identities.listActiveRoles(identity.userId,identity.organizationId)]);
    if(!user||user.status!=='active'||!org||org.status!=='active')throw new MediaError(403);
    const collection=key.startsWith('pronunciation/staging/')?'pronunciation_recordings':key.startsWith('task-recordings/staging/')?'task_recordings':key.startsWith('student-works/staging/')?'student_works':key.startsWith('task-dubbing/staging/')?'task_dubbing_works':key.startsWith('review-voice/')?'review_voice_drafts':key.startsWith('teacher-videos/staging/')?'teacher_private_videos':null;
    if(!collection)throw new MediaError(403);
    const owner=collection==='teacher_private_videos'?'ownerTeacherId':collection==='review_voice_drafts'?'teacherId':'studentId';
    const role=owner==='studentId'?'student':'teacher';if(!roles.some(r=>r.role===role&&r.status==='active'))throw new MediaError(403);
    const matches=await documents.find(collection,{organizationId:identity.organizationId,stagingPath:key,deletedAt:null});
    if(matches.length!==1||matches[0]?.[owner]!==identity.userId||matches[0]?.status!=='draft'||matches[0]?.fileId)throw new MediaError(403);
  };
}
