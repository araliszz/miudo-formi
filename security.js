const crypto=require('node:crypto');
// Limites persistem entre deploys e são compartilhados por instâncias.
class PgRateLimitStore {
 constructor(pool,prefix){this.pool=pool;this.prefix=prefix;this.localKeys=false;}
 init(options){this.windowMs=options.windowMs;}
 key(key){return crypto.createHash('base64').update(this.prefix+':'+key).digest('hex');}
 async increment(key){const start=Math.floor(Date.now()/this.windowMs)*this.windowMs;const end=new Date(start+this.windowMs);const q=await this.pool.query(`INSERT INTO security_rate_limits(chave,janela,contador,expira_em) VALUES($1,$2,1,$3) ON CONFLICT(chave,janela) DO UPDATE SET contador=security_rate_limits.contador+1 RETURNING contador`,[this.key(key),String(start),end]);return {totalHits:q.rows[0].contador,resetTime:end};}
 async decrement(key){const start=Math.floor(Date.now()/this.windowMs)*this.windowMs;await this.pool.query('UPDATE security_rate_limits SET contador=GREATEST(0,contador-1) WHERE chave=$1 AND janela=$2',[this.key(key),String(start)]);}
 async resetKey(key){await this.pool.query('DELETE FROM security_rate_limits WHERE chave=$1',[this.key(key)]);}
}
function isOwnerAccount(user,env){return !!user?.email_verificado&&!!env.OWNER_EMAIL&&user.email===env.OWNER_EMAIL.trim().toLowerCase();}
function ownerReady(user,req,env){return isOwnerAccount(user,env)&&req.session.ownerMfaUid===user.id&&Date.now()-req.session.ownerMfaAt<8*3600000;}
function publicUser(user,req,env){return user?{...user,conta_proprietario:isOwnerAccount(user,env),proprietario:ownerReady(user,req,env)}:null;}
async function audit(db,req,event,companyId=null,detail={}){await db.query('INSERT INTO auditoria(usuario_id,empresa_id,evento,detalhes) VALUES($1,$2,$3,$4)',[req.user?.id||req.session.uid||null,companyId,event,JSON.stringify(detail)]);}
module.exports={PgRateLimitStore,isOwnerAccount,ownerReady,publicUser,audit};
