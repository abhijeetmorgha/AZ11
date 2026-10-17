import { getStore } from "@netlify/blobs";
import { randomBytes, createHash } from "node:crypto";

const J=(d,s=200)=>new Response(JSON.stringify(d),{
  status:s,
  headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store"
  }
});

const tokenHash=t=>createHash("sha256").update(t).digest("hex");
const cleanCode=s=>String(s||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
const EMOJIS=new Set(["😂","🔥","😎","😜","👀","💪"]);

async function sessionUser(req){
  const users=getStore({name:"az11-users",consistency:"strong"});
  const c=req.headers.get("cookie")||"";
  const m=c.match(/(?:^|;\s*)az11_session=([^;]+)/);
  if(!m)return null;

  const sess=await users.get(`session-${tokenHash(decodeURIComponent(m[1]))}`,{
    type:"json",consistency:"strong"
  });
  if(!sess||Date.now()>sess.expires)return null;

  const user=await users.get(`user-${sess.username}`,{
    type:"json",consistency:"strong"
  });
  if(!user)return null;

  return {
    username:user.username,
    displayName:user.displayName||user.username
  };
}

function roomView(room,user){
  const me=room.players.find(p=>p.username===user.username);
  const displayByUser=Object.fromEntries(room.players.map(p=>[
    p.username,p.displayName||p.username
  ]));

  return {
    code:room.code,
    questionIds:room.questionIds,
    createdAt:room.createdAt,
    label:room.label||'Friend Game',
    players:room.players.map(p=>({
      username:p.username,
      displayName:p.displayName,
      score:p.score||0,
      answered:Object.keys(p.answers||{}).length
    })),
    me:me?{
      username:me.username,
      displayName:me.displayName,
      score:me.score||0,
      answers:me.answers||{}
    }:null,
    reactions:(room.reactions||[]).slice(-12).map(r=>({
      id:r.id,
      from:r.from,
      to:r.to,
      emoji:r.emoji,
      at:r.at,
      fromDisplayName:displayByUser[r.from]||r.from
    }))
  };
}

async function getRoom(store,code){
  const room=await store.get(`room-${code}`,{
    type:"json",consistency:"strong"
  });
  if(!room)return null;

  if(Date.now()>Number(room.expires||0)){
    await store.delete(`room-${code}`);
    return null;
  }
  return room;
}

function newCode(){
  return randomBytes(4).toString("hex").slice(0,6).toUpperCase();
}


async function finalizeGameStats(statsStore,room){
  if(room.statsSaved)return room;
  const total=room.questionIds?.length||0;
  if(room.players.length<2)return room;
  if(!room.players.every(p=>Object.keys(p.answers||{}).length>=total))return room;

  const scores=room.players.map(p=>Number(p.score||0));
  const max=Math.max(...scores);
  const winners=room.players.filter(p=>Number(p.score||0)===max);

  for(const p of room.players){
    const key=`user-${p.username}`;
    let s=await statsStore.get(key,{type:"json",consistency:"strong"})||{
      username:p.username,
      displayName:p.displayName||p.username,
      games:0,wins:0,points:0
    };
    s.displayName=p.displayName||p.username;
    s.games=Number(s.games||0)+1;
    s.points=Number(s.points||0)+Number(p.score||0);
    if(winners.length===1 && winners[0].username===p.username){
      s.wins=Number(s.wins||0)+1;
    }
    await statsStore.setJSON(key,s);
  }
  room.statsSaved=true;
  return room;
}

export default async req=>{
  const user=await sessionUser(req);
  if(!user)return J({error:"Login to AZ11 Account first."},401);

  const store=getStore({name:"az11-game-rooms",consistency:"strong"});
  const statsStore=getStore({name:"az11-game-stats",consistency:"strong"});

  if(req.method==="GET"){
    const code=cleanCode(new URL(req.url).searchParams.get("code"));
    const room=await getRoom(store,code);
    if(!room)return J({error:"Game room not found or expired."},404);

    if(!room.players.some(p=>p.username===user.username)){
      return J({error:"Join this room first."},403);
    }
    return J({room:roomView(room,user)});
  }

  if(req.method!=="POST")return J({error:"Method not allowed."},405);

  let b;
  try{b=await req.json()}
  catch{return J({error:"Invalid game request."},400)}

  
  if(b.action==="leaderboard"){
    const raw=await statsStore.list({prefix:"user-"});
    const rows=[];
    for(const blob of raw.blobs||[]){
      try{
        const s=await statsStore.get(blob.key,{type:"json",consistency:"strong"});
        if(s)rows.push(s);
      }catch(e){}
    }
    rows.sort((a,b)=>(b.wins||0)-(a.wins||0)||(b.points||0)-(a.points||0)||(a.games||0)-(b.games||0));
    return J({leaderboard:rows.slice(0,20)});
  }

if(b.action==="create"){
    const ids=Array.isArray(b.questionIds)?b.questionIds.map(String):[];
    const answers=Array.isArray(b.correctAnswers)?b.correctAnswers.map(Number):[];

    if(
      ids.length!==20 ||
      new Set(ids).size!==20 ||
      answers.length!==20 ||
      answers.some(x=>!Number.isInteger(x)||x<0||x>3)
    ){
      return J({error:"Friend Game needs exactly 20 unique valid questions."},400);
    }

    let code,tries=0;
    do{code=newCode();tries++}
    while(await getRoom(store,code)&&tries<8);

    const now=Date.now();
    const room={
      code,
      questionIds:ids,
      correctAnswers:answers,
      createdAt:new Date(now).toISOString(),
      label:String(b.label||'Friend Game').slice(0,120),
      expires:now+24*3600*1000,
      reactions:[],
      players:[{
        username:user.username,
        displayName:user.displayName,
        score:0,
        answers:{},
        lastReactionAt:0
      }]
    };

    await store.setJSON(`room-${code}`,room);
    return J({room:roomView(room,user)});
  }

  const code=cleanCode(b.code);
  const room=await getRoom(store,code);
  if(!room)return J({error:"Game room not found or expired."},404);

  if(b.action==="join"){
    if(!room.players.some(p=>p.username===user.username)){
      if(room.players.length>=2){
        return J({error:"This game already has 2 players."},409);
      }

      room.players.push({
        username:user.username,
        displayName:user.displayName,
        score:0,
        answers:{},
        lastReactionAt:0
      });
      await store.setJSON(`room-${code}`,room);
    }
    return J({room:roomView(room,user)});
  }

  if(b.action==="leave"){
    room.players=room.players.filter(p=>p.username!==user.username);

    if(!room.players.length){
      await store.delete(`room-${code}`);
    }else{
      room.reactions=(room.reactions||[]).filter(
        r=>r.from!==user.username&&r.to!==user.username
      );
      await store.setJSON(`room-${code}`,room);
    }
    return J({ok:true});
  }

  if(b.action==="answer"){
    const p=room.players.find(x=>x.username===user.username);
    if(!p)return J({error:"Join this game first."},403);

    if(room.players.length<2){
      return J({error:"Wait for your friend to join."},409);
    }

    const index=Number(b.index),choice=Number(b.choice);
    if(
      !Number.isInteger(index) ||
      index<0 ||
      index>=room.questionIds.length ||
      !Number.isInteger(choice) ||
      choice<0 ||
      choice>3
    ){
      return J({error:"Invalid answer."},400);
    }

    p.answers=p.answers||{};
    if(p.answers[String(index)]!=null){
      return J({error:"You already answered this question."},409);
    }

    const point=choice===Number(room.correctAnswers[index])?1:0;
    p.answers[String(index)]={choice,point,at:Date.now()};
    p.score=Object.values(p.answers).reduce(
      (sum,a)=>sum+(Number(a.point)||0),0
    );

    await finalizeGameStats(statsStore,room);
    await store.setJSON(`room-${code}`,room);
    return J({point,room:roomView(room,user)});
  }

  if(b.action==="react"){
    const p=room.players.find(x=>x.username===user.username);
    if(!p)return J({error:"Join this game first."},403);

    if(room.players.length<2){
      return J({error:"Wait for your friend to join."},409);
    }

    const emoji=String(b.emoji||"");
    if(!EMOJIS.has(emoji)){
      return J({error:"Unsupported emoji."},400);
    }

    const now=Date.now();
    if(now-Number(p.lastReactionAt||0)<700){
      return J({error:"Emoji too fast 😄"},429);
    }
    p.lastReactionAt=now;

    const other=room.players.find(x=>x.username!==user.username);
    if(!other)return J({error:"Friend is not in the room."},409);

    room.reactions=Array.isArray(room.reactions)?room.reactions:[];
    room.reactions.push({
      id:`${now.toString(36)}-${randomBytes(2).toString("hex")}`,
      from:user.username,
      to:other.username,
      emoji,
      at:now
    });
    room.reactions=room.reactions.slice(-20);

    await store.setJSON(`room-${code}`,room);
    return J({room:roomView(room,user)});
  }

  return J({error:"Unknown game action."},400);
};

export const config={path:"/api/game"};
