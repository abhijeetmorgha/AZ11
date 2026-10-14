import { getStore } from "@netlify/blobs";
const J=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const admin=req=>(req.headers.get("x-az11-admin-key")||"")===(process.env.AZ11_ADMIN_KEY||"") && !!process.env.AZ11_ADMIN_KEY;
export default async req=>{
  const store=getStore({name:"az11-questions",consistency:"strong"});
  if(req.method==="GET"){const q=await store.get("index",{type:"json",consistency:"strong"});return J(Array.isArray(q)?q:[])}
  if(req.method==="POST"){
    if(!admin(req))return J({error:"Wrong or missing owner key."},401);
    let body;try{body=await req.json()}catch{return J({error:"Invalid JSON."},400)}
    let items=await store.get("index",{type:"json",consistency:"strong"})||[];
    if(body.action==="bulk"){
      const incoming=Array.isArray(body.questions)?body.questions:[];
      for(const x of incoming){if(!x?.id)continue;items=items.filter(q=>String(q.id)!==String(x.id));items.push({...x,hasFile:false})}
      await store.setJSON("index",items);return J({ok:true,count:items.length,added:incoming.length});
    }
    const x=body.question;if(!x?.id||!x?.q)return J({error:"Question id and text are required."},400);
    const id=String(x.id),old=items.find(q=>String(q.id)===id);
    let hasFile=!!old?.hasFile,fileName=old?.fileName||"",fileType=old?.fileType||"";
    if(x.fileBase64){
      const buf=Buffer.from(x.fileBase64,"base64");
      if(buf.length>3*1024*1024)return J({error:"Question file must be 3 MB or smaller."},413);
      const arrayBuffer=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
      await store.set(`file-${id}`,arrayBuffer);
      const verify=await store.getMetadata(`file-${id}`,{consistency:"strong"});
      if(!verify)return J({error:"Question file upload could not be verified. Please try again."},500);
      hasFile=true;
      fileName=String(x.fileName||"question-file");
      fileType=String(x.fileType||"application/octet-stream");
    }else if(x.keepExistingFile&&old?.hasFile){hasFile=true}else if(!x.imageOptionsOnly){hasFile=false;if(old?.hasFile)await store.delete(`file-${id}`)}
    const {fileBase64,keepExistingFile,...rest}=x;
    const saved={...rest,id,baseId:String(rest.baseId||id),hasFile,fileName,fileType,updated:new Date().toISOString()};
    items=items.filter(q=>String(q.id)!==id);items.push(saved);await store.setJSON("index",items);return J({ok:true,question:saved,count:items.length});
  }
  if(req.method==="DELETE"){
    if(!admin(req))return J({error:"Wrong or missing owner key."},401);
    let body;try{body=await req.json()}catch{return J({error:"Invalid JSON."},400)}
    const id=String(body.id||"");let items=await store.get("index",{type:"json",consistency:"strong"})||[];const old=items.find(q=>String(q.id)===id);if(old?.hasFile)await store.delete(`file-${id}`);items=items.filter(q=>String(q.id)!==id);await store.setJSON("index",items);return J({ok:true,count:items.length});
  }
  return J({error:"Method not allowed."},405)
};
export const config={path:"/api/questions"};
