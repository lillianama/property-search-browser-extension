const {JSDOM}=require('jsdom'),fs=require('node:fs');
function showcase(){const dom=new JSDOM(fs.readFileSync(__dirname+'/fixtures/showcase-header.html','utf8'));const {document,HTMLElement}=dom.window;Object.defineProperty(HTMLElement.prototype,'innerText',{get(){return this.textContent}});HTMLElement.prototype.getClientRects=function(){return [{}]};return {document,url:document.querySelector('link').href,style:n=>dom.window.getComputedStyle(n)}}
module.exports=showcase;
