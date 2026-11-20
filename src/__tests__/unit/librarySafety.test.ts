import {describe,it,expect,vi} from "vitest";
import {documentKey,parseDocumentKey,decodeCursor,encodeCursor,fingerprint} from "../../library/cursor";
import {validateQuery,parseLibraryQuery} from "../../library/queryOptions";
import {assertReaderRole} from "../../library/readOnly";
import {buildLibraryApp} from "../../library/server";
import {getDocument} from "../../library/read";
import type {LibraryDb} from "../../library/types";
describe("library query boundaries",()=>{
 it("roundtrips business identifiers with slashes and Unicode",()=>{expect(parseDocumentKey(documentKey("openalex_水资源","https://x.test/a/b?x=1"))).toEqual(["openalex_水资源","https://x.test/a/b?x=1"]);});
 it("retains microseconds in cursor timestamps",()=>{
  const data={dataset:"snapshot",fingerprint:fingerprint({}),time:"2026-11-20T08:07:13.123456Z",id:"123"};
  expect(decodeCursor(encodeCursor(data))).toMatchObject(data);
 });
 it("binds cursors to every ordering and filter input",()=>{
  expect(fingerprint({sources:["a","b"]})).toBe(fingerprint({sources:["b","a"]}));
  expect(fingerprint({})).not.toBe(fingerprint({scope:"content"}));
  expect(fingerprint({})).not.toBe(fingerprint({order:"content"}));
 });
 it.each([0,101,NaN,1.1])("rejects invalid page size %s",limit=>expect(()=>validateQuery({limit})).toThrow());
 it("rejects malformed and impossible dates",()=>{expect(()=>validateQuery({dateFrom:"2025-02-30"})).toThrow();expect(()=>validateQuery({dateFrom:"2026-02-01",dateTo:"2026-01-01"})).toThrow();});
 it("rejects unknown HTTP inputs and malformed keys",()=>{expect(()=>parseLibraryQuery({sql:"DROP"})).toThrow();expect(()=>parseDocumentKey("???")).toThrow();expect(()=>decodeCursor("e30")).toThrow();});
});
describe("reader isolation",()=>{
 const allowed={admin:false,owner:false,writable:false,can_create:false,read_only:true};
 it("accepts only a SELECT-only nonowner role",async()=>{
  await expect(assertReaderRole({query:vi.fn().mockResolvedValue({rows:[allowed]})} as unknown as LibraryDb)).resolves.toBeUndefined();
  for(const field of ["admin","owner","writable","can_create"])await expect(assertReaderRole({query:vi.fn().mockResolvedValue({rows:[{...allowed,[field]:true}]})} as unknown as LibraryDb)).rejects.toThrow();
  await expect(assertReaderRole({query:vi.fn().mockResolvedValue({rows:[{...allowed,read_only:false}]})} as unknown as LibraryDb)).rejects.toThrow();
 });
 it("reports availability and timestamps of the selected historical version",async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{id:"snapshot",created_at:new Date("2026-11-20"),state:"ready"}]})
   .mockResolvedValueOnce({rows:[{doc_id:"1",source_id:"crossref",external_id:"x",availability:"fulltext",facets:{}}]})
   .mockResolvedValueOnce({rows:[{body_json:{title:"Earlier metadata",abstract:"Earlier abstract"},
    supplements:{version:"2",origin:"raw",fetched_at:"2026-05-21T07:00:00Z"}}]});
  const body=await getDocument({query} as unknown as LibraryDb,documentKey("crossref","x"),"snapshot","2");
  expect(body.item.availability).toBe("abstract");expect(body.item.fetched_at).toBe("2026-05-21T07:00:00Z");
 });
 it("does not expose collection or mutation endpoints or filesystem paths",async()=>{
  const db={query:vi.fn()} as unknown as LibraryDb;const app=await buildLibraryApp(db);
  try{
   for(const [method,url] of [["POST","/api/admin/collect"],["POST","/api/library/document"],["GET","/.env"],["GET","/assets/../../.env"]] as const)
    expect((await app.inject({method,url})).statusCode).toBe(404);
   const bad=await app.inject("/api/library/documents?limit=1000");expect(bad.statusCode).toBe(400);expect(db.query).not.toHaveBeenCalled();
   const page=await app.inject("/");expect(page.statusCode).toBe(200);expect(page.headers["content-security-policy"]).toContain("script-src 'self'");
  }finally{await app.close();}
 });
});
