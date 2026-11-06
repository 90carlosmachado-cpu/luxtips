// Reconcile cards and day buttons without recreating unchanged DOM or images.
export function stableDom(target,markup) {
  const state=target.__luxtipsDom||(target.__luxtipsDom={markup:null,nodes:new Map()});
  if(state.markup===markup)return;
  const template=document.createElement('template');template.innerHTML=markup;
  function morph(old,fresh) {
    if(old.nodeType!==fresh.nodeType||old.nodeName!==fresh.nodeName){old.replaceWith(fresh);return fresh;}
    if(old.nodeType===3){if(old.nodeValue!==fresh.nodeValue)old.nodeValue=fresh.nodeValue;return old;}
    if(old.nodeType!==1)return old;
    for(const key of ['data-fixture','data-day'])if(old.hasAttribute(key)&&old.getAttribute(key)!==fresh.getAttribute(key)){old.replaceWith(fresh);return fresh;}
    // Native disclosure state belongs to the reader, not to the new markup.
    if(old.matches('details[data-analysis]'))fresh.open=old.open;
    if(old.matches('details[data-analysis] > summary'))fresh.setAttribute('aria-expanded',String(old.parentElement.open));
    if(old.classList.contains('loaded')&&fresh.classList.contains('crest'))fresh.classList.add('loaded');
    for(const a of [...old.attributes])if(!fresh.hasAttribute(a.name))old.removeAttribute(a.name);
    for(const a of fresh.attributes)if(old.getAttribute(a.name)!==a.value)old.setAttribute(a.name,a.value);
    const before=[...old.childNodes],after=[...fresh.childNodes];
    for(let i=0;i<after.length;i++)if(before[i])morph(before[i],after[i]);else old.append(after[i]);
    for(let i=after.length;i<before.length;i++)before[i].remove();
    return old;
  }
  const desired=[...template.content.childNodes].map((fresh,i)=>{
    const key=fresh.nodeType===1?(fresh.getAttribute('data-fixture')?'game:'+fresh.getAttribute('data-fixture'):fresh.getAttribute('data-day')?'day:'+fresh.getAttribute('data-day'):'position:'+i):'text:'+i;
    const cached=state.nodes.get(key),node=cached?morph(cached,fresh):fresh;
    state.nodes.set(key,node);return node;
  });
  for(let i=0;i<desired.length;i++)if(target.childNodes[i]!==desired[i])target.insertBefore(desired[i],target.childNodes[i]||null);
  while(target.childNodes.length>desired.length)target.lastChild.remove();
  state.markup=markup;
  if(state.nodes.size>200)for(const [key,node] of state.nodes)if(!desired.includes(node)){state.nodes.delete(key);if(state.nodes.size<=150)break;}
}
