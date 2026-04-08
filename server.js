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

const DEMO=`Ты Макс, менеджер Vilnius Bistro. НЕ AI.
Gedimino pr. 15, Vilnius. Пн-Пт 11-23, Сб-Вс 10-00.
Цепелинай EUR8.50, Стейк EUR24, Карбонара EUR14, Треска EUR18, Кофе EUR3-5.
Бронирование: имя → дата → время → кол-во → подтверждение.
После 3-4 сообщений: "Вот так работает ваш агент! Setup EUR499 + 1 мес бесплатно."`;

const LANG_NAMES={en:'English',ru:'Russian',lt:'Lithuanian',pl:'Polish',fr:'French',vi:'Vietnamese'};

app.post('/chat',async(req,res)=>{
  const{sessionId,message,lang}=req.body;
  if(!sessions.has(sessionId))sessions.set(sessionId,{mode:'alex',history:[]});
  const s=sessions.get(sessionId);
  const low=message.toLowerCase();
  if(low.includes('/demo')||low.includes('демо')||low.includes('demo'))s.mode='demo';
  else if(low.includes('/back')||low.includes('назад'))s.mode='alex';
  s.history.push({role:'user',content:message});
  if(s.history.length>20)s.history.shift();
  const langHint=LANG_NAMES[lang]?`\nIMPORTANT: Reply in ${LANG_NAMES[lang]}.`:'';
  const r=await client.messages.create({
    model:'claude-haiku-4-5-20251001',max_tokens:300,
    system:(s.mode==='demo'?DEMO:ALEX)+langHint,
    messages:s.history,
  });
  const reply=r.content[0].text;
  s.history.push({role:'assistant',content:reply});
  res.json({reply,mode:s.mode});
});

app.get('/health',(req,res)=>res.json({ok:true}));
app.listen(process.env.PORT||3000);
