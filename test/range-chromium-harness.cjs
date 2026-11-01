const fs = require('node:fs');
const net = require('node:net');
const {spawn} = require('node:child_process');
const vm = require('node:vm');
const puppeteer = require('puppeteer');
const extractor = require('../extract.js');
const fixture = require('./range-fixture.cjs');

// Uses only synthetic page data and the caller's disposable authenticated endpoint.
(async () => {
  const endpoint = process.argv[2];
  if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(endpoint || '')) throw Error('disposable loopback endpoint required');
  let browser, bridge; const sockets = new Set();
  try {
    if (process.env.BROWSER_CHROMIUM_CONTAINER) {
      const proxy = 'import sys,socket,select,os\ns=socket.create_connection(("127.0.0.1",9222))\nwhile True:\n r,_,_=select.select([sys.stdin.buffer,s],[],[])\n if s in r:\n  b=s.recv(65536)\n  if not b: break\n  os.write(1,b)\n if sys.stdin.buffer in r:\n  b=os.read(0,65536)\n  if not b: break\n  s.sendall(b)';
      bridge = net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));const child=spawn('docker',['exec','-i',process.env.BROWSER_CHROMIUM_CONTAINER,'python3','-u','-c',proxy],{stdio:['pipe','pipe','ignore']});socket.pipe(child.stdin);child.stdout.pipe(socket);socket.on('close',()=>child.kill());child.on('close',()=>socket.destroy())});
      await new Promise(r=>bridge.listen(0,'127.0.0.1',r));const port=bridge.address().port;
      const info=await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      browser=await puppeteer.connect({browserWSEndpoint:info.webSocketDebuggerUrl.replace('localhost:9222',`127.0.0.1:${port}`).replace('127.0.0.1:9222',`127.0.0.1:${port}`)});
    } else browser = await puppeteer.launch({headless:true,args:['--no-sandbox']});
    const page = await browser.newPage();
    const f = fixture({homeType:'APARTMENT'}), bodies = [];
    await page.setRequestInterception(true);
    page.on('request', r => r.isNavigationRequest() && r.url() === f.url
      ? r.respond({status:200,contentType:'text/html',body:f.document.documentElement.outerHTML}) : r.abort());
    await page.goto(f.url,{waitUntil:'domcontentloaded'});
    let listener;
    const chrome = {runtime:{id:'extension',onMessage:{addListener:f=>listener=f}},storage:{local:{setAccessLevel:async()=>{},get:async()=>({origin:'https://dashboard.test',token:'test-token'})}},tabs:{get:async()=>({url:page.url()})},permissions:{contains:async()=>true}};
    vm.runInNewContext(fs.readFileSync('worker.js','utf8'),{chrome,URL,AbortSignal,TextEncoder,importScripts:()=>{},ZillowExtract:extractor,fetch:async(_,init)=>{
      bodies.push(JSON.parse(init.body));
      return fetch(endpoint,{...init,headers:{...init.headers,Origin:'chrome-extension://abcdefghijklmnopabcdefghijklmnop'}});
    }});
    await page.exposeFunction('__novaSend',message=>new Promise(resolve=>listener(message,{id:'extension',frameId:0,tab:{id:1,url:page.url()},url:page.url()},resolve)));
    await page.evaluate(()=>{globalThis.chrome={runtime:{getManifest:()=>({version:'0.2.8'}),sendMessage:m=>globalThis.__novaSend(m)}}});
    for (const file of ['capture-requests.js','extract.js','content.js']) await page.addScriptTag({content:fs.readFileSync(file,'utf8')});
    await page.waitForFunction(()=>/Whole property tracked; apartment capture blocked/.test(document.querySelector('[data-nova-nest]')?.textContent || ''),{timeout:10000});
    const hasControls = await page.$eval('[data-nova-nest]',n=>!!n.querySelector('button,div'));
    if (hasControls || bodies.length !== 1 || bodies[0].action !== 'tracking-lookup' || /813|finished_sqft|watchlist-intake/.test(JSON.stringify(bodies))) throw Error('blocked scope leaked into capture or intake');
    console.log(JSON.stringify({message:'Whole property tracked; apartment capture blocked',requests:bodies.length,noCapture:true,noIntake:true}));
  } finally { if (browser) { if (bridge) await browser.disconnect(); else await browser.close(); } for (const socket of sockets) socket.destroy(); bridge?.close(); }
})().catch(e=>{console.error(e.stack || e);process.exitCode=1});
