import { getStore } from "@netlify/blobs";

const J=(d,s=200)=>new Response(JSON.stringify(d),{
  status:s,
  headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store"
  }
});

const admin=req =>
  (req.headers.get("x-az11-admin-key")||"") === (process.env.AZ11_ADMIN_KEY||"") &&
  !!process.env.AZ11_ADMIN_KEY;

function normToken(v){
  let s=String(v||"").trim().toUpperCase().replace(/\|/g,"/");
  if(s==="DROPPED") s="DROP";
  if(s==="DROP") return "DROP";
  if(/^[ABCD]$/.test(s)) return s;

  if(/^[ABCD](?:\/[ABCD])+$/.test(s)){
    return [...new Set(s.split("/"))].join("/");
  }
  return "";
}

function tokensFromLegacy(v){
  const raw=String(v||"").toUpperCase().replace(/\r/g,"\n").replace(/\|/g,"/");
  const compact=raw.replace(/[\s,;]+/g,"");

  if(compact && /^[ABCD]+$/.test(compact)){
    return [...compact];
  }

  const parts=raw.split(/[\s,;]+/).filter(Boolean);
  const out=[];

  for(let part of parts){
    part=part.replace(/^\d+\s*[-.):]?\s*/,"").trim();
    if(!part) continue;
    if(part==="DROPPED") part="DROP";
    const n=normToken(part);
    if(n) out.push(n);
  }
  return out;
}

export default async req=>{
  const store=getStore({name:"az11-pdf-tests",consistency:"strong"});

  if(req.method==="GET"){
    const items=await store.get("index",{type:"json",consistency:"strong"});
    return J(Array.isArray(items)?items:[]);
  }

  if(req.method==="POST"){
    if(!admin(req)) return J({error:"Wrong or missing owner key."},401);

    let b;
    try{ b=await req.json(); }
    catch{ return J({error:"Invalid JSON."},400); }

    const id=String(b.id||"").trim();
    const title=String(b.title||"").trim();
    const subject=String(b.subject||"NEET Full Paper");
    const count=Math.max(1,Math.min(180,Number(b.count)||0));
    const minutes=Math.max(1,Math.min(300,Number(b.minutes)||0));

    // IMPORTANT: accept BOTH new and old Admin formats.
    let rawTokens=[];
    if(Array.isArray(b.answerKeyTokens)){
      rawTokens=b.answerKeyTokens;
    }else if(b.answerKey!==undefined){
      rawTokens=tokensFromLegacy(b.answerKey);
    }

    const answerKeyTokens=rawTokens.map(normToken);

    if(!id || !title){
      return J({error:"Test id and title are required."},400);
    }

    if(!count || answerKeyTokens.length!==count || answerKeyTokens.some(x=>!x)){
      return J({
        error:`Answer key must contain exactly ${count} valid entries. Received ${answerKeyTokens.length}.`
      },400);
    }

    let items=await store.get("index",{type:"json",consistency:"strong"})||[];
    const old=items.find(x=>String(x.id)===id);

    const allSingle=answerKeyTokens.every(x=>/^[ABCD]$/.test(x));

    const saved={
      id,
      title,
      subject,
      count,
      minutes,
      answerKeyTokens,
      // keep legacy field too so older public clients still work
      answerKey: allSingle ? answerKeyTokens.join("") : "",
      hasFile: b.hasFile!==false,
      fileName:String(b.fileName||old?.fileName||"paper.pdf"),
      updated:new Date().toISOString()
    };

    items=items.filter(x=>String(x.id)!==id);
    items.push(saved);
    await store.setJSON("index",items);

    return J({ok:true,test:saved,count:items.length});
  }

  if(req.method==="DELETE"){
    if(!admin(req)) return J({error:"Wrong or missing owner key."},401);

    let b;
    try{ b=await req.json(); }
    catch{ return J({error:"Invalid JSON."},400); }

    const id=String(b.id||"");
    let items=await store.get("index",{type:"json",consistency:"strong"})||[];
    items=items.filter(x=>String(x.id)!==id);
    await store.setJSON("index",items);

    // Clean both new and older PDF storage layouts where possible.
    const meta=await store.get(`meta-${id}`,{type:"json",consistency:"strong"});
    if(meta?.total){
      for(let i=0;i<Number(meta.total);i++){
        await store.delete(`chunk-${id}-${i}`);
      }
      await store.delete(`meta-${id}`);
    }

    const oldMeta=await store.get(`filemeta-${id}`,{type:"json",consistency:"strong"});
    if(oldMeta?.chunks){
      for(let i=0;i<Number(oldMeta.chunks);i++){
        await store.delete(`file-${id}-part-${i}`);
      }
      await store.delete(`filemeta-${id}`);
    }

    await store.delete(`file-${id}`);

    return J({ok:true,count:items.length});
  }

  return J({error:"Method not allowed."},405);
};

export const config={path:"/api/pdf-tests"};
