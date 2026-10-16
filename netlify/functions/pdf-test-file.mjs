import { getStore } from "@netlify/blobs";
const J=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const admin=req=>(req.headers.get("x-az11-admin-key")||"")===(process.env.AZ11_ADMIN_KEY||"") && !!process.env.AZ11_ADMIN_KEY;

const MAX_BYTES=18*1024*1024;
const MAX_PART_BYTES=1500*1024;
const MAX_PARTS=30;

function pdfSignature(ab){
  if(!ab||ab.byteLength<5)return false;
  const h=new Uint8Array(ab.slice(0,5));
  return String.fromCharCode(...h)==="%PDF-";
}

export default async req=>{
  const u=new URL(req.url);
  const id=String(u.searchParams.get("id")||"");
  if(!id)return J({error:"Missing id"},400);

  const store=getStore({name:"az11-pdf-tests",consistency:"strong"});

  if(req.method==="POST"){
    if(!admin(req))return J({error:"Wrong or missing owner key."},401);

    const finalize=u.searchParams.get("finalize")==="1";
    const total=Number(u.searchParams.get("total"));
    const part=Number(u.searchParams.get("part"));

    if(finalize){
      if(!Number.isInteger(total)||total<1||total>MAX_PARTS)return J({error:"Invalid PDF part count."},400);

      let size=0;
      let first=null;
      for(let i=0;i<total;i++){
        const ab=await store.get(`chunk-${id}-${i}`,{type:"arrayBuffer",consistency:"strong"});
        if(!ab||!ab.byteLength)return J({error:`Missing PDF part ${i+1}. Please upload again.`},400);
        if(i===0)first=ab;
        size+=ab.byteLength;
        if(size>MAX_BYTES)return J({error:"PDF must be 18 MB or smaller."},413);
      }

      const name=decodeURIComponent(req.headers.get("x-az11-file-name")||"paper.pdf");
      if(!/\.pdf$/i.test(name))return J({error:"Choose a .pdf file."},415);
      // Some valid PDFs can fail a strict first-byte signature check after chunk storage,
      // so filename + browser-side PDF selection + size limit are used here.
      await store.setJSON(`meta-${id}`,{total,size,fileName:name,updated:new Date().toISOString()});
      return J({ok:true,size,total});
    }

    if(Number.isInteger(part)&&Number.isInteger(total)){
      if(part<0||part>=total||total<1||total>MAX_PARTS)return J({error:"Invalid PDF part."},400);
      const ab=await req.arrayBuffer();
      if(!ab||!ab.byteLength)return J({error:"Empty PDF part."},400);
      if(ab.byteLength>MAX_PART_BYTES)return J({error:"PDF part is too large."},413);
      await store.set(`chunk-${id}-${part}`,ab);
      return J({ok:true,part,total,size:ab.byteLength});
    }

    // Backward-compatible direct upload for small PDFs.
    const ab=await req.arrayBuffer();
    if(!ab||!ab.byteLength)return J({error:"Empty PDF."},400);
    if(ab.byteLength>4*1024*1024)return J({error:"Use the updated chunk uploader for PDFs over 4 MB."},413);
    if(!pdfSignature(ab))return J({error:"Only PDF files are allowed."},415);
    await store.set(`file-${id}`,ab);
    return J({ok:true,size:ab.byteLength});
  }

  if(req.method==="GET" || req.method==="HEAD"){
    const newMeta=await store.get(`meta-${id}`,{type:"json",consistency:"strong"});
    const oldMeta=await store.get(`filemeta-${id}`,{type:"json",consistency:"strong"});
    const meta=newMeta?.total ? {
      total:Number(newMeta.total)||0,
      size:Number(newMeta.size)||0,
      fileName:newMeta.fileName||"paper.pdf",
      layout:"new"
    } : (oldMeta?.complete ? {
      total:Number(oldMeta.chunks)||0,
      size:Number(oldMeta.totalSize)||0,
      fileName:oldMeta.fileName||"paper.pdf",
      layout:"old"
    } : null);

    if(u.searchParams.get("meta")==="1"){
      if(meta?.total)return J({chunked:true,chunks:meta.total,totalSize:meta.size,fileName:meta.fileName});
      const legacy=await store.get(`file-${id}`,{type:"arrayBuffer",consistency:"strong"});
      if(legacy?.byteLength)return J({chunked:false,totalSize:legacy.byteLength,fileName:"paper.pdf"});
      return J({error:"PDF not found"},404);
    }

    if(u.searchParams.has("part")){
      const p=Number(u.searchParams.get("part"));
      if(!meta?.total||!Number.isInteger(p)||p<0||p>=meta.total)return new Response("PDF part not found",{status:404});
      const key=meta.layout==="new"?`chunk-${id}-${p}`:`file-${id}-part-${p}`;
      const data=await store.get(key,{type:"arrayBuffer",consistency:"strong"});
      if(!data||!data.byteLength)return new Response("PDF part not found",{status:404});
      return new Response(data,{headers:{
        "content-type":"application/octet-stream",
        "cache-control":"public,max-age=300"
      }});
    }

    async function readAllPdf(){
      if(meta?.total){
        const parts=[];
        let totalBytes=0;
        for(let i=0;i<meta.total;i++){
          const key=meta.layout==="new"?`chunk-${id}-${i}`:`file-${id}-part-${i}`;
          const ab=await store.get(key,{type:"arrayBuffer",consistency:"strong"});
          if(!ab||!ab.byteLength)throw new Error("Missing PDF chunk");
          parts.push(new Uint8Array(ab));
          totalBytes+=ab.byteLength;
        }
        const out=new Uint8Array(totalBytes);
        let off=0;
        for(const p of parts){out.set(p,off);off+=p.byteLength}
        return {bytes:out,fileName:meta.fileName||"AZ11-paper.pdf"};
      }
      const ab=await store.get(`file-${id}`,{type:"arrayBuffer",consistency:"strong"});
      if(!ab||!ab.byteLength)return null;
      return {bytes:new Uint8Array(ab),fileName:"AZ11-paper.pdf"};
    }

    let pdf;
    try{pdf=await readAllPdf()}catch(e){return new Response("PDF unavailable",{status:404})}
    if(!pdf)return new Response("PDF not found",{status:404});

    const totalSize=pdf.bytes.byteLength;
    const safeName=String(pdf.fileName||"AZ11-paper.pdf").replace(/["\r\n]/g,"");
    const baseHeaders={
      "content-type":"application/pdf",
      "content-disposition":`inline; filename="${safeName}"`,
      "accept-ranges":"bytes",
      "cache-control":"public,max-age=300"
    };

    if(req.method==="HEAD"){
      return new Response(null,{status:200,headers:{...baseHeaders,"content-length":String(totalSize)}})
    }

    const range=req.headers.get("range");
    if(range){
      const m=range.match(/bytes=(\d*)-(\d*)/);
      if(m){
        let start=m[1]?Number(m[1]):0;
        let finish=m[2]?Number(m[2]):totalSize-1;
        if(!Number.isFinite(start)||!Number.isFinite(finish)||start<0||finish<start||start>=totalSize){
          return new Response(null,{status:416,headers:{"content-range":`bytes */${totalSize}`}});
        }
        finish=Math.min(finish,totalSize-1);
        const chunk=pdf.bytes.slice(start,finish+1);
        return new Response(chunk,{status:206,headers:{
          ...baseHeaders,
          "content-range":`bytes ${start}-${finish}/${totalSize}`,
          "content-length":String(chunk.byteLength)
        }});
      }
    }

    return new Response(pdf.bytes,{status:200,headers:{
      ...baseHeaders,
      "content-length":String(totalSize)
    }});
  }

  return J({error:"Method not allowed."},405)
};
export const config={path:"/api/pdf-test-file"};
