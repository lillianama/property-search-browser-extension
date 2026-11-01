const fs=require('fs'),vm=require('vm'),net=require('net'),{spawn}=require('child_process'),puppeteer=require('puppeteer');
const assert=require('node:assert/strict'),path=require('node:path');
const outputDir=path.resolve('../property-search-browser-extension-artifacts/0.2.5-validation');fs.mkdirSync(outputDir,{recursive:true,mode:0o700});
const bridgeCode='import sys,socket,select,os\ns=socket.create_connection(("127.0.0.1",9222))\nwhile True:\n r,_,_=select.select([sys.stdin.buffer,s],[],[])\n if s in r:\n  b=s.recv(65536)\n  if not b: break\n  os.write(1,b)\n if sys.stdin.buffer in r:\n  b=os.read(0,65536)\n  if not b: break\n  s.sendall(b)';
(async()=>{
 const sockets=new Set();const bridge=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));const child=spawn('docker',['exec','-i','nova-ui-025','python3','-u','-c',bridgeCode],{stdio:['pipe','pipe','ignore']});socket.pipe(child.stdin);child.stdout.pipe(socket);socket.on('close',()=>child.kill());child.on('close',()=>socket.destroy())});
 await new Promise(r=>bridge.listen(0,'127.0.0.1',r));const port=bridge.address().port;let browser;
 try {
  const info=await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();browser=await puppeteer.connect({browserWSEndpoint:info.webSocketDebuggerUrl.replace('127.0.0.1:9222',`127.0.0.1:${port}`)});
  const page=await browser.newPage();await page.setViewport({width:1280,height:900});
  const input={street:'777 Browser Test Ave, Apt J25',zip:'97209',zpid:'889977',mls:'NOVA889977'},fixture=require('./condo-fixture.cjs').fixture(input);
  const html=process.env.NOVA_UI_HTML ? fs.readFileSync(process.env.NOVA_UI_HTML,'utf8').replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi,(m,a)=>/(?:application\/ld\+json|__NEXT_DATA__)/i.test(a)?m:'') : fixture.document.documentElement.outerHTML;
  const canonical=process.env.NOVA_UI_HTML ? html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/i)[1] : fixture.url;
  await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()&&r.url()===canonical?r.respond({status:200,contentType:'text/html',body:html}):r.abort());await page.goto(canonical,{waitUntil:'domcontentloaded'});
  // Chrome API bridge only: production content scripts, mocked worker, no intake endpoint.
  const requests=[];let release;
  await page.exposeFunction('__novaSend',async message=>{
   if(message.type==='observe')return {ok:false,reason:'not-tracked'};
   requests.push(message);
   return new Promise(resolve=>{release=resolve});
  });
  await page.evaluate(()=>{globalThis.chrome={runtime:{getManifest:()=>({version:'0.2.5'}),sendMessage:m=>globalThis.__novaSend(m)}}});
  await page.addStyleTag({content:'button,select {color:white !important;background:white !important;font-size:1px !important;opacity:0 !important}'});
  for(const file of ['dom-fields.js','capture-requests.js','extract.js','content.js'])await page.addScriptTag({content:fs.readFileSync(file,'utf8')});
  const add='[data-nova-nest] div >>> [data-add]',house='[data-nova-nest] div >>> [value=house]',plex='[data-nova-nest] div >>> [value=plex]';
  await page.waitForSelector(add);
  const selected=()=>page.$eval(house,e=>e.getAttribute('aria-checked'));
  const shot=async name=>{const target=outputDir+'/'+name+'.png';await (await page.$('[data-nova-nest]')).screenshot({path:target});fs.chmodSync(target,0o600)};
  assert.equal(await selected(),'true');
  assert.equal(await page.$eval(add,e=>getComputedStyle(e).opacity),'1');
  await shot('default-house');
  await page.$eval(add,e=>e.click());assert.equal(requests.length,0);
  await page.click(plex);assert.equal(await selected(),'false');assert.equal(requests.length,0);
  await page.evaluate(()=>document.body.appendChild(document.createElement('p')));
  await new Promise(resolve=>setTimeout(resolve,1200));
  assert.equal(await selected(),'false','same-listing DOM mutation must preserve Plex');
  await page.focus(plex);
  for(const [key,want] of [['Home','true'],['End','false'],['ArrowRight','true'],['ArrowLeft','false'],['ArrowUp','true'],['ArrowDown','false'],[' ','false'],['Enter','false']]){await page.keyboard.press(key);assert.equal(await selected(),want)}
  assert.equal(requests.length,0);await page.keyboard.press('Tab');await page.keyboard.press('Shift');await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');await shot('plex-focus');
  await page.hover(add);await shot('add-hover');
  await page.click(add);await page.waitForFunction(()=>document.querySelector('[data-nova-nest] div').shadowRoot.querySelector('[data-add]').disabled);
  assert.equal(requests[0].intake.track,'plex');
  assert.equal(await page.$eval(house,e=>e.disabled),true);await shot('in-flight');
  await page.click(house);assert.equal(await selected(),'false');
  release({ok:false,reason:'network'});
  await page.waitForFunction(()=>!document.querySelector('[data-nova-nest] div').shadowRoot.querySelector('[data-add]').disabled);
  await page.focus(add);await page.keyboard.press('Tab');await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
  assert.equal(await page.$eval(add,e=>getComputedStyle(e).outlineStyle),'solid');await shot('retry-focus');
  await page.click(add);await page.waitForFunction(()=>document.querySelector('[data-nova-nest] div').shadowRoot.querySelector('[data-add]').disabled);
  assert.deepEqual(requests[1],requests[0]);release({ok:true,status:'existing'});
  await page.waitForFunction(()=>document.querySelector('[data-nova-nest]').textContent.includes('Already tracked'));
  // A fresh offer accepts a trusted Add click with default House.
  await page.reload({waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{globalThis.chrome={runtime:{getManifest:()=>({version:'0.2.5'}),sendMessage:m=>globalThis.__novaSend(m)}}});
  for(const file of ['dom-fields.js','capture-requests.js','extract.js','content.js'])await page.addScriptTag({content:fs.readFileSync(file,'utf8')});
  await page.waitForSelector(add);await page.click(add);
  await page.waitForFunction(()=>document.querySelector('[data-nova-nest] div').shadowRoot.querySelector('[data-add]').disabled);
  assert.equal(requests[2].intake.track,'house');release({ok:true,status:'existing'});
  console.log(JSON.stringify({bridge:'mock Chrome API; not installed-extension acceptance',trustedHouse:true,trustedPlex:true,syntheticRejected:true,passiveSelection:true,keyboard:true,immutableRetry:true,screenshots:outputDir}));await page.close();
 }finally{if(browser)await browser.disconnect();for(const s of sockets)s.destroy();bridge.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
