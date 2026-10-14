import { getStore } from "@netlify/blobs";
const J=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export default async req=>{
  const key=req.headers.get("x-az11-admin-key")||"";if(!process.env.AZ11_ADMIN_KEY||key!==process.env.AZ11_ADMIN_KEY)return J({error:"Wrong or missing owner key."},401);
  const users=getStore({name:"az11-users",consistency:"strong"}),prog=getStore({name:"az11-progress",consistency:"strong"}),idx=await users.get("users-index",{type:"json",consistency:"strong"})||[],out=[];
  for(const u of idx){const a=await prog.get(`attempts-${u.username}`,{type:"json",consistency:"strong"})||[];out.push({...u,attemptCount:a.length,lastAttempt:a.length?a[a.length-1]:null})}
  return J({users:out});
};
export const config={path:"/api/owner-users"};
