/* Runs the unchanged original App A self-test suite in Chromium. */
const {chromium}=require('playwright');
const path=require('node:path'),fs=require('node:fs');
const {pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--allow-file-access-from-files']});
 const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try {
  await page.goto(pathToFileURL(path.resolve(__dirname, process.argv.includes('--vendor') ? '../vendor/grid-studio/tests.html' : '../../grid-studio/tests.html')).toString());
  await page.waitForFunction(()=>document.title==='PASS'||document.title.startsWith('FAIL'),{},{timeout:600000});
  const result={title:await page.title(),text:await page.locator('#out').innerText(),errors};
  fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,process.argv.includes('--vendor') ? '../test-results/vendor-grid.json' : '../test-results/original-grid.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  if(result.title!=='PASS'||errors.length)process.exitCode=1;
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
