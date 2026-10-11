const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const request=require('supertest');const {createTestPool}=require('./pool');const {createApp}=require('../server');const {PgRateLimitStore}=require('../security');
function client(app){let cookie='',csrf='';return {async call(method,url,body){let q=request(app)[method](url).set('X-Forwarded-Proto','https').set('Origin','https://miudoformi.com');if(cookie)q=q.set('Cookie',cookie);if(method!=='get')q=q.set('X-CSRF-Token',csrf).send(body||{});const r=await q;const values=r.headers['set-cookie'];if(values)cookie=values.map(x=>x.split(';')[0]).join('; ');if(url==='/api/session')csrf=r.body.csrf;return r;},async post(url,body){await this.call('get','/api/session');return this.call('post',url,body);}};}
test('produção: HTTPS, dono com segundo fator, convites, suspensão e limites duráveis',async()=>{const pool=await createTestPool();await pool.db.exec(fs.readFileSync(path.join(__dirname,'../schema.sql'),'utf8'));await pool.db.exec(fs.readFileSync(path.join(__dirname,'../crm-schema.sql'),'utf8'));const env={NODE_ENV:'production',OWNER_EMAIL:'owner@gmail.com',APP_URL:'https://miudoformi.com',SESSION_SECRET:'a'.repeat(96),TRUST_PROXY:'1',REGISTRATION_MODE:'invite',COMPANY_CREATION_MODE:'owner'};const sent=[];const app=createApp({pool,env,sendMail:async(email,kind,link)=>sent.push({email,kind,link})});const owner=client(app),other=client(app),stranger=client(app);
 const details=email=>({nome:'Teste',email,telefone:'11999999999',senha:'senha-segura-123'});
 try{
 assert.throws(()=>createApp({pool,env:{...env,APP_URL:'http://example.com'},sendMail:async()=>{}}),/HTTPS/);
 assert.throws(()=>createApp({pool,env:{...env,OWNER_EMAIL:''},sendMail:async()=>{}}),/OWNER_EMAIL/);
 assert.equal((await stranger.post('/api/auth/register',details('unknown@outlook.com'))).status,400);
 const reg=await owner.post('/api/auth/register',details(env.OWNER_EMAIL));assert.equal(reg.status,201);assert.match(reg.headers['set-cookie'].join(';'),/Secure/);
 let token=new URL(sent.at(-1).link).searchParams.get('verificar');assert.equal((await owner.post('/api/auth/token',{token,finalidade:'verificar'})).status,200);
 assert.equal((await owner.post('/api/empresas',{nome:'Antes do segundo fator'})).status,403);
 const login=await owner.post('/api/auth/login',{email:env.OWNER_EMAIL,senha:'senha-segura-123',proprietario:true});assert.equal(login.status,200);assert.equal(login.body.requires_mfa,true);
 token=new URL(sent.at(-1).link).searchParams.get('acesso_dono');assert.equal((await stranger.post('/api/auth/token',{token,finalidade:'acesso_dono'})).status,403);
 assert.equal((await owner.post('/api/auth/token',{token,finalidade:'acesso_dono'})).status,200);
 const state=(await owner.call('get','/api/session')).body;assert.equal(state.usuario.proprietario,true);
 const company=(await owner.post('/api/empresas',{nome:'Empresa segura'})).body;assert.ok(company.id);
 const url=`/api/empresas/${company.id}`;
 const invitation=(await owner.post(url+'/convites',{email:'member@proton.me',perfil:'admin'})).body;
 const invitedToken=new URL(invitation.link).searchParams.get('convite');assert.equal((await other.post('/api/auth/register',{...details('member@proton.me'),convite:invitedToken})).status,201);
 token=new URL(sent.at(-1).link).searchParams.get('verificar');assert.equal((await other.post('/api/auth/token',{token,finalidade:'verificar'})).status,200);
 assert.equal((await other.post('/api/convites/aceitar',{token:invitedToken})).status,200);
 assert.equal((await other.call('get','/api/plataforma/empresas')).status,403);
 assert.equal((await other.post('/api/empresas',{nome:'Sem permissão'})).status,403);
 assert.equal((await owner.call('get','/api/plataforma/empresas')).body.length,1);
 await owner.call('get','/api/session');assert.equal((await owner.call('patch',`/api/plataforma/empresas/${company.id}`,{suspensa:true})).status,200);
 assert.equal((await other.call('get',url+'/leads')).status,403);
 await owner.call('get','/api/session');assert.equal((await owner.call('patch',`/api/plataforma/empresas/${company.id}`,{suspensa:false})).status,200);
 assert.equal((await other.call('get',url+'/leads')).status,200);
 const audits=(await owner.call('get','/api/plataforma/auditoria')).body;assert.ok(audits.some(a=>a.evento==='empresa_suspensa'));assert.ok(audits.some(a=>a.evento==='proprietario_login'));
 const one=new PgRateLimitStore(pool,'shared'),two=new PgRateLimitStore(pool,'shared');one.init({windowMs:60000});two.init({windowMs:60000});assert.equal((await one.increment('example-ip')).totalHits,1);assert.equal((await two.increment('example-ip')).totalHits,2);
 assert.equal((await owner.call('get','/healthz')).body.status,'ok');
 }finally{await pool.end();}
});
