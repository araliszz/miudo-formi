require('dotenv').config();
const fs=require('node:fs');
const {Pool}=require('pg');
function poolOptions(env=process.env){
 const config=env.DATABASE_URL?{connectionString:env.DATABASE_URL}:{};
 if(config.connectionString&&env.PGSSL){const u=new URL(config.connectionString);for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])u.searchParams.delete(key);config.connectionString=u.toString();}
 config.max=Number(env.PG_POOL_MAX||5);
 config.connectionTimeoutMillis=10000;
 config.idleTimeoutMillis=30000;
 // Conexão externa: certificado validado. Render interno usa certificado
 // autoassinado, explicitamente restrito ao hostname privado do provedor.
 if(env.PGSSL==='true')config.ssl={rejectUnauthorized:true,...(env.PGSSL_CA_FILE?{ca:fs.readFileSync(env.PGSSL_CA_FILE,'utf8')}:{})};
 if(env.PGSSL==='render-internal'){if(!env.DATABASE_URL||!/^dpg-[a-z0-9-]+$/.test(new URL(env.DATABASE_URL).hostname))throw new Error('render-internal permitido somente para hostname PostgreSQL privado dpg-*.');config.ssl={rejectUnauthorized:false};}
 return config;
}
const pool=new Pool(poolOptions());pool.on('error',e=>console.error('Falha na conexão PostgreSQL:',e.code||'indisponível'));
module.exports=pool;module.exports.poolOptions=poolOptions;
