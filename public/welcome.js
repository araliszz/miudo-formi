'use strict';
$('welcome-next').onclick=()=>{setAuth('login');screen('auth');window.scrollTo(0,0);};
const feedbackDialog=$('feedback-dialog'),feedbackForm=$('feedback-form');
function resetFeedback(){feedbackForm.reset();feedbackForm.classList.add('hidden');$('feedback-types').classList.remove('hidden');$('feedback-result').classList.add('hidden');$('feedback-email-label').classList.add('hidden');feedbackForm.email.required=false;updateFeedbackStars();}
$('welcome-feedback').onclick=()=>{resetFeedback();feedbackDialog.showModal();};
for(const id of ['feedback-close','feedback-cancel'])$(id).onclick=()=>feedbackDialog.close();
$('feedback-back').onclick=()=>{feedbackForm.classList.add('hidden');$('feedback-types').classList.remove('hidden');};
for(const b of document.querySelectorAll('[data-feedback-kind]'))b.onclick=()=>{feedbackForm.tipo.value=b.dataset.feedbackKind;$('feedback-kind-label').textContent={elogio:'Um elogio',problema:'Um problema',sugestao:'Uma sugestão'}[b.dataset.feedbackKind];$('feedback-types').classList.add('hidden');feedbackForm.classList.remove('hidden');feedbackForm.texto.focus();};
function updateFeedbackStars(){const selected=Number(feedbackForm.querySelector('[name="nota"]:checked')?.value||0);feedbackForm.querySelectorAll('.feedback-rating label').forEach((label,i)=>{label.classList.toggle('is-rated',i<selected);label.querySelector('[aria-hidden]').textContent=i<selected?'★':'☆';});}
feedbackForm.querySelectorAll('[name="nota"]').forEach(r=>r.onchange=updateFeedbackStars);
$('feedback-contact').onchange=e=>{$('feedback-email-label').classList.toggle('hidden',!e.target.checked);feedbackForm.email.required=e.target.checked;};
submit('feedback-form',async f=>{const b=data(f);b.nota=Number(b.nota);b.permitir_contato=$('feedback-contact').checked;if(!b.permitir_contato)delete b.email;const r=await api('/api/feedback',{method:'POST',body:b});feedbackForm.classList.add('hidden');$('feedback-result').textContent=r.mensagem;$('feedback-result').classList.remove('hidden');});
$('refresh-feedback').onclick=()=>loadPlatform().catch(e=>toast(e.message));
if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){document.querySelectorAll('.trail-marcher').forEach(g=>{g.querySelector('animateMotion')?.remove();g.setAttribute('transform',g.dataset.rest);});}
