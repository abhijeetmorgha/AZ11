import { getStore } from "@netlify/blobs";
import { createHash, randomBytes } from "node:crypto";

const J=(d,s=200)=>new Response(JSON.stringify(d),{
  status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
});
const admin=req=>(req.headers.get("x-az11-admin-key")||"")===(process.env.AZ11_ADMIN_KEY||"") && !!process.env.AZ11_ADMIN_KEY;
const tokenHash=t=>createHash("sha256").update(t).digest("hex");

async function sessionUser(req){
  const users=getStore({name:"az11-users",consistency:"strong"});
  const c=req.headers.get("cookie")||"",m=c.match(/(?:^|;\s*)az11_session=([^;]+)/);
  if(!m)return null;
  const sess=await users.get(`session-${tokenHash(decodeURIComponent(m[1]))}`,{type:"json",consistency:"strong"});
  if(!sess||Date.now()>sess.expires)return null;
  const u=await users.get(`user-${sess.username}`,{type:"json",consistency:"strong"});
  return u?{username:u.username,displayName:u.displayName||u.username}:null;
}

export default async req=>{
  const store=getStore({name:"az11-question-reports",consistency:"strong"});

  if(req.method==="GET"){
    if(!admin(req))return J({error:"Wrong or missing owner key."},401);
    const items=await store.get("index",{type:"json",consistency:"strong"})||[];
    return J({reports:Array.isArray(items)?items:[]});
  }

  if(req.method==="POST"){
    const user=await sessionUser(req);
    if(!user)return J({error:"Login required to report a question."},401);
    let b;try{b=await req.json()}catch{return J({error:"Invalid JSON."},400)}
    const reason=String(b.reason||"").trim().slice(0,500);
    const questionId=String(b.questionId||"").trim().slice(0,120);
    if(!reason||!questionId)return J({error:"Question and reason are required."},400);

    let items=await store.get("index",{type:"json",consistency:"strong"})||[];
    if(!Array.isArray(items))items=[];
    const now=new Date().toISOString();
    const item={
      id:`${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`,
      questionId,
      questionText:String(b.questionText||"").slice(0,1200),
      reason,
      subject:String(b.subject||"").slice(0,80),
      chapter:String(b.chapter||"").slice(0,160),
      topic:String(b.topic||"").slice(0,160),
      username:user.username,
      displayName:user.displayName,
      createdAt:now
    };
    items.push(item);
    if(items.length>1000)items=items.slice(-1000);
    await store.setJSON("index",items);
    return J({ok:true,report:item});
  }

  if(req.method==="DELETE"){
    if(!admin(req))return J({error:"Wrong or missing owner key."},401);
    let b;try{b=await req.json()}catch{return J({error:"Invalid JSON."},400)}
    const id=String(b.id||"");
    let items=await store.get("index",{type:"json",consistency:"strong"})||[];
    items=(Array.isArray(items)?items:[]).filter(x=>String(x.id)!==id);
    await store.setJSON("index",items);
    return J({ok:true,count:items.length});
  }

  return J({error:"Method not allowed."},405);
};
export const config={path:"/api/reports"};
