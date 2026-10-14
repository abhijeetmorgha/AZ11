import { getStore } from "@netlify/blobs";
export default async req=>{
  const u=new URL(req.url),id=String(u.searchParams.get("id")||"");if(!id)return new Response("Missing id",{status:400});
  const store=getStore({name:"az11-notes",consistency:"strong"}),notes=await store.get("index",{type:"json",consistency:"strong"})||[],n=notes.find(x=>String(x.id)===id);if(!n?.hasFile)return new Response("Not found",{status:404});
  const data=await store.get(`file-${id}`,{type:"arrayBuffer",consistency:"strong"});if(!data)return new Response("Not found",{status:404});
  return new Response(data,{headers:{"content-type":n.fileType||"application/octet-stream","content-disposition":`inline; filename*=UTF-8''${encodeURIComponent(n.fileName||"note-file")}`,"cache-control":"public,max-age=300"}});
};
export const config={path:"/api/note-file"};
