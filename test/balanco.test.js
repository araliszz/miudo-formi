const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),request=require('supertest');const {createTestPool}=require('./pool'),{createApp}=require('../server');
const sql=n=>fs.readFileSync(require('node:path').join(__dirname,'..',n),'utf8');
test('balanço manual: situações, percentuais, período, empresa e contratos preservados',async()=>{
 const pool=await createTestPool();let server;
 try{const schema=sql('schema.sql');await pool.db.exec(schema.split('-- Data real de captação separada')[0]);await pool.query("INSERT INTO usuarios(nome,email,telefone,senha_hash) VALUES('Legado','legacy@example.com','11999999999','x')");await pool.query("INSERT INTO empresas(nome) VALUES('Legado')");await pool.query("INSERT INTO membros(empresa_id,usuario_id,perfil) VALUES(1,1,'admin')");await pool.query("INSERT INTO leads(empresa_id,usuario_id,nome,telefone,criado_em) VALUES(1,1,'Legado','11988888888','2026-10-11T01:00:00Z')");await pool.db.exec(schema);assert.equal((await pool.query('SELECT data_captacao::text AS d FROM leads WHERE id=1')).rows[0].d,'2026-10-10');await pool.db.exec(sql('crm-schema.sql'));
 const sent=[];server=createApp({pool,env:{NODE_ENV:'development',APP_URL:'http://localhost:3000',SESSION_SECRET:'a'.repeat(96)},sendMail:async(e,k,l)=>sent.push(l)}).listen(0);await new Promise(ok=>server.once('listening',ok));const a=request.agent(server),call=async(url,b,method='post')=>a[method](url).set('X-CSRF-Token',(await a.get('/api/session')).body.csrf).send(b);
 await a.get('/api/session');
 assert.equal((await call('/api/auth/register',{nome:'Teste',email:'dates@example.com',telefone:'11977777777',senha:'senha-teste-forte'})).status,201);assert.equal((await call('/api/auth/token',{finalidade:'verificar',token:new URL(sent.at(-1)).searchParams.get('verificar')})).status,200);const co=await call('/api/empresas',{nome:'Datas'});assert.equal(co.status,201);const p='/api/empresas/'+co.body.id,b={nome:'Anterior',telefone:'11966666666',data_captacao:'2020-02-29'},made=await call(p+'/leads',b);assert.equal(made.status,201);assert.equal(made.body.data_captacao,b.data_captacao);const created=made.body.criado_em,id=made.body.id;
 assert.equal((await call(p+'/leads/'+id,{...b,data_captacao:'2020-03-01',criado_em:'2000-01-01'},'patch')).status,200);let row=(await a.get(p+'/leads')).body[0];assert.equal(row.criado_em,created);assert.equal(row.data_captacao,'2020-03-01');await pool.db.exec(schema);assert.equal((await a.get(p+'/leads')).body[0].data_captacao,'2020-03-01');assert.equal((await a.get(p+'/analise?inicio=2020-03-01&fim=2020-03-01')).body.captados,1);
 const base={nome:'Situação',telefone:'11944444444',data_captacao:'2020-03-01'};
 const ids={};for(const status of ['trabalhado','convertido','inativo','perdido']){const made=await call(p+'/leads',{...base,nome:status,situacao_lead:status});assert.equal(made.status,201);ids[status]=made.body.id;}
 let report=(await a.get(p+'/crm/relatorios?inicio=2020-03-01&fim=2020-03-01')).body;
 const balance=report.balanco_leads;assert.deepEqual(balance.captados,{quantidade:5,percentual:100});
 for(const key of ['trabalhados','convertidos','inativos','perdidos','somente_captados'])assert.deepEqual(balance[key],{quantidade:1,percentual:20});
 assert.equal(report.contratado,0);assert.equal(report.recebido,0);assert.equal((await pool.query('SELECT count(*)::int AS n FROM crm_contratos')).rows[0].n,0);
 assert.equal((await call(p+'/leads/'+ids.perdido,{...base,nome:'Retomado',situacao_lead:'trabalhado'},'patch')).status,200);
 assert.equal((await call(p+'/leads/'+ids.perdido,{...base,nome:'Editado sem alterar situação'},'patch')).status,200);
 assert.equal((await a.get(p+'/leads')).body.find(x=>x.id===ids.perdido).situacao_lead,'trabalhado');
 report=(await a.get(p+'/crm/relatorios?inicio=2020-03-01&fim=2020-03-01')).body;
 assert.deepEqual(report.balanco_leads.trabalhados,{quantidade:2,percentual:40});assert.equal(report.balanco_leads.perdidos.quantidade,0);
 for(const status of ['cancelado','administrador','',null])assert.equal((await call(p+'/leads',{...base,situacao_lead:status})).status,400);
 for(const range of ['1950-01-01&fim=1950-12-31','2101-01-01&fim=2101-12-31']){const empty=(await a.get(p+'/crm/relatorios?inicio='+range)).body.balanco_leads;for(const metric of Object.values(empty))assert.deepEqual(metric,{quantidade:0,percentual:0});}
 const other=await call('/api/empresas',{nome:'Outra empresa'});assert.equal(other.status,201);const op='/api/empresas/'+other.body.id;
 assert.equal((await call(op+'/leads',{...base,situacao_lead:'perdido'})).status,201);
 assert.equal((await a.get(p+'/crm/relatorios')).body.balanco_leads.perdidos.quantidade,0);assert.equal((await a.get(op+'/crm/relatorios')).body.balanco_leads.perdidos.quantidade,1);
 // A collaborator sees only their own contacts; changing a status does not grant access.
 const me=(await a.get('/api/session')).body.usuario.id;
 await pool.query("UPDATE membros SET perfil='usuario' WHERE empresa_id=$1 AND usuario_id=$2",[co.body.id,me]);
 await pool.query("INSERT INTO membros(empresa_id,usuario_id,perfil) VALUES($1,1,'usuario')",[co.body.id]);
 const foreign=(await pool.query("INSERT INTO leads(empresa_id,usuario_id,nome,telefone,data_captacao,situacao_lead) VALUES($1,1,'Outro responsável','11933333333','2020-03-01','perdido') RETURNING id",[co.body.id])).rows[0].id;
 assert.equal((await a.get(p+'/crm/relatorios')).body.balanco_leads.perdidos.quantidade,0);
 assert.equal((await call(p+'/leads/'+foreign,{...base,situacao_lead:'trabalhado'},'patch')).status,404);
 await pool.db.exec(schema);assert.equal((await a.get(p+'/leads')).body.find(x=>x.id===ids.perdido).situacao_lead,'trabalhado');
 }finally{if(server)await new Promise(ok=>server.close(ok));await pool.end();}
});
