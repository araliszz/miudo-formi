'use strict';
const D=require('./domain');
function manager(req){return req.company.perfil==='admin'||req.user.proprietario===true;}
function scope(req){
 const result={sql:'l.empresa_id=$1',args:[req.company.id]};
 const requested=req.query?.responsavel;
 const wide=req.company.perfil==='admin'||(req.user.proprietario===true&&['GET','HEAD'].includes(req.method));
 if(!wide){
  if(requested&&D.id(requested)!==req.user.id)D.fail('Você pode consultar apenas sua própria carteira.',403);
  result.args.push(req.user.id);result.sql+=' AND l.usuario_id=$2';
 }else if(requested){result.args.push(D.id(requested));result.sql+=' AND l.usuario_id=$2';}
 return result;
}
function captureFilters(req,result){
 const add=(sql,value)=>{result.args.push(value);result.sql+=' AND '+sql.replace('?',`$${result.args.length}`);};
 const q=req.query;
 if(q.situacao){const status=q.situacao==='nao_trabalhado'?'captado':D.choice(q.situacao,['captado','trabalhado','convertido','inativo','perdido','cancelado'],'Situação');if(status==='cancelado')result.sql+=" AND l.etapa='cancelado'";else add('l.situacao_lead=?',status);}
 if(q.qualificacao)add('l.qualificacao=?',D.choice(q.qualificacao,['IQL','MQL','SQL','PQL'],'Qualificação'));
 if(q.dificuldade)add('l.dificuldade=?',D.choice(q.dificuldade,['simples','complexa','complexo_irregular'],'Dificuldade'));
 const valid=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&v>='1950-01-01'&&v<='9999-12-31'&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 if((q.inicio&&!valid(q.inicio))||(q.fim&&!valid(q.fim))||(q.inicio&&q.fim&&q.inicio>q.fim))D.fail('Informe um intervalo de datas válido.');
 if(q.inicio)add('l.data_captacao>=?::date',q.inicio);
 if(q.fim)add('l.data_captacao<=?::date',q.fim);
 return result;
}
module.exports={manager,scope,captureFilters};
