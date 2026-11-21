import type { FastifyInstance } from "fastify";
import { listDocuments, listSources } from "./queries";
import { getDocument, getSeries, getVersions, loadBody } from "./read";
import { parseLibraryQuery } from "./queryOptions";
import { redact } from "./text";
import { LibraryError, type LibraryDb } from "./types";
function fields(query: unknown, allowed: string[]): Record<string,string> {
 const input=query as Record<string,unknown>;
 for (const [key,value] of Object.entries(input)) if (!allowed.includes(key) || typeof value!=="string" || value.length>16000)
  throw new LibraryError(`Invalid query parameter: ${key}`);
 return input as Record<string,string>;
}
export async function libraryRoutes(app: FastifyInstance, db: LibraryDb): Promise<void> {
 app.get("/api/library/bootstrap",async req=>{
  const q=fields(req.query,["dataset","order"]);
  const result=await listSources(db,q.dataset,q.order);
  return {...result,capabilities:{scopes:["title","content","raw"],semantic:false,readOnly:true}};
 });
 app.get("/api/library/documents",async req=>listDocuments(db,parseLibraryQuery(req.query as Record<string,unknown>)));
 app.get("/api/library/document",async req=>{
  const q=fields(req.query,["key","dataset","version"]);
  return getDocument(db,q.key??"",q.dataset,q.version);
 });
 app.get("/api/library/versions",async req=>{
  const q=fields(req.query,["key","dataset","cursor"]);
  return getVersions(db,q.key??"",q.dataset,q.cursor);
 });
 app.get("/api/library/series",async req=>{
  const q=fields(req.query,["seriesKey","dataset","cursor","limit"]);
  return getSeries(db,q.seriesKey??"",{dataset:q.dataset,cursor:q.cursor,limit:q.limit?Number(q.limit):undefined});
 });
 app.get("/api/library/raw",async(req,reply)=>{
  const q=fields(req.query,["key","dataset","version"]);
  const result=await loadBody(db,q.key??"",q.dataset,q.version);
  return reply.header("Content-Disposition",'attachment; filename="document.json"').type("application/json")
   .send(JSON.stringify(redact(result.raw),null,2));
 });
 app.get("/api/library/text",async(req,reply)=>{
  const q=fields(req.query,["key","dataset","version"]);
  const result=await getDocument(db,q.key??"",q.dataset,q.version);
  return reply.header("Content-Disposition",'attachment; filename="document.txt"').type("text/plain; charset=utf-8")
   .send([result.title,result.abstract,result.fulltext].filter(Boolean).join("\n\n"));
 });
}
