import { getStore } from "@netlify/blobs";
const J=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const admin=req=>(req.headers.get("x-az11-admin-key")||"")===(process.env.AZ11_ADMIN_KEY||"") && !!process.env.AZ11_ADMIN_KEY;
export default async req=>{
  const u=new URL(req.url),id=String(u.searchParams.get("id")||"");if(!id)return J({error:"Missing id"},400);
  const store=getStore({name:"az11-pdf-tests",consistency:"strong"});
  if(req.method==="POST"){
    if(!admin(req))return J({error:"Wrong or missing owner key."},401);
    const ab=await req.arrayBuffer();if(!ab||!ab.byteLength)return J({error:"Empty PDF."},400);if(ab.byteLength>5*1024*1024)return J({error:"PDF must be 5 MB or smaller."},413);
    const head=new Uint8Array(ab.slice(0,5));const sig=String.fromCharCode(...head);if(sig!=="%PDF-")return J({error:"Only PDF files are allowed."},415);
    await store.set(`file-${id}`,ab);return J({ok:true,size:ab.byteLength});
  }
  if(req.method==="GET"){
    const data=await store.get(`file-${id}`,{type:"arrayBuffer",consistency:"strong"});if(!data||data.byteLength===0)return new Response("PDF not found",{status:404});
    return new Response(data,{headers:{"content-type":"application/pdf","content-disposition":"inline; filename=AZ11-paper.pdf","cache-control":"public,max-age=300"}})
  }
  return J({error:"Method not allowed."},405)
};
export const config={path:"/api/pdf-test-file"};
