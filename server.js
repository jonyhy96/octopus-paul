#!/usr/bin/env node
/* 章鱼保罗 AI 军团 — 2026 世界杯单场竞技场
 * 真实赛程数据；选一场比赛，多只章鱼(各自真实模型)同时预测；
 * 比赛有真实结果后，按预测准确度给章鱼打分排名。
 * 通过 OpenAI 兼容代理 (127.0.0.1:8066) 调用不同模型。
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8099;
const PROXY = process.env.PROXY_BASE || "http://127.0.0.1:8066";
const HTML = path.join(__dirname, "index.html");
const DB = path.join(__dirname, "history.json"); // 预测记录持久化

// 读取历史记录（容错：文件不存在/损坏都返回空数组）
function loadHistory() {
  try { return JSON.parse(fs.readFileSync(DB, "utf8")) || []; }
  catch (e) { return []; }
}
// 追加一批预测记录（同章鱼+同比赛只保留最新一条，便于累计战绩去重）
function saveRecords(recs) {
  const hist = loadHistory();
  for (const r of recs) {
    const i = hist.findIndex(x => x.octoId === r.octoId && x.matchId === r.matchId);
    if (i >= 0) hist[i] = r; else hist.push(r);
  }
  try { fs.writeFileSync(DB, JSON.stringify(hist)); } catch (e) {}
  return hist;
}
// 按章鱼聚合累计战绩
function buildStats() {
  const hist = loadHistory();
  const agg = {};
  for (const r of hist) {
    const a = agg[r.octoId] || (agg[r.octoId] = {
      octoId: r.octoId, octo: r.octo, model: r.model,
      total: 0, scored: 0, sumScore: 0, dirHit: 0, exactHit: 0 });
    a.total += 1;
    if (r.scoring && typeof r.scoring.score === "number") {
      a.scored += 1; a.sumScore += r.scoring.score;
      if (r.scoring.score >= 50) a.dirHit += 1;
      if (r.scoring.score >= 90) a.exactHit += 1;
    }
  }
  return Object.values(agg).map(a => ({
    ...a,
    avgScore: a.scored ? Math.round(a.sumScore / a.scored) : 0,
    dirRate: a.scored ? Math.round(a.dirHit / a.scored * 100) : 0,
  })).sort((x, y) => (y.sumScore - x.sumScore) || (y.avgScore - x.avgScore));
}

// 章鱼 -> 真实模型
const OCTOPI = {
  gpt:   { name: "GPT-保罗",     model: "gpt-5.5",  emoji: "🐙", tag: "OpenAI 系 · 全能触手", color: "#2ee6c5", mood: "沉稳老练" },
  glm:   { name: "GLM-章鱼",     model: "glm-5.1",  emoji: "🦑", tag: "智谱 GLM · 东方玄学", color: "#ffd75e", mood: "中庸平衡" },
  reo48: { name: "Claude-深海", model: "claude 4.8", emoji: "🐙", tag: "Claude 系 · 冷算力",   color: "#b69cff", mood: "逻辑至上" },
  reo47: { name: "Claude-海怪", model: "claude 4.7", emoji: "🦑", tag: "Claude 系 · 大胆派",   color: "#ff6fae", mood: "大胆冒进" },
};

// 真实球队
const T = {
  MEX:{n:"墨西哥",f:"🇲🇽"}, RSA:{n:"南非",f:"🇿🇦"}, KOR:{n:"韩国",f:"🇰🇷"}, CZE:{n:"捷克",f:"🇨🇿"},
  CAN:{n:"加拿大",f:"🇨🇦"}, BIH:{n:"波黑",f:"🇧🇦"}, QAT:{n:"卡塔尔",f:"🇶🇦"}, SUI:{n:"瑞士",f:"🇨🇭"},
  BRA:{n:"巴西",f:"🇧🇷"}, MAR:{n:"摩洛哥",f:"🇲🇦"}, HAI:{n:"海地",f:"🇭🇹"}, SCO:{n:"苏格兰",f:"🏴"},
  USA:{n:"美国",f:"🇺🇸"}, PAR:{n:"巴拉圭",f:"🇵🇾"}, AUS:{n:"澳大利亚",f:"🇦🇺"}, TUR:{n:"土耳其",f:"🇹🇷"},
  GER:{n:"德国",f:"🇩🇪"}, CUW:{n:"库拉索",f:"🇨🇼"}, CIV:{n:"科特迪瓦",f:"🇨🇮"}, ECU:{n:"厄瓜多尔",f:"🇪🇨"},
  NED:{n:"荷兰",f:"🇳🇱"}, JPN:{n:"日本",f:"🇯🇵"}, SWE:{n:"瑞典",f:"🇸🇪"}, TUN:{n:"突尼斯",f:"🇹🇳"},
  BEL:{n:"比利时",f:"🇧🇪"}, EGY:{n:"埃及",f:"🇪🇬"}, IRN:{n:"伊朗",f:"🇮🇷"}, NZL:{n:"新西兰",f:"🇳🇿"},
  ESP:{n:"西班牙",f:"🇪🇸"}, CPV:{n:"佛得角",f:"🇨🇻"}, KSA:{n:"沙特",f:"🇸🇦"}, URU:{n:"乌拉圭",f:"🇺🇾"},
  FRA:{n:"法国",f:"🇫🇷"}, SEN:{n:"塞内加尔",f:"🇸🇳"}, IRQ:{n:"伊拉克",f:"🇮🇶"}, NOR:{n:"挪威",f:"🇳🇴"},
  ARG:{n:"阿根廷",f:"🇦🇷"}, ALG:{n:"阿尔及利亚",f:"🇩🇿"}, AUT:{n:"奥地利",f:"🇦🇹"}, JOR:{n:"约旦",f:"🇯🇴"},
  POR:{n:"葡萄牙",f:"🇵🇹"}, COD:{n:"刚果金",f:"🇨🇩"}, UZB:{n:"乌兹别克斯坦",f:"🇺🇿"}, COL:{n:"哥伦比亚",f:"🇨🇴"},
  ENG:{n:"英格兰",f:"🏴"}, CRO:{n:"克罗地亚",f:"🇭🇷"}, GHA:{n:"加纳",f:"🇬🇭"}, PAN:{n:"巴拿马",f:"🇵🇦"},
};

// 真实赛程（北京时间）。result: 已完赛比分；null=未开赛。
// 数据来源：FIFA 官方 / 央视 / 7M 赛程公布。
const MATCHES = [
  {id:"A1", group:"A组", date:"6/12 03:00", home:"MEX", away:"RSA", result:{gh:2,ga:0}}, // 揭幕战，已完赛 FIFA
  {id:"A2", group:"A组", date:"6/12 10:00", home:"KOR", away:"CZE", result:null},
  {id:"B1", group:"B组", date:"6/13 03:00", home:"CAN", away:"BIH", result:null},
  {id:"D1", group:"D组", date:"6/13 09:00", home:"USA", away:"PAR", result:null},
  {id:"C1", group:"C组", date:"6/14 05:00", home:"BRA", away:"MAR", result:null},
  {id:"I1", group:"I组", date:"6/27 03:00", home:"NOR", away:"FRA", result:null},
  {id:"J1", group:"J组", date:"6/17 09:00", home:"ARG", away:"ALG", result:null},
  {id:"K1", group:"K组", date:"6/17 异日",  home:"POR", away:"COD", result:null},
  {id:"L1", group:"L组", date:"6/17 异日",  home:"ENG", away:"CRO", result:null},
  {id:"H1", group:"H组", date:"小组赛",     home:"ESP", away:"URU", result:null},
];

// ===== 外部赛果同步：TheSportsDB（公开 API，无需 key）=====
const https = require("https");
const SPORTSDB_URL = "https://www.thesportsdb.com/api/v1/json/3/eventsseason.php?id=4429&s=2026";
// API 英文队名 -> 内部 T 表 code
const NAME2CODE = {
  "Mexico":"MEX","South Africa":"RSA","South Korea":"KOR","Czech Republic":"CZE",
  "Canada":"CAN","Bosnia-Herzegovina":"BIH","USA":"USA","Paraguay":"PAR",
  "Brazil":"BRA","Morocco":"MAR","Qatar":"QAT","Switzerland":"SUI",
  "Haiti":"HAI","Scotland":"SCO","Germany":"GER","Curaçao":"CUW","Curacao":"CUW",
  "Ivory Coast":"CIV","Ecuador":"ECU","Netherlands":"NED","Japan":"JPN",
  "Australia":"AUS","Turkey":"TUR","Belgium":"BEL","Egypt":"EGY",
  "Saudi Arabia":"KSA","Uruguay":"URU","Spain":"ESP","Cape Verde":"CPV",
  "Sweden":"SWE","Tunisia":"TUN","Iran":"IRN","New Zealand":"NZL",
  "France":"FRA","Senegal":"SEN","Iraq":"IRQ","Norway":"NOR",
  "Argentina":"ARG","Algeria":"ALG","Austria":"AUT","Jordan":"JOR",
  "Portugal":"POR","DR Congo":"COD","Congo DR":"COD","Uzbekistan":"UZB","Colombia":"COL",
  "England":"ENG","Croatia":"CRO","Ghana":"GHA","Panama":"PAN",
};
let SYNC = { lastTs:0, lastOk:false, lastMsg:"未同步", updated:0 };

function httpsGetJson(url) {
  return new Promise((resolve,reject)=>{
    https.get(url,{timeout:15000},res=>{
      let d=""; res.on("data",c=>d+=c);
      res.on("end",()=>{ try{ resolve(JSON.parse(d)); } catch(e){ reject(new Error("bad json")); } });
    }).on("error",reject).on("timeout",function(){ this.destroy(new Error("timeout")); });
  });
}
async function syncResults() {
  try {
    const data = await httpsGetJson(SPORTSDB_URL);
    const events = data.events || [];
    let updated = 0, added = 0, skipped = 0;
    for (const ev of events) {
      const hc = NAME2CODE[ev.strHomeTeam], ac = NAME2CODE[ev.strAwayTeam];
      if (!hc || !ac) { skipped++; continue; } // 队名映射缺失:留意日志
      let m = MATCHES.find(x => x.home===hc && x.away===ac);
      // API 提供 dateEvent + strTime(UTC) → 解析为时间戳并显示为北京时间
      const isoUtc = ev.dateEvent ? (ev.dateEvent+"T"+(ev.strTime||"00:00:00")+"Z") : null;
      const ts = isoUtc ? Date.parse(isoUtc) : null;
      let dateStr = "待定";
      if (ts) {
        const d = new Date(ts + 8*3600*1000); // 北京时间
        dateStr = `${d.getUTCMonth()+1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`;
      }
      if (!m) {
        m = { id:"E"+ev.idEvent, group:(ev.intRound?("R"+ev.intRound):"小组赛"),
              date:dateStr, ts, home:hc, away:ac, result:null };
        MATCHES.push(m); added++;
      } else if (ts && (!m.ts || m.ts!==ts)) {
        m.ts = ts; m.date = dateStr; // 用 API 的精确时间覆盖手写值
      }
      if (ev.strStatus !== "FT") continue; // 比分只取已完赛
      const gh = parseInt(ev.intHomeScore,10), ga = parseInt(ev.intAwayScore,10);
      if (Number.isNaN(gh) || Number.isNaN(ga)) continue;
      const prev = m.result;
      if (!prev || prev.gh!==gh || prev.ga!==ga) { m.result = {gh,ga}; updated++; }
    }
    if (updated > 0) rescoreHistory();
    SYNC = { lastTs:Date.now(), lastOk:true,
      msg:`同步 OK，新增 ${added} 场 / 更新 ${updated} 场${skipped?` / 跳过 ${skipped} 场(队名未映射)`:""}`,
      added, updated, skipped };
    return SYNC;
  } catch(e) {
    SYNC = { lastTs:Date.now(), lastOk:false, msg:"同步失败: "+(e.message||e), updated:0 };
    return SYNC;
  }
}
function rescoreHistory() {
  try {
    const hist = JSON.parse(fs.readFileSync(DB,"utf8"));
    let changed = 0;
    for (const r of hist) {
      const m = MATCHES.find(x=>x.id===r.matchId);
      if (!m || !m.result) continue;
      r.finished = true; r.result = m.result;
      const sc = scorePrediction(r.prediction, m);
      if (sc && JSON.stringify(r.scoring)!==JSON.stringify(sc)) { r.scoring = sc; changed++; }
    }
    if (changed) fs.writeFileSync(DB, JSON.stringify(hist));
  } catch(e) {}
}
// 启动后 5 秒首次同步，之后每 10 分钟自动同步
setTimeout(syncResults, 5000);
setInterval(syncResults, 10 * 60 * 1000);

const PROXY_MODE_DEFAULT = process.env.PROXY_MODE || "deep"; // 章鱼推理模式：fast / deep / max
const VALID_MODES = ["fast","deep","max"];
function pickMode(m) { return VALID_MODES.includes(String(m||"").toLowerCase()) ? String(m).toLowerCase() : PROXY_MODE_DEFAULT; }

function callProxy(model, messages, maxTokens = 1500, mode = PROXY_MODE_DEFAULT) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, messages, stream:false, temperature:0.75, max_tokens:maxTokens, mode });
    const u = new URL(PROXY + "/v1/chat/completions");
    const req = http.request(
      { hostname:u.hostname, port:u.port, path:u.pathname, method:"POST",
        headers:{ "Content-Type":"application/json", "Content-Length":Buffer.byteLength(body) } },
      (res) => { let d=""; res.on("data",c=>d+=c); res.on("end",()=>{
        try { const j=JSON.parse(d); resolve(j.choices?.[0]?.message?.content||""); }
        catch(e){ reject(new Error("bad proxy resp: "+d.slice(0,300))); }
      }); }
    );
    req.setTimeout(300000, ()=>req.destroy(new Error("proxy timeout")));
    req.on("error", reject); req.write(body); req.end();
  });
}

function buildPrompt(octo, m) {
  const h=T[m.home].n, a=T[m.away].n;
  return [
    { role:"system", content:
      `你是「${octo.name}」，一只会通灵预测足球的章鱼，性格${octo.mood}。预测 2026 世界杯一场真实比赛。`+
      `\n\n你必须经过深度推理后再给结论。推理时要综合考虑以下维度：`+
      `\n① 两队近 12 个月战绩、世预赛走势、FIFA 排名差距与变化趋势；`+
      `\n② 阵容质量：主力前锋/中场/后防核心是否健康，关键球员状态；`+
      `\n③ 战术风格相克：高位逼抢 vs 反击、控球 vs 长传、定位球能力；`+
      `\n④ 主客场/中立场因素、球场海拔、气候、时差对客队影响；`+
      `\n⑤ 历史交锋(H2H)结果、心理优势、是否苦主；`+
      `\n⑥ 小组形势:出线压力大小、首战vs生死战的心理负担；`+
      `\n⑦ 教练战术应变能力与世界杯经验；`+
      `\n⑧ 你的性格(${octo.mood})对最终判断的偏置。`+
      `\n\n以上每条都要在脑中走一遍,综合得出最终预测,不要拍脑袋。`+
      `\n\n输出严格 JSON,无任何多余文字/解释/代码块标记。字段:`+
      `\nhome(主胜概率0-100整数)、draw(平局概率)、away(客胜概率),三者之和必须=100;`+
      `\ngh(预测主队进球整数)、ga(预测客队进球整数);winner(胜者中文队名或"平局");`+
      `\nthink(50-120字中文,简述你综合上述维度后的核心推理路径,体现深度思考);`+
      `\nreason(不超过30字中文神谕,体现你的${octo.mood}性格)。` },
    { role:"user", content:
      `比赛:${m.group},${h}(主) vs ${a}(客)。请以${octo.name}身份完整走一遍深度推理后给出预测 JSON。` },
  ];
}

function safeParse(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```json?/i,"").replace(/```$/,"").trim();
  const s=t.indexOf("{"), e=t.lastIndexOf("}");
  if (s>=0&&e>s) t=t.slice(s,e+1);
  try {
    const o=JSON.parse(t);
    let home=Math.max(0,Math.round(+o.home||0)), draw=Math.max(0,Math.round(+o.draw||0)), away=Math.max(0,Math.round(+o.away||0));
    const sum=home+draw+away||1;
    home=Math.round(home/sum*100); draw=Math.round(draw/sum*100); away=100-home-draw;
    return { home, draw, away,
      gh:Math.max(0,Math.round(+o.gh||0)), ga:Math.max(0,Math.round(+o.ga||0)),
      winner:String(o.winner||"").slice(0,20)||"平局",
      think:String(o.think||"").slice(0,300),
      reason:String(o.reason||"").slice(0,60) };
  } catch(e){ return null; }
}

// 评分：满分100。胜负方向命中50；比分完全命中再+40；进球差命中+10。
function scorePrediction(p, m) {
  if (!m.result) return null;
  const {gh,ga}=m.result;
  const realWinner = gh>ga ? T[m.home].n : (ga>gh ? T[m.away].n : "平局");
  let score=0; const detail=[];
  if (p.winner===realWinner){ score+=50; detail.push("胜负方向 ✅ +50"); }
  else detail.push("胜负方向 ❌ +0");
  if (p.gh===gh && p.ga===ga){ score+=40; detail.push("精确比分 ✅ +40"); }
  else detail.push("精确比分 ❌ +0");
  if ((p.gh-p.ga)===(gh-ga)){ score+=10; detail.push("净胜球差 ✅ +10"); }
  else detail.push("净胜球差 ❌ +0");
  return { score, realWinner, realScore:`${gh}:${ga}`, detail };
}

async function predict(octoId, m, mode) {
  const octo=OCTOPI[octoId];
  if (!octo) throw new Error("unknown octopus");
  const text=await callProxy(octo.model, buildPrompt(octo, m), 1500, mode);
  const parsed=safeParse(text);
  if (!parsed) throw new Error("parse fail: "+text.slice(0,200));
  return { ...parsed, model:octo.model, octo:octo.name, octoId, mode };
}

function send(res, code, obj, type="application/json") {
  const body = (typeof obj==="string"||Buffer.isBuffer(obj)) ? obj : JSON.stringify(obj);
  res.writeHead(code, { "Content-Type":type, "Access-Control-Allow-Origin":"*" });
  res.end(body);
}

const server = http.createServer(async (req,res)=>{
  const u=new URL(req.url,"http://localhost");
  if (req.method==="OPTIONS") return send(res,204,"");

  if (u.pathname==="/api/octopi") {
    return send(res,200,{ octopi:Object.entries(OCTOPI).map(([id,o])=>
      ({id,name:o.name,emoji:o.emoji,tag:o.tag,color:o.color,mood:o.mood,model:o.model})) });
  }

  if (u.pathname==="/api/matches") {
    const sorted=[...MATCHES].sort((a,b)=>{
      const at=a.ts||Number.POSITIVE_INFINITY, bt=b.ts||Number.POSITIVE_INFINITY;
      return at-bt;
    });
    return send(res,200,{ sync:SYNC, matches:sorted.map(m=>({
      id:m.id, group:m.group, date:m.date,
      home:{code:m.home,...T[m.home]}, away:{code:m.away,...T[m.away]},
      finished:!!m.result, result:m.result||null })) });
  }

  // POST /api/arena  body:{matchId, octos:[ids], mode:"fast"|"deep"|"max"} -> 多章鱼同时预测 + 评分
  if (u.pathname==="/api/arena" && req.method==="POST") {
    let raw=""; req.on("data",c=>raw+=c);
    req.on("end", async ()=>{
      try {
        const body=JSON.parse(raw||"{}");
        const {matchId, octos}=body;
        const mode=pickMode(body.mode);
        const m=MATCHES.find(x=>x.id===matchId);
        if (!m) return send(res,200,{ok:false,error:"match not found"});
        const ids=(Array.isArray(octos)&&octos.length)?octos:Object.keys(OCTOPI);
        const settled=await Promise.allSettled(ids.map(id=>predict(id,m,mode)));
        const results=settled.map((r,i)=>{
          const id=ids[i];
          if (r.status==="fulfilled"){
            const p=r.value; const sc=scorePrediction(p,m);
            return { ok:true, octoId:id, prediction:p, scoring:sc };
          }
          return { ok:false, octoId:id, error:String(r.reason?.message||r.reason) };
        });
        // 持久化每只成功章鱼的预测记录
        const recs=results.filter(x=>x.ok).map(x=>({
          ts:Date.now(), matchId:m.id, group:m.group, finished:!!m.result,
          home:T[m.home].n, away:T[m.away].n, result:m.result||null,
          octoId:x.octoId, octo:x.prediction.octo, model:x.prediction.model, mode,
          prediction:{gh:x.prediction.gh,ga:x.prediction.ga,winner:x.prediction.winner,reason:x.prediction.reason,think:x.prediction.think||""},
          scoring:x.scoring }));
        if (recs.length) saveRecords(recs);
        send(res,200,{ ok:true, mode, match:{id:m.id,group:m.group,finished:!!m.result,result:m.result||null,
          home:{code:m.home,...T[m.home]}, away:{code:m.away,...T[m.away]}}, results });
      } catch(e){ send(res,200,{ok:false,error:String(e.message||e)}); }
    });
    return;
  }

  // 历史预测记录（可按 ?octoId= 或 ?matchId= 过滤），最新在前
  if (u.pathname==="/api/history") {
    let hist=loadHistory();
    const oid=u.searchParams.get("octoId"), mid=u.searchParams.get("matchId");
    if (oid) hist=hist.filter(x=>x.octoId===oid);
    if (mid) hist=hist.filter(x=>x.matchId===mid);
    hist.sort((a,b)=>b.ts-a.ts);
    return send(res,200,{ ok:true, records:hist });
  }

  // 章鱼累计战绩榜
  if (u.pathname==="/api/stats") {
    return send(res,200,{ ok:true, stats:buildStats() });
  }

  // 手动触发同步最新比赛结果（也可由前端按钮调用）
  if (u.pathname==="/api/refresh") {
    syncResults().then(s=>send(res,200,{ ok:true, sync:s }));
    return;
  }

  // 清空所有历史预测（前端"重置"按钮）
  if (u.pathname==="/api/clear_history" && req.method==="POST") {
    try { fs.writeFileSync(DB, "[]"); send(res,200,{ok:true, cleared:true}); }
    catch(e){ send(res,200,{ok:false,error:String(e.message||e)}); }
    return;
  }


  if (u.pathname==="/"||u.pathname==="/index.html") {
    fs.readFile(HTML,(err,data)=> err?send(res,500,"index.html missing"):send(res,200,data,"text/html; charset=utf-8"));
    return;
  }
  send(res,404,{error:"not found"});
});

server.listen(PORT,"0.0.0.0",()=>console.log(`🐙 octopus arena on http://0.0.0.0:${PORT}  proxy=${PROXY}`));
