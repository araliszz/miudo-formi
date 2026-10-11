'use strict';
// Alertas e fila duráveis; claim com lease evita envio simultâneo por instâncias.
async function collectAlerts(pool,env={}){
 const base=(env.APP_URL||'http://localhost:3000').replace(/\/$/,'');
 await pool.query(`INSERT INTO crm_alertas(empresa_id,usuario_id,lead_id,chave,titulo)
 SELECT l.empresa_id,a.responsavel_id,l.id,'tarefa:'||a.id||':'||a.prazo::text,'Lembrete: '||a.titulo
 FROM acoes a JOIN leads l ON l.id=a.lead_id JOIN empresas e ON e.id=l.empresa_id JOIN membros m ON m.empresa_id=e.id AND m.usuario_id=a.responsavel_id
 WHERE NOT e.suspensa AND m.ativo AND NOT a.concluida AND a.prazo<=now()+coalesce((e.crm_config->>'lembrete_minutos')::int,60)*interval '1 minute'
 ON CONFLICT(chave) DO NOTHING`);
 await pool.query(`INSERT INTO crm_alertas(empresa_id,usuario_id,lead_id,chave,titulo)
 SELECT l.empresa_id,l.usuario_id,l.id,'inativo:'||l.id||':'||coalesce(l.ultima_resposta_em,l.criado_em)::text,'Sem resposta: '||l.nome
 FROM leads l JOIN empresas e ON e.id=l.empresa_id JOIN membros m ON m.empresa_id=e.id AND m.usuario_id=l.usuario_id
 WHERE NOT e.suspensa AND m.ativo AND coalesce((e.crm_config->>'automacao_inatividade')::boolean,true)
 AND l.etapa NOT IN ('convertido','perdido','cancelado') AND coalesce(l.ultima_resposta_em,l.criado_em)<now()-e.dias_inatividade*interval '1 day'
 ON CONFLICT(chave) DO NOTHING`);
 await pool.query(`INSERT INTO crm_fila_email(empresa_id,usuario_id,chave,assunto,texto,link)
 SELECT a.empresa_id,a.usuario_id,a.chave,a.titulo,'Você tem um acompanhamento pendente no FORMI. Abra sua empresa para conferir.', $1
 FROM crm_alertas a WHERE a.chave LIKE 'tarefa:%' OR a.chave LIKE 'inativo:%' ON CONFLICT(chave) DO NOTHING`,[base]);
}
async function runJobs(pool,mail,env={}){
 await collectAlerts(pool,env);
 for(let i=0;i<10;i++){
 const c=await pool.connect();let job;
 try{await c.query('BEGIN');const q=await c.query(`SELECT f.*,coalesce(f.destino,u.email) AS email FROM crm_fila_email f JOIN usuarios u ON u.id=f.usuario_id JOIN empresas e ON e.id=f.empresa_id JOIN membros m ON m.empresa_id=e.id AND m.usuario_id=f.usuario_id WHERE NOT e.suspensa AND m.ativo AND f.enviado_em IS NULL AND f.tentativas<5 AND f.disponivel_em<=now() ORDER BY f.id LIMIT 1 FOR UPDATE OF f SKIP LOCKED`);job=q.rows[0];if(job)await c.query("UPDATE crm_fila_email SET tentativas=tentativas+1,disponivel_em=now()+interval '5 minutes' WHERE id=$1",[job.id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 if(!job)break;
 let skip=false;
 if(job.chave.startsWith('tarefa:')){const q=await pool.query('SELECT a.concluida,m.ativo FROM acoes a JOIN leads l ON l.id=a.lead_id JOIN membros m ON m.empresa_id=l.empresa_id AND m.usuario_id=a.responsavel_id WHERE a.id=$1',[Number(job.chave.split(':')[1])]);skip=!q.rowCount||q.rows[0].concluida||!q.rows[0].ativo;}
 if(job.chave.startsWith('convite:')){const q=await pool.query('SELECT id FROM convites WHERE id=$1 AND usado_em IS NULL AND revogado_em IS NULL AND expira_em>now()',[Number(job.chave.split(':')[1])]);skip=!q.rowCount;}
 if(skip){await pool.query('UPDATE crm_fila_email SET enviado_em=now() WHERE id=$1',[job.id]);continue;}
 try{await mail(job.email,'notificacao',job.link,{subject:job.assunto,text:job.texto});await pool.query('UPDATE crm_fila_email SET enviado_em=now() WHERE id=$1',[job.id]);}catch(e){console.error('Fila de e-mail: tentativa pendente',job.id,e.code||'SMTP');}
 }
}
function startJobs(pool,mail,env){let busy=false;const tick=async()=>{if(busy)return;busy=true;try{await runJobs(pool,mail,env);}catch(e){console.error('Agendador CRM:',e.code||e.name);}finally{busy=false;}};const timer=setInterval(tick,60000);timer.unref();tick();return ()=>clearInterval(timer);}
module.exports={collectAlerts,runJobs,startJobs};
