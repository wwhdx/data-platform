import Fastify from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { getPool } from "../storage/db";
import { assertReaderRole } from "./readOnly";
import { libraryRoutes } from "./routes";
import { LibraryError, type LibraryDb } from "./types";
const ASSETS: Record<string,string>={"app.js":"text/javascript","state.js":"text/javascript","list.js":"text/javascript",
 "reader.js":"text/javascript","versions.js":"text/javascript","styles.css":"text/css","responsive.css":"text/css"};
export async function buildLibraryApp(db: LibraryDb = getPool()) {
 const app=Fastify({logger:false,bodyLimit:1024});
 const root=path.resolve(__dirname,"../../library-ui");
 app.addHook("onRequest",async(_req,reply)=>{
  reply.header("X-Content-Type-Options","nosniff").header("Referrer-Policy","same-origin")
   .header("Cache-Control","no-store").header("Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
 });
 app.setErrorHandler((error,_request,reply)=>{
  const status=error instanceof LibraryError?error.statusCode:400===error.statusCode?400:(error as {code?:string}).code==="57014"?503:500;
  const message=status===503?"查询超时，请缩小范围后重试":status>=500?"阅览查询失败，请查看服务日志":error.message;
  if(status>=500) app.log.error({code:(error as {code?:string}).code},"Library query failed");
  void reply.code(status).send({error:message});
 });
 for (const route of ["/","/library"]) app.get(route,async(_req,reply)=>reply.type("text/html; charset=utf-8").send(await fs.readFile(path.join(root,"index.html"))));
 app.get("/favicon.ico",async(_req,reply)=>reply.code(204).send());
 for (const [file,mime] of Object.entries(ASSETS)) app.get(`/assets/${file}`,async(_req,reply)=>reply.type(mime).send(await fs.readFile(path.join(root,"assets",file))));
 await libraryRoutes(app,db);
 return app;
}
export async function serveLibrary(port=8736): Promise<void> {
 if(!Number.isInteger(port)||port<1024||port>65535) throw new LibraryError("port must be 1024–65535");
 const pool=new Pool({connectionString:process.env.DATA_PLATFORM_DATABASE_URL,max:4,connectionTimeoutMillis:3000});
 try { await assertReaderRole(pool); } catch(error) { await pool.end(); throw error; }
 const app=await buildLibraryApp(pool);
 await app.listen({host:"127.0.0.1",port});
 console.log(`Library reader ready: http://127.0.0.1:${port}/ (read-only, no scheduler)`);
 await new Promise<void>(resolve=>{
  let closing=false;
  const shutdown=()=>{if(closing)return;closing=true;void app.close().then(()=>pool.end()).then(resolve);};
  process.once("SIGINT",shutdown);process.once("SIGTERM",shutdown);
 });
}
