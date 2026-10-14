'use strict';
const D=require('./domain');
const DAY=86400000;
const iso=d=>d.toISOString().slice(0,10);
const valid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&s>='1950-01-01'&&s<='9999-12-31'&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&iso(new Date(s+'T00:00:00Z'))===s;
function windowFor(query,now=new Date()){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const end=query.fim||today,start=query.inicio||iso(new Date(Date.parse(end+'T00:00:00Z')-179*DAY));
 if(!valid(start)||!valid(end)||start>end)D.fail('Informe um intervalo de datas válido.');
 const duration=Math.round((Date.parse(end)-Date.parse(start))/DAY)+1;
 if(duration>3660)D.fail('Para o gráfico, selecione um período de até 10 anos.');
 const previousEnd=iso(new Date(Date.parse(start)-DAY)),previousStart=iso(new Date(Date.parse(start)-duration*DAY));
 return {inicio:start,fim:end,anterior_inicio:previousStart,anterior_fim:previousEnd,dias:duration};
}
const percent=(n,d)=>d?Math.round(n/d*10000)/100:0;
function summarize(rows,w){
 const points=new Map();const daily=w.dias<=62;
 for(let ms=Date.parse(w.inicio);ms<=Date.parse(w.fim);){const key=iso(new Date(ms)).slice(0,daily?10:7);points.set(key,{periodo:key,leads:0,convertidos:0,taxa:0});if(daily)ms+=DAY;else{const d=new Date(ms);d.setUTCMonth(d.getUTCMonth()+1,1);ms=d.getTime();}}
 const current={leads:0,convertidos:0},previous={leads:0,convertidos:0};
 for(const row of rows){const day=String(row.dia).slice(0,10),n=Number(row.leads),c=Number(row.convertidos);if(day>=w.inicio&&day<=w.fim){current.leads+=n;current.convertidos+=c;const point=points.get(day.slice(0,daily?10:7));if(point){point.leads+=n;point.convertidos+=c;}}else if(day>=w.anterior_inicio&&day<=w.anterior_fim){previous.leads+=n;previous.convertidos+=c;}}
 current.taxa=percent(current.convertidos,current.leads);previous.taxa=percent(previous.convertidos,previous.leads);
 const diff=Math.round((current.taxa-previous.taxa)*100)/100;
 const comparable=current.leads>0&&previous.leads>0;
 return {periodo:w,atual:current,anterior:previous,variacao_pp:comparable?diff:null,tendencia:!comparable?'sem_base':diff>0?'alta':diff<0?'queda':'estavel',serie:[...points.values()].map(p=>({...p,taxa:percent(p.convertidos,p.leads)})),criterio:'Data de captação e situação atual Convertido. Não representa a data em que o contrato foi fechado.',atualizado_em:new Date().toISOString()};
}
function install(router,{pool,wrap}){
 router.get('/crm/tendencias',wrap(async(req,res)=>{
  const w=windowFor(req.query),mode=D.choice(req.query.visao||'minha',['minha','empresa','colaborador'],'Visão');
  const manager=req.company.perfil==='admin'||req.user.proprietario===true;
  const args=[req.company.id,w.anterior_inicio,w.fim];let sql='l.empresa_id=$1 AND l.data_captacao >= $2::date AND l.data_captacao <= $3::date';
  let owner=null;
  if(mode==='colaborador'){
   if(!manager)D.fail('A consulta por colaborador é exclusiva do administrador.',403);
   owner=D.id(req.query.responsavel);
   const membership=await pool.query('SELECT usuario_id FROM membros WHERE empresa_id=$1 AND usuario_id=$2',[req.company.id,owner]);
   if(!membership.rowCount)D.fail('Colaborador indisponível nesta empresa.',404);
  }else if(req.query.responsavel)D.fail('Selecione a visão por colaborador para filtrar a carteira.');
  if(mode==='minha')owner=req.user.id;
  if(owner){args.push(owner);sql+=' AND l.usuario_id=$4';}
  const rows=(await pool.query(`SELECT l.data_captacao::text AS dia,count(*)::int AS leads,count(*) FILTER (WHERE l.situacao_lead='convertido')::int AS convertidos FROM leads l WHERE ${sql} GROUP BY l.data_captacao ORDER BY l.data_captacao`,args)).rows;
  res.json({...summarize(rows,w),visao:mode});
 }));
}
module.exports={install,windowFor,summarize};
