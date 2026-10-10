const crypto = require('node:crypto');
function fail(message,status=400) { const e=new Error(message); e.status=status; throw e; }
function text(value,label,max=200,required=true) {
 if(typeof value !== 'string' || value.trim().length>max || (required && !value.trim())) fail(`${label} inválido.`);
 return value.trim();
}
function email(value) { const v=text(value,'E-mail',255).toLowerCase(); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail('E-mail inválido.'); return v; }
function phone(value) { if(typeof value!=='string'|| !/^\d{10,15}$/.test(value)) fail('Telefone deve conter apenas 10 a 15 números, incluindo DDD.'); return value; }
function password(value) { if(typeof value!=='string'||value.length<10||Buffer.byteLength(value)>72) fail('Senha deve ter pelo menos 10 caracteres e até 72 bytes.'); return value; }
function choice(value,values,label) { if(!values.includes(value)) fail(`${label} inválido.`); return value; }
function id(value) { const n=Number(value); if(!Number.isSafeInteger(n)||n<1) fail('Identificador inválido.'); return n; }
function money(value) { if(!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(String(value))) fail('Informe valor positivo com até duas casas decimais.'); return Number(value); }
function hash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function token() { return crypto.randomBytes(32).toString('hex'); }
function inactive(l,days,now=Date.now()) {
 if(l.etapa==='inativo') return true;
 if(['convertido','perdido','cancelado'].includes(l.etapa)||!l.ultimo_contato_em) return false;
 const reference=l.ultima_resposta_em || l.trabalhado_em || l.ultimo_contato_em;
 return now-new Date(reference).getTime() >= days*86400000;
}
function suggest(l,days) {
 if(['convertido','cancelado','perdido'].includes(l.etapa)) return null;
 if(!l.trabalhado_em) return {prioridade:1,titulo:'Realizar o primeiro contato e identificar o objetivo do aluno',motivo:'Lead sem trabalho registrado'};
 if(inactive(l,days)) return {prioridade:2,titulo:'Tentar reativação e confirmar se ainda há interesse',motivo:'Sem resposta no prazo definido'};
 if(l.temperatura==='quente'||l.qualificacao==='SQL') return {prioridade:1,titulo:'Confirmar orçamento e apresentar proposta de matrícula',motivo:'Lead pronto para conversa comercial'};
 if(l.qualificacao==='PQL') return {prioridade:2,titulo:'Retomar a experiência da aula e oferecer o plano adequado',motivo:'Experimentou o serviço'};
 if(l.dificuldade==='complexo_irregular') return {prioridade:2,titulo:'Investigar oscilação do interesse e combinar próximo contato',motivo:'Conversão irregular'};
 if(l.qualificacao==='MQL') return {prioridade:3,titulo:'Entender impedimentos e agendar visita ou aula experimental',motivo:'Interesse com perfil adequado'};
 return {prioridade:3,titulo:'Entender necessidade e compartilhar informação relevante',motivo:'Lead em qualificação'};
}
function analyze(leads,days,meta,now=Date.now()) {
 const worked=leads.filter(l=>l.trabalhado_em).length;
 const converted=leads.filter(l=>l.contrato_id);
 const count=(key,values)=>Object.fromEntries(values.map(v=>[v,leads.filter(l=>l[key]===v).length]));
 const groups=(key)=>Object.entries(leads.reduce((a,l)=>{const v=l[key]||'Não informado'; const x=a[v] ||= {captados:0,convertidos:0}; x.captados++; if(l.contrato_id)x.convertidos++;return a;},{})).map(([nome,x])=>({nome,...x,conversao:+(100*x.convertidos/x.captados).toFixed(1)}));
 return {captados:leads.length,trabalhados:worked,nao_trabalhados:leads.length-worked,convertidos:converted.length,
 inativos:leads.filter(l=>inactive(l,days,now)).length,perdidos:leads.filter(l=>l.etapa==='perdido').length,cancelados:leads.filter(l=>l.etapa==='cancelado').length,
 valor_contratos:converted.reduce((s,l)=>s+Math.round(Number(l.valor_contrato)*100),0)/100,recebido_inicial:converted.reduce((s,l)=>s+Math.round(Number(l.recebido_inicial)*100),0)/100,
 conversao:leads.length?+(100*converted.length/leads.length).toFixed(1):0,
 conversao_trabalhados:worked?+(100*converted.length/worked).toFixed(1):0,
 qualificacao:count('qualificacao',['IQL','MQL','SQL','PQL']),temperatura:count('temperatura',['frio','morno','quente']),dificuldade:count('dificuldade',['simples','complexa','complexo_irregular']),
 origens:groups('origem'),responsaveis:groups('responsavel'),motivos_perda:leads.filter(l=>l.etapa==='perdido').reduce((a,l)=>{const k=l.motivo_perda||'Não informado';a[k]=(a[k]||0)+1;return a;},{}),
 meta:Number(meta),abaixo_meta:leads.length>0&&100*converted.length/leads.length<meta};
}
module.exports={fail,text,email,phone,password,choice,id,money,hash,token,inactive,suggest,analyze};
