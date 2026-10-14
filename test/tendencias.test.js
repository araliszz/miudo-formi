const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),request=require('supertest');
const {windowFor,summarize}=require('../conversion-trends');
const {createTestPool}=require('./pool'),{createApp}=require('../server');
test('tendências: calendário, janelas iguais, zeros, alta e queda em pontos percentuais',()=>{
 for(const inicio of ['2026-02-30','1949-12-31','x'])assert.throws(()=>windowFor({inicio,fim:'2026-10-14'}));
 assert.throws(()=>windowFor({inicio:'2026-10-15',fim:'2026-10-14'}));assert.throws(()=>windowFor({inicio:'1950-01-01',fim:'2026-10-14'}));
 const w=windowFor({inicio:'2026-03-01',fim:'2026-03-31'});assert.equal(w.dias,31);assert.equal(w.anterior_fim,'2026-02-28');assert.equal(w.anterior_inicio,'2026-01-29');
 let d=summarize([{dia:'2026-03-01',leads:4,convertidos:1},{dia:'2026-02-01',leads:2,convertidos:1}],w);assert.equal(d.atual.taxa,25);assert.equal(d.anterior.taxa,50);assert.equal(d.variacao_pp,-25);assert.equal(d.tendencia,'queda');assert.equal(d.serie.length,31);assert.equal(d.serie[1].leads,0);
 d=summarize([{dia:'2026-03-01',leads:2,convertidos:1},{dia:'2026-02-01',leads:4,convertidos:1}],w);assert.equal(d.tendencia,'alta');assert.equal(summarize([],w).tendencia,'sem_base');assert.equal(summarize([],w).variacao_pp,null);
 const month=summarize([{dia:'2026-02-28',leads:3,convertidos:2}],windowFor({inicio:'2026-01-31',fim:'2026-04-30'}));assert.equal(month.serie.length,4);assert.equal(month.serie[1].convertidos,2);
});
test('tendências: colaborador vê seus dados e agregado, admin filtra; proteção entre empresas e atualização',async()=>{
 const pool=await createTestPool();await pool.db.exec(fs.readFileSync('schema.sql','utf8'));await pool.db.exec(fs.readFileSync('crm-schema.sql','utf8'));let sent=[];
 const server=createApp({pool,env:{APP_URL:'http://localhost:3000',SESSION_SECRET:'x'.repeat(96),NODE_ENV:'development'},sendMail:async(...a)=>sent.push(a)}).listen(0);await new Promise(ok=>server.once('listening',ok));
 const call=async(a,url,b,method='post')=>{const state=await a.get('/api/session');return a[method](url).set('X-CSRF-Token',state.body.csrf).send(b);};
 const account=async email=>{const a=request.agent(server);assert.equal((await call(a,'/api/auth/register',{nome:'Usuário '+email,email,telefone:'11999999999',senha:'senha-teste-forte'})).status,201);await call(a,'/api/auth/token',{token:new URL(sent.at(-1)[2]).searchParams.get('verificar'),finalidade:'verificar'});return {a,id:(await a.get('/api/session')).body.usuario.id};};
 try{
 const A=await account('admin@test.com'),B=await account('colaborador@test.com'),C=await account('externo@test.com');
 const co=(await call(A.a,'/api/empresas',{nome:'Empresa A'})).body.id,other=(await call(C.a,'/api/empresas',{nome:'Empresa B'})).body.id,p='/api/empresas/'+co;
 await pool.query("INSERT INTO membros(empresa_id,usuario_id,perfil) VALUES($1,$2,'usuario')",[co,B.id]);
 await pool.query("INSERT INTO leads(empresa_id,usuario_id,nome,telefone,data_captacao,situacao_lead) VALUES($1,$2,'Sigiloso A','11900000001','2026-03-01','convertido'),($1,$3,'Cliente B','11900000002','2026-03-02','captado'),($1,$3,'Cliente B antigo','11900000003','2026-02-02','convertido'),($4,$5,'Outro tenant','11900000004','2026-03-01','convertido')",[co,A.id,B.id,other,C.id]);
 const range='&inicio=2026-03-01&fim=2026-03-31';
 assert.equal((await request(server).get(p+'/crm/tendencias')).status,401);
 let r=await B.a.get(p+'/crm/tendencias?visao=minha'+range);assert.equal(r.status,200);assert.equal(r.body.atual.leads,1);assert.equal(r.body.atual.convertidos,0);assert.equal(r.body.tendencia,'queda');
 r=await B.a.get(p+'/crm/tendencias?visao=empresa'+range);assert.equal(r.body.atual.leads,2);assert.equal(r.body.atual.convertidos,1);assert.ok(!JSON.stringify(r.body).includes('Sigiloso'));assert.ok(!JSON.stringify(r.body).includes('11900000001'));assert.equal(r.body.contatos,undefined);
 assert.equal((await B.a.get(p+'/crm/tendencias?visao=colaborador&responsavel='+A.id+range)).status,403);
 assert.equal((await B.a.get(p+'/crm/tendencias?visao=empresa&responsavel='+A.id+range)).status,400);
 r=await A.a.get(p+'/crm/tendencias?visao=colaborador&responsavel='+B.id+range);assert.equal(r.body.atual.leads,1);
 assert.equal((await A.a.get(p+'/crm/tendencias?visao=colaborador&responsavel='+C.id+range)).status,404);
 assert.equal((await A.a.get('/api/empresas/'+other+'/crm/tendencias?visao=empresa'+range)).status,403);
 assert.equal((await A.a.get(p+'/crm/tendencias?visao=forjada'+range)).status,400);
 assert.equal((await A.a.get(p+'/crm/tendencias?visao=minha&inicio=2026-02-30&fim=2026-03-31')).status,400);
 const b=(await B.a.get(p+'/leads')).body.find(l=>l.nome==='Cliente B');await call(B.a,p+'/leads/'+b.id,{nome:b.nome,telefone:b.telefone,situacao_lead:'convertido'},'patch');
 r=await B.a.get(p+'/crm/tendencias?visao=minha'+range);assert.equal(r.body.atual.convertidos,1);assert.equal(r.body.atual.taxa,100);assert.equal(r.body.tendencia,'estavel');
 // As outras rotas continuam restritas à carteira do colaborador.
 assert.equal((await B.a.get(p+'/leads')).body.length,2);assert.equal((await B.a.get(p+'/leads?responsavel='+A.id)).status,403);
 }finally{await new Promise(ok=>server.close(ok));await pool.end();}
});
