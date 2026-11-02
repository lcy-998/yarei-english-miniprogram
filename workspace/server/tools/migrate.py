"""Offline create-only migration into an unused directory. No source mutations."""
import os,json,pathlib,sqlite3,hashlib,hmac,base64,secrets,shutil
os.umask(0o077)
source=pathlib.Path(os.environ['YAREI_SOURCE']);old=pathlib.Path(os.environ['YAREI_OLD_DATA']);target=pathlib.Path(os.environ['YAREI_NEW_DATA'])
assert not target.exists(),'Refusing existing migration destination'
target.mkdir(mode=0o700)
def load(p):return json.loads(p.read_text())
snapshot=load(source/'business-snapshot.json')
env=dict(line.split('=',1) for line in (source/'function-env/auth-session.env').read_text().splitlines() if '=' in line)
keys={'subjectPepper':'YAREI_SUBJECT_PEPPER','cursorSigningKey':'YAREI_QUERY_CURSOR_SIGNING_KEY','batchReviewSigningKey':'YAREI_BATCH_REVIEW_SIGNING_KEY','businessSessionEncryptionKey':'YAREI_BUSINESS_SESSION_ENCRYPTION_KEY','bindingCodeDerivationKey':'YAREI_BINDING_CODE_DERIVATION_KEY','bindingCodePepper':'YAREI_BINDING_CODE_PEPPER'}
config={k:env[v] for k,v in keys.items()}
(target/'secrets.json').write_text(json.dumps(config))
def digest(uid,pepper):return 'sd1_'+base64.urlsafe_b64encode(hmac.new(pepper.encode(),b'yarei:platform-subject:v1\0'+('cloudbase:username:'+uid).encode(),hashlib.sha256).digest()).decode().rstrip('=')
# SQLite backup API captures consistent source files, including WAL.
for name in ['business.sqlite','auth.sqlite']:
 src=sqlite3.connect(f'file:{old/name}?mode=ro',uri=True);dst=sqlite3.connect(target/name);src.backup(dst);dst.close();src.close()
db=sqlite3.connect(target/'business.sqlite');auth=sqlite3.connect(target/'auth.sqlite')
original=load(old/'secrets.json');oldaccounts=auth.execute('SELECT uid FROM accounts').fetchall()
with db:
 for uid, in oldaccounts:
  olddigest=digest(uid,original['subjectPepper']);newdigest=digest(uid,config['subjectPepper'])
  for cid,id,body in db.execute("SELECT collection,id,body FROM documents WHERE collection='auth_identities'").fetchall():
   doc=json.loads(body)
   if doc.get('providerSubjectDigest')==olddigest:
    doc['providerSubjectDigest']=newdigest;db.execute('UPDATE documents SET body=? WHERE collection=? AND id=?',(json.dumps(doc),cid,id))
 count=0
 for collection,docs in snapshot.items():
  for doc in docs:
   assert isinstance(doc.get('_id'),str)
   # Preserve original JSON byte semantics and missing legacy version fields.
   db.execute('INSERT INTO documents VALUES(?,?,?,?)',(collection,doc['_id'],doc.get('version',0),json.dumps(doc,ensure_ascii=False,separators=(',',':'))));count+=1
 assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
accounts=load(source/'users.json')['data'];delivery=[]
with auth:
 auth.execute('DELETE FROM tokens')
 for account in accounts:
  uid=account['Uid'];phone=account.get('Phone') or account['Name'];phone=phone.removeprefix('+86')
  matches=[x for x in snapshot['auth_identities'] if x.get('providerSubjectDigest')==digest(uid,config['subjectPepper'])]
  assert len(matches)<=1
  if matches: assert len(phone)==11 and phone.isdigit() and phone.startswith('1')
  password=secrets.token_urlsafe(24);salt=secrets.token_hex(24)
  password_hash=hashlib.scrypt(password.encode(),salt=salt.encode(),n=16384,r=8,p=1,dklen=32).hex()
  enabled=1 if account.get('UserStatus') in ('NORMAL','ACTIVE',None,'') else 0
  # Known export uses NORMAL; reject unrecognized status instead of activating blocked identities.
  assert account.get('UserStatus') in ('NORMAL','ACTIVE','DISABLED','BLOCKED',None,''),account.get('UserStatus')
  auth.execute('INSERT INTO accounts(uid,phone,salt,password_hash,enabled) VALUES(?,?,?,?,?)',(uid,phone,salt,password_hash,enabled))
  userids=[x['userId'] for x in matches];roles=[x['role'] for x in snapshot['role_assignments'] if x.get('userId') in userids]
  delivery.append({'phone':phone,'password':password,'uid':uid,'roles':roles,'businessUserIds':userids,'enabled':bool(enabled)})
(target/'migration-accounts.json').write_text(json.dumps(delivery,ensure_ascii=False,indent=2))
report={'version':'0.128.0','sourceRevision':'1644caef460dcc4bca16db9bcd223211859c8d1d','sourceCollections':len(snapshot),'sourceDocuments':count,'sourceAccounts':len(accounts),'matchedBusinessUsers':sum(bool(x['businessUserIds']) for x in delivery),'sourceUnmodified':True}
(target/'migration-report.json').write_text(json.dumps(report,indent=2));db.close();auth.close();print(json.dumps(report))
