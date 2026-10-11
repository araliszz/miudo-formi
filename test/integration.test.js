const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const request=require('supertest');const {createApp}=require('../server');const {createTestPool}=require('./pool');
test('cadastro, e-mail, sessão persistente, multiempresa, ADM, convites e isolamento',async t=>{
 const pool=await createTestPool();await pool.db.exec(fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8'));
 await pool.db.exec(fs.readFileSync(path.join(__dirname,'../crm-schema.sql'),'utf8'));const env={NODE_ENV:'development',APP_URL:'http://localhost:3000',SESSION_SECRET:'test-secret-with-at-least-thirty-two-characters'};const sent=[];
 const app=createApp({pool,env,sendMail:async(email,kind,link)=>sent.push({email,kind,link})});
 const agents={};
 async function user(key,email){const agent=request.agent(app);agents[key]=agent;let s=(await agent.get('/api/session')).body;
 const r=await agent.post('/api/auth/register').set('X-CSRF-Token',s.csrf).send({nome:key,email,telefone:'11999999999',senha:'senha-forte-123'});assert.equal(r.status,201,JSON.stringify(r.body));s=(await agent.get('/api/session')).body;assert.equal(s.usuario.email_verificado,false);
 const token=new URL(sent.at(-1).link).searchParams.get('verificar');assert.equal((await agent.post('/api/auth/token').set('X-CSRF-Token',s.csrf).send({token,finalidade:'verificar'})).status,200);
 assert.equal((await agent.post('/api/auth/token').set('X-CSRF-Token',s.csrf).send({token,finalidade:'verificar'})).status,400);return agent;}
 async function post(agent,url,body={},method='post'){const s=(await agent.get('/api/session')).body;return agent[method](url).set('X-CSRF-Token',s.csrf).send(body);}
 try{
 const alice=await user('Alice','ALICE@example.com');const bob=await user('Bob','bob@example.com');const eve=await user('Eve','eve@example.com');
 const a=(await post(alice,'/api/empresas',{nome:'Academia A'})).body;const b=(await post(alice,'/api/empresas',{nome:'Academia B'})).body;const cid=a.id;const url=`/api/empresas/${cid}`;
 assert.equal((await alice.get('/api/empresas')).body.length,2);
 const invite=(await post(alice,url+'/convites',{email:'bob@example.com',perfil:'usuario'})).body;const token=new URL(invite.link).searchParams.get('convite');
 assert.equal((await post(eve,'/api/convites/aceitar',{token})).status,403);
 assert.equal((await post(bob,'/api/convites/aceitar',{token})).status,200);
 assert.equal((await post(bob,'/api/convites/aceitar',{token})).status,400);
 assert.equal((await post(bob,url+'/convites',{email:'eve@example.com',perfil:'admin'})).status,403);
 const bi=(await post(alice,`/api/empresas/${b.id}/convites`,{email:'bob@example.com',perfil:'admin'})).body;
 assert.equal((await post(bob,'/api/convites/aceitar',{token:new URL(bi.link).searchParams.get('convite')})).status,200);
 assert.equal((await bob.get('/api/empresas')).body.length,2);
 assert.equal((await bob.get(url+'/membros')).status,403);assert.equal((await bob.get(`/api/empresas/${b.id}/membros`)).status,200);
 const leadBody={nome:'João',telefone:'11988776655',origem:'Instagram',qualificacao:'SQL',temperatura:'quente',dificuldade:'complexa'};
 const l=(await post(bob,url+'/leads',leadBody)).body;assert.ok(l.id);
 const invalid=await post(bob,url+'/leads',{...leadBody,telefone:'1198x776655'});assert.equal(invalid.status,400);
 assert.equal((await bob.get(`/api/empresas/${b.id}/leads/${l.id}`)).status,404);assert.equal((await eve.get(url+'/analise')).status,403);
 const own=(await post(alice,url+'/leads',{...leadBody,nome:'Maria'})).body;
 assert.equal((await bob.get(url+'/leads')).body.length,1);assert.equal((await alice.get(url+'/leads')).body.length,2);
 assert.equal((await post(bob,`${url}/leads/${own.id}/eventos`,{tipo:'contato'})).status,404);
 assert.equal((await post(bob,`${url}/leads/${l.id}/eventos`,{tipo:'contato',detalhes:'Enviada proposta'})).status,201);
 assert.equal((await post(bob,`${url}/leads/${l.id}/contrato`,{valor:'1200.00',recebido_inicial:'200.00'})).status,201);
 assert.equal((await post(bob,`${url}/leads/${l.id}/contrato`,{valor:'1200.00',recebido_inicial:'200.00'})).status,409);
 const analysis=(await bob.get(url+'/analise')).body;assert.equal(analysis.captados,1);assert.equal(analysis.convertidos,1);assert.equal(analysis.recebido_inicial,200);assert.equal(analysis.conversao,100);
 const all=(await alice.get(url+'/analise')).body;assert.equal(all.captados,2);assert.equal(all.nao_trabalhados,1);
 assert.equal((await post(bob,`${url}/leads/${l.id}/eventos`,{tipo:'cancelamento'})).status,201);assert.equal((await bob.get(url+'/analise')).body.recebido_inicial,200);
 const action=(await post(bob,`${url}/leads/${l.id}/acoes`,{titulo:'Confirmar recebimento',prazo:'2026-12-01T12:00:00Z'})).body;assert.ok(action.id);
 assert.equal((await post(bob,url+'/acoes/'+action.id,{concluida:true},'patch')).status,200);
 const revoked=(await post(alice,url+'/convites',{email:'eve@example.com',perfil:'admin'})).body;assert.equal((await post(alice,url+'/convites/'+revoked.id,{},'delete')).status,200);assert.equal((await post(eve,'/api/convites/aceitar',{token:new URL(revoked.link).searchParams.get('convite')})).status,400);
 const expired=(await post(alice,url+'/convites',{email:'eve@example.com',perfil:'usuario'})).body;await pool.query("UPDATE convites SET expira_em='2020-01-01' WHERE id=$1",[expired.id]);assert.equal((await post(eve,'/api/convites/aceitar',{token:new URL(expired.link).searchParams.get('convite')})).status,400);
 const aid=(await alice.get('/api/session')).body.usuario.id;assert.equal((await post(alice,url+'/membros/'+aid,{perfil:'usuario',ativo:true},'patch')).status,400);
 assert.equal((await bob.post(url+'/leads').send(leadBody)).status,403);
 assert.equal((await post(bob,'/api/auth/logout')).status,200);assert.equal((await bob.get('/api/empresas')).status,401);
 const logged=await post(bob,'/api/auth/login',{email:'bob@example.com',senha:'senha-forte-123',lembrar:true});assert.equal(logged.status,200);assert.match(logged.headers['set-cookie'].join(';'),/HttpOnly/);assert.match(logged.headers['set-cookie'].join(';'),/Expires=/);
 await post(bob,'/api/auth/forgot',{email:'bob@example.com'});const resetToken=new URL(sent.at(-1).link).searchParams.get('redefinir');assert.equal((await post(eve,'/api/auth/token',{token:resetToken,finalidade:'redefinir',senha:'nova-senha-123'})).status,200);assert.equal((await bob.get('/api/empresas')).status,401);
 assert.equal((await post(bob,'/api/auth/login',{email:'bob@example.com',senha:'senha-forte-123'})).status,401);assert.equal((await post(bob,'/api/auth/login',{email:'bob@example.com',senha:'nova-senha-123'})).status,200);
 }finally{await pool.end();}
});
