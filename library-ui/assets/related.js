const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
 '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
}[char]));
const labels = {country:'地区',date:'参考周期',period:'参考周期',value:'数值',unit:'单位',dimensions:'维度',
 indicator_code:'指标代码',indicator_name:'指标名称',organism:'物种',sequence_length:'序列长度',nct_id:'试验标识',
 phases:'阶段',conditions:'疾病 / 条件',score:'评分',descendants:'评论数',num_comments:'评论数',comment_count:'评论数',
 stars:'Stars',stargazers_count:'Stars',view_count:'播放量',like_count:'点赞数',cited_by_count:'被引次数',
 citationCount:'被引次数',citation_count:'被引次数','is-referenced-by-count':'被引次数','references-count':'参考文献数','reference-count':'参考文献数'};
const kinds = {descendants:'discussion',num_comments:'discussion',comment_count:'discussion',stars:'stars',
 stargazers_count:'stars',cited_by_count:'citations',citationCount:'citations',citation_count:'citations',
 'is-referenced-by-count':'citations','references-count':'references','reference-count':'references'};
function safeUrl(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}}
function anchor(link){const url=safeUrl(link.url);return url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(link.label)} ↗</a>`:'';}
export function renderLinks(body){return (body.links??[]).map(anchor).join('');}
export function renderFacts(values,links=[]){return `<dl class="facts">${Object.entries(values??{}).map(([key,value])=>{
 const shown=typeof value==='object'?JSON.stringify(value,null,2):value==null||value===''?'—':String(value);
 const link=links.find(item=>item.kind===kinds[key]),url=link&&safeUrl(link.url);
 return `<div><dt>${esc(labels[key]??key)}</dt><dd><pre>${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(shown)}</a>`:esc(shown)}</pre></dd></div>`;
}).join('')}</dl>`;}
export function renderRelated(body){
 const refs=(body.references??[]).filter(link=>safeUrl(link.url));
 const references=refs.length?`<section><h2>参考文献链接（${refs.length}/${esc(body.referenceTotal??refs.length)}）</h2><ol class="related-list">${refs.map(link=>`<li>${anchor(link)}</li>`).join('')}</ol></section>`:'';
 const comments=body.comments?.length?`<section><h2>评论摘录（${body.comments.length} 条）</h2><p class="muted">采集时的热门评论摘录，非完整评论区。</p><ol class="related-list">${body.comments.map(value=>`<li class="prose">${esc(value)}</li>`).join('')}</ol></section>`:'';
 return references+comments;
}
