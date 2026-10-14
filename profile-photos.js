'use strict';
const D=require('./domain');
const MAX_BYTES=768*1024;
function parsePhoto(body){
 const text=body?.imagem;
 if(typeof text!=='string'||text.length>MAX_BYTES*4/3+200)D.fail('A imagem deve ter até 768 KB após o ajuste.');
 const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(text);
 if(!match||match[2].length%4!==0)D.fail('Envie uma imagem JPG, PNG ou WebP válida.');
 const bytes=Buffer.from(match[2],'base64');
 if(!bytes.length||bytes.length>MAX_BYTES||bytes.toString('base64')!==match[2])D.fail('Imagem inválida ou muito grande.');
 const mime=match[1],png=Buffer.from('89504e470d0a1a0a','hex');
 const good=mime==='image/jpeg'?bytes.length>4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217:mime==='image/png'?bytes.length>=33&&bytes.subarray(0,8).equals(png)&&bytes.toString('ascii',12,16)==='IHDR':bytes.length>=20&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(bytes.toString('ascii',12,16));
 if(!good)D.fail('O conteúdo do arquivo não corresponde a uma imagem válida.');
 return {bytes,mime};
}
function install(app,router,{pool,auth,verified,admin,wrap}){
 function routes(host,prefix,guards,table,key,getId){
  host.get(prefix+'/info',...guards,wrap(async(req,res)=>{const row=(await pool.query(`SELECT atualizado_em FROM ${table} WHERE ${key}=$1`,[getId(req)])).rows[0];res.json({tem_foto:!!row,atualizado_em:row?.atualizado_em||null});}));
  host.get(prefix,...guards,wrap(async(req,res)=>{const row=(await pool.query(`SELECT imagem,mime FROM ${table} WHERE ${key}=$1`,[getId(req)])).rows[0];if(!row)D.fail('Nenhuma foto cadastrada.',404);res.set({'Content-Type':row.mime,'Content-Length':Buffer.from(row.imagem).length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(Buffer.from(row.imagem));}));
  const edit=table==='empresa_fotos'?[...guards,admin]:guards;
  host.put(prefix,...edit,wrap(async(req,res)=>{const photo=parsePhoto(req.body);const row=(await pool.query(`INSERT INTO ${table}(${key},imagem,mime) VALUES($1,$2,$3) ON CONFLICT(${key}) DO UPDATE SET imagem=EXCLUDED.imagem,mime=EXCLUDED.mime,atualizado_em=now() RETURNING atualizado_em`,[getId(req),photo.bytes,photo.mime])).rows[0];res.json({mensagem:'Foto atualizada.',tem_foto:true,atualizado_em:row.atualizado_em});}));
  host.delete(prefix,...edit,wrap(async(req,res)=>{await pool.query(`DELETE FROM ${table} WHERE ${key}=$1`,[getId(req)]);res.json({mensagem:'Foto removida.',tem_foto:false,atualizado_em:null});}));
 }
 routes(app,'/api/perfil/foto',[auth,verified],'usuario_fotos','usuario_id',r=>r.user.id);
 routes(router,'/foto',[],'empresa_fotos','empresa_id',r=>r.company.id);
}
module.exports={install,parsePhoto};
