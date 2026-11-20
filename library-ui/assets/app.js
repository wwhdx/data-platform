import{$,state,api,announce,formFromUrl,queryParams,updateUrl,urlParams,count,time}from'./state.js';
import{renderSources,renderPage,markSelected,renderOverview}from'./list.js';
import{renderDocument,renderTab,bodyError}from'./reader.js';
import{renderVersions,renderSeries}from'./versions.js';
const cache=new Map();
async function loadPage({keepDoc=false}={}){
 state.request?.abort();const controller=new AbortController();state.request=controller;
 const p=queryParams(),signature=p.toString(),restore=history.state?.listTop??0;
 $('loading').hidden=false;$('error').hidden=true;$('records').setAttribute('aria-busy','true');
 try{
  const page=cache.get(signature)??await api('documents',p,controller.signal);
  if(controller.signal.aborted)return;
  cache.set(signature,page);if(cache.size>6)cache.delete(cache.keys().next().value);
  state.page=page;state.dataset=page.dataset;
  const key=keepDoc&&urlParams().get('doc')?urlParams().get('doc'):page.rows[0]?.key;
  state.selected=key??null;renderPage();$('list-columns').hidden=false;
  requestAnimationFrame(()=>$('records').scrollTop=restore);
  if(key)void openDocument(key,keepDoc?urlParams().get('version'):null,{replace:true,reveal:false});
  else{$('reader').innerHTML='<div class="empty"><strong>当前筛选下没有记录</strong><p>调整条件后继续阅览。</p></div>';state.document=null;}
  if(urlParams().get('view')==='sources')renderOverview();
  announce(`全库 ${count(page.dataset.documents)} 条 · 本批 ${page.rows.length} 条${page.hasMore?' · 可继续翻页':' · 结果末尾'} · 只读快照`);
 }catch(error){if(error.name!=='AbortError'){$('error').hidden=false;$('error').textContent=`${error.message}。已有列表保留，可重试搜索。`;announce('加载失败，保留上次成功结果');}}
 finally{if(state.request===controller){$('loading').hidden=true;$('records').removeAttribute('aria-busy');}}
}
async function openDocument(key,version=null,{replace=false,reveal=true}={}){
 state.bodyRequest?.abort();const controller=new AbortController();state.bodyRequest=controller;
 state.selected=key;state.versions=null;state.series=null;state.tab='body';
 updateUrl({doc:key,version},{replace});markSelected();
 if(reveal)document.body.classList.add('reading');
 $('reader').setAttribute('aria-busy','true');
 try{const body=await api('document',{key,dataset:state.dataset.id,version},controller.signal);
  if(controller.signal.aborted)return;renderDocument(body);$('reader').scrollTop=0;syncFocus();
 }catch(error){if(error.name!=='AbortError')bodyError(error.message);}
 finally{if(state.bodyRequest===controller)$('reader').removeAttribute('aria-busy');}
}
function clearPaging(){state.pageStack=[];document.body.classList.remove('reading');}
function changeFilters(){const changes={cursor:null,doc:null,version:null,view:null};for(const [k,v]of new FormData($('filters')))changes[k]=String(v);clearPaging();updateUrl(changes);void loadPage();}
function selectSources(source,multi=false){const selected=new Set((urlParams().get('source')??'').split(',').filter(Boolean));if(!multi)selected.clear();if(source){if(selected.has(source))selected.delete(source);else selected.add(source);}else selected.clear();clearPaging();updateUrl({source:[...selected].sort().join(','),cursor:null,doc:null,version:null,view:null});document.body.classList.remove('nav-open');void loadPage();}
function syncFocus(){const active=document.body.classList.contains('focus-reading');const button=$('reader').querySelector('[data-focus]');if(button){button.textContent=active?'收起阅读':'展开阅读';button.setAttribute('aria-pressed',String(active));}}
function backToList(){document.body.classList.remove('reading','focus-reading');syncFocus();$('records').querySelector('[aria-current=true]')?.focus();}
function switchTab(tab){state.tab=tab;renderTab();if(tab==='versions')void renderVersions();if(tab==='series')void renderSeries();}
$('filters').addEventListener('submit',event=>{event.preventDefault();changeFilters();});
for(const id of ['scope','kind','availability','order','limit'])$(id).addEventListener('change',changeFilters);
$('reset').addEventListener('click',()=>{clearPaging();updateUrl({source:null,kind:null,availability:null,q:null,scope:null,order:null,from:null,to:null,cursor:null,doc:null,version:null,view:null});formFromUrl();void loadPage();});
$('source-search').addEventListener('input',renderSources);
$('source-order').addEventListener('change',async()=>{try{const result=await api('bootstrap',{dataset:state.dataset.id,order:$('source-order').value});state.sources=result.rows;renderSources();if(urlParams().get('view')==='sources')renderOverview();}catch(error){announce(error.message);}});
$('sources').addEventListener('click',event=>{const button=event.target.closest('[data-source]');if(button)selectSources(button.dataset.source,event.ctrlKey||event.metaKey);});
$('all-sources').addEventListener('click',()=>selectSources(null));
$('toggle-nav').addEventListener('click',()=>{const active=document.body.classList.toggle('nav-open');$('toggle-nav').setAttribute('aria-expanded',String(active));});
$('records').addEventListener('click',event=>{const source=event.target.closest('[data-overview-source]');if(source){selectSources(source.dataset.overviewSource);return;}const row=event.target.closest('[data-key]');if(row&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){event.preventDefault();void openDocument(row.dataset.key);}});
$('records').addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp','Enter'].includes(event.key)||!state.page?.rows.length)return;event.preventDefault();const current=state.page.rows.findIndex(r=>r.key===state.selected);const index=event.key==='ArrowDown'?Math.min(state.page.rows.length-1,current+1):event.key==='ArrowUp'?Math.max(0,current-1):Math.max(0,current);void openDocument(state.page.rows[index].key,null,{replace:true,reveal:event.key==='Enter'});$('records').querySelector(`[data-key="${state.page.rows[index].key}"]`)?.scrollIntoView({block:'nearest'});});
$('next').addEventListener('click',()=>{if(!state.page?.nextCursor)return;state.pageStack.push(urlParams().get('cursor'));updateUrl({cursor:state.page.nextCursor,doc:null,version:null});void loadPage();});
$('previous').addEventListener('click',()=>{if(!state.pageStack.length)return;updateUrl({cursor:state.pageStack.pop(),doc:null,version:null});void loadPage();});
$('first').addEventListener('click',()=>{clearPaging();updateUrl({cursor:null,doc:null,version:null});void loadPage();});
$('browse').addEventListener('click',()=>{updateUrl({view:null});$('list-columns').hidden=false;renderPage();});
$('overview').addEventListener('click',()=>{updateUrl({view:'sources'});renderOverview();});
$('density').addEventListener('click',()=>{const comfortable=document.body.classList.toggle('comfortable');localStorage.setItem('library-density',comfortable?'comfortable':'compact');$('density').textContent=comfortable?'舒适':'紧凑';$('density').setAttribute('aria-pressed',String(!comfortable));});
$('reader').addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.tab)switchTab(button.dataset.tab);
 if(button.dataset.version)void openDocument(state.selected,button.dataset.version);
 if(button.dataset.observation)void openDocument(button.dataset.observation);
 if(button.hasAttribute('data-current'))void openDocument(state.selected);
 if(button.hasAttribute('data-back'))backToList();
 if(button.hasAttribute('data-focus')){document.body.classList.toggle('focus-reading');syncFocus();}
 if(button.hasAttribute('data-copy'))void navigator.clipboard.writeText(location.href).then(()=>announce('记录链接已复制')).catch(()=>announce('可从地址栏复制当前记录链接'));
 if(button.hasAttribute('data-more-versions'))void renderVersions(true);
 if(button.hasAttribute('data-more-series'))void renderSeries(true);
 if(button.hasAttribute('data-retry-tab'))switchTab(state.tab);
 if(button.hasAttribute('data-retry-body'))void openDocument(state.selected,urlParams().get('version'));
});
document.addEventListener('keydown',event=>{if(event.key==='Escape')backToList();if(event.key==='/'&&!event.target.closest('input,select,textarea')){event.preventDefault();$('q').focus();}});
window.addEventListener('popstate',()=>{state.pageStack=history.state?.pageStack??[];formFromUrl();void loadPage({keepDoc:true});});
const divider=$('divider');divider.tabIndex=0;divider.setAttribute('aria-valuemin','35');divider.setAttribute('aria-valuemax','65');
function setRatio(value){const ratio=Math.max(.35,Math.min(.65,value));document.documentElement.style.setProperty('--list-weight',`${ratio/(1-ratio)}fr`);divider.dataset.ratio=String(ratio);divider.setAttribute('aria-valuenow',String(Math.round(ratio*100)));localStorage.setItem('library-ratio',String(ratio));}
divider.addEventListener('pointerdown',event=>{divider.setPointerCapture(event.pointerId);});
divider.addEventListener('pointermove',event=>{if(!divider.hasPointerCapture(event.pointerId))return;const rect=$('listing').getBoundingClientRect(),right=$('reader').getBoundingClientRect();setRatio((event.clientX-rect.left)/(right.right-rect.left));});
divider.addEventListener('pointerup',event=>{if(divider.hasPointerCapture(event.pointerId))divider.releasePointerCapture(event.pointerId);});
divider.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();setRatio(Number(divider.dataset.ratio??.5)+(event.key==='ArrowRight'?.025:-.025));}});
async function start(){
 formFromUrl();if(localStorage.getItem('library-density')==='comfortable')$('density').click();setRatio(Number(localStorage.getItem('library-ratio')??.535));
 try{const result=await api('bootstrap',{dataset:urlParams().get('dataset')});state.dataset=result.dataset;state.sources=result.rows;
  $('dataset').textContent=`${result.dataset.label} · ${count(result.dataset.documents)} 条`;
  $('dataset').title=`目录统计：${time(result.dataset.ready_at)}；各记录保留原始采集时间`;
  if(!urlParams().get('dataset'))updateUrl({dataset:result.dataset.id},{replace:true});
  renderSources();await loadPage({keepDoc:true});
 }catch(error){$('error').hidden=false;$('error').textContent=error.message;announce('目录连接失败，请刷新重试');}
}
void start();
