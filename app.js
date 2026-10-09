'use strict';
const config=window.ITBS_CONFIG, live=Boolean(config.supabaseUrl&&config.supabaseKey);
const catalog=[['yoga','Yoga','❀',60,30,'Respirez, étirez-vous et prenez un moment pour vous.','#eee6f0'],['padel','Padel','◈',8,15,'Le plaisir du jeu, les premiers échanges en équipe.','#f8ead7'],['volley','Volley','◉',10,15,'Un terrain, une équipe, une énergie collective.','#e1ede9'],['golf','Golf','⚑',15,15,'Découvrez le swing et relevez un nouveau défi.','#e7edce'],['arc','Tir à l’arc','◎',10,15,'Concentration, précision… à vous de viser.','#f7e0d5'],['peinture','Peinture','✳',10,15,'Des couleurs, des idées, un moment pour créer.','#e4e7f4']];
let slots=catalog.flatMap(([activity,name,icon,capacity,duration])=>Array.from({length:90/duration},(_,i)=>({id:activity+'-'+(600+i*duration),activity,name,start:600+i*duration,end:600+(i+1)*duration,capacity,remaining:capacity}))),chosen=[],step=1,busy=false,ready=false;
const $=id=>document.getElementById(id),time=m=>`${Math.floor(m/60)} h ${String(m%60).padStart(2,'0')}`,range=s=>`${time(s.start)} – ${time(s.end)}`,conflict=(a,b)=>a.start<b.end&&b.start<a.end;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function rpc(name,data){const res=await fetch(config.supabaseUrl.replace(/\/$/,'')+'/rest/v1/rpc/'+name,{method:'POST',...(typeof AbortSignal!=='undefined'&&AbortSignal.timeout?{signal:AbortSignal.timeout(15000)}:{}),headers:{apikey:config.supabaseKey,'Content-Type':'application/json'},body:JSON.stringify(data)});let value;try{value=await res.json()}catch{throw Error('Réponse indisponible. Veuillez réessayer.')}if(!res.ok)throw Error(value.message||'Connexion impossible. Veuillez réessayer.');return value;}
function render(){
$('activities').innerHTML=catalog.map(([id,name,icon,cap,duration,desc,tint])=>`<article class="activity ${chosen.some(s=>s.activity===id)?'selected':''}"><div class="activity-top"><span class="icon" style="--tint:${tint}" aria-hidden="true">${icon}</span><div><h3>${name}</h3><small>${duration} min · ${cap} places par séance</small></div></div><p>${desc}</p><div class="slot-heading"><span>CHOISIR UN CRÉNEAU</span><span>${duration} MIN</span></div><div class="slots">${slots.filter(s=>s.activity===id).map(s=>{const selected=chosen.some(c=>c.id===s.id),blocked=chosen.some(c=>c.activity!==id&&conflict(c,s)),full=s.remaining<=0;return `<button class="slot" data-slot="${s.id}" aria-pressed="${selected}" ${(!ready||((blocked||full)&&!selected))?'disabled':''}><span class="slot-time">${time(s.start)} <span class="slot-arrow">→</span> ${time(s.end)}</span><small>${selected?'✓ Votre choix':!ready?(live?'Vérification…':'Non disponible'):full?'Complet':blocked?'Horaire occupé':s.remaining+' place'+(s.remaining>1?'s':'')+' restante'+(s.remaining>1?'s':'')}</small></button>`}).join('')}</div></article>`).join('');
$('choices').innerHTML=chosen.length?[...chosen].sort((a,b)=>a.start-b.start).map(s=>`<div class="choice"><div><b>${esc(s.name)}</b><small>${range(s)}</small></div>${step===1?`<button class="remove" data-remove="${s.id}" aria-label="Retirer ${esc(s.name)}">×</button>`:''}</div>`).join(''):'<div class="empty">Votre programme commence ici.<br>Choisissez un premier créneau.</div>';
$('count').textContent=chosen.length?`${chosen.length} activité${chosen.length>1?'s':''} · ${chosen.reduce((n,s)=>n+s.end-s.start,0)} min`:'Aucune activité sélectionnée';$('continue').disabled=!chosen.length||!ready;$('continue').hidden=step!==1;
}
$('activities').addEventListener('click',e=>{const b=e.target.closest('[data-slot]');if(!b||b.disabled)return;const s=slots.find(s=>s.id===b.dataset.slot),has=chosen.some(c=>c.id===s.id);chosen=chosen.filter(c=>c.activity!==s.activity);if(!has)chosen.push({...s});render();});
$('choices').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(b){chosen=chosen.filter(s=>s.id!==b.dataset.remove);render()}});
function changeStep(next){step=next;$('selection').hidden=next!==1;$('identity').hidden=next!==2;$('success').hidden=next!==3;$('summary').hidden=next===3;document.querySelectorAll('.steps li').forEach((el,i)=>el.classList.toggle('current',i+1===next));render();document.querySelector('.workspace').scrollIntoView({behavior:'smooth',block:'start'});}
$('continue').onclick=()=>changeStep(2);$('back').onclick=()=>{if(!busy)changeStep(1)};
let requestId=crypto.randomUUID(),humanChallenge=null,humanLoading=false,humanGeneration=0;
$('student-form').onsubmit=async e=>{e.preventDefault();if(busy||!chosen.length)return;if(!live||!ready){$('error').textContent='Les réservations sont momentanément indisponibles. Réessayez dans quelques instants.';return;}busy=true;$('submit').disabled=true;$('back').disabled=true;$('error').textContent='';try{const f=Object.fromEntries(new FormData(e.target));if(!/^\+?[0-9]{8,15}$/.test(f.phone.trim().replace(/[\s().-]/g,'')))throw Error('Indiquez un numéro de téléphone valide (ex. : 20 123 456 ou +216 20 123 456).');if(!$('human-check').checked||!humanChallenge||humanLoading)throw Error('Cochez « Je ne suis pas un robot » et répondez à la question.');const receipt=await rpc('reserve_checked',{p_first_name:f.first_name,p_last_name:f.last_name,p_email:f.email,p_phone:f.phone,p_slots:chosen.map(s=>s.id),p_request:requestId,p_challenge:humanChallenge.id,p_answer:$('human-answer').value.trim()});if(receipt?.error){if(receipt.code==='challenge_expired')await loadHumanChallenge();else if(receipt.code==='challenge_wrong')$('human-answer').focus();throw Error(receipt.error)}if(!receipt||typeof receipt.reference!=='string'||!receipt.reference)throw Error('Confirmation non reçue. Réessayez sans changer vos choix.');$('ticket').innerHTML=`<b>${esc(f.first_name)} ${esc(f.last_name)}</b><p class="muted">Dimanche 11 octobre 2026 · Club Yasmine Golf<br>Référence : ${esc(receipt.reference)}</p>`+[...chosen].sort((a,b)=>a.start-b.start).map(s=>`<div class="choice"><b>${esc(s.name)}</b><span>${range(s)}</span></div>`).join('');showReceiptQR(receipt.reference);$('success-note').textContent='Vos places sont enregistrées. Gardez une capture de ce reçu ou enregistrez-le en PDF pour présenter votre QR au coach.';changeStep(3);$('success').focus();}catch(err){$('error').textContent=err.message;await refresh();}finally{busy=false;$('submit').disabled=false;$('back').disabled=false}};
async function refresh(){if(!live||step===3||document.hidden)return;try{const data=await rpc('availability',{});if(!Array.isArray(data)||data.length!==slots.length||!slots.every(s=>data.some(d=>d.id===s.id&&Number.isInteger(d.remaining)&&d.remaining>=0&&d.remaining<=s.capacity)))throw Error('Planning indisponible. Contactez l’équipe ITBS.');slots=slots.map(s=>({...s,...data.find(x=>x.id===s.id)}));ready=true;$('mode').textContent='';render();}catch(e){ready=false;$('mode').textContent='Connexion indisponible : les réservations sont suspendues. Réessayez dans quelques instants.';render()}}
$('mode').textContent=live?'Chargement des disponibilités…':'Les réservations ne sont pas encore disponibles. Merci de revenir dans quelques instants.';render();refresh();setInterval(()=>{if(!busy)refresh()},25000);

function showReceiptQR(reference){
 const area=document.createElement('div');area.className='receipt-qr';
 try{const qr=qrcode(0,'M');qr.addData('ITBS1:'+reference);qr.make();area.innerHTML=qr.createSvgTag({cellSize:6,margin:24,scalable:true})+'<p>Mon QR de présence</p><small>À présenter au coach pour chaque activité réservée.</small>';}catch{area.textContent='Conservez ce reçu : le coach peut aussi vous retrouver par votre nom.';}
 $('ticket').appendChild(area);
}

$('print-receipt').onclick=()=>window.print();

async function loadHumanChallenge(){
 const generation=++humanGeneration;humanChallenge=null;humanLoading=true;
 $('human-answer').value='';$('human-answer').disabled=true;$('human-retry').disabled=true;
 $('human-status').textContent='Chargement de la vérification…';$('human-question').textContent='…';
 try{
  const value=await rpc('registration_challenge',{p_request:requestId});
  if(generation!==humanGeneration||!$('human-check').checked)return;
  if(!value||typeof value.id!=='string'||typeof value.question!=='string')throw Error('Vérification indisponible. Réessayez.');
  humanChallenge=value;$('human-question').textContent=value.question;$('human-status').textContent='';$('human-answer').disabled=false;$('human-answer').focus();
 }catch(e){if(generation===humanGeneration)$('human-status').textContent='Vérification indisponible. Cliquez sur « Recharger la vérification ».';}
 finally{if(generation===humanGeneration){humanLoading=false;$('human-retry').disabled=false;}}
}
$('human-check').onchange=()=>{
 $('human-challenge').hidden=!$('human-check').checked;$('human-answer').required=$('human-check').checked;
 if($('human-check').checked){void loadHumanChallenge();}else{humanGeneration++;humanLoading=false;humanChallenge=null;$('human-answer').value='';$('human-answer').disabled=true;}
};
$('human-retry').onclick=()=>{if(!busy&&!humanLoading)void loadHumanChallenge();};
