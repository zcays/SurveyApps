/* Direct checks for startup failure and stable lifecycle state; no Electron runtime needed. */
const assert=require('node:assert/strict');
const {Backend}=require('../desktop/backend.cjs');
const os=require('node:os'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'surveyapps-missing-engine-'));
 const b=new Backend({root:dir,resources:dir,packaged:true});
 try{
   const result=new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(new Error('No startup error delivered')),5000);
     b.on('status',s=>{if(s.state==='error'){clearTimeout(timer);resolve(s);}});
   });
   b.start();
   const status=await result;
   assert.match(status.message,/could not start/);
   assert.equal(b.origin,null);assert.equal(b.child,null);
   b.stop(); b.stop();
   console.log('PASS missing bundled executable produces actionable startup error; cleanup is idempotent');
 }finally{b.stop();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
