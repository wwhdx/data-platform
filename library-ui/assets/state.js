export const $=id=>document.getElementById(id);
export const kinds={paper:'文献',indicator:'指标',entity:'生物 / 材料',trial:'临床试验',patent:'专利',activity:'社区 / 行情',video:'视频',other:'其他'};
export const states={fulltext:'全文',abstract:'摘要',metadata:'元数据',structured:'数据'};
export const origins={raw:'原始 JSON 镜像',export:'历史 JSON 导出',legacy_db:'旧库备份',current_db:'当前库快照',database:'数据库'};
export const state={dataset:null,sources:[],page:null,selected:null,document:null,tab:'body',versions:null,series:null,pageStack:[],request:null,bodyRequest:null};
export function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function count(value){return Number(value??0).toLocaleString('zh-CN');}
export function time(value,short=false){if(!value)return '—';const d=new Date(value);if(!Number.isFinite(d.getTime()))return String(value);return new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',...(short?{}:{hour:'2-digit',minute:'2-digit'}),hour12:false}).format(d);}
export function label(value){if(value==null)return '—';if(typeof value==='object')return JSON.stringify(value);return String(value);}
export function urlParams(){return new URL(location.href).searchParams;}
export function queryParams(){const p=urlParams(),q=new URLSearchParams();for(const key of ['dataset','source','kind','availability','q','scope','order','from','to','limit','cursor'])if(p.get(key))q.set(key,p.get(key));return q;}
export async function api(path,params={},signal){const url=new URL(`/api/library/${path}`,location.origin);for(const [k,v]of params instanceof URLSearchParams?params.entries():Object.entries(params))if(v!=null&&v!=='')url.searchParams.set(k,v);const response=await fetch(url,{signal,headers:{Accept:'application/json'}});if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('会话已过期或服务返回异常，请刷新页面');const data=await response.json();if(!response.ok){const error=new Error(data.error??`请求失败 (${response.status})`);error.status=response.status;throw error;}return data;}
export function updateUrl(changes,{replace=false}={}){const url=new URL(location.href);for(const [k,v]of Object.entries(changes))if(v==null||v==='')url.searchParams.delete(k);else url.searchParams.set(k,String(v));const historyState={...history.state,listTop:$('records').scrollTop,pageStack:state.pageStack};history.replaceState(historyState,'');history[replace?'replaceState':'pushState']({listTop:0,pageStack:state.pageStack},'',url);}
export function downloads(body){const p=new URLSearchParams({dataset:state.dataset.id,key:body.item.key});if(body.version)p.set('version',body.version);return{raw:`/api/library/raw?${p}`,text:`/api/library/text?${p}`};}
export function announce(message){$('status').textContent=message;}
export function formFromUrl(){const p=urlParams();for(const id of ['q','kind','availability','scope','order','from','to','limit']){$(id).value=p.get(id)??({scope:'title',order:'fetched',limit:'50'}[id]??'');}}
