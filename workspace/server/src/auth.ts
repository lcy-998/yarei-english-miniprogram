import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SubjectDigestPort } from '../../m1-cloudbase/src/runtime/ports';
import type { NativeAccountProvider } from '../../m1-cloudbase/src/native-admin/account-service';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class LocalAuth {
  private readonly db: DatabaseSync;
  private inFlight = 0;
  private readonly dummy = randomBytes(32);
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS accounts(uid TEXT PRIMARY KEY,phone TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,password_hash TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS provisions(operation TEXT PRIMARY KEY,uid TEXT NOT NULL,phone TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens(digest TEXT PRIMARY KEY,uid TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);`);
  }
  provision(uid: string,phone: string,password: string): void {
    phone = normalizePhone(phone);
    if (!/^1\d{10}$/.test(phone) || password.length < 14 || password.length > 256) throw new Error('Invalid account credentials');
    const salt = randomBytes(24).toString('hex');
    this.db.prepare('INSERT INTO accounts(uid,phone,salt,password_hash) VALUES(?,?,?,?)').run(uid,phone,salt,scryptSync(password,salt,32).toString('hex'));
  }
  async login(phone: string,password: string,ip: string): Promise<string | null> {
    phone = normalizePhone(phone);
    const now = Date.now();
    this.db.prepare('DELETE FROM attempts WHERE expires<?').run(now);
    this.db.prepare('DELETE FROM tokens WHERE expires<?').run(now);
    const keys = ['ip:'+hash(ip),'phone:'+hash(phone)];
    for (const key of keys) {
      const row = this.db.prepare('SELECT count FROM attempts WHERE key=?').get(key);
      if (row && Number(row.count) >= (key.startsWith('ip:') ? 40 : 10)) return null;
    }
    if (this.inFlight >= 4 || password.length > 256 || !/^1\d{10}$/.test(phone)) return null;
    for (const key of keys) this.db.prepare('INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+900_000);
    this.inFlight++;
    try {
      const row = this.db.prepare('SELECT * FROM accounts WHERE phone=?').get(phone);
      const actual = await derive(password,row ? String(row.salt) : 'invalid-account-salt',32) as Buffer;
      const expected = row ? Buffer.from(String(row.password_hash),'hex') : this.dummy;
      if (!timingSafeEqual(actual,expected) || !row || row.enabled !== 1) return null;
      this.db.prepare('DELETE FROM attempts WHERE key=?').run(keys[1]);
      const token = randomBytes(32).toString('base64url');
      this.db.prepare('INSERT INTO tokens VALUES(?,?,?)').run(hash(token),String(row.uid),now+2*60*60*1000);
      return token;
    } finally {this.inFlight--;}
  }
  resolve(token: string): string | undefined {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    const row = this.db.prepare('SELECT t.uid FROM tokens t JOIN accounts a ON a.uid=t.uid WHERE t.digest=? AND t.expires>? AND a.enabled=1').get(hash(token),Date.now());
    return row ? String(row.uid) : undefined;
  }
  logout(token: string): void {this.db.prepare('DELETE FROM tokens WHERE digest=?').run(hash(token));}
  removeUnactivatedAccount(uid: string): void {
    this.db.prepare('DELETE FROM accounts WHERE uid=? AND NOT EXISTS(SELECT 1 FROM tokens WHERE uid=?)').run(uid,uid);
  }
  resetPassword(uid:string,password:string):void {
    if(password.length<14||password.length>256)throw new Error('Invalid password');
    const salt=randomBytes(24).toString('hex'),derived=scryptSync(password,salt,32).toString('hex');
    this.db.exec('BEGIN IMMEDIATE');try {
      if(this.db.prepare('UPDATE accounts SET salt=?,password_hash=? WHERE uid=? AND enabled=1').run(salt,derived,uid).changes!==1)throw new Error('Account unavailable');
      this.db.prepare('DELETE FROM tokens WHERE uid=?').run(uid);this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  nativeProvider(digest:SubjectDigestPort,data:string):NativeAccountProvider {
    return {
      mobileExists:async(phone,key)=>{const row=this.db.prepare('SELECT a.uid,p.operation FROM accounts a LEFT JOIN provisions p ON p.uid=a.uid WHERE a.phone=?').get(normalizePhone(phone));return !!row&&row.operation!==key;},
      provision:async(input,key)=>{
        const prior=this.db.prepare('SELECT uid,phone FROM provisions WHERE operation=?').get(key);
        if(prior){if(prior.phone!==normalizePhone(input.mobile))throw new Error('Provision conflict');return {platformUid:String(prior.uid),subjectDigest:digest.digest('cloudbase:username:'+prior.uid)};}
        const uid='ali_'+hash(key).slice(0,40),password=randomBytes(24).toString('base64url');
        const folder=join(data,'account-delivery');mkdirSync(folder,{recursive:true,mode:0o700});
        const file=join(folder,uid+'.json');
        if(existsSync(file))throw new Error('Provision requires operator reconciliation');
        writeFileSync(file,JSON.stringify({uid,phone:input.mobile,password}),{mode:0o600,flag:'wx'});
        this.db.exec('BEGIN IMMEDIATE');try{this.provision(uid,input.mobile,password);this.db.prepare('INSERT INTO provisions VALUES(?,?,?)').run(key,uid,normalizePhone(input.mobile));this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}
        return {platformUid:uid,subjectDigest:digest.digest('cloudbase:username:'+uid)};
      },
      blockUnlinked:async(receipt,key)=>{const row=this.db.prepare('SELECT uid FROM provisions WHERE operation=?').get(key);if(row?.uid===receipt.platformUid){this.db.prepare('UPDATE accounts SET enabled=0 WHERE uid=?').run(receipt.platformUid);this.db.prepare('DELETE FROM tokens WHERE uid=?').run(receipt.platformUid);}},
    };
  }
  close(): void {this.db.close();}
}
function normalizePhone(value: string): string {return value.replace(/^\+86/,'');}
