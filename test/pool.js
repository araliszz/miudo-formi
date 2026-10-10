// Engine PostgreSQL embutido para testes. Produção usa pg + servidor PostgreSQL.
const {PGlite}=require('@electric-sql/pglite');
async function createTestPool(){const db=new PGlite();await db.waitReady;
 let tail=Promise.resolve();
 async function acquire(){let release;const old=tail;tail=new Promise(r=>release=r);await old;return release;}
 const query=async(sql,args=[])=>{const r=await db.query(sql,args);return {rows:r.rows,rowCount:r.rows.length || r.affectedRows || 0};};
 return {db,query:async(sql,args)=>{const release=await acquire();try{return await query(sql,args);}finally{release();}},connect:async()=>{const release=await acquire();return {query,release};},end:()=>db.close()};}
module.exports={createTestPool};
