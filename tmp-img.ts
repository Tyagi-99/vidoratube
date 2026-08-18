const key=process.env.LOVABLE_API_KEY!;
const scenes=["A wide, atmospheric shot of a windswept hill in Sussex under a dramatic, overcast autumn sky. Anglo-Saxon banners flutter in the cold wind.","Close-up of interlocking wooden shields, scarred by battle. English soldiers stand shoulder-to-shoulder, grim-faced, bracing against incoming pressure.","A dynamic, low-angle shot of Norman cavalry charging uphill, swords raised, as dust and mud fly from beneath the horses' hooves.","The English shield wall begins to splinter and break apart in chaos, revealing gaps in the defensive line.","A slow-motion, cinematic shot of a royal standard falling to the bloodied earth, symbolizing the death of King Harold."];
for (const [i,s] of scenes.entries()){
  const prompt=`Cinematic documentary b-roll still, 16:9 widescreen, photorealistic, filmic colour grading, no text or logos. Scene: ${s}`;
  const r=await fetch("https://ai.gateway.lovable.dev/v1/images/generations",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:"google/gemini-2.5-flash-image",messages:[{role:"user",content:prompt}],modalities:["image","text"]})});
  console.log(i,r.status, r.ok?"ok":(await r.text()).slice(0,400));
}
