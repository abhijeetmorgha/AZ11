import { getStore } from "@netlify/blobs";
const J=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const admin=req=>(req.headers.get("x-az11-admin-key")||"")===(process.env.AZ11_ADMIN_KEY||"") && !!process.env.AZ11_ADMIN_KEY;
export default async req=>{
  const store=getStore({name:"az11-pdf-tests",consistency:"strong"});
  if(req.method==="GET"){const items=await store.get("index",{type:"json",consistency:"strong"});return J(Array.isArray(items)?items:[])}
  if(req.method==="POST"){
    if(!admin(req))return J({error:"Wrong or missing owner key."},401);
    let b;try{b=await req.json()}catch{return J({error:"Invalid JSON."},400)}
    const id=String(b.id||"").trim(),title=String(b.title||"").trim(),subject=String(b.subject||"NEET Full Paper"),count=Math.max(1,Math.min(180,Number(b.count)||0)),minutes=Math.max(1,Math.min(300,Number(b.minutes)||0)),answerKey=String(b.answerKey||"").toUpperCase().replace(/[^ABCD]/g,"");
    if(!id||!title)return J({error:"Test id and title are required."},400);
    if(!count||answerKey.length!==count)return J({error:`Answer key must contain exactly ${count} answers.`},400);
    let items=await store.get("index",{type:"json",consistency:"strong"})||[];
    const old=items.find(x=>String(x.id)===id);
    const saved={id,title,subject,count,minutes,answerKey,hasFile:true,fileName:String(b.fileName||old?.fileName||"paper.pdf"),updated:new Date().toISOString()};
    items=items.filter(x=>String(x.id)!==id);items.push(saved);await store.setJSON("index",items);return J({ok:true,test:saved,count:items.length});
  }
  if(req.method==="DELETE"){
    if(!admin(req))return J({error:"Wrong or missing owner key."},401);
    let b;try{b=await req.json()}catch{return J({error:"Invalid JSON."},400)}
    const id=String(b.id||"");let items=await store.get("index",{type:"json",consistency:"strong"})||[];items=items.filter(x=>String(x.id)!==id);await store.setJSON("index",items);const meta=await store.get(`filemeta-${id}`,{type:"json",consistency:"strong"});if(meta?.chunks){for(let i=0;i<Number(meta.chunks);i++)await store.delete(`file-${id}-part-${i}`)}await store.delete(`filemeta-${id}`);await store.delete(`file-${id}`);return J({ok:true,count:items.length});
  }
  return J({error:"Method not allowed."},405)
};
export const config={path:"/api/pdf-tests"};
