// Sanitized synthetic DOM regression, not a saved or verified live Zillow DOM.
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
function fixture(label='Sold for $439,000',history=true) {
  const dom=new JSDOM(fs.readFileSync(__dirname+'/fixtures/sold-label.html','utf8'));
  const {document,HTMLElement}=dom.window;
  Object.defineProperty(HTMLElement.prototype,'innerText',{get(){return this.textContent}});
  HTMLElement.prototype.getClientRects=function(){return [{}]};
  document.querySelector('[data-testid="gallery-status-pill"]').textContent=label;
  if (!history) document.querySelector('table').remove();
  return {document,url:document.querySelector('link').href,style:n=>dom.window.getComputedStyle(n)};
}
module.exports=fixture;
