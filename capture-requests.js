(function(root) {
  const fields = new Set(['price','status','bedrooms','bathrooms','finished_sqft','year_built','lot_sqft','latitude','longitude','property_type','description','mls_number','annual_property_tax','annual_property_tax_year','zestimate','rent_zestimate','monthly_hoa_fee','parking_features','basement','heating','cooling','interior_features','exterior_features','appliances','roof','flooring','property_subtype','stories','unit_count','photo_url','tax_history','listing_history','published_room','unit_mix','parcel_id','structure_sqft','days_on_market','published_assessed_value','published_annual_tax_amount','laundry','windows','foundation','architectural_style','patio_porch','view','sewer','water','gas','listing_terms','has_hoa','new_construction','has_view','room_types','date_on_market']);
  const fingerprint = o => JSON.stringify([o.zpid,o.price,o.status,o.fields || {}]);
  function build(o, uuid = () => crypto.randomUUID()) {
    const base = {zpid:o.zpid,url:o.url,observedAt:o.observedAt};
    const f = o.fields || {};
    if ([f.parcel_id,f.mls_number].every(v => typeof v === 'string' && /^[A-Za-z0-9-]{1,40}$/.test(v))) base.identity = {parcelId:f.parcel_id,mlsNumber:f.mls_number};
    const make = (field,value) => ({...base,captureId:uuid(),field,value});
    const requests = [make('listing',{status:o.status,...(o.price === undefined ? {} : {price:o.price})})];
    const encoder = new TextEncoder();
    for (const [field,value] of Object.entries(o.fields || {})) {
      if (field === 'photos' || field === 'tax_history' || field === 'listing_history' || field === 'rooms') {
        if (!Array.isArray(value)) throw new Error('invalid list');
        const name = field === 'photos' ? 'photo_url' : field === 'rooms' ? 'published_room' : field;
        for (const item of value) requests.push(make(name,item));
      } else if (fields.has(field) && field !== 'price' && field !== 'status') requests.push(make(field,value));
      else throw new Error('unsupported field');
    }
    if (requests.length>500 || requests.some(r=>encoder.encode(JSON.stringify(r)).length>256000)) throw new Error('capture exceeds supported size');
    return requests;
  }
  root.ZillowCaptureRequests = {fields,fingerprint,build};
  if (typeof module !== 'undefined') module.exports = root.ZillowCaptureRequests;
})(globalThis);
