import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import QRCode from "https://esm.sh/qrcode@1.5.4";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const c = (h: string) => rgb(parseInt(h.slice(1,3),16)/255, parseInt(h.slice(3,5),16)/255, parseInt(h.slice(5,7),16)/255);

async function makeTicketPdf(rows: any[], order: any) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const palettes: Record<string, any> = {
    vvip: { bg:"#090704", panel:"#211707", panel2:"#120e08", ink:"#f7e5b2", muted:"#c8b27b", accent:"#d9ae52", edge:"#876225", badge:"#d9ae52", badgeInk:"#181006" },
    vip: { bg:"#0a0d13", panel:"#202632", panel2:"#111720", ink:"#f4f5f7", muted:"#b7c0cc", accent:"#cbd3df", edge:"#737e8c", badge:"#cbd3df", badgeInk:"#11151b" },
    early: { bg:"#fbfaf6", panel:"#eeece5", panel2:"#f5f3ed", ink:"#1c1b18", muted:"#777267", accent:"#857d6e", edge:"#c9c3b7", badge:"#292822", badgeInk:"#ffffff" },
    regular: { bg:"#10111d", panel:"#202239", panel2:"#15172a", ink:"#f8f5ff", muted:"#c4bdd8", accent:"#d8c8ff", edge:"#9382bd", badge:"#d8c8ff", badgeInk:"#171426" },
  };
  const hex=(v:string)=>c(v);
  const drawFit=(page:any,value:any,x:number,y:number,maxWidth:number,size:number,font:any,color:any,min=5)=>{
    const str=String(value??"");
    let s=size;
    while(s>min && font.widthOfTextAtSize(str,s)>maxWidth) s-=0.4;
    page.drawText(str,{x,y,size:s,font,color});
  };
  const wrap=(value:string,font:any,size:number,maxWidth:number)=>{
    const words=String(value||"").split(/\s+/);const lines:string[]=[];let line="";
    for(const word of words){const test=line?line+" "+word:word;if(font.widthOfTextAtSize(test,size)>maxWidth&&line){lines.push(line);line=word}else line=test}
    if(line)lines.push(line);return lines.slice(0,2);
  };
  for (const t of rows) {
    const rawType=String(t.ticket_type_name||"Regular").toLowerCase();
    const variant=rawType.includes("vvip")?"vvip":rawType.includes("vip")?"vip":rawType.includes("early")?"early":"regular";
    const p=palettes[variant];
    const page=pdf.addPage([720,300]);
    const rect=(x:number,y:number,w:number,h:number,color:string)=>page.drawRectangle({x,y,width:w,height:h,color:hex(color)});
    const line=(x1:number,y1:number,x2:number,y2:number,color:string,width=0.8,dash?:number[])=>page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},thickness:width,color:hex(color),...(dash?{dashArray:dash}:{})});
    const label=(value:string,x:number,y:number)=>page.drawText(value,{x,y,size:7,font:bold,color:hex(p.muted),characterSpacing:1.1});
    rect(0,0,720,300,p.bg);
    rect(0,0,184,300,p.panel);
    rect(184,0,351,300,p.bg);
    rect(535,0,185,300,p.panel2);
    // Category-specific artwork, all vector-based so it remains crisp in the PDF.
    if(variant==="vvip"){
      for(let i=0;i<13;i++) page.drawCircle({x:12+(i*37)%160,y:12+(i*53)%275,size:1.05,color:hex("#8d682b"),opacity:0.62});
      for(let i=0;i<5;i++) line(8+i*8,0,0,50+i*8,"#5e451e",0.45);
      page.drawRectangle({x:9,y:9,width:166,height:282,borderColor:hex(p.accent),borderWidth:1.4});
      page.drawRectangle({x:15,y:15,width:154,height:270,borderColor:hex("#725323"),borderWidth:0.5});
    } else if(variant==="vip"){
      for(let i=0;i<8;i++) line(0,24+i*35,184,0+i*35,"#394352",0.55);
      page.drawRectangle({x:9,y:9,width:166,height:282,borderColor:hex(p.accent),borderWidth:1.2});
      page.drawRectangle({x:15,y:15,width:154,height:270,borderColor:hex("#596473"),borderWidth:0.45});
    } else if(variant==="early"){
      for(let i=0;i<14;i++) line(8+i*12,0,0+i*12,300,"#e0ddd5",0.55);
      page.drawRectangle({x:9,y:9,width:166,height:282,borderColor:hex(p.edge),borderWidth:1});
      page.drawRectangle({x:15,y:15,width:154,height:270,borderColor:hex("#ded9cf"),borderWidth:0.45});
    } else {
      const holo=["#d8b7ef","#a9dce9","#b9e5d2","#f1d6a7","#d9c5f3","#f0bdda"];
      for(let i=0;i<holo.length;i++){rect(i*120,294,120,6,holo[i]);line(i*120,0,i*120+105,300,holo[i],0.7)}
      page.drawRectangle({x:9,y:9,width:166,height:282,borderColor:hex("#b9a8df"),borderWidth:1.1});
      page.drawRectangle({x:15,y:15,width:154,height:270,borderColor:hex("#6e668c"),borderWidth:0.45});
    }
    // SWAN identity panel.
    const logoColor=hex(p.accent);
    page.drawSvgPath("M 8 4 C 18 0 26 7 24 17 C 22 25 13 30 9 39 C 19 34 31 35 40 43 C 29 40 19 43 11 51 C 21 49 33 54 39 64 C 26 57 17 59 7 69 C 11 55 4 47 3 38 C 2 27 13 21 17 14 C 19 10 15 5 8 4 Z",{x:67,y:192,scale:1.08,color:logoColor});
    page.drawText("SWAN",{x:92,y:151,size:25,font:bold,color:hex(p.ink),characterSpacing:3});
    page.drawText("T I C K E T S",{x:91,y:132,size:9,font:bold,color:hex(p.accent)});
    line(43,119,141,119,p.accent,0.9);
    page.drawText(variant==="vvip"?"VERY IMPORTANT GUEST":variant==="vip"?"VIP ADMISSION":variant==="early"?"EARLY BIRD ACCESS":"GENERAL ADMISSION",{x:34,y:103,size:7,font:bold,color:hex(p.muted),characterSpacing:0.7});
    page.drawText("THE GRAND EXPERIENCE",{x:41,y:39,size:6,font:bold,color:hex(p.muted),characterSpacing:1});
    // Main ticket information.
    line(184,10,184,290,p.edge,1);
    page.drawText("OFFICIAL EVENT ADMISSION",{x:207,y:270,size:7,font:bold,color:hex(p.accent),characterSpacing:1.35});
    const eventLines=wrap(String(t.event_title||"SWAN TICKETS EVENT"),serif,24,300);
    eventLines.forEach((str,i)=>page.drawText(str,{x:207,y:237-i*27,size:24,font:serif,color:hex(p.ink)}));
    const category=String(t.ticket_type_name||"REGULAR").toUpperCase();
    const badgeWidth=Math.min(170,Math.max(88,bold.widthOfTextAtSize(category,8)+22));
    rect(207,178,badgeWidth,18,p.badge);
    page.drawText(category,{x:218,y:184,size:8,font:bold,color:hex(p.badgeInk),characterSpacing:0.9});
    label("ATTENDEE",207,151);
    drawFit(page,t.attendee_name||order.customer_name||"Guest",207,133,300,12,bold,hex(p.ink),7);
    label("DATE & TIME",207,107);
    const when=t.starts_at?new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Nairobi",dateStyle:"medium",timeStyle:"short"}).format(new Date(t.starts_at)):"See event details";
    drawFit(page,when,207,90,300,10,regular,hex(p.ink),7);
    label("VENUE",207,64);
    drawFit(page,t.venue||"Venue to be confirmed",207,47,300,10,regular,hex(p.ink),7);
    line(207,32,510,32,p.edge,0.65);
    drawFit(page,"BOOKING REF.  "+String(order.booking_reference||""),207,18,300,7,bold,hex(p.muted),5.5);
    // Separate tear-off QR stub.
    line(535,8,535,292,p.accent,1,[4,3]);
    page.drawText("SCAN AT ENTRY",{x:574,y:267,size:9,font:bold,color:hex(p.ink),characterSpacing:0.8});
    page.drawRectangle({x:562,y:119,width:132,height:132,color:hex("#ffffff")});
    const data=await QRCode.toDataURL("SWT1:"+String(t.qr_token),{errorCorrectionLevel:"H",margin:1,width:360});
    const png=Uint8Array.from(atob(data.split(",")[1]),z=>z.charCodeAt(0));
    const image=await pdf.embedPng(png);
    page.drawImage(image,{x:568,y:125,width:120,height:120});
    page.drawText("TICKET NUMBER",{x:583,y:98,size:6.5,font:bold,color:hex(p.muted),characterSpacing:0.8});
    drawFit(page,t.ticket_number,558,81,140,8,bold,hex(p.ink),5);
    line(565,63,690,63,p.edge,0.65);
    page.drawText("VALID  ·  ONE ENTRY",{x:580,y:45,size:7,font:bold,color:hex(p.accent),characterSpacing:0.5});
    page.drawText(String(order.booking_reference||""),{x:575,y:24,size:5.5,font:regular,color:hex(p.muted)});
  }
  return await pdf.save();
}
async function sendPaidOrderEmail(db: any, orderId: string) {
  const stale = new Date(Date.now()-300000).toISOString();
  const {data:order,error:claimErr} = await db.from("orders")
    .update({ticket_email_claimed_at:new Date().toISOString()})
    .eq("id",orderId).eq("status","paid").is("ticket_email_sent_at",null)
    .or("ticket_email_claimed_at.is.null,ticket_email_claimed_at.lt."+stale)
    .select("id,booking_reference,customer_name,customer_email,total_amount,currency,ticket_email_attempts")
    .maybeSingle();
  if (claimErr) throw new Error("Could not claim email job: "+claimErr.message);
  if (!order) return "skipped";
  const attempt = Number(order.ticket_email_attempts || 0) + 1;
  const {error:attemptErr} = await db.from("orders").update({ticket_email_attempts:attempt}).eq("id",orderId);
  if (attemptErr) throw new Error("Could not record retry attempt: "+attemptErr.message);

  try {
    if (!order.customer_email) throw new Error("Customer email is missing");
    const {data:items,error:itemsErr} = await db.from("order_items").select("id,ticket_type_id").eq("order_id",orderId);
    if (itemsErr) throw new Error("Order items query failed: "+itemsErr.message);
    if (!items?.length) throw new Error("No order items found for paid order");
    const typeIds = [...new Set(items.map((x:any)=>x.ticket_type_id).filter(Boolean))];
    const {data:types,error:typesErr} = await db.from("ticket_types").select("id,name,event_id").in("id",typeIds);
    if (typesErr) throw new Error("Ticket types query failed: "+typesErr.message);
    const eventIds = [...new Set((types||[]).map((x:any)=>x.event_id).filter(Boolean))];
    const {data:events,error:eventsErr} = await db.from("events").select("id,title,venue,starts_at").in("id",eventIds);
    if (eventsErr) throw new Error("Events query failed: "+eventsErr.message);
    const typeById = new Map((types||[]).map((x:any)=>[x.id,x]));
    const eventById = new Map((events||[]).map((x:any)=>[x.id,x]));
    const {data:tickets,error:ticketsErr} = await db.from("tickets")
      .select("ticket_number,qr_token,attendee_name,order_item_id,status")
      .in("order_item_id",items.map((x:any)=>x.id)).eq("status","valid").order("created_at",{ascending:true});
    if (ticketsErr) throw new Error("Ticket query failed: "+ticketsErr.message);
    if (!tickets?.length) throw new Error("No valid tickets found for paid order");
    const itemById = new Map(items.map((x:any)=>[x.id,x]));
    const rows = tickets.map((t:any)=>{
      const item:any = itemById.get(t.order_item_id);
      const type:any = typeById.get(item?.ticket_type_id);
      const event:any = eventById.get(type?.event_id);
      return {...t,ticket_type_name:type?.name||"Regular",event_title:event?.title||"SWAN TICKETS EVENT",venue:event?.venue||"",starts_at:event?.starts_at||null};
    });
    const bytes = await makeTicketPdf(rows,order);
    let binary = "";
    for(let i=0;i<bytes.length;i+=32768) binary += String.fromCharCode(...bytes.subarray(i,Math.min(i+32768,bytes.length)));
    const esc = (v:any)=>String(v??"").replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]!));
    const key = Deno.env.get("BREVO_API_KEY")!;
    const sender = Deno.env.get("BREVO_SENDER_EMAIL")!;
    const res = await fetch("https://api.brevo.com/v3/smtp/email",{
      method:"POST",
      headers:{"accept":"application/json","api-key":key,"content-type":"application/json"},
      body:JSON.stringify({
        sender:{name:"SWAN TICKETS",email:sender},
        to:[{email:order.customer_email,name:order.customer_name}],
        subject:"Your SWAN TICKETS — "+order.booking_reference,
        htmlContent:"<div style='font-family:Arial,sans-serif;color:#211d30'><h2>SWAN TICKETS</h2><p>Hello "+esc(order.customer_name)+",</p><p>Your payment is confirmed. Your tickets are attached as a PDF.</p><p><b>Booking reference:</b> "+esc(order.booking_reference)+"</p><p>Present each ticket's QR code at the entrance. Each ticket is valid for one entry.</p><p>Thank you for booking with SWAN TICKETS.</p></div>",
        attachment:[{name:"SWAN-TICKETS-"+order.booking_reference+".pdf",content:btoa(binary)}]
      })
    });
    if(!res.ok) throw new Error("Brevo rejected email (HTTP "+res.status+"): "+(await res.text()).slice(0,400));
    const {error:sentErr} = await db.from("orders").update({
      ticket_email_sent_at:new Date().toISOString(),
      ticket_email_claimed_at:null,
      ticket_email_last_error:null
    }).eq("id",orderId);
    if(sentErr) throw new Error("Sent but failed to record delivery: "+sentErr.message);
    return "sent";
  } catch(e) {
    const message = String(e instanceof Error ? e.message : e).slice(0,1000);
    const quotaOrRateLimit = /daily|quota|credit|limit reached|too many requests|429|402/i.test(message);
    const delayMinutes = quotaOrRateLimit ? 30 : Math.min(360,Math.pow(2,Math.max(0,attempt-1))*2);
    await db.from("orders").update({
      ticket_email_claimed_at:null,
      ticket_email_last_error:message,
      ticket_email_next_attempt_at:new Date(Date.now()+delayMinutes*60000).toISOString()
    }).eq("id",orderId);
    console.error("Ticket email retry failed",orderId,"attempt",attempt,message);
    return "failed";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({error:"Method not allowed"},405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey || !Deno.env.get("BREVO_API_KEY") || !Deno.env.get("BREVO_SENDER_EMAIL")) {
    return json({error:"Retry worker configuration is incomplete"},503);
  }
  const token = req.headers.get("x-swan-retry-token") || "";
  const db = createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:valid,error:authError} = await db.rpc("verify_ticket_email_worker_token",{p_token:token});
  if (authError || valid !== true) return json({error:"Unauthorized"},401);

  try {
    const now = new Date().toISOString();
    const {data:orders,error} = await db.from("orders")
      .select("id")
      .eq("status","paid")
      .is("ticket_email_sent_at",null)
      .lte("ticket_email_next_attempt_at",now)
      .or("ticket_email_claimed_at.is.null,ticket_email_claimed_at.lt."+new Date(Date.now()-300000).toISOString())
      .order("created_at",{ascending:true})
      .limit(10);
    if (error) throw error;
    let sent=0,failed=0,skipped=0;
    for (const order of orders||[]) {
      const result = await sendPaidOrderEmail(db,String(order.id));
      if (result==="sent") sent++;
      else if (result==="failed") failed++;
      else skipped++;
    }
    return json({ok:true,checked:orders?.length||0,sent,failed,skipped});
  } catch(e) {
    console.error("Ticket email retry worker error",e);
    return json({error:"Retry worker failed"},500);
  }
});
