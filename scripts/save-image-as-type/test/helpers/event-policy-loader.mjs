/** OFFLINE unit-fixture transform only. No production input activates it. */
export async function load(url,context,nextLoad) {
  const result=await nextLoad(url,context);
  if(url.endsWith('/src/ui/events.js')) {
    const source=String(result.source),policy='return event !== null && event !== undefined && event.isTrusted === true;';
    if(source.split(policy).length!==2)throw Error('Owned-event policy transform drift');
    return {...result,source:source.replace(policy,'return true;')};
  }
  return result;
}
