const express=require('express');
const cors=require('cors');
const Anthropic=require('@anthropic-ai/sdk');

const app=express();
app.use(cors());
app.use(express.json());
const client=new Anthropic();
const sessions=new Map();

// === CONFIG ===
const TG_BOT='8783753675:AAGo0D01UpgdNwvf15QFU6DcwJiqfnUIvLI';
const TG_CHAT='6696661524';
const SHEETS_ID='1i9eHENfvlukANB6H5AUgfef9nsRxIKIHzZlShI-i9cc';

// === CLIENT PLANS ===
const PLANS = {
  starter:  { limit: 500,   overage: 0.05 },
  business: { limit: 2000,  overage: 0.04 },
  pro:      { limit: 5000,  overage: 0.03 },
  ultra:    { limit: 10000, overage: 0.02 },
};

// === MESSAGE COUNTER (in-memory + Google Sheets backup) ===
// Structure: { clientId: { plan, count, month, conversations: [{ts,from,channel,msg,reply}] } }
const clients = new Map();

function getMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function getClient(clientId) {
  const month = getMonthKey();
  if (!clients.has(clientId)) {
    clients.set(clientId, { plan: 'starter', count: 0, month, conversations: [], alerted80: false, alerted100: false });
  }
  const c = clients.get(clientId);
  // Reset counter if new month
  if (c.month !== month) {
    c.count = 0;
    c.month = month;
    c.alerted80 = false;
    c.alerted100 = false;
  }
  return c;
}

async function tg(text) {
  await fetch(`https://api.telegram.org/bot${TG_BOT}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text }),
  }).catch(e => console.error('TG error:', e.message));
}

async function logToSheets(data) {
  if (process.env.GOOGLE_SCRIPT_URL) {
    await fetch(process.env.GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(e => console.error('Sheets error:', e.message));
  }
}

// === DEMO CHAT ===
const ALEX=`Ты Алекс, менеджер xplai.eu. Тёплый, профессиональный. НЕ говоришь что ты AI.
Продукт: AI-менеджер для бизнеса. Отвечает клиентам 24/7 в WhatsApp, чате и email.
Настройка: БЕСПЛАТНО (EUR0). Звонков НЕТ.
Цены (без НДС): Starter EUR79/мес (500 сообщ) | Business EUR149/мес (2000) | Pro EUR299/мес (5000) | Ultra EUR599/мес (10000).
Акция: первый месяц БЕСПЛАТНО для первых 3 бизнесов. Осталось 2 места!
Отмена в любое время, без контрактов.
Схема: Бесплатная настройка (3-5 дней) → агент работает → платишь EUR79/мес.
После 1-2 сообщений ОБЯЗАТЕЛЬНО предложи: "Хочешь сам попробовать? Напиши /demo — стану агентом ресторана!"
Язык: по первому сообщению клиента.`;

const DEMO=`Ты Макс, менеджер Vilnius Bistro. НЕ AI.
Gedimino pr. 15, Vilnius. Пн-Пт 11-23, Сб-Вс 10-00.
Цепелинай EUR8.50, Стейк EUR24, Карбонара EUR14, Треска EUR18, Шакотис EUR6, Кофе EUR3-5, Вино EUR6/бокал.
Бронирование: имя → дата → время → кол-во → подтверждение.
После 3-4 сообщений: "Вот так работает ваш будущий агент! Настройка бесплатная, первый месяц тоже — осталось 2 места. Хотите такого же? Напишите /back"`;

app.post('/chat',async(req,res)=>{
  const{sessionId,message}=req.body;
  if(!sessions.has(sessionId))sessions.set(sessionId,{mode:'alex',history:[]});
  const s=sessions.get(sessionId);
  const low=message.toLowerCase();
  if(low.includes('/demo')||low.includes('демо')||low.includes('demo')||low.includes('покажи как работает'))s.mode='demo';
  else if(low.includes('/back')||low.includes('назад'))s.mode='alex';
  s.history.push({role:'user',content:message});
  if(s.history.length>20)s.history.shift();
  const r=await client.messages.create({
    model:'claude-haiku-4-5-20251001',max_tokens:300,
    system:s.mode==='demo'?DEMO:ALEX,
    messages:s.history,
  });
  const reply=r.content[0].text;
  s.history.push({role:'assistant',content:reply});
  res.json({reply,mode:s.mode});
});

// === CLIENT MESSAGE ENDPOINT ===
// Each client's agent calls this after every AI response
app.post('/log', async(req,res)=>{
  try {
    const { clientId, channel, customerMsg, aiReply, customerName } = req.body;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });

    const c = getClient(clientId);
    c.count++;
    const plan = PLANS[c.plan] || PLANS.starter;
    const ts = new Date().toISOString();

    // Save conversation
    c.conversations.push({
      ts,
      channel: channel || 'chat',
      customer: customerName || 'Unknown',
      msg: customerMsg,
      reply: aiReply,
    });

    // Keep last 1000 conversations in memory
    if (c.conversations.length > 1000) c.conversations.shift();

    // Log to Google Sheets
    await logToSheets({
      type: 'message',
      clientId,
      month: c.month,
      count: c.count,
      limit: plan.limit,
      channel,
      customerName,
      customerMsg,
      aiReply,
      ts,
    });

    // Alert at 80%
    if (!c.alerted80 && c.count >= plan.limit * 0.8) {
      c.alerted80 = true;
      await tg(`⚠️ ${clientId}: 80% limito (${c.count}/${plan.limit})\nPlanas: ${c.plan}\nMėnuo: ${c.month}`);
    }

    // Alert at 100%
    if (!c.alerted100 && c.count >= plan.limit) {
      c.alerted100 = true;
      await tg(`🔴 ${clientId}: limitas pasiektas! (${c.count}/${plan.limit})\nPlanas: ${c.plan}\nViršijimas: €${plan.overage}/žinutę\nMėnuo: ${c.month}`);
    }

    res.json({
      ok: true,
      count: c.count,
      limit: plan.limit,
      remaining: Math.max(0, plan.limit - c.count),
      overage: Math.max(0, c.count - plan.limit),
    });
  } catch (e) {
    console.error('Log error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// === CLIENT STATS ===
app.get('/stats/:clientId', (req,res)=>{
  const c = getClient(req.params.clientId);
  const plan = PLANS[c.plan] || PLANS.starter;
  res.json({
    clientId: req.params.clientId,
    plan: c.plan,
    month: c.month,
    count: c.count,
    limit: plan.limit,
    remaining: Math.max(0, plan.limit - c.count),
    overage: Math.max(0, c.count - plan.limit),
    overageCost: Math.max(0, c.count - plan.limit) * plan.overage,
  });
});

// === CLIENT CONVERSATIONS (dashboard) ===
app.get('/conversations/:clientId', (req,res)=>{
  const c = getClient(req.params.clientId);
  const { channel, from, to, search } = req.query;
  let convs = c.conversations;

  // Filter by channel
  if (channel) convs = convs.filter(x => x.channel === channel);
  // Filter by date range
  if (from) convs = convs.filter(x => x.ts >= from);
  if (to) convs = convs.filter(x => x.ts <= to);
  // Search
  if (search) {
    const s = search.toLowerCase();
    convs = convs.filter(x => (x.msg||'').toLowerCase().includes(s) || (x.reply||'').toLowerCase().includes(s));
  }

  res.json({
    clientId: req.params.clientId,
    total: convs.length,
    conversations: convs.slice(-100), // last 100
  });
});

// === SET CLIENT PLAN ===
app.post('/client', (req,res)=>{
  const { clientId, plan } = req.body;
  if (!clientId || !PLANS[plan]) return res.status(400).json({ error: 'clientId and valid plan required' });
  const c = getClient(clientId);
  c.plan = plan;
  res.json({ ok: true, clientId, plan });
});

// === LEAD FORM ===
app.post('/lead', async(req,res)=>{
  try {
    const { name, phone, business, lang } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone required' });
    const ts = new Date().toISOString();
    await tg(`🔔 Naujas lidas!\n\n👤 ${name}\n📱 ${phone}\n🏢 ${business || '—'}\n🌐 ${lang || 'lt'}\n⏰ ${ts}`);
    await logToSheets({ type: 'lead', name, phone, business, lang, ts });
    res.json({ ok: true });
  } catch (e) {
    console.error('Lead error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// === ALL CLIENTS OVERVIEW (for boss) ===
app.get('/dashboard', (req,res)=>{
  const all = [];
  for (const [id, c] of clients) {
    const plan = PLANS[c.plan] || PLANS.starter;
    all.push({
      clientId: id,
      plan: c.plan,
      month: c.month,
      count: c.count,
      limit: plan.limit,
      pct: Math.round(c.count / plan.limit * 100),
      overage: Math.max(0, c.count - plan.limit),
      overageCost: (Math.max(0, c.count - plan.limit) * plan.overage).toFixed(2),
      lastMessage: c.conversations.length ? c.conversations[c.conversations.length-1].ts : null,
    });
  }
  res.json({ clients: all, month: getMonthKey() });
});

app.get('/health',(req,res)=>res.json({ok:true}));
app.listen(process.env.PORT||3000);
