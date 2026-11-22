import os,sys,json,time,hmac,hashlib,importlib.util,pathlib
base=pathlib.Path('/opt/yarei/inference');data=pathlib.Path('/var/lib/yarei-v0128');secret=json.loads((data/'secrets.json').read_text())['batchReviewSigningKey']
os.environ.update(VOICE_INTERNAL_SECRET=secret,VOICE_ALLOWED_MEDIA_HOST='video.aimanhua.xin',VOICE_BENCHMARK_LOG='1',QWEN_TRIAL_INTERNAL_SECRET=secret,QWEN_TRIAL_MODEL_VERSION='qwen3-0.6b-q4_0-b11345',QWEN_TRIAL_PROMPT_VERSION='teacher-v13')
report=[]
for name,file,job in [('pronunciation-inference','inference.py',{'action':'modelCheck','operationId':'migration_model_check'}),('teacher-suggestion-inference-trial','index.py',{'action':'health','operationId':'migration_model_check'})]:
 folder=base/name;sys.path.insert(0,str(folder));spec=importlib.util.spec_from_file_location(name,folder/file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 t=int(time.time());signed={'job':job,'timestamp':t,'signature':hmac.new(secret.encode(),(str(t)+'\n'+json.dumps(job,sort_keys=True,separators=(',',':'))).encode(),hashlib.sha256).hexdigest()}
 result=module.main(signed,None);report.append({'worker':name,'result':result});assert result['ok'],result
 if name.startswith('teacher'):
  job={'operationId':'migration_synthetic_check','modelVersion':'qwen3-0.6b-q4_0-b11345','promptVersion':'teacher-v13','facts':[{'id':'fact_1','text':'题干“Choose the correct word: I see a cat.”；学生作答“cat”。'},{'id':'fact_2','text':'题干“Translate: 小狗”；学生作答“dag”；参考答案“dog”。'}]};t=int(time.time());signed={'job':job,'timestamp':t,'signature':hmac.new(secret.encode(),(str(t)+'\n'+json.dumps(job,ensure_ascii=False,sort_keys=True,separators=(',',':'))).encode(),hashlib.sha256).hexdigest()}
  start=time.monotonic();result=module.main(signed,None);report.append({'worker':name,'check':'synthetic_generation','ok':result.get('ok'), 'code':result.get('code'),'elapsedSeconds':round(time.monotonic()-start,2),'textLength':len(result.get('text',''))});assert result['ok'],result
(data/'inference-smoke.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
