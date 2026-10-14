import { getStore } from "@netlify/blobs";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
const J=(d,s=200,h={})=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...h}});
const clean=s=>String(s||"").trim();
const tokenHash=t=>createHash("sha256").update(t).digest("hex");
const cookie=t=>`az11_session=${t}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
async function sessionUser(req,store){
  const c=req.headers.get("cookie")||"",m=c.match(/(?:^|;\s*)az11_session=([^;]+)/);if(!m)return null;
  const sess=await store.get(`session-${tokenHash(decodeURIComponent(m[1]))}`,{type:"json",consistency:"strong"});if(!sess||Date.now()>sess.expires)return null;
  const user=await store.get(`user-${sess.username}`,{type:"json",consistency:"strong"});if(!user)return null;return {username:user.username,displayName:user.displayName,createdAt:user.createdAt};
}
async function newSession(username,store){const token=randomBytes(32).toString("hex"),expires=Date.now()+30*24*3600*1000;await store.setJSON(`session-${tokenHash(token)}`,{username,expires});return token}
export default async req=>{
  const store=getStore({name:"az11-users",consistency:"strong"});
  if(req.method==="GET"){const user=await sessionUser(req,store);return user?J({user}):J({error:"Not logged in"},401)}
  if(req.method!=="POST")return J({error:"Method not allowed"},405);
  let b;try{b=await req.json()}catch{return J({error:"Invalid JSON"},400)}
  if(b.action==="register"){
    const username=clean(b.username).toLowerCase(),displayName=clean(b.displayName)||username,password=String(b.password||"");
    if(!/^[a-z0-9_]{3,20}$/.test(username))return J({error:"Username must be 3–20 letters, numbers or _."},400);
    if(password.length<6)return J({error:"Password must be at least 6 characters."},400);
    const existing=await store.get(`user-${username}`,{type:"json",consistency:"strong"});if(existing)return J({error:"Username already exists."},409);
    const salt=randomBytes(16).toString("hex"),hash=scryptSync(password,salt,64).toString("hex"),now=new Date().toISOString();
    await store.setJSON(`user-${username}`,{username,displayName,salt,hash,createdAt:now,lastSeen:now});
    const idx=await store.get("users-index",{type:"json",consistency:"strong"})||[];idx.push({username,displayName,createdAt:now,lastSeen:now});await store.setJSON("users-index",idx);
    const token=await newSession(username,store);return J({user:{username,displayName,createdAt:now}},200,{"set-cookie":cookie(token)});
  }
  if(b.action==="login"){
    const username=clean(b.username).toLowerCase(),password=String(b.password||""),user=await store.get(`user-${username}`,{type:"json",consistency:"strong"});
    if(!user)return J({error:"Invalid username or password."},401);
    const got=scryptSync(password,user.salt,64),want=Buffer.from(user.hash,"hex");if(got.length!==want.length||!timingSafeEqual(got,want))return J({error:"Invalid username or password."},401);
    user.lastSeen=new Date().toISOString();await store.setJSON(`user-${username}`,user);
    let idx=await store.get("users-index",{type:"json",consistency:"strong"})||[];idx=idx.map(x=>x.username===username?{...x,lastSeen:user.lastSeen}:x);await store.setJSON("users-index",idx);
    const token=await newSession(username,store);return J({user:{username,displayName:user.displayName,createdAt:user.createdAt}},200,{"set-cookie":cookie(token)});
  }
  if(b.action==="logout"){
    const c=req.headers.get("cookie")||"",m=c.match(/(?:^|;\s*)az11_session=([^;]+)/);if(m)await store.delete(`session-${tokenHash(decodeURIComponent(m[1]))}`);
    return J({ok:true},200,{"set-cookie":"az11_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"});
  }
  return J({error:"Unknown action"},400);
};
export const config={path:"/api/auth"};
