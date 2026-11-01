const fs=require('fs'),vm=require('vm'),net=require('net'),{spawn}=require('child_process'),puppeteer=require('puppeteer');
const endpoint=process.argv[2];
const bridgeCode='import sys,socket,select,os\ns=socket.create_connection(("127.0.0.1",9222))\nwhile True:\n r,_,_=select.select([sys.stdin.buffer,s],[],[])\n if s in r:\n  b=s.recv(65536)\n  if not b: break\n  os.write(1,b)\n if sys.stdin.buffer in r:\n  b=os.read(0,65536)\n  if not b: break\n  s.sendall(b)';
(async()=>{
 const sockets=new Set();const bridge=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));const child=spawn('docker',['exec','-i','nova-nest-chromium','python3','-u','-c',bridgeCode],{stdio:['pipe','pipe','ignore']});socket.pipe(child.stdin);child.stdout.pipe(socket);socket.on('close',()=>child.kill());child.on('close',()=>socket.destroy())});
 await new Promise(r=>bridge.listen(0,'127.0.0.1',r));const port=bridge.address().port;let browser;
 try {
  const info=await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();browser=await puppeteer.connect({browserWSEndpoint:info.webSocketDebuggerUrl.replace('127.0.0.1:9222',`127.0.0.1:${port}`)});
  const page=await browser.newPage();await page.setViewport({width:1280,height:900});
  const input={street:'777 Browser Test Ave, Apt J25',zip:'97209',zpid:'889977',mls:'NOVA889977'},fixture=require('./condo-fixture.cjs').fixture(input),canonical=fixture.url,html=fixture.document.documentElement.outerHTML;
  await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()&&r.url()===canonical?r.respond({status:200,contentType:'text/html',body:html}):r.abort());await page.goto(canonical,{waitUntil:'domcontentloaded'});
  let listener;const bodies=[],acks=[];const extract=require('../extract.js');
  const chrome={runtime:{id:'extension',onMessage:{addListener:f=>listener=f}},storage:{local:{setAccessLevel:async()=>{},get:async()=>({origin:'https://dashboard.test',token:'test-token'})}},tabs:{get:async()=>({url:canonical})},permissions:{contains:async()=>true}};
  vm.runInNewContext(fs.readFileSync('worker.js','utf8'),{chrome,URL,AbortSignal,TextEncoder,importScripts:()=>{},ZillowExtract:extract,fetch:async(_url,init)=>{bodies.push(JSON.parse(init.body));return fetch(endpoint,{...init,headers:{...init.headers,Origin:'chrome-extension://abcdefghijklmnopabcdefghijklmnop'}})}});
  await page.exposeFunction('__novaSend',message=>new Promise(resolve=>listener(message,{id:'extension',frameId:0,tab:{id:1,url:canonical},url:canonical},r=>{acks.push(r);resolve(r)})));
  await page.evaluate(()=>{globalThis.chrome={runtime:{getManifest:()=>({version:'test'}),sendMessage:m=>globalThis.__novaSend(m)}}});
  for(const file of ['dom-fields.js','capture-requests.js','extract.js','content.js'])await page.addScriptTag({content:fs.readFileSync(file,'utf8')});
  await page.waitForSelector('[data-nova-nest] div >>> [data-add]',{timeout:10000});
  await page.$eval('[data-nova-nest] div >>> [data-add]',el=>el.click());
  if(bodies.some(x=>x.action))throw Error('synthetic click invoked intake');
  await page.click('[data-nova-nest] div >>> [data-add]');
  await page.waitForFunction(()=>/Saved|Checked; no changes/.test(document.querySelector('[data-nova-nest]')?.textContent||''),{timeout:15000});
  const first=bodies.find(x=>x.field==='listing'),again=bodies.filter(x=>x.field==='listing');if(!first||again.length<2||first.captureId!==again[1].captureId||!bodies.some(x=>x.action==='watchlist-intake')||!bodies.some(x=>x.field==='bedrooms'))throw Error('capture batch not reused');
  console.log(JSON.stringify({syntheticRejected:true,listingRetries:again.length,identicalCapture:first.captureId===again[1].captureId,requests:bodies.length,acks}));await page.close();
 }finally{if(browser)await browser.disconnect();for(const s of sockets)s.destroy();bridge.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
