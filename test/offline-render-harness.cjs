// Optional private-fixture harness. The container must run with --network none.
const fs=require('node:fs'),vm=require('node:vm'),net=require('node:net'),{spawn}=require('node:child_process'),puppeteer=require('puppeteer');
const [fixture,endpoint,outputDir]=process.argv.slice(2);
const source=fs.readFileSync(fixture,'utf8').replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi,(m,a)=>/(?:application\/ld\+json|__NEXT_DATA__)/i.test(a)?m:'');
const canonical=source.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i)?.[1] || source.match(/<link[^>]*href="([^"]+)"[^>]*rel="canonical"/i)?.[1];
if(!canonical) throw Error('fixture canonical missing');
const bridgeCode='import sys,socket,select,os\ns=socket.create_connection(("127.0.0.1",9222))\nwhile True:\n r,_,_=select.select([sys.stdin.buffer,s],[],[])\n if s in r:\n  b=s.recv(65536)\n  if not b: break\n  os.write(1,b)\n if sys.stdin.buffer in r:\n  b=os.read(0,65536)\n  if not b: break\n  s.sendall(b)';
(async()=>{
 const sockets=new Set(); const bridge=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));const child=spawn('docker',['exec','-i','nova-offline-render','python3','-u','-c',bridgeCode],{stdio:['pipe','pipe','ignore']});socket.pipe(child.stdin);child.stdout.pipe(socket);socket.on('close',()=>child.kill());child.on('close',()=>socket.destroy())});
 await new Promise(r=>bridge.listen(0,'127.0.0.1',r));const port=bridge.address().port;
 let browser;
 try {
  const info=await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  browser=await puppeteer.connect({browserWSEndpoint:info.webSocketDebuggerUrl.replace(/127\.0\.0\.1:9222/,`127.0.0.1:${port}`)});
  const page=await browser.newPage();await page.setViewport({width:1280,height:900});
  await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest() && r.url()===canonical ? r.respond({status:200,contentType:'text/html',body:source}) : r.abort());
  await page.setJavaScriptEnabled(false);await page.goto(canonical,{waitUntil:'domcontentloaded'});await page.setJavaScriptEnabled(true);
  let listener;const bodies=[], errors=[],acks=[];let loss=true,failures=0;
  const extract=require('../extract.js');
  const chrome={runtime:{id:'testextension',onMessage:{addListener:f=>listener=f}},storage:{local:{setAccessLevel:async()=>{},get:async()=>({origin:'https://dashboard.test',token:'test-token'})}},tabs:{get:async()=>({url:canonical})},permissions:{contains:async()=>true}};
  const context={chrome,URL,AbortSignal,TextEncoder,importScripts:()=>{},ZillowExtract:extract,fetch:async(_url,init)=>{const body=JSON.parse(init.body);bodies.push(body);if(new Set(bodies.map(x=>x.captureId)).size===5 && failures<2){failures++;return {ok:false,status:503}};const response=await fetch(endpoint,{...init,headers:{...init.headers,Origin:'chrome-extension://abcdefghijklmnopabcdefghijklmnop'}});if(loss){loss=false;await response.arrayBuffer();throw Error('lost response')}return response}};
  vm.runInNewContext(fs.readFileSync('worker.js','utf8'),context);
  await page.exposeFunction('__novaObserve',message=>new Promise(resolve=>listener(message,{id:'testextension',frameId:0,tab:{id:1,url:canonical},url:canonical},result=>{acks.push(result);resolve(result)})));
  const avatar=fs.readFileSync('icons/nova-32.png').toString('base64');
  await page.evaluate(avatar=>{globalThis.chrome={runtime:{getURL:()=>`data:image/png;base64,${avatar}`,getManifest:()=>({version:'0.2.0'}),sendMessage:m=>globalThis.__novaObserve(m)}}},avatar);
  for(const file of ['dom-fields.js','capture-requests.js','extract.js','content.js']) await page.addScriptTag({content:fs.readFileSync(file,'utf8')});
  try { await page.waitForFunction(()=>document.querySelector('[data-nova-nest]')?.textContent.includes('retrying'),{timeout:10000}); } catch { const status=await page.$eval('[data-nova-nest]',e=>e.textContent).catch(()=> 'missing'); throw Error(`state=${status}; requests=${bodies.length}; acknowledgements=${acks.length}`); }
  const partial=await page.$eval('[data-nova-nest]',e=>e.textContent);if(/saved/i.test(partial))throw Error('partial capture reported saved');
  await page.waitForFunction(()=>document.querySelector('[data-nova-nest]')?.textContent.includes('Saved '),{timeout:60000});
  await page.$eval('[data-nova-nest]',e=>e.scrollIntoView());await (await page.$('[data-nova-nest]')).screenshot({path:outputDir+'/nova-nest-badge.png'});
  const distinct=[...new Map(bodies.map(b=>[b.captureId,b])).values()];
  if(distinct.length<30 || bodies.some(b=>Buffer.byteLength(JSON.stringify(b))>256000) || acks[0]?.ok!==false || acks.at(-1)?.ok!==true || bodies[0].captureId!==bodies[1].captureId || JSON.stringify(bodies[0])!==JSON.stringify(bodies[1]))throw Error('capture/retry invariant failed');
  const options=await browser.newPage();await options.setViewport({width:800,height:600});await options.setContent(fs.readFileSync('options.html','utf8').replace('<script src="options.js"></script>','').replace('icons/nova-48.png',`data:image/png;base64,${fs.readFileSync('icons/nova-48.png').toString('base64')}`));await options.screenshot({path:outputDir+'/nova-nest-options.png'});await options.close();for(const name of ['nova-nest-badge.png','nova-nest-options.png'])fs.chmodSync(outputDir+'/'+name,0o600);
  console.log(JSON.stringify({unique:distinct.length,attempts:bodies.length,partialFailed:acks[0]?.ok===false,finalSaved:acks.at(-1)?.ok===true}));
 } finally {if(browser)await browser.disconnect();for(const s of sockets)s.destroy();bridge.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
