const {JSDOM}=require('jsdom');
// Minimized range/header/cache shape from the public 81st page. Whole-property
// variants are synthetic controls; the observed apartment is never a plex fact.
module.exports=function({street='1630-1632 NE 81st Ave',heading=street,homeType='MULTI_FAMILY',cacheStreet=street,zpid='53891611'}={}) {
 const url=`https://www.zillow.com/homedetails/${zpid}_zpid/`;
 const address={streetAddress:street,addressLocality:'Portland',addressRegion:'OR',postalCode:'97213'};
 const ld={url,offers:{itemOffered:{address}}};
 const property={zpid:Number(zpid),address:{streetAddress:cacheStreet,city:'Portland',state:'OR',zipcode:'97213'},homeType,livingArea:homeType==='APARTMENT'?813:1560};
 const next={props:{pageProps:{componentProps:{gdpClientCache:JSON.stringify({Property:{property}})}}}};
 const dom=new JSDOM(`<link rel="canonical" href="${url}"><script type="application/ld+json">${JSON.stringify(ld)}</script><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script><div id="layout-wrapper"><h1>${heading}, Portland, OR 97213</h1><span data-testid="gallery-status-pill">Off market</span></div>`);
 const {document,HTMLElement}=dom.window;
 Object.defineProperty(HTMLElement.prototype,'innerText',{get(){return this.textContent}});
 HTMLElement.prototype.getClientRects=function(){return [{}]};
 return {document,url,style:n=>dom.window.getComputedStyle(n)};
};
