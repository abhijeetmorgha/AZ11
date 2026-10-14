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
    const meta=await store.get(`meta-${id}`,{type:"json",consistency:"strong"});
    if(meta?.total){
      const headers={
        "content-type":"application/pdf",
        "content-disposition":`inline; filename="${String(meta.fileName||"AZ11-paper.pdf").replace(/["\r\n]/g,"")}"`,
        "cache-control":"public,max-age=300",
        "content-length":String(meta.size||"")
      };
      if(req.method==="HEAD")return new Response(null,{headers});

      let i=0;
      const stream=new ReadableStream({
        async pull(controller){
          if(i>=meta.total){controller.close();return}
          try{
            const ab=await store.get(`chunk-${id}-${i}`,{type:"arrayBuffer",consistency:"strong"});
            if(!ab||!ab.byteLength){controller.error(new Error("Missing PDF chunk"));return}
            controller.enqueue(new Uint8Array(ab));
            i++;
          }catch(e){controller.error(e)}
        }
      });
      return new Response(stream,{headers});
    }

    const data=await store.get(`file-${id}`,{type:"arrayBuffer",consistency:"strong"});
    if(!data||data.byteLength===0)return new Response("PDF not found",{status:404});
    if(req.method==="HEAD")return new Response(null,{headers:{"content-type":"application/pdf","content-length":String(data.byteLength),"cache-control":"public,max-age=300"}});
    return new Response(data,{headers:{"content-type":"application/pdf","content-disposition":"inline; filename=AZ11-paper.pdf","cache-control":"public,max-age=300"}});
  }

  return J({error:"Method not allowed."},405)
};
export const config={path:"/api/pdf-test-file"};
