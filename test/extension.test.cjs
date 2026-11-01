const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const extract = require('../extract.js');
const captureRequests = require('../capture-requests.js');
const url = 'https://www.zillow.com/homedetails/example/123_zpid/';
const script = JSON.stringify({url,offers:{price:500000}});
const flush=()=>new Promise(setImmediate);
test('bounded requests preserve all description bytes, history, rooms and photo entries',()=>{
  let n=0;const uuid=()=>`${String(++n).padStart(8,'0')}-1111-4111-8111-111111111111`;
  const description='🔥\n"'.repeat(2000);
  const observation={zpid:'123',url:'https://www.zillow.com/homedetails/123_zpid/',observedAt:'2026-01-01T00:00:00.000Z',status:'Off market',fields:{description,tax_history:[{year:2025,taxPaid:42}],listing_history:[{date:'2025-01-01',event:'Listed',kind:'sale'}],rooms:[{roomType:'bedroom',widthFt:9,lengthFt:10}],photos:['https://photos.zillowstatic.com/fp/a.jpg','https://photos.zillowstatic.com/fp/b.jpg']}};
  const requests=captureRequests.build(observation,uuid);
  assert.equal(requests.find(r=>r.field==='description').value,description);
  assert.ok(requests.every(r=>Buffer.byteLength(JSON.stringify(r))<=256000));
  assert.equal(requests.filter(r=>r.field==='photo_url').length,2);assert.ok(requests.some(r=>r.field==='published_room'));
  assert.throws(()=>captureRequests.build({...observation,fields:{unknown:'not silently dropped'}},uuid));
  const large=captureRequests.build({...observation,fields:{description:'a'.repeat(50000),heating:Array(30).fill('x'.repeat(200))}},uuid);
  assert.equal(large.length,3);assert.equal(large[1].field,'description');assert.equal(large[2].field,'heating');assert.ok(large.every(r=>Buffer.byteLength(JSON.stringify(r))<=256000));
});
test('projects only matching allowlisted property data from Next cache',()=>{
  const property={zpid:123,address:{streetAddress:'123 Example St',city:'Portland',state:'OR',zipcode:'97221'},bedrooms:3,bathrooms:2,livingArea:2100,lotSize:13503,description:'Public listing description',mlsid:'12345',zestimate:500000,rentZestimate:2500,resoFacts:{yearBuilt:1921,parkingFeatures:['Driveway']},originalPhotos:[{mixedSources:{jpeg:[{url:'https://photos.zillowstatic.com/fp/one.jpg?private=discard',width:800}]}}],taxHistory:[{year:2025,taxPaid:5000,value:999999}],mortgageZHLRates:{secret:'never'},attributionInfo:{agentEmail:'private@example.test'},adTargets:{secret:'never'}};
  const wrap=p=>JSON.stringify({props:{pageProps:{componentProps:{gdpClientCache:JSON.stringify({a:{property:p}})}}}});
  const address={streetAddress:'123 Example St',addressLocality:'Portland',addressRegion:'OR',postalCode:'97221'};
  const fields=extract.projectCache(wrap(property),'123',address);
  assert.equal(fields.bedrooms,3);assert.deepEqual(fields.tax_history,[{year:2025,taxPaid:5000}]);
  assert.deepEqual(fields.photos,['https://photos.zillowstatic.com/fp/one.jpg']);
  assert.doesNotMatch(JSON.stringify(fields),/private|secret|999999/);
  assert.equal(extract.projectCache(wrap(property),'124',address),null);
  assert.equal(extract.projectCache(wrap(property),'123',{...address,addressLocality:'Other'}),null);
});
test('identity, visible status and matching sale price are required', () => {
  assert.equal(extract.extract(url,[script],{status:['For sale'],price:['$500,000']}).price,500000);
  assert.equal(extract.extract(url,[script],{status:['Active'],price:['$500,000']}).status,'Active');
  for (const status of ['Inactive','Not Active','Active under contract']) assert.equal(extract.extract(url,[script],{status:[status],price:['$500,000']}),null);
  for (const status of ['Pending','Sold','For rent','Off market']) assert.equal(extract.extract(url,[script],{status:['Active',status],price:['$500,000']}),null);
  for (const status of ['Sold', 'Off market', 'Off-market', 'For rent']) {
    const result=extract.extract(url,[script],{status:[status],price:['$500,000']});
    assert.ok(result); assert.equal(result.price,undefined);
  }
  // The literal gallery-status-pill label on the Laidlaw page; the price
  // slot can display a Zestimate and must not become a sale asking price.
  const offMarket=extract.extract(url,[script],{status:['Off market'],price:['Zestimate®: $500,000']});
  assert.equal(offMarket.status,'Off market');assert.equal(offMarket.price,undefined);
  for (const evidence of [{status:['Not for sale'],price:['$500,000']},{status:['For sale'],price:['Zestimate $500,000']}]) assert.equal(extract.extract(url,[script],evidence),null);
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
  const context={chrome, URL, AbortSignal, TextEncoder, importScripts:()=>{}, ZillowExtract:extract, fetch:async()=>{fetched++; return {ok:true,json:async()=>ack}}};
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
test('worker sends bounded immutable field requests and aggregates only validated acknowledgements',async()=>{
  let listener; const bodies=[]; let failed=false;
  const chrome={runtime:{id:'extension',onMessage:{addListener:f=>listener=f}},storage:{local:{setAccessLevel:async()=>{},get:async()=>({origin:'https://dashboard.test',token:'not-visible'})}},tabs:{get:async()=>({url})},permissions:{contains:async()=>true}};
  const context={chrome,URL,AbortSignal,TextEncoder,importScripts:()=>{},ZillowExtract:extract,fetch:async(_url,init)=>{bodies.push(init.body);const request=JSON.parse(init.body);if(request.field==='description'&&!failed){failed=true;throw Error('temporary')}return {ok:true,json:async()=>({matched:true,zpid:'123',changedFields:request.field==='listing'?['status']:[request.field]})}}};
  vm.runInNewContext(fs.readFileSync('worker.js','utf8'),context);
  const base={zpid:'123',url:'https://www.zillow.com/homedetails/123_zpid/',observedAt:'2026-01-01T00:00:00.000Z'};
  const captures=[{...base,captureId:'11111111-1111-4111-8111-111111111111',field:'listing',value:{status:'Off market'}},{...base,captureId:'22222222-2222-4222-8222-222222222222',field:'description',value:'A public description'}];
  const sender={id:'extension',frameId:0,tab:{id:1,url},url};
  const result=await new Promise(resolve=>listener({type:'observe',observation:{...base,status:'Off market',captures}},sender,resolve));
  assert.equal(result.ok,true);assert.deepEqual(Array.from(result.changedFields),['status','description']);
  assert.equal(bodies.length,3);assert.equal(bodies[1],bodies[2]);assert.ok(bodies.every(x=>Buffer.byteLength(x)<=256000));
  assert.equal(JSON.parse(bodies[0]).value.price,undefined);assert.doesNotMatch(JSON.stringify(result),/not-visible/);
  const tooLarge={...captures[1],value:'x'.repeat(256000)};
  const before=bodies.length;const rejected=await new Promise(resolve=>listener({type:'observe',observation:{...base,status:'Off market',captures:[captures[0],tooLarge]}},sender,resolve));
  assert.equal(rejected.reason,'oversized');assert.equal(bodies.length,before);
});
test('manifest limits permissions to Zillow and optional HTTPS origins', () => {
  const m=JSON.parse(fs.readFileSync('manifest.json')); assert.deepEqual(m.permissions,['storage']); assert.deepEqual(m.host_permissions,['https://www.zillow.com/*']); assert.deepEqual(m.optional_host_permissions,['https://*/*']); assert.deepEqual(m.content_scripts[0].matches,['https://www.zillow.com/*']);
});
function harness(start='https://www.zillow.com/portland-or/') {
  let timer, interval, mutation, now=0, next=0, appended=0, toastText='', beforeExtract=()=>{};
  const location={href:start}, messages=[];
  const document={documentElement:{},body:{appendChild(element){appended++; toastText=element.textContent}},querySelectorAll(sel){beforeExtract();return sel.startsWith('script') ? [{textContent:script}] : [{innerText:sel.includes('chip') ? 'For sale' : '$500,000'}]},createElement(){return {style:{},setAttribute(){},contains(){return false},remove(){},set textContent(value){toastText=value},get textContent(){return toastText}}}};
  const context={location,document,ZillowCaptureRequests:captureRequests,ZillowExtract:{...extract,collect(document,start){return extract.extract(start, [...document.querySelectorAll('script')].map(x=>x.textContent), {status:document.querySelectorAll('chip').map(x=>x.innerText),price:document.querySelectorAll('price').map(x=>x.innerText)})}},getComputedStyle:()=>({}),crypto:{randomUUID:()=>`${String(++next).padStart(8,'0')}-1111-4111-8111-111111111111`},Date:{now:()=>now},MutationObserver:class {constructor(f){mutation=f} observe(){}},setTimeout:(f,delay)=>{timer={f,delay};return 1},clearTimeout:()=>{timer=null},setInterval:f=>{interval=f},chrome:{runtime:{sendMessage:message=>new Promise(resolve=>messages.push({message,resolve}))}}};
  vm.runInNewContext(fs.readFileSync('content.js','utf8'),context);
  return {location,messages,run(){const t=timer; timer=null; if(t){now+=t.delay; t.f()}}, interval:()=>interval(),mutation:()=>mutation([]),get appended(){return appended},get toastText(){return toastText},beforeExtract:f=>beforeExtract=f};
}
test('search-to-property SPA captures, toast only on changed acknowledgement, and deduplicates', async()=>{
  const h=harness();h.run();assert.equal(h.messages.length,0);h.location.href=url;h.interval();h.run();assert.equal(h.messages.length,1);
  h.messages[0].resolve({ok:true,changedFields:['price']});await flush();assert.equal(h.appended,1);assert.match(h.toastText,/Saved 1 detail/);h.mutation();h.run();assert.equal(h.messages.length,1);
});
test('failed retry preserves exact capture without mutations and malformed acknowledgement cannot toast',async()=>{
  const h=harness(url);h.run();const first=h.messages[0].message.observation;h.messages[0].resolve({ok:false});await flush();h.run();assert.deepEqual(h.messages[1].message.observation,first);
  h.messages[1].resolve({ok:true,changedFields:['unknown']});await flush();assert.match(h.toastText,/Could not save/);h.run();assert.deepEqual(h.messages[2].message.observation,first);
  h.messages[2].resolve({ok:true,changedFields:[]});await flush();assert.match(h.toastText,/Checked; no changes/);h.mutation();h.run();assert.equal(h.messages.length,3);
});
test('SPA changes during extraction and after response do not send or toast old property',async()=>{
  const a=harness(url);a.beforeExtract(()=>{a.location.href=url.replace('123','456')});a.run();assert.equal(a.messages.length,0);
  const b=harness(url);b.run();b.location.href=url.replace('123','456');b.messages[0].resolve({ok:true,changedFields:['price']});await flush();assert.doesNotMatch(b.toastText,/Captured/);
});

test('toast names each confirmed field', async()=>{ const h=harness(url); h.run(); h.messages[0].resolve({ok:true,changedFields:['price','status']}); await flush(); assert.match(h.toastText,/Saved 2 details/); });

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

test('worker returns safe actionable categories without server text', async()=>{
  let listener, mode='settings';
  const chrome={runtime:{id:'extension',onMessage:{addListener:f=>listener=f}},storage:{local:{setAccessLevel:async()=>{},get:async()=>({origin:mode==='settings'?'bad':'https://dashboard.test',token:'private-token'})}},tabs:{get:async()=>({url})},permissions:{contains:async()=>true}};
  const context={chrome,URL,AbortSignal,TextEncoder,importScripts:()=>{},ZillowExtract:extract,fetch:async()=>{if(mode==='network') throw Error('secret'); if(mode==='authorization') return {ok:false,status:401};return {ok:true,json:async()=>({matched:false,changedFields:[],message:'secret'})}}};
  vm.runInNewContext(fs.readFileSync('worker.js','utf8'),context);
  const sender={id:'extension',frameId:0,tab:{id:1,url},url};
  const send=()=>new Promise(resolve=>listener({type:'observe',observation:{zpid:'123',url:'https://www.zillow.com/homedetails/123_zpid/'}},sender,resolve));
  for(const category of ['settings','authorization','network','not-tracked']) {mode=category;const result=await send();assert.equal(result.reason,category);assert.doesNotMatch(JSON.stringify(result),/secret|private-token/)}
});
test('unreadable listing and repeated mutations produce visible status and cannot starve capture',async()=>{
  const h=harness(url); assert.match(h.toastText,/Zillow listing detected/); for(let i=0;i<100;i++) h.mutation(); h.run(); assert.equal(h.messages.length,1); assert.match(h.toastText,/Checking listing details/);
  h.messages[0].resolve({ok:false,reason:'not-tracked'});await flush();assert.match(h.toastText,/not tracked/);
  const unreadable=harness(url.replace('123','456'));unreadable.run();assert.match(unreadable.toastText,/Couldn't read listing/);assert.equal(unreadable.messages.length,0);
});

test('layout-wrapper requires canonical and nested structured address, visible heading and gallery status',()=>{
  const page='https://www.zillow.com/homedetails/example/123_zpid/';
  const ld={url:page,offers:{price:500000,itemOffered:{address:{streetAddress:'123 Example St'}}}};
  const node=text=>({nodeType:1,innerText:text,hidden:false,getClientRects(){return this.hidden?[]:[{}]},getAttribute:()=>null,closest:()=>null});
  const heading=node('123 Example St, Portland OR'),status=node('Pending'),price=node('$500,000');
  const root=node('');root.id='layout-wrapper';root.contains=()=>false;root.querySelectorAll=s=>s==='h1'?[heading]:s.includes('gallery-status-pill')?[status]:[price];
  let canonical=page;const doc={querySelector:()=>({href:canonical}),querySelectorAll:s=>s.startsWith('script')?[{textContent:JSON.stringify(ld)}]:[root]};const style=()=>({display:'block',visibility:'visible',opacity:'1'});
  let result=extract.collect(doc,page,style);assert.equal(result.zpid,'123');assert.equal(result.status,'Pending');assert.equal(result.price,500000);
  canonical=page.replace('123_zpid','456_zpid');assert.equal(extract.collect(doc,page,style),null);canonical=page;
  heading.innerText='456 Different St';assert.equal(extract.collect(doc,page,style),null);heading.innerText='123 Example St';
  status.hidden=true;assert.equal(extract.collect(doc,page,style),null);status.hidden=false;
  price.hidden=true;assert.equal(extract.collect(doc,page,style),null);
});

test('fixed extraction diagnostics distinguish failed evidence gates',()=>{
  const reasons=[];const diagnose=reason=>reasons.push(reason);const check=(expected,fn)=>{reasons.length=0;assert.equal(fn(),null);assert.equal(reasons[0],expected)};
  const evidence={status:['For sale'],price:['$500,000']};
  check('identity',()=>extract.extract('https://example.test/',[script],evidence,diagnose));
  check('status-missing',()=>extract.extract(url,[script],{...evidence,status:[]},diagnose));
  check('status-unsupported',()=>extract.extract(url,[script],{...evidence,status:['Coming soon']},diagnose));
  check('status-contradictory',()=>extract.extract(url,[script],{...evidence,status:['For sale','Pending']},diagnose));
  check('price-missing',()=>extract.extract(url,[script],{...evidence,price:[]},diagnose));
  check('price-ambiguous',()=>extract.extract(url,[script],{...evidence,price:['$500,000','$400,000']},diagnose));
  check('structured-identity',()=>extract.extract(url,[],evidence,diagnose));
  check('structured-price-mismatch',()=>extract.extract(url,[script],{...evidence,price:['$400,000']},diagnose));
  const node=text=>({nodeType:1,innerText:text,hidden:false,getClientRects(){return this.hidden?[]:[{}]},getAttribute:()=>null,closest:()=>null});
  const heading=node('123 Example St'),status=node('For sale'),price=node('$500,000'),root=node('');root.id='layout-wrapper';root.contains=()=>false;root.querySelectorAll=s=>s==='h1'?[heading]:s.includes('gallery-status-pill')?[status]:[price];
  let roots=[root],canonical=url,structured={url,offers:{price:500000,itemOffered:{address:{streetAddress:'123 Example St'}}}};
  const doc={querySelector:()=>({href:canonical}),querySelectorAll:s=>s.startsWith('script')?[{textContent:JSON.stringify(structured)}]:roots},style=()=>({display:'block',visibility:'visible',opacity:'1'});
  const collect=()=>extract.collect(doc,url,style,diagnose);
  roots=[];check('no-visible-container',collect);roots=[root];canonical=url.replace('123_zpid','456_zpid');check('canonical-mismatch',collect);canonical=url;
  structured.url=url.replace('123_zpid','456_zpid');check('structured-identity',collect);structured.url=url;
  structured.offers.itemOffered.address={};check('structured-address',collect);structured.offers.itemOffered.address={streetAddress:'123 Example St'};
  heading.innerText='999 Different St';check('heading-mismatch',collect);heading.innerText='123 Example St';
  roots=[root,{...root}];check('ambiguous-container',collect);roots=[root];status.hidden=true;check('status-missing',collect);
});

test('production scripts load the DOM collector and request builder before the observer',()=>{
  const manifest=JSON.parse(fs.readFileSync('manifest.json'));
  assert.deepEqual(manifest.content_scripts[0].js,['dom-fields.js','capture-requests.js','extract.js','content.js']);
  assert.deepEqual(manifest.web_accessible_resources,[{resources:['icons/nova-32.png'],matches:['https://www.zillow.com/*']}]);
  for (const n of [16,32,48,128]) assert.ok(fs.existsSync(manifest.icons[n]));
});
