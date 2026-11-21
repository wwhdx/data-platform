import {beforeAll,afterAll,describe,it,expect} from "vitest";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import type {PoolClient} from "pg";
import {connectTestDatabase,clearTestData} from "../helpers/dbAvailable";
import {assertTestDatabase} from "../../../storage/testDatabase";
import {closePool} from "../../../storage/db";
import {prepareLibrary} from "../../../library/prepare";
import {getDataset,listDocuments} from "../../../library/queries";
import {getDocument,getSeries,getVersions} from "../../../library/read";
import {documentKey} from "../../../library/cursor";
import {buildLibraryApp} from "../../../library/server";
let db:PoolClient,dataset:string;
describe("full-corpus reader on disposable PostgreSQL",()=>{
 beforeAll(async()=>{
  db=await connectTestDatabase();await db.query("SELECT pg_advisory_lock(641040)");
  await clearTestData(db);await db.query("TRUNCATE library.datasets CASCADE");
  for(let i=0;i<8;i++)await db.query(`INSERT INTO raw_documents(source_id,external_id,raw_json,fetched_at)
   VALUES('crossref',$1,$2::jsonb,'2026-01-01T01:02:03.123456Z')`,["10.1/"+i,JSON.stringify({title:[`Paper ${i}`],issued:{"date-parts":[[2024,2]]},abstract:i===0?'Only-in-body zebrafish '+"a".repeat(479)+'𝐒':'',publication_date:i===7?'3000-01-01':undefined,api_key:'fixture-secret',url:'https://example.test/?UserID=fixture-secret'})]);
  for(const [date,sex]of [["2009","F"],["2010","F"],["2009","M"]])await db.query(`INSERT INTO raw_documents(source_id,external_id,raw_json,fetched_at)
   VALUES('eurostat',$1,$2::jsonb,'2026-01-01T01:02:03.123456Z')`,[date+sex,JSON.stringify({title:"Unemployment",dataset_code:"test",date,country:"Austria",unit:"PC",value:5,dimensions:{time:date,sex,geo:"AT",freq:"A"}})]);
  await db.query(`INSERT INTO raw_documents(source_id,external_id,raw_json,fetched_at) VALUES
   ('uniprot','P123','{"title":"Protein","organism":"Human"}','2026-01-01T01:02:03.123456Z')`);
  dataset=(await prepareLibrary(db,{batchSize:3,label:"Reader test"})).id;
 });
 afterAll(async()=>{if(db){await assertTestDatabase(db);await clearTestData(db);await db.query("TRUNCATE library.datasets CASCADE");await db.query("SELECT pg_advisory_unlock(641040)");db.release();await closePool();}});
 it("preserves full coverage and microsecond ties over arbitrarily many batches",async()=>{
  const ids:string[]=[];let cursor:string|undefined;
  do{const page=await listDocuments(db,{dataset,limit:2,cursor});ids.push(...page.rows.map(r=>r.doc_id));
   for(const row of page.rows)expect(row.fetched_at).toContain(".123456Z");cursor=page.nextCursor??undefined;
  }while(cursor);
  expect(ids).toHaveLength(12);expect(new Set(ids).size).toBe(12);expect((await getDataset(db,dataset)).documents).toBe("12");
 });
 it("reaches unknown publication dates after known dates",async()=>{
  const ids:string[]=[];let cursor:string|undefined;let nulls=false;
  do{const page=await listDocuments(db,{dataset,order:"content",limit:3,cursor});
   for(const row of page.rows){if(row.content_at===null)nulls=true;else expect(nulls).toBe(false);ids.push(row.doc_id);}cursor=page.nextCursor??undefined;
  }while(cursor);expect(ids).toHaveLength(12);expect(nulls).toBe(true);
 });
 it("rejects reusing a cursor with different filters",async()=>{
  const page=await listDocuments(db,{dataset,limit:2});await expect(listDocuments(db,{dataset,kind:"paper",cursor:page.nextCursor!})).rejects.toThrow("Filters changed");
 });
 it("searches body content separately from titles and redacts raw credentials",async()=>{
  expect((await listDocuments(db,{dataset,query:"zebrafish"})).rows).toHaveLength(0);
  expect((await listDocuments(db,{dataset,query:"zebrafish",scope:"content"})).rows).toHaveLength(1);
  const body=await getDocument(db,documentKey("crossref","10.1/0"),dataset);
  expect(body.abstract).toContain("𝐒");expect(JSON.stringify(body)).not.toContain("fixture-secret");
 });
 it("keeps non-time series dimensions separate",async()=>{
  const page=await listDocuments(db,{dataset,kind:"indicator"});const female=page.rows.find(r=>r.facets.date==="2010")!;
  const series=await getSeries(db,female.series_key!,{dataset,limit:1});expect(series.rows[0].reference_period).toBe("2010");
  const next=await getSeries(db,female.series_key!,{dataset,limit:1,cursor:series.nextCursor!});expect(next.rows[0].reference_period).toBe("2009");expect(next.hasMore).toBe(false);
 });
 it("serves matching HTTP and CLI results without scheduler routes",async()=>{
  const app=await buildLibraryApp(db);
  try{
   const response=await app.inject(`/api/library/documents?dataset=${dataset}&limit=2`);expect(response.statusCode).toBe(200);
   const child=await promisify(execFile)(process.execPath,["--import","tsx","src/cli/index.ts","library","list","--dataset",dataset,"--limit","2","--json"],{env:{...process.env,VITEST:"true"},timeout:15000});
   expect(JSON.parse(child.stdout).rows.map((r:{doc_id:string})=>r.doc_id)).toEqual(response.json().rows.map((r:{doc_id:string})=>r.doc_id));
   expect((await app.inject({method:"POST",url:"/api/admin/collect"})).statusCode).toBe(404);
   expect((await getVersions(db,documentKey("crossref","10.1/0"),dataset)).rows).toHaveLength(1);
  }finally{await app.close();}
 });
});
