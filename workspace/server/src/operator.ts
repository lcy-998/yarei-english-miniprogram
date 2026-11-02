import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { SqliteDocuments } from './database';
import { LocalAuth } from './auth';
import { readSecrets } from './config';
import { installRuntime } from './runtime';
import type { VersionedDocument } from '../../m1-cloudbase/src/repositories/document-database-port';

// Operator-only tool. Inputs and credentials stay in mode-0600 files, never argv/logs.
async function main() {
  process.umask(0o077);
  const data=process.env.YAREI_DATA_DIR??'/var/lib/yarei';
  mkdirSync(data,{recursive:true,mode:0o700});
  const secretsPath=join(data,'secrets.json');
  if (!existsSync(secretsPath)) {
    const keys=['subjectPepper','cursorSigningKey','batchReviewSigningKey','businessSessionEncryptionKey','bindingCodeDerivationKey','bindingCodePepper'];
    writeFileSync(secretsPath,JSON.stringify(Object.fromEntries(keys.map(k=>[k,randomBytes(32).toString('base64url')]))),{mode:0o600,flag:'wx'});
  }
  const db=new SqliteDocuments(join(data,'business.sqlite'));
  const auth=new LocalAuth(join(data,'auth.sqlite'));
  const crypto=installRuntime(db,readSecrets(secretsPath));
  try {
    if (process.argv[2]==='init-admin') {
      if ((await db.find('organizations',{})).length) throw new Error('Refusing to initialize a nonempty database');
      const phone=process.env.YAREI_ADMIN_PHONE;
      if (!phone || !/^1\d{10}$/.test(phone)) throw new Error('Set YAREI_ADMIN_PHONE before initialization');
      const password=randomBytes(24).toString('base64url');
      const uid='local_admin_'+randomBytes(12).toString('hex');
      const now=new Date().toISOString(); const org='org_yarei'; const user='usr_yarei_admin';
      const common={organizationId:org,schemaVersion:1 as const,version:1,deletedAt:null,createdAt:now,updatedAt:now};
      await db.runTransaction(async tx=>{
        await tx.create('organizations',{...common,_id:org,name:'雅睿英语',status:'active',timeZone:'Asia/Shanghai'});
        await tx.create('users',{...common,_id:user,displayName:'管理员',displayNameMasked:'管理员',status:'active',profileVersion:1,authorizationVersion:1});
        await tx.create('auth_identities',{...common,_id:'aid_yarei_admin',userId:user,provider:'cloudbase_uid',providerSubjectDigest:crypto.subjectDigest.digest('cloudbase:username:'+uid),status:'active',verifiedAt:now,lastUsedAt:null});
        await tx.create('role_assignments',{...common,_id:'rol_yarei_admin',userId:user,role:'admin',status:'active',permissions:['organization.read','organization.manage','class.read','class.manage','user.read','user.manage','authorization.manage','audit.read','student.bind-code.issue'],scopeType:'organization',scopeIds:[org],grantedBy:'sys_bootstrap',grantedAt:now,revokedAt:null});
      });
      auth.provision(uid,phone,password);
      writeFileSync(join(data,'initial-admin.json'),JSON.stringify({phone,password,notice:'New administrator; CloudBase accounts and business data have not been imported.'},null,2),{mode:0o600,flag:'wx'});
      console.log('Administrator initialized. Credentials saved to the protected data directory.');
    } else if (process.argv[2]==='provision') {
      const file=process.env.YAREI_ACCOUNT_FILE;
      if (!file) throw new Error('YAREI_ACCOUNT_FILE required');
      const input: unknown=JSON.parse(readFileSync(file,'utf8'));
      if (!input || typeof input!=='object' || !('userId' in input) || typeof input.userId!=='string' || !('phone' in input) || typeof input.phone!=='string') throw new Error('Invalid account input');
      const user=await db.get('users',input.userId);
      if (!user || user.status!=='active' || user.deletedAt!==null) throw new Error('Active business user required');
      const password='password' in input && typeof input.password==='string' ? input.password : randomBytes(24).toString('base64url');
      const uid='local_'+randomBytes(24).toString('hex');
      const now=new Date().toISOString();
      auth.provision(uid,input.phone,password);
      try {
        await db.runTransaction(async tx=>{
          if (!await tx.create('auth_identities',{_id:'aid_'+uid,organizationId:user.organizationId,schemaVersion:1,version:1,deletedAt:null,createdAt:now,updatedAt:now,userId:user._id,provider:'cloudbase_uid',providerSubjectDigest:crypto.subjectDigest.digest('cloudbase:username:'+uid),status:'active',verifiedAt:now,lastUsedAt:null})) throw new Error('Identity collision');
        });
      } catch (error) {auth.removeUnactivatedAccount(uid);throw error;}
      writeFileSync(join(data,'provisioned-'+uid+'.json'),JSON.stringify({userId:user._id,phone:input.phone,password},null,2),{mode:0o600,flag:'wx'});
      console.log('Local login linked to the existing business user. Credentials saved privately.');
    } else if (process.argv[2]==='reset-password') {
      const file=process.env.YAREI_ACCOUNT_FILE;if(!file)throw new Error('Protected account input required');
      const input:unknown=JSON.parse(readFileSync(file,'utf8'));
      if(!input||typeof input!=='object'||!('uid' in input)||typeof input.uid!=='string'||!/^[A-Za-z0-9_-]+$/.test(input.uid))throw new Error('Invalid account');
      const password=randomBytes(24).toString('base64url');
      const destination=join(data,'reset-'+Date.now()+'-'+input.uid+'.json');
      writeFileSync(destination,JSON.stringify({uid:input.uid,password}),{mode:0o600,flag:'wx'});
      auth.resetPassword(input.uid,password);console.log('Password updated; existing sessions revoked. Credentials saved privately.');
    } else if (process.argv[2]==='import') {
      const file=process.env.YAREI_IMPORT_FILE;
      if (!file) throw new Error('YAREI_IMPORT_FILE required');
      const input: unknown=JSON.parse(readFileSync(file,'utf8'));
      if (!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Expected collection-to-documents object');
      let count=0;
      await db.runTransaction(async tx=>{
        for (const [collection,docs] of Object.entries(input)) {
          if (!/^[a-z][a-z0-9_]{0,63}$/.test(collection) || !Array.isArray(docs)) throw new Error('Invalid import collection');
          for (const item of docs) {
            if (!item || typeof item!=='object' || item.schemaVersion!==1 || typeof item.organizationId!=='string') throw new Error('Invalid imported record');
            if (!await tx.create(collection,item as VersionedDocument)) throw new Error('Import collision; refusing overwrite');
            count++;
          }
        }
      });
      console.log('Imported documents: '+count+'. Authentication mapping and media require separate verification.');
    } else console.log('Commands: init-admin | provision | reset-password | import. Stop the service before operator writes; back up data first.');
  } finally {await db.close();auth.close();}
}
void main().catch(()=>{console.error('Operator failed; check configuration and import schema. No sensitive details logged.');process.exitCode=1;});
