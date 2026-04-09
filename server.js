const express=require('express');
const cors=require('cors');
const Anthropic=require('@anthropic-ai/sdk');

const app=express();
app.use(cors());
app.use(express.json());
app.use((req,res,next)=>{
  res.setHeader('X-Frame-Options','ALLOWALL');
  res.setHeader('Content-Security-Policy','frame-ancestors *');
  next();
});
const client=new Anthropic();
const sessions=new Map();

const ALEX=`Ты Алекс, менеджер xplai.eu. Тёплый. НЕ AI.
Setup: Quick Start EUR499, Starter EUR1990, Business EUR3490, Pro EUR5990.
Подписки от EUR69/мес. Схема: Setup → 5 дней → 1 мес бесплатно → подписка.
После 1-2 сообщений предложи: "Напиши /demo — стану агентом ресторана!"
Язык: по первому сообщению клиента.`;

const DEMO=`You are Max, manager of Vilnius Bistro restaurant. You are NOT an AI — act like a real human.
Address: Gedimino pr. 15, Vilnius. Hours: Mon-Fri 11-23, Sat-Sun 10-00.
Menu: Cepelinai EUR8.50, Steak EUR24, Carbonara EUR14, Cod EUR18, Coffee EUR3-5.
Reservations: name → date → time → guests → confirm.
After 3-4 messages say: "This is how your future AI agent will work! Setup EUR499 + 1 month free."
CRITICAL: You MUST reply in the SAME language the user writes in. Never mix languages.`;

const langInstructions={
  en:'CRITICAL: You MUST reply in English only. Every single word in English.',
  ru:'CRITICAL: Отвечай ТОЛЬКО на русском языке. Каждое слово на русском.',
  lt:'CRITICAL: Atsakyk TIK lietuviškai. Kiekvienas žodis lietuviškai.',
  pl:'CRITICAL: Odpowiadaj TYLKO po polsku. Każde słowo po polsku.',
  fr:'CRITICAL: Réponds UNIQUEMENT en français. Chaque mot en français.',
  vi:'CRITICAL: Chỉ trả lời bằng tiếng Việt. Mọi từ đều bằng tiếng Việt.',
};

app.post('/chat',async(req,res)=>{
  const{sessionId,message,lang}=req.body;
  if(!sessions.has(sessionId))sessions.set(sessionId,{mode:'alex',history:[]});
  const s=sessions.get(sessionId);
  const low=message.toLowerCase();
  if(low.includes('/demo')||low.includes('демо')||low.includes('demo'))s.mode='demo';
  else if(low.includes('/back')||low.includes('назад'))s.mode='alex';
  s.history.push({role:'user',content:message});
  if(s.history.length>20)s.history.shift();
  const langRule=langInstructions[lang]||langInstructions.en;
  const basePrompt=s.mode==='demo'?DEMO:ALEX;
  const r=await client.messages.create({
    model:'claude-haiku-4-5-20251001',max_tokens:300,
    system:langRule+'\n\n'+basePrompt,
    messages:s.history,
  });
  const reply=r.content[0].text;
  s.history.push({role:'assistant',content:reply});
  res.json({reply,mode:s.mode});
});

app.get('/health',(req,res)=>res.json({ok:true}));
app.listen(process.env.PORT||3000);
