const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const extract = require('../extract.js');
const url = 'https://www.zillow.com/homedetails/example/123_zpid/';
const script = JSON.stringify({url,offers:{price:500000}});
const flush=()=>new Promise(setImmediate);
test('identity, visible status and matching sale price are required', () => {
  assert.equal(extract.extract(url,[script],{status:['For sale'],price:['$500,000']}).price,500000);
  for (const evidence of [{status:['For rent'],price:['$500,000']},{status:['Not for sale'],price:['$500,000']},{status:['For sale'],price:['Zestimate $500,000']}]) assert.equal(extract.extract(url,[script],evidence),null);
  assert.equal(extract.extract(url,[JSON.stringify({url:url.replace('123','456'),offers:{price:500000}})],{status:['For sale'],price:['$500,000']}),null);
  for (const statuses of [['For sale','For rent'],['Pending','Sold'],['For sale','Off market'],['Pending','Off-market']]) assert.equal(extract.extract(url,[script],{status:statuses,price:['$500,000']}),null);
  assert.equal(extract.extract(url,[script],{status:['For sale','Pending'],price:['$500,000']}),null);
  assert.equal(extract.extract(url,[script],{status:['For sale'],price:['$500,000','$490,000']}),null);
  assert.equal(extract.identity('https://evil.test/homedetails/123_zpid/'),null);
  assert.equal(extract.identity('https://user@www.zillow.com/homedetails/123_zpid/'),null);
  assert.equal(extract.identity('http://www.zillow.com/homedetails/123_zpid/'),null);
  assert.equal(extract.identity('https://www.zillow.com:444/homedetails/123_zpid/'),null);
});
test('worker trusts only top frame, granted HTTPS origin and never returns credential or malformed acknowledgement', async () => {
  let listener, fetched = 0, access, granted = true, origin = 'https://dashboard.test', ack = {matched:true,zpid:'123',changedFields:['price']};
  const chrome = {runtime:{id:'extension',onMessage:{addListener:f=>listener=f}},storage:{local:{setAccessLevel:async x=>{access=x.accessLevel},get:async()=>({origin,token:'private-token'})}},tabs:{get:async()=>({url})},permissions:{contains:async()=>granted}};
  const context={chrome, URL, AbortSignal, importScripts:()=>{}, ZillowExtract:extract, fetch:async()=>{fetched++; return {ok:true,json:async()=>ack}}};
  vm.runInNewContext(fs.readFileSync('worker.js','utf8'),context);
  const send=(sender,o={zpid:'123',url:'https://www.zillow.com/homedetails/123_zpid/'})=>new Promise(resolve=>listener({type:'observe',observation:o},sender,resolve));
  const sender={id:'extension',frameId:0,tab:{id:1,url},url};
  assert.equal((await send({...sender,frameId:1})).ok,false);
  assert.equal((await send({...sender,tab:{id:1,url:url.replace('123','456')}})).ok,false);
  for (const badUrl of ['https://user@www.zillow.com/homedetails/123_zpid/','https://www.zillow.com:444/homedetails/123_zpid/','http://www.zillow.com/homedetails/123_zpid/']) { assert.equal((await send({...sender,url:badUrl})).ok,false); assert.equal((await send({...sender,tab:{id:1,url:badUrl}})).ok,false); }
  granted=false; assert.equal((await send(sender)).ok,false); granted=true;
  origin='http://dashboard.test'; assert.equal((await send(sender)).ok,false); origin='https://dashboard.test';
  let result=await send(sender); assert.equal(result.ok,true); assert.equal(JSON.stringify(result).includes('private-token'),false); assert.equal(access,'TRUSTED_CONTEXTS'); assert.equal(fetched,1);
  ack={matched:true,zpid:'123',changedFields:['price','unexpected']}; result=await send(sender); assert.equal(result.ok,false);
});
test('manifest limits permissions to Zillow and optional HTTPS origins', () => {
  const m=JSON.parse(fs.readFileSync('manifest.json')); assert.deepEqual(m.permissions,['storage']); assert.deepEqual(m.host_permissions,['https://www.zillow.com/*']); assert.deepEqual(m.optional_host_permissions,['https://*/*']); assert.deepEqual(m.content_scripts[0].matches,['https://www.zillow.com/*']);
});
function harness(start='https://www.zillow.com/portland-or/') {
  let timer, interval, mutation, now=0, next=0, appended=0, toastText='', beforeExtract=()=>{};
  const location={href:start}, messages=[];
  const document={documentElement:{},body:{appendChild(element){appended++; toastText=element.textContent}},querySelectorAll(sel){beforeExtract();return sel.startsWith('script') ? [{textContent:script}] : [{innerText:sel.includes('chip') ? 'For sale' : '$500,000'}]},createElement(){return {style:{},remove(){}}}};
  const context={location,document,ZillowExtract:{...extract,collect(document,start){return extract.extract(start, [...document.querySelectorAll('script')].map(x=>x.textContent), {status:document.querySelectorAll('chip').map(x=>x.innerText),price:document.querySelectorAll('price').map(x=>x.innerText)})}},getComputedStyle:()=>({}),crypto:{randomUUID:()=>`${String(++next).padStart(8,'0')}-1111-4111-8111-111111111111`},Date:{now:()=>now},MutationObserver:class {constructor(f){mutation=f} observe(){}},setTimeout:(f,delay)=>{timer={f,delay};return 1},clearTimeout:()=>{timer=null},setInterval:f=>{interval=f},chrome:{runtime:{sendMessage:message=>new Promise(resolve=>messages.push({message,resolve}))}}};
  vm.runInNewContext(fs.readFileSync('content.js','utf8'),context);
  return {location,messages,run(){const t=timer; timer=null; if(t){now+=t.delay; t.f()}}, interval:()=>interval(),mutation:()=>mutation(),get appended(){return appended},get toastText(){return toastText},beforeExtract:f=>beforeExtract=f};
}
test('search-to-property SPA captures, toast only on changed acknowledgement, and deduplicates', async()=>{
  const h=harness();h.run();assert.equal(h.messages.length,0);h.location.href=url;h.interval();h.run();assert.equal(h.messages.length,1);
  h.messages[0].resolve({ok:true,changedFields:['price']});await flush();assert.equal(h.appended,1);assert.match(h.toastText,/price/);assert.doesNotMatch(h.toastText,/status/);h.mutation();h.run();assert.equal(h.messages.length,1);
});
test('failed retry preserves exact capture without mutations and malformed acknowledgement cannot toast',async()=>{
  const h=harness(url);h.run();const first=h.messages[0].message.observation;h.messages[0].resolve({ok:false});await flush();h.run();assert.deepEqual(h.messages[1].message.observation,first);
  h.messages[1].resolve({ok:true,changedFields:['unknown']});await flush();assert.equal(h.appended,0);h.run();assert.deepEqual(h.messages[2].message.observation,first);
  h.messages[2].resolve({ok:true,changedFields:[]});await flush();assert.equal(h.appended,0);h.mutation();h.run();assert.equal(h.messages.length,3);
});
test('SPA changes during extraction and after response do not send or toast old property',async()=>{
  const a=harness(url);a.beforeExtract(()=>{a.location.href=url.replace('123','456')});a.run();assert.equal(a.messages.length,0);
  const b=harness(url);b.run();b.location.href=url.replace('123','456');b.messages[0].resolve({ok:true,changedFields:['price']});await flush();assert.equal(b.appended,0);
});

test('toast names each confirmed field', async()=>{ const h=harness(url); h.run(); h.messages[0].resolve({ok:true,changedFields:['price','status']}); await flush(); assert.match(h.toastText,/price/); assert.match(h.toastText,/status/); });

 test('DOM evidence comes only from one visible identified detail container', () => {
  const node=(text,id=null,hidden=false)=>({nodeType:1,hidden,innerText:text,parentElement:null,getClientRects:()=>[{}],getAttribute:()=>id,closest:()=>null});
  const price=node('$500,000'), status=node('For sale'), wrongStatus=node('Pending','456');
  wrongStatus.closest=()=>wrongStatus;
  let children=[status], roots=[];
  const root=node('', '123');root.contains=()=>false;root.querySelectorAll=s=>s.includes('chip')?children:[price];roots=[root];
  const doc={querySelector:()=>null,querySelectorAll:s=>s.startsWith('script')?[{textContent:script}]:roots};
  const style=()=>({display:'block',visibility:'visible',opacity:'1'});
  children=[status,wrongStatus];assert.equal(extract.collect(doc,url,style).status,'Active');
  const hidden=node('Pending',null,true);children=[status,hidden];assert.equal(extract.collect(doc,url,style).status,'Active');
  children=[status,node('Pending')];assert.equal(extract.collect(doc,url,style),null);
  children=[status];const other={...root};roots=[root,other];assert.equal(extract.collect(doc,url,style),null);
  roots=[root];root.getAttribute=()=> '456';assert.equal(extract.collect(doc,url,style),null);
 });
 test('manifest has a stable public key identity',()=>{const crypto=require('node:crypto');const m=JSON.parse(fs.readFileSync('manifest.json'));assert.equal(crypto.createPublicKey({key:Buffer.from(m.key,'base64'),format:'der',type:'spki'}).asymmetricKeyType,'rsa');});

 test('fallback detail container binds canonical URL, JSON-LD street address, and visible heading',()=>{
  const ld=JSON.stringify({url,address:{streetAddress:'123 Example St'},offers:{price:500000}});
  const node=text=>({nodeType:1,innerText:text,getClientRects:()=>[{}],getAttribute:()=>null,closest:()=>null});
  const heading=node('123 Example St, Portland OR');const root=node('');root.id='hdp-content';root.contains=()=>false;root.querySelectorAll=s=>s==='h1'?[heading]:[node(s.includes('chip')?'For sale':'$500,000')];
  let canonical=url;const doc={querySelector:()=>({href:canonical}),querySelectorAll:s=>s.startsWith('script')?[{textContent:ld}]:[root]};const style=()=>({display:'block',visibility:'visible',opacity:'1'});
  assert.equal(extract.collect(doc,url,style).price,500000);heading.innerText='456 Other St';assert.equal(extract.collect(doc,url,style),null);heading.innerText='123 Example St';canonical=url.replace('123_zpid','456_zpid');assert.equal(extract.collect(doc,url,style),null);
 });
