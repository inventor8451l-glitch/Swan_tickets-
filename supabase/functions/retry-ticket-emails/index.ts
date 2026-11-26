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
    vvip:{bg:"#101010",ink:"#ffffff",muted:"#c9c9c9",accent:"#e2b84d",edge:"#8c6c2d",badge:"#e2b84d",badgeInk:"#17120a",panel:"#1b1b1b"},
    vip:{bg:"#101820",ink:"#ffffff",muted:"#c4d2dc",accent:"#48d8ff",edge:"#247c91",badge:"#48d8ff",badgeInk:"#08151b",panel:"#172630"},
    early:{bg:"#21121b",ink:"#ffffff",muted:"#e4bdcc",accent:"#ff78ad",edge:"#9b4268",badge:"#ff78ad",badgeInk:"#24101a",panel:"#301927"},
    regular:{bg:"#ffffff",ink:"#111111",muted:"#555555",accent:"#111111",edge:"#c9c9c9",badge:"#111111",badgeInk:"#ffffff",panel:"#f1f1f1"}
  };
  const fit=(page:any,value:any,x:number,y:number,maxWidth:number,size:number,font:any,color:any,min=6)=>{
    const str=String(value??"");let z=size;while(z>min&&font.widthOfTextAtSize(str,z)>maxWidth)z-=0.5;
    page.drawText(str,{x,y,size:z,font,color});
  };
  const wrap=(value:string,font:any,size:number,maxWidth:number)=>{
    const words=String(value||"").split(/\s+/);const lines:string[]=[];let line="";
    for(const word of words){const test=line?line+" "+word:word;if(font.widthOfTextAtSize(test,size)>maxWidth&&line){lines.push(line);line=word}else line=test}
    if(line)lines.push(line);return lines.slice(0,2);
  };
  for(const t of rows){
    const raw=String(t.ticket_type_name||"Regular").toLowerCase();
    const variant=raw.includes("vvip")?"vvip":raw.includes("vip")?"vip":raw.includes("early")?"early":"regular";
    const p=palettes[variant],col=(h:string)=>c(h),page=pdf.addPage([420,640]);
    const rect=(x:number,y:number,w:number,h:number,color:string)=>page.drawRectangle({x,y,width:w,height:h,color:col(color)});
    const line=(x1:number,y1:number,x2:number,y2:number,color:string,width=0.8)=>page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},thickness:width,color:col(color)});
    const label=(v:string,x:number,y:number)=>page.drawText(v,{x,y,size:8,font:bold,color:col(p.muted),characterSpacing:1});
    rect(0,0,420,640,p.bg);
    rect(14,14,392,612,p.bg);
    page.drawRectangle({x:14,y:14,width:392,height:612,borderColor:col(p.edge),borderWidth:1});
    rect(15,500,390,125,p.panel);
    page.drawText("SWAN TICKETS",{x:76,y:566,size:26,font:serif,color:col(p.ink),characterSpacing:1.5});
    page.drawText("•  MOBILE TICKET  •",{x:79,y:542,size:9,font:bold,color:col(p.accent),characterSpacing:2});
    line(38,524,382,524,p.accent,1);
    const eventLines=wrap(String(t.event_title||"Event admission"),serif,27,340);
    eventLines.forEach((v,i)=>page.drawText(v,{x:38,y:475-i*31,size:27,font:serif,color:col(p.ink)}));
    line(38,410,382,410,p.edge,0.8);
    const category=String(t.ticket_type_name||"Regular").toUpperCase();
    const badgeW=Math.min(220,Math.max(110,bold.widthOfTextAtSize(category,10)+28));
    rect(38,378,badgeW,23,p.badge);
    page.drawText(category,{x:52,y:385,size:10,font:bold,color:col(p.badgeInk),characterSpacing:1});
    label("ADMITS",300,392);fit(page,"1 PERSON",300,376,80,12,bold,col(p.ink),8);
    line(38,354,382,354,p.edge,0.8);
    label("ISSUED TO",38,329);
    fit(page,t.attendee_name||order.customer_name||"Guest",38,305,340,19,bold,col(p.ink),10);
    line(38,286,382,286,p.edge,0.8);
    label("BOOKING ID",38,262);fit(page,order.booking_reference||"—",38,243,150,11,regular,col(p.ink),7);
    label("TICKET ID",220,262);fit(page,t.ticket_number||"—",220,243,160,11,bold,col(p.ink),7);
    line(38,224,382,224,p.edge,0.8);
    const when=t.starts_at?new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Nairobi",dateStyle:"medium",timeStyle:"short"}).format(new Date(t.starts_at)):"See event details";
    label("DATE & TIME",38,202);fit(page,when,38,184,340,10,regular,col(p.ink),7);
    label("VENUE",38,161);fit(page,t.venue||"Venue to be confirmed",38,143,340,10,regular,col(p.ink),7);
    const data=await QRCode.toDataURL("SWT1:"+String(t.qr_token),{errorCorrectionLevel:"H",margin:1,width:360});
    const png=Uint8Array.from(atob(data.split(",")[1]),z=>z.charCodeAt(0)),image=await pdf.embedPng(png);
    page.drawRectangle({x:145,y:39,width:130,height:92,color:col("#ffffff"),borderColor:col(p.accent),borderWidth:1});
    page.drawImage(image,{x:166,y:47,width:88,height:76});
    page.drawText("VALID FOR ONE-TIME ENTRY",{x:106,y:24,size:7,font:bold,color:col(p.muted),characterSpacing:0.8});
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
