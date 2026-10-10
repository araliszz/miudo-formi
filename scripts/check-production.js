require('dotenv').config();
const nodemailer=require('nodemailer');const {smtpConfig}=require('../mail');const pool=require('../db');
(async()=>{let failed=false;const required=['DATABASE_URL','SESSION_SECRET','APP_URL','OWNER_EMAIL','SMTP_HOST','SMTP_USER','SMTP_PASS','MAIL_FROM'];
 for(const key of required){const value=process.env[key];if(!value||/SUBSTITUA|COLOQUE|SEU_|seu-email|example\.com/.test(value)){console.error(`${key}: falta valor real.`);failed=true;}}
 if(process.env.NODE_ENV!=='production'){console.error('NODE_ENV precisa ser production.');failed=true;}
 if(!['true','render-internal'].includes(process.env.PGSSL)){console.error('Produção exige PGSSL=true ou render-internal para conexão criptografada.');failed=true;}
 if(process.env.MAIL_MODE!=='smtp'){console.error('MAIL_MODE precisa ser smtp.');failed=true;}
 if(!/^https:\/\//.test(process.env.APP_URL||'')){console.error('APP_URL precisa usar HTTPS.');failed=true;}
 if((process.env.SESSION_SECRET||'').length<64){console.error('Use SESSION_SECRET com pelo menos 64 caracteres aleatórios.');failed=true;}
 if(!failed){try{await pool.query('SELECT id FROM usuarios LIMIT 1');await pool.query('SELECT id FROM auditoria LIMIT 1');console.log('PostgreSQL e schema: OK.');}catch(e){console.error('PostgreSQL/schema: falhou ('+(e.code||'configuração')+').');failed=true;}
 try{await nodemailer.createTransport(smtpConfig(process.env)).verify();console.log('Conexão e autenticação SMTP: OK. Isto não prova entrega na caixa de entrada.');}catch(e){console.error('SMTP: falhou ('+(e.code||'configuração')+').');failed=true;}}
 await pool.end();if(failed)process.exitCode=1;else console.log('Configuração técnica conferida. Complete os testes de entrega, HTTPS, isolamento e restauração do roteiro.');})().catch(()=>{console.error('Falha na conferência.');process.exitCode=1;pool.end();});
