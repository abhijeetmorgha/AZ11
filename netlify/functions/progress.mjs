import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
const J=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const tokenHash=t=>createHash("sha256").update(t).digest("hex");
async function username(req,store){const c=req.headers.get("cookie")||"",m=c.match(/(?:^|;\s*)az11_session=([^;]+)/);if(!m)return null;const sess=await store.get(`session-${tokenHash(decodeURIComponent(m[1]))}`,{type:"json",consistency:"strong"});if(!sess||Date.now()>sess.expires)return null;return sess.username}
export default async req=>{
  const users=getStore({name:"az11-users",consistency:"strong"}),u=await username(req,users);if(!u)return J({error:"Login required"},401);
  const p=getStore({name:"az11-progress",consistency:"strong"});
  if(req.method==="GET"){const a=await p.get(`attempts-${u}`,{type:"json",consistency:"strong"})||[];return J({attempts:a})}
  if(req.method==="POST"){let b;try{b=await req.json()}catch{return J({error:"Invalid JSON"},400)}let a=await p.get(`attempts-${u}`,{type:"json",consistency:"strong"})||[];if(!a.some(x=>String(x.id)===String(b.id))){a.push({id:String(b.id||Date.now()),name:String(b.name||"Test"),date:String(b.date||new Date().toISOString()),score:Number(b.score||0),total:Number(b.total||0),correct:Number(b.correct||0),wrong:Number(b.wrong||0),unattempted:Number(b.unattempted||0),accuracy:Number(b.accuracy||0),points:Number(b.points||0)});a=a.slice(-150);await p.setJSON(`attempts-${u}`,a)}return J({ok:true,count:a.length})}
  return J({error:"Method not allowed"},405)
};
export const config={path:"/api/progress"};
