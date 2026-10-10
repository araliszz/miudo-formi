const nodemailer=require('nodemailer');
function smtpConfig(env){return {host:env.SMTP_HOST,port:Number(env.SMTP_PORT||465),secure:env.SMTP_SECURE==='true',requireTLS:env.NODE_ENV==='production'&&env.SMTP_SECURE!=='true',connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,auth:env.SMTP_USER?{user:env.SMTP_USER,pass:env.SMTP_PASS}:undefined};}
function createMailer(env=process.env) {
 const consoleMode=env.MAIL_MODE==='console'&&env.NODE_ENV!=='production';
 if(env.NODE_ENV==='production'&&env.MAIL_MODE!=='smtp')throw new Error('Produção exige MAIL_MODE=smtp.');
 if(!consoleMode&&(!env.SMTP_HOST||!env.SMTP_USER||!env.SMTP_PASS||!env.MAIL_FROM))throw new Error('Preencha SMTP_HOST, SMTP_USER, SMTP_PASS e MAIL_FROM.');
 const transport=consoleMode?null:nodemailer.createTransport(smtpConfig(env));
 return async(email,kind,link)=>{const subject={verificar:'Confirme seu e-mail no FORMI',redefinir:'Redefina sua senha do FORMI',acesso_dono:'Confirme seu acesso de proprietário ao FORMI'}[kind];
 const text=`${subject}\n\nAbra este link: ${link}\n\nO link expira e só pode ser utilizado uma vez. Se você não solicitou, ignore. ${kind==='acesso_dono'?'O acesso do proprietário exige abrir o link no mesmo navegador em que a senha foi informada.':''}`;
 if(consoleMode){console.log(`[E-MAIL LOCAL] ${email} | ${subject}\n${link}`);return;}
 await transport.sendMail({from:env.MAIL_FROM,to:email,subject,text});};
}
module.exports={createMailer,smtpConfig};
