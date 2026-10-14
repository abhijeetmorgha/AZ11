import { getStore } from "@netlify/blobs";
const J=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const admin=req=>(req.headers.get("x-az11-admin-key")||"")===(process.env.AZ11_ADMIN_KEY||"") && !!process.env.AZ11_ADMIN_KEY;
export default async req=>{
  const store=getStore({name:"az11-notes",consistency:"strong"});
  if(req.method==="GET"){const n=await store.get("index",{type:"json",consistency:"strong"});return J(Array.isArray(n)?n:[])}
  if(req.method==="POST"){
    if(!admin(req))return J({error:"Wrong or missing owner key."},401);
    let b;try{b=await req.json()}catch{return J({error:"Invalid JSON."},400)}
    const id=String(b.id||Date.now()),notes=await store.get("index",{type:"json",consistency:"strong"})||[],old=notes.find(n=>String(n.id)===id);let hasFile=!!old?.hasFile,fileName=old?.fileName||"",fileType=old?.fileType||"";
    if(b.fileBase64){const buf=Buffer.from(b.fileBase64,"base64");if(buf.length>3*1024*1024)return J({error:"Note file must be 3 MB or smaller."},413);await store.set(`file-${id}`,buf);hasFile=true;fileName=String(b.fileName||"note-file");fileType=String(b.fileType||"application/octet-stream")}else if(b.keepExistingFile&&old?.hasFile){hasFile=true}
    const now=new Date().toISOString(),saved={id,subject:String(b.subject||"General"),class:String(b.class||"12"),chapter:String(b.chapter||"General"),title:String(b.title||"Note"),body:String(b.body||""),explanation:String(b.explanation||""),hasFile,fileName,fileType,created:old?.created||now,updated:now};
    const next=notes.filter(n=>String(n.id)!==id);next.push(saved);await store.setJSON("index",next);return J({ok:true,note:saved,count:next.length});
  }
  if(req.method==="DELETE"){
    if(!admin(req))return J({error:"Wrong or missing owner key."},401);
    let b;try{b=await req.json()}catch{return J({error:"Invalid JSON."},400)}const id=String(b.id||""),notes=await store.get("index",{type:"json",consistency:"strong"})||[],old=notes.find(n=>String(n.id)===id);if(old?.hasFile)await store.delete(`file-${id}`);const next=notes.filter(n=>String(n.id)!==id);await store.setJSON("index",next);return J({ok:true,count:next.length});
  }
  return J({error:"Method not allowed."},405)
};
export const config={path:"/api/notes"};
