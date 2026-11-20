import { describe,it,expect } from "vitest";
import { normalizeDocument,sourceKind } from "../../library/normalize";
import { parseContentDate } from "../../library/dates";
import { chunks,clip,plain,redact } from "../../library/text";
const asOf=new Date("2026-11-20T10:00:00Z");
const base={id:"1",source_id:"crossref",external_id:"10.1/example",fetched_at:"2026-11-20 08:07:13.123456+00",industry_tag:null};
describe("library normalization",()=>{
 it("normalizes title arrays without changing original fetch precision",()=>{
  const {document}=normalizeDocument({...base,raw_json:{title:["A","B"],issued:{"date-parts":[[2024,2]]}}},asOf);
  expect(document.title).toBe("A; B");expect(document.precision).toBe("month");
  expect(document.content_label).toBe("2024-02");expect(document.fetched_at).toBe(base.fetched_at);
 });
 it("keeps reference years out of publication dates",()=>{
  const {document}=normalizeDocument({...base,source_id:"eurostat",raw_json:{title:"Series",date:"2009",value:10,dimensions:{time:"2009",geo:"AT"}}},asOf);
  expect(document.kind).toBe("indicator");expect(document.content_at).toBeNull();expect(document.facets.date).toBe("2009");
  expect(document.availability).toBe("structured");
 });
 it("retains all non-time series dimensions",()=>{
  const make=(time:string,sex:string)=>normalizeDocument({...base,source_id:"eurostat",raw_json:{dataset_code:"test",dimensions:{time,sex,geo:"AT",unit:"PC",freq:"A"},country:"Austria",unit:"PC"}},asOf).document;
  expect(make("2009","F").series_key).toBe(make("2010","F").series_key);
  expect(make("2009","F").series_key).not.toBe(make("2009","M").series_key);
 });
 it("does not classify proteins as papers",()=>{expect(sourceKind("uniprot")).toBe("entity");expect(sourceKind("openalex_水资源")).toBe("paper");expect(sourceKind("new_source")).toBe("other");});
 it("indexes entity and trial descriptions as readable content",()=>{
  for(const source_id of ["uniprot","clinicaltrials"]){
   const result=normalizeDocument({...base,source_id,raw_json:{title:"Entity",abstract:"Searchable explanation"}},asOf);
   expect(result.document.availability).toBe("structured");expect(result.content).toContain("Searchable explanation");
  }
 });
 it("does not fabricate document industry or unavailable bodies",()=>{
  const {document,content}=normalizeDocument({...base,raw_json:{title:"Metadata"}},asOf);
  expect(document.industry).toBeNull();expect(document.availability).toBe("metadata");expect(content).toBe("");
 });
 it("keeps mathematical Unicode valid at snippet and chunk boundaries",()=>{
  const value="a".repeat(479)+"𝐒"+"z";
  const {document}=normalizeDocument({...base,raw_json:{abstract:value}},asOf);
  expect(document.snippet).toBe("a".repeat(479));
  expect(chunks(value,480).join("")).toBe(value);
  for(const part of chunks(value,480))expect(/[\uD800-\uDBFF]$/.test(part)).toBe(false);
  expect(clip("𝐒",1)).toBe("");expect(()=>chunks("x",1)).toThrow();
 });
 it("removes active markup while preserving text",()=>{
  expect(plain('<script>steal()</script><p>A &amp; B</p>')).toBe("A & B");
  expect(plain("&#xD800; valid")).toBe("valid");
 });
 it("hides nested credentials and URL secrets",()=>{
  const value=redact({headers:{"X-API-Key":"secret"},url:"https://u:p@example.test/path?UserID=secret&country=AT"});
  const serialized=JSON.stringify(value);expect(serialized).not.toContain("secret");expect(serialized).not.toContain("u:p");expect(serialized).toContain("country=AT");
 });
});
describe("library date semantics",()=>{
 it.each(["2026-11-21","2025-02-30","3000","not-a-date"])("excludes invalid or future date %s",value=>expect(parseContentDate(value,asOf).at).toBeNull());
 it("preserves precise publication timestamps and rejects future times",()=>{
  expect(parseContentDate("2026-11-20T08:00:00Z",asOf).precision).toBe("second");
  expect(parseContentDate("2026-11-20T11:00:00Z",asOf).at).toBeNull();
 });
 it("parses PubMed month names without fabricating a display day",()=>{
  expect(parseContentDate("2024 Mar",asOf)).toEqual({at:"2024-03-01T00:00:00.000Z",label:"2024-03",precision:"month"});
 });
});
