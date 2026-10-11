require('dotenv').config();
const express=require('express');
const session=require('express-session');
const PgSession=require('connect-pg-simple')(session);
const bcrypt=require('bcrypt');
const helmet=require('helmet');
const {rateLimit}=require('express-rate-limit');
const path=require('node:path');
const D=require('./domain');
const {createMailer}=require('./mail');
const {PgRateLimitStore,isOwnerAccount,ownerReady,publicUser,audit}=require('./security');
const DUMMY_HASH=bcrypt.hashSync('invalid-login-placeholder',12);
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
async function tx(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
function createApp({pool,env=process.env,sendMail,sessionStore}={}) {
 if(!pool)throw new Error('Pool PostgreSQL obrigatório.');
 if(!env.SESSION_SECRET||env.SESSION_SECRET.length<32||env.SESSION_SECRET.startsWith('SUBSTITUA'))throw new Error('Configure SESSION_SECRET aleatório (32 caracteres ou mais).');
 const base=new URL(env.APP_URL||'http://localhost:3000');
 const production=env.NODE_ENV==='production';
 if(production&&(!env.OWNER_EMAIL||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.OWNER_EMAIL)))throw new Error('Configure OWNER_EMAIL com o e-mail do proprietário.');
 if(production&&base.protocol!=='https:')throw new Error('APP_URL de produção deve usar HTTPS.');
 const mail=sendMail||createMailer(env);
 const app=express(); app.disable('x-powered-by');
 if(env.TRUST_PROXY==='1')app.set('trust proxy',1);
 app.use((req,res,next)=>{res.set('Referrer-Policy','no-referrer');next();});
 app.get('/healthz',wrap(async(req,res)=>{await pool.query('SELECT 1');res.set('Cache-Control','no-store').json({status:'ok'});}));
 app.use(helmet({contentSecurityPolicy:{directives:{'script-src':["'self'"],'style-src':["'self'"],'img-src':["'self'",'data:']}}}));
 app.use(express.json({limit:'4mb'}));
 app.use('/api',rateLimit({windowMs:60000,limit:300,store:production?new PgRateLimitStore(pool,'api'):undefined,standardHeaders:'draft-7',legacyHeaders:false}));
 app.use(session({name:'formi.sid',store:sessionStore||new PgSession({pool,tableName:'session',createTableIfMissing:false}),secret:env.SESSION_SECRET,resave:false,saveUninitialized:false,
 cookie:{httpOnly:true,sameSite:'lax',secure:production,maxAge:8*3600000}}));
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');
 if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
 if(req.get('Origin')&&req.get('Origin')!==base.origin)return next(Object.assign(new Error('Origem não autorizada.'),{status:403}));
 if(!req.session.csrf||req.get('X-CSRF-Token')!==req.session.csrf)return next(Object.assign(new Error('Atualize a página e tente novamente.'),{status:403}));
 }next();});
 const auth=wrap(async(req,res,next)=>{
 if(!req.session.uid)D.fail('Você precisa entrar na sua conta.',401);
 const q=await pool.query('SELECT id,nome,email,telefone,email_verificado FROM usuarios WHERE id=$1',[req.session.uid]);
 if(!q.rowCount)D.fail('Sessão inválida.',401);req.user=publicUser(q.rows[0],req,env);next();});
 const verified=(req,res,next)=>req.user.email_verificado?next():next(Object.assign(new Error('Confirme seu e-mail antes de acessar empresas.'),{status:403}));
 const company=wrap(async(req,res,next)=>{
 const cid=D.id(req.params.empresaId);const q=await pool.query(`SELECT m.perfil,e.* FROM membros m JOIN empresas e ON e.id=m.empresa_id WHERE m.usuario_id=$1 AND m.empresa_id=$2 AND m.ativo=true`,[req.user.id,cid]);
 if(!q.rowCount)D.fail('Empresa indisponível para sua conta.',403);req.company=q.rows[0];if(req.company.suspensa)D.fail('Esta empresa está suspensa. Entre em contato com o proprietário.',403);next();});
 const admin=(req,res,next)=>req.company.perfil==='admin'?next():next(Object.assign(new Error('Acesso exclusivo do ADM desta empresa.'),{status:403}));
 const scope=(req)=>({sql:'l.empresa_id=$1'+(req.company.perfil==='admin'?'':' AND l.usuario_id=$2'),args:req.company.perfil==='admin'?[req.company.id]:[req.company.id,req.user.id]});
 async function lead(req,c=pool,lock=false) {const s=scope(req);s.args.push(D.id(req.params.leadId));const q=await c.query(`SELECT l.* FROM leads l WHERE ${s.sql} AND l.id=$${s.args.length}${lock?' FOR UPDATE':''}`,s.args);if(!q.rowCount)D.fail('Lead não encontrado.',404);return q.rows[0];}
 const sessionSave=req=>new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));
 async function loginSession(req,uid,remember,owner=false){await new Promise((ok,no)=>req.session.regenerate(e=>e?no(e):ok()));req.session.uid=uid;if(owner){req.session.ownerMfaUid=uid;req.session.ownerMfaAt=Date.now();}req.session.csrf=D.token();req.session.cookie.maxAge=(remember?30*24:8)*3600000;await sessionSave(req);}
 const mailLimit=production?new PgRateLimitStore(pool,'mail'):null;if(mailLimit)mailLimit.init({windowMs:60000});
 async function issueEmail(uid,email,kind,binding=null){if(mailLimit&&(await mailLimit.increment(uid+':'+kind)).totalHits>1)D.fail('Aguarde um minuto antes de solicitar outro e-mail.',429);const token=D.token();const q=await pool.query(`INSERT INTO tokens_email(usuario_id,token_hash,finalidade,expira_em,session_binding_hash) VALUES($1,$2,$3,$4,$5) RETURNING id`,[uid,D.hash(token),kind,new Date(Date.now()+(kind==='verificar'?86400000:kind==='acesso_dono'?600000:3600000)),binding?D.hash(binding):null]);
 try{await mail(email,kind,`${base.origin}/?${kind==='verificar'?'verificar':kind==='acesso_dono'?'acesso_dono':'redefinir'}=${token}`);}catch(e){await pool.query('DELETE FROM tokens_email WHERE id=$1',[q.rows[0].id]);console.error('Falha SMTP:',e.code||'indisponível');D.fail('Não foi possível enviar o e-mail. Tente reenviar em instantes.',503);}}
 const authLimit=rateLimit({windowMs:15*60000,limit:20,store:production?new PgRateLimitStore(pool,'auth'):undefined,standardHeaders:'draft-7',legacyHeaders:false});
 app.get('/api/session',wrap(async(req,res)=>{if(!req.session.csrf)req.session.csrf=D.token();let user=null;if(req.session.uid){const q=await pool.query('SELECT id,nome,email,telefone,email_verificado FROM usuarios WHERE id=$1',[req.session.uid]);user=q.rows[0]||null;}res.json({csrf:req.session.csrf,usuario:publicUser(user,req,env),cadastro_por_convite:production&&env.REGISTRATION_MODE!=='public'});}));
 app.post('/api/auth/register',authLimit,wrap(async(req,res)=>{const b=req.body;const nome=D.text(b.nome,'Nome',120),email=D.email(b.email),telefone=D.phone(b.telefone),senha=D.password(b.senha);
 if(production&&env.REGISTRATION_MODE!=='public'&&email!==env.OWNER_EMAIL.trim().toLowerCase()){
 const inviteToken=D.text(b.convite||'','Convite',64);
 const allowed=await pool.query('SELECT id FROM convites WHERE token_hash=$1 AND email=$2 AND usado_em IS NULL AND revogado_em IS NULL AND expira_em>now()',[D.hash(inviteToken),email]);
 if(!allowed.rowCount)D.fail('Cadastro disponível somente pelo convite do ADM.',403);
 }
 const hash=await bcrypt.hash(senha,12);let user;
 try{user=(await pool.query(`INSERT INTO usuarios(nome,email,telefone,senha_hash) VALUES($1,$2,$3,$4) RETURNING id`,[nome,email,telefone,hash])).rows[0];}catch(e){if(e.code==='23505')D.fail('Este e-mail já tem uma conta. Entre nela para adicionar outra empresa.',409);throw e;}
 await loginSession(req,user.id,false);await issueEmail(user.id,email,'verificar');res.status(201).json({mensagem:'Conta criada. Confirme seu e-mail para continuar.'});}));
 app.post('/api/auth/login',authLimit,wrap(async(req,res)=>{const email=D.email(req.body.email);const senha=D.password(req.body.senha);const q=await pool.query('SELECT id,email,email_verificado,senha_hash FROM usuarios WHERE email=$1',[email]);
 const validPassword=await bcrypt.compare(senha,q.rows[0]?.senha_hash||DUMMY_HASH);if(!q.rowCount||!validPassword)D.fail('E-mail ou senha incorretos.',401);if(isOwnerAccount(q.rows[0],env)){
 await new Promise((ok,no)=>req.session.regenerate(e=>e?no(e):ok()));req.session.pendingOwnerUid=q.rows[0].id;req.session.pendingOwnerNonce=D.token();req.session.csrf=D.token();req.session.cookie.maxAge=600000;await sessionSave(req);
 await issueEmail(q.rows[0].id,email,'acesso_dono',req.session.pendingOwnerNonce);return res.json({requires_mfa:true,mensagem:'Abra o link enviado ao seu e-mail neste mesmo navegador para confirmar o acesso do proprietário.'});
 }
 await loginSession(req,q.rows[0].id,req.body.lembrar===true);res.json({mensagem:'Login realizado.'});}));
 app.post('/api/auth/logout',auth,wrap(async(req,res)=>{await new Promise((ok,no)=>req.session.destroy(e=>e?no(e):ok()));res.clearCookie('formi.sid',{httpOnly:true,sameSite:'lax',secure:production,path:'/'}).json({mensagem:'Você saiu.'});}));
 app.post('/api/auth/reenviar',authLimit,auth,wrap(async(req,res)=>{if(!req.user.email_verificado)await issueEmail(req.user.id,req.user.email,'verificar');res.json({mensagem:'Se houver confirmação pendente, enviamos um novo link.'});}));
 app.post('/api/auth/forgot',authLimit,wrap(async(req,res)=>{const q=await pool.query('SELECT id,email FROM usuarios WHERE email=$1',[D.email(req.body.email)]);if(q.rowCount){try{await issueEmail(q.rows[0].id,q.rows[0].email,'redefinir');}catch(e){if(![429,503].includes(e.status))throw e;}}res.json({mensagem:'Se a conta existir, você receberá um link.'});}));
 app.post('/api/auth/token',authLimit,wrap(async(req,res)=>{const kind=D.choice(req.body.finalidade,['verificar','redefinir','acesso_dono'],'Finalidade');const t=D.text(req.body.token,'Token',64);const newHash=kind==='redefinir'?await bcrypt.hash(D.password(req.body.senha),12):null;
 const uid=await tx(pool,async c=>{const q=await c.query(`SELECT * FROM tokens_email WHERE token_hash=$1 AND finalidade=$2 FOR UPDATE`,[D.hash(t),kind]);const v=q.rows[0];if(!v||v.usado_em||new Date(v.expira_em)<=new Date())D.fail('Link inválido, utilizado ou expirado.');
 if(kind==='acesso_dono'){if(req.session.pendingOwnerUid!==v.usuario_id||!req.session.pendingOwnerNonce||D.hash(req.session.pendingOwnerNonce)!==v.session_binding_hash)D.fail('Abra este link no mesmo navegador em que você informou a senha.',403);}
 else if(kind==='verificar')await c.query('UPDATE usuarios SET email_verificado=true WHERE id=$1',[v.usuario_id]);else{await c.query('UPDATE usuarios SET senha_hash=$1 WHERE id=$2',[newHash,v.usuario_id]);await c.query(`DELETE FROM session WHERE sess->>'uid'=$1`,[String(v.usuario_id)]);}
 await c.query('UPDATE tokens_email SET usado_em=now() WHERE usuario_id=$1 AND finalidade=$2 AND usado_em IS NULL',[v.usuario_id,kind]);return v.usuario_id;});
 if(kind==='acesso_dono'){await loginSession(req,uid,false,true);await audit(pool,req,'proprietario_login');return res.json({mensagem:'Acesso de proprietário confirmado. Volte ao FORMI.'});}
 if(kind==='redefinir'&&req.session.uid===uid)await new Promise((ok,no)=>req.session.destroy(e=>e?no(e):ok()));res.json({mensagem:kind==='verificar'?'E-mail confirmado. Entre na sua conta para continuar.':'Senha alterada. Entre novamente.'});}));
 app.get('/api/empresas',auth,verified,wrap(async(req,res)=>{const q=await pool.query(`SELECT e.*,m.perfil FROM empresas e JOIN membros m ON m.empresa_id=e.id WHERE m.usuario_id=$1 AND m.ativo=true ORDER BY e.nome`,[req.user.id]);res.json(q.rows);}));
 app.post('/api/empresas',auth,verified,wrap(async(req,res)=>{if(production&&env.COMPANY_CREATION_MODE!=='public'&&!ownerReady(req.user,req,env))D.fail('Somente o proprietário pode criar empresas nesta implantação.',403);const nome=D.text(req.body.nome,'Nome da empresa',150);const e=await tx(pool,async c=>{const q=await c.query('INSERT INTO empresas(nome) VALUES($1) RETURNING *',[nome]);await c.query(`INSERT INTO membros(empresa_id,usuario_id,perfil) VALUES($1,$2,'admin')`,[q.rows[0].id,req.user.id]);return q.rows[0];});res.status(201).json(e);}));
 const owner=(req,res,next)=>ownerReady(req.user,req,env)?next():next(Object.assign(new Error('Acesso exclusivo do proprietário com confirmação adicional.'),{status:403}));
 app.get('/api/plataforma/empresas',auth,verified,owner,wrap(async(req,res)=>{
 const q=await pool.query(`SELECT e.id,e.nome,e.suspensa,e.criado_em,(SELECT count(*)::int FROM membros m WHERE m.empresa_id=e.id AND m.ativo=true) AS membros_ativos,(SELECT count(*)::int FROM leads l WHERE l.empresa_id=e.id) AS total_leads FROM empresas e ORDER BY e.id DESC`);res.json(q.rows);
 }));
 app.patch('/api/plataforma/empresas/:empresaId',auth,verified,owner,wrap(async(req,res)=>{
 const id=D.id(req.params.empresaId);if(typeof req.body.suspensa!=='boolean')D.fail('Informe o estado da empresa.');
 await tx(pool,async c=>{const q=await c.query('UPDATE empresas SET suspensa=$1 WHERE id=$2 RETURNING id',[req.body.suspensa,id]);if(!q.rowCount)D.fail('Empresa não encontrada.',404);await audit(c,req,req.body.suspensa?'empresa_suspensa':'empresa_reativada',id);});res.json({mensagem:'Estado da empresa atualizado.'});
 }));
 app.get('/api/plataforma/auditoria',auth,verified,owner,wrap(async(req,res)=>{
 const q=await pool.query('SELECT a.id,a.evento,a.empresa_id,a.detalhes,a.criado_em,u.nome AS autor FROM auditoria a LEFT JOIN usuarios u ON u.id=a.usuario_id ORDER BY a.id DESC LIMIT 100');res.json(q.rows);
 }));
 const router=express.Router({mergeParams:true});app.use('/api/empresas/:empresaId',auth,verified,company,router);
 router.get('/membros',admin,wrap(async(req,res)=>{const q=await pool.query(`SELECT u.id,u.nome,u.email,m.perfil,m.ativo FROM membros m JOIN usuarios u ON u.id=m.usuario_id WHERE m.empresa_id=$1 ORDER BY u.nome`,[req.company.id]);res.json(q.rows);}));
 router.patch('/membros/:usuarioId',admin,wrap(async(req,res)=>{const uid=D.id(req.params.usuarioId);const perfil=D.choice(req.body.perfil,['admin','usuario'],'Perfil');if(typeof req.body.ativo!=='boolean')D.fail('Informe se o vínculo está ativo.');
 await tx(pool,async c=>{await c.query('SELECT id FROM empresas WHERE id=$1 FOR UPDATE',[req.company.id]);const q=await c.query('SELECT * FROM membros WHERE empresa_id=$1 AND usuario_id=$2',[req.company.id,uid]);if(!q.rowCount)D.fail('Membro não encontrado.',404);
 if(q.rows[0].ativo&&q.rows[0].perfil==='admin'&&(!req.body.ativo||perfil!=='admin')){const a=await c.query(`SELECT usuario_id FROM membros WHERE empresa_id=$1 AND ativo=true AND perfil='admin'`,[req.company.id]);if(a.rowCount<=1)D.fail('A empresa precisa manter pelo menos um ADM ativo.');}
 await c.query('UPDATE membros SET perfil=$1,ativo=$2 WHERE empresa_id=$3 AND usuario_id=$4',[perfil,req.body.ativo,req.company.id,uid]);await audit(c,req,'permissao_atualizada',req.company.id,{usuario_id:uid,perfil,ativo:req.body.ativo});});res.json({mensagem:'Permissão atualizada.'});}));
 router.patch('/config',admin,wrap(async(req,res)=>{const days=D.id(req.body.dias_inatividade);const meta=Number(req.body.meta_conversao);if(days>365||!Number.isFinite(meta)||meta<0||meta>100)D.fail('Configuração inválida.');await pool.query('UPDATE empresas SET dias_inatividade=$1,meta_conversao=$2 WHERE id=$3',[days,meta,req.company.id]);res.json({mensagem:'Metas atualizadas.'});}));
 router.get('/convites',admin,wrap(async(req,res)=>{const q=await pool.query('SELECT id,email,perfil,expira_em,usado_em,revogado_em FROM convites WHERE empresa_id=$1 ORDER BY id DESC',[req.company.id]);res.json(q.rows);}));
 router.post('/convites',admin,wrap(async(req,res)=>{const email=D.email(req.body.email),perfil=D.choice(req.body.perfil,['admin','usuario'],'Perfil');const t=D.token();const q=await pool.query(`INSERT INTO convites(empresa_id,criado_por,email,perfil,token_hash,expira_em) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,expira_em`,[req.company.id,req.user.id,email,perfil,D.hash(t),new Date(Date.now()+7*86400000)]);await audit(pool,req,'convite_criado',req.company.id,{convite_id:q.rows[0].id,perfil});const link=`${base.origin}/?convite=${t}`; await require('./crm').queueInvite(pool,req,q.rows[0].id,email,link); res.status(201).json({...q.rows[0],link,email_agendado:true});}));
 router.delete('/convites/:id',admin,wrap(async(req,res)=>{const q=await pool.query('UPDATE convites SET revogado_em=now() WHERE id=$1 AND empresa_id=$2 AND usado_em IS NULL RETURNING id',[D.id(req.params.id),req.company.id]);if(!q.rowCount)D.fail('Convite indisponível.',404);await audit(pool,req,'convite_revogado',req.company.id,{convite_id:q.rows[0].id});res.json({mensagem:'Convite revogado.'});}));
 app.post('/api/convites/aceitar',auth,verified,wrap(async(req,res)=>{const token=D.text(req.body.token,'Token',64);const empresa=await tx(pool,async c=>{const q=await c.query('SELECT * FROM convites WHERE token_hash=$1 FOR UPDATE',[D.hash(token)]);const v=q.rows[0];if(!v||v.usado_em||v.revogado_em||new Date(v.expira_em)<=new Date())D.fail('Convite inválido, utilizado, revogado ou expirado.');const tenant=await c.query('SELECT suspensa FROM empresas WHERE id=$1',[v.empresa_id]);if(!tenant.rowCount||tenant.rows[0].suspensa)D.fail('Empresa indisponível.',403);if(v.email!==req.user.email)D.fail('Entre com o e-mail ao qual o ADM destinou este convite.',403);
 const issuer=await c.query(`SELECT usuario_id FROM membros WHERE empresa_id=$1 AND usuario_id=$2 AND perfil='admin' AND ativo=true`,[v.empresa_id,v.criado_por]);if(!issuer.rowCount)D.fail('O ADM que criou este convite não tem mais permissão.',403);
 const member=await c.query('SELECT usuario_id FROM membros WHERE empresa_id=$1 AND usuario_id=$2',[v.empresa_id,req.user.id]);if(member.rowCount)D.fail('Esta conta já tem um vínculo nesta empresa. Peça ao ADM para ajustar a permissão.',409);
 await c.query('INSERT INTO membros(empresa_id,usuario_id,perfil) VALUES($1,$2,$3)',[v.empresa_id,req.user.id,v.perfil]);await c.query('UPDATE convites SET usado_em=now(),aceito_por=$1 WHERE id=$2',[req.user.id,v.id]);return v.empresa_id;});res.json({empresa_id:empresa,mensagem:'Você entrou na empresa.'});}));
 require('./crm').mountCRM({router,pool,admin,lead,scope,tx,wrap,mail,base});
 const selectLeads=`SELECT l.*,u.nome AS responsavel,c.id AS contrato_id,c.valor AS valor_contrato,c.recebido_inicial FROM leads l JOIN usuarios u ON u.id=l.usuario_id LEFT JOIN contratos c ON c.lead_id=l.id`;
 async function list(req){const s=scope(req);return (await pool.query(`${selectLeads} WHERE ${s.sql} ORDER BY l.criado_em DESC,l.id DESC`,s.args)).rows;}
 router.get('/leads',wrap(async(req,res)=>res.json((await list(req)).map(l=>({...l,inativo_calculado:D.inactive(l,req.company.dias_inatividade)})))));
 function leadFields(b){return [D.text(b.nome,'Nome',120),D.phone(b.telefone),b.email?D.email(b.email):null,D.text(b.origem||'Manual','Origem',80),D.choice(b.qualificacao||'IQL',['IQL','MQL','SQL','PQL'],'Qualificação'),D.choice(b.temperatura||'frio',['frio','morno','quente'],'Temperatura'),D.choice(b.dificuldade||'simples',['simples','complexa','complexo_irregular'],'Dificuldade'),D.text(b.observacoes||'','Observações',5000,false)];}
 router.post('/leads',wrap(async(req,res)=>{const fields=leadFields(req.body);let uid=req.user.id;if(req.company.perfil==='admin'&&req.body.usuario_id)uid=D.id(req.body.usuario_id);const m=await pool.query('SELECT usuario_id FROM membros WHERE empresa_id=$1 AND usuario_id=$2 AND ativo=true',[req.company.id,uid]);if(!m.rowCount)D.fail('Responsável não está ativo nesta empresa.');const q=await pool.query(`INSERT INTO leads(empresa_id,usuario_id,nome,telefone,email,origem,qualificacao,temperatura,dificuldade,observacoes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[req.company.id,uid,...fields]);res.status(201).json(q.rows[0]);}));
 router.patch('/leads/:leadId',wrap(async(req,res)=>{const fields=leadFields(req.body);await tx(pool,async c=>{const l=await lead(req,c,true);let uid=l.usuario_id;if(req.company.perfil==='admin'&&req.body.usuario_id)uid=D.id(req.body.usuario_id);const m=await c.query('SELECT usuario_id FROM membros WHERE empresa_id=$1 AND usuario_id=$2 AND ativo=true',[req.company.id,uid]);if(!m.rowCount)D.fail('Responsável indisponível.');await c.query(`UPDATE leads SET nome=$1,telefone=$2,email=$3,origem=$4,qualificacao=$5,temperatura=$6,dificuldade=$7,observacoes=$8,usuario_id=$9,atualizado_em=now() WHERE id=$10`,[...fields,uid,l.id]);await c.query(`INSERT INTO eventos(lead_id,usuario_id,tipo,detalhes) VALUES($1,$2,'edicao',$3)`,[l.id,req.user.id,'Cadastro atualizado']);});res.json({mensagem:'Lead atualizado.'});}));
 router.get('/leads/:leadId',wrap(async(req,res)=>{const l=await lead(req);const e=await pool.query('SELECT e.*,u.nome AS autor FROM eventos e JOIN usuarios u ON u.id=e.usuario_id WHERE e.lead_id=$1 ORDER BY e.criado_em DESC,e.id DESC',[l.id]);res.json({lead:l,eventos:e.rows});}));
 router.post('/leads/:leadId/eventos',wrap(async(req,res)=>{const tipo=D.choice(req.body.tipo,['contato','resposta','visita_agendada','visita_realizada','perdido','inativo','cancelamento','reativacao'],'Ação');const detalhes=D.text(req.body.detalhes||'','Detalhes',5000,false);if(tipo==='perdido'&&!detalhes)D.fail('Informe o motivo da perda.');
 await tx(pool,async c=>{const l=await lead(req,c,true);const hasContract=(await c.query('SELECT id FROM contratos WHERE lead_id=$1',[l.id])).rowCount>0;if(['perdido','inativo','reativacao'].includes(tipo)&&hasContract)D.fail('Lead convertido: utilize cancelamento para encerrar o contrato.');if(tipo==='cancelamento'&&l.etapa!=='convertido')D.fail('Só é possível cancelar um lead convertido.');
 let etapa=l.etapa;if(tipo==='contato'&&['captado','inativo'].includes(etapa))etapa='trabalhado';if(['resposta','visita_agendada','visita_realizada'].includes(tipo)&&['captado','inativo'].includes(etapa))etapa='trabalhado';
 if(tipo==='perdido')etapa='perdido';if(tipo==='inativo')etapa='inativo';if(tipo==='cancelamento')etapa='cancelado';if(tipo==='reativacao')etapa='trabalhado';
 if(tipo==='cancelamento')await c.query('UPDATE crm_contratos SET cancelado_em=now() WHERE legado_id IN(SELECT id FROM contratos WHERE lead_id=$1)',[l.id]);
 const worked=['contato','resposta','visita_agendada','visita_realizada'].includes(tipo);
 if(tipo==='visita_agendada'&&req.company.crm_config?.automacao_visita){const prazo=new Date(req.body.prazo);if(!Number.isFinite(prazo.getTime()))D.fail('Informe data e hora da visita.');await c.query('INSERT INTO acoes(lead_id,titulo,responsavel_id,prazo) VALUES($1,$2,$3,$4)',[l.id,'Visita: '+l.nome,l.usuario_id,prazo]);}

 await c.query(`UPDATE leads SET etapa=$1,motivo_perda=$2,trabalhado_em=CASE WHEN $3 THEN coalesce(trabalhado_em,now()) ELSE trabalhado_em END,ultimo_contato_em=CASE WHEN $4 THEN now() ELSE ultimo_contato_em END,ultima_resposta_em=CASE WHEN $5 THEN now() ELSE ultima_resposta_em END,atualizado_em=now() WHERE id=$6`,[etapa,tipo==='perdido'?detalhes:l.motivo_perda,worked,tipo==='contato',tipo==='resposta',l.id]);await c.query('INSERT INTO eventos(lead_id,usuario_id,tipo,detalhes) VALUES($1,$2,$3,$4)',[l.id,req.user.id,tipo,detalhes]);});res.status(201).json({mensagem:'Ação registrada.'});}));
 router.post('/leads/:leadId/contrato',wrap(async(req,res)=>{const valor=D.money(req.body.valor),recebido=D.money(req.body.recebido_inicial);if(recebido>valor)D.fail('Recebimento inicial não pode superar o contrato.');await tx(pool,async c=>{const l=await lead(req,c,true);const existing=await c.query('SELECT id FROM contratos WHERE lead_id=$1',[l.id]);if(existing.rowCount)D.fail('Este lead já tem contrato registrado. Não pode ser contado duas vezes.',409);
 await c.query('INSERT INTO contratos(lead_id,valor,recebido_inicial,criado_por) VALUES($1,$2,$3,$4)',[l.id,valor,recebido,req.user.id]);await require('./crm').syncLegacyContract(c,l,req.user.id,valor,recebido);await c.query(`UPDATE leads SET etapa='convertido',trabalhado_em=coalesce(trabalhado_em,now()),atualizado_em=now() WHERE id=$1`,[l.id]);await c.query(`INSERT INTO eventos(lead_id,usuario_id,tipo,detalhes) VALUES($1,$2,'contrato',$3)`,[l.id,req.user.id,`Contrato: R$ ${valor.toFixed(2)}; recebido inicial: R$ ${recebido.toFixed(2)}`]);});res.status(201).json({mensagem:'Conversão e recebimento inicial registrados.'});}));
 router.get('/analise',wrap(async(req,res)=>{let leads=await list(req);const start=req.query.inicio,end=req.query.fim;
 if(start||end){if(!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(end||'')||start>end||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end)))D.fail('Informe um intervalo de datas válido.');leads=leads.filter(l=>{const d=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(l.criado_em));return d>=start&&d<=end;});}
 res.json(D.analyze(leads,req.company.dias_inatividade,req.company.meta_conversao));}));
 router.get('/acoes',wrap(async(req,res)=>{const s=scope(req);const q=await pool.query(`SELECT a.*,l.nome AS lead_nome,u.nome AS responsavel FROM acoes a JOIN leads l ON l.id=a.lead_id JOIN usuarios u ON u.id=a.responsavel_id WHERE ${s.sql} ORDER BY a.concluida,a.prazo`,s.args);const suggestions=(await list(req)).map(l=>({lead_id:l.id,nome:l.nome,...D.suggest(l,req.company.dias_inatividade)})).filter(x=>x.titulo).sort((a,b)=>a.prioridade-b.prioridade);res.json({acoes:q.rows,sugestoes:suggestions});}));
 router.post('/leads/:leadId/acoes',wrap(async(req,res)=>{const titulo=D.text(req.body.titulo,'Ação',200);const prazo=new Date(req.body.prazo);if(!Number.isFinite(prazo.getTime()))D.fail('Prazo inválido.');let uid=req.user.id;if(req.company.perfil==='admin'&&req.body.responsavel_id)uid=D.id(req.body.responsavel_id);const l=await lead(req);const m=await pool.query('SELECT usuario_id FROM membros WHERE empresa_id=$1 AND usuario_id=$2 AND ativo=true',[req.company.id,uid]);if(!m.rowCount)D.fail('Responsável indisponível.');const q=await pool.query('INSERT INTO acoes(lead_id,titulo,responsavel_id,prazo) VALUES($1,$2,$3,$4) RETURNING *',[l.id,titulo,uid,prazo]);res.status(201).json(q.rows[0]);}));
 router.patch('/acoes/:id',wrap(async(req,res)=>{const s=scope(req);s.args.push(D.id(req.params.id));const q=await pool.query(`SELECT a.id FROM acoes a JOIN leads l ON l.id=a.lead_id WHERE ${s.sql} AND a.id=$${s.args.length}`,s.args);if(!q.rowCount)D.fail('Ação indisponível.',404);if(typeof req.body.concluida!=='boolean')D.fail('Estado inválido.');await pool.query('UPDATE acoes SET concluida=$1,concluida_em=CASE WHEN $1 THEN now() ELSE NULL END WHERE id=$2',[req.body.concluida,q.rows[0].id]);res.json({mensagem:'Plano atualizado.'});}));
 app.use('/api',(req,res)=>res.status(404).json({erro:'Operação não encontrada.'}));
 app.use(express.static(path.join(__dirname,'public'),{dotfiles:'deny'}));
 app.use((err,req,res,next)=>{if(res.headersSent)return next(err);if(!err.status)console.error('Erro no servidor:',err.code||err.name);res.status(err.status||500).json({erro:err.status?err.message:'Erro interno. Tente novamente.'});});
 return app;
}
if(require.main===module){const pool=require('./db');pool.query('SELECT 1').then(()=>{const app=createApp({pool});const stopJobs=require('./crm-jobs').startJobs(pool,createMailer(process.env),process.env); const server=app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log(`MIÚDO / FORMI em ${process.env.APP_URL||'http://localhost:3000'}`));process.on('SIGTERM',()=>{stopJobs();server.close(()=>pool.end());});}).catch(e=>{console.error('Não foi possível iniciar:',e.message);process.exitCode=1;pool.end();});}
module.exports={createApp};
