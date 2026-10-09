'use strict';
const cfg=window.ITBS_CONFIG,$=id=>document.getElementById(id),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let token='',rows=[],sessionGeneration=0,idleTimer,expiryTimer;let lastActivity=0;const hour=m=>`${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`;
async function request(path,body){const generation=sessionGeneration;const r=await fetch(cfg.supabaseUrl.replace(/\/$/,'')+path,{method:'POST',cache:'no-store',...(typeof AbortSignal!=='undefined'&&AbortSignal.timeout?{signal:AbortSignal.timeout(15000)}:{}),headers:{apikey:cfg.supabaseKey,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});const raw=await r.text();let v=null;try{v=raw?JSON.parse(raw):null}catch{throw Error('Réponse du serveur illisible. Réessayez.');}if(generation!==sessionGeneration)throw Error('Session fermée. Reconnectez-vous.');if(r.status===401&&token)clearSession('Votre session a expiré. Reconnectez-vous.');if(!r.ok)throw Error(v?.message||v?.msg||'Connexion impossible.');return v}
$('login').onsubmit=async e=>{e.preventDefault();$('error').textContent='';const b=e.target.querySelector('button');b.disabled=true;try{if(!cfg.supabaseUrl||!cfg.supabaseKey)throw Error('Connexion momentanément indisponible. Contactez l’organisateur.');const f=new FormData(e.target),v=await request('/auth/v1/token?grant_type=password',{email:f.get('email'),password:f.get('password')});token=v.access_token;e.target.reset();armSession(v.expires_in);await load();$('login').hidden=true;$('dashboard').hidden=false;}catch(e){clearSession();$('error').textContent=e.message}finally{e.target.reset();b.disabled=false}};
async function load(){rows=await request('/rest/v1/rpc/coach_list',{});const old=$('activity').value,oldSlot=$('slot').value;$('activity').innerHTML='<option value="">Toutes mes activités</option>'+[...new Set(rows.map(r=>r.activity))].map(a=>`<option>${esc(a)}</option>`).join('');$('activity').value=old;$('slot').innerHTML='<option value="">Tous les créneaux</option>'+[...new Set(rows.map(r=>r.start))].sort((a,b)=>a-b).map(s=>`<option value="${s}">${hour(s)}</option>`).join('');$('slot').value=oldSlot;draw();$('status').textContent='Liste actualisée à '+new Date().toLocaleTimeString('fr-FR');}
function filtered(){return rows.filter(r=>(!$('activity').value||r.activity===$('activity').value)&&(!$('slot').value||r.start===Number($('slot').value)))}
function draw(){$('rows').innerHTML=filtered().map(r=>`<tr><td><b>${esc(r.first_name)} ${esc(r.last_name)}</b><br>${esc(r.email)}</td><td><div class="attendance-buttons" role="group" aria-label="Présence de ${esc(r.first_name+' '+r.last_name)}">${[['present','P','Présent',true],['absent','A','Absent',false],['unmarked','—','Non renseigné',null]].map(([value,label,title,state])=>`<button type="button" class="attendance-button ${value}" data-id="${r.id}" data-state="${value}" aria-label="${title}" title="${title}" aria-pressed="${state===null?r.present==null:r.present===state}">${label}</button>`).join('')}</div></td><td>${esc(r.phone||'—')}</td><td>${esc(r.activity)}</td><td>${hour(r.start)}–${hour(r.end)}</td></tr>`).join('');$('stats').textContent=`${filtered().length} réservation(s) · ${filtered().filter(r=>r.present===true).length} présent(s) · ${filtered().filter(r=>r.present===false).length} absent(s) · ${filtered().filter(r=>r.present==null).length} non renseigné(s)`;}

$('activity').onchange=()=>{stopScanner();draw()};$('slot').onchange=()=>{stopScanner();draw()};$('refresh').onclick=()=>load().catch(e=>$('error').textContent=e.message);$('logout').onclick=()=>clearSession('Vous êtes déconnecté.');
const pendingAttendance=new Set();
$('rows').onclick=async e=>{const el=e.target.closest('button[data-state]');if(!el||scanSubmitting)return;const id=Number(el.dataset.id),row=rows.find(r=>r.id===id);if(!row||pendingAttendance.has(id))return;const next=el.dataset.state==='present'?true:el.dataset.state==='absent'?false:null;if(row.present===next)return;pendingAttendance.add(id);const buttons=el.parentElement.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);$('error').textContent='';try{await request('/rest/v1/rpc/mark_present',{p_id:id,p_present:next});const current=rows.find(r=>r.id===id);if(current)current.present=next;draw()}catch(e){$('error').textContent=e.message}finally{pendingAttendance.delete(id);buttons.forEach(b=>b.disabled=false)}};
$('export').onclick=()=>{const safe=v=>'"'+String(v??'').replace(/^(?:[\s]*[=+@\-]|[\t\r\n])/,"'"+'$&').replaceAll('"','""')+'"';const values=[['Prénom','Nom','Email','Téléphone','Activité','Début','Fin','Présence'],...filtered().map(r=>[r.first_name,r.last_name,r.email,r.phone,r.activity,hour(r.start),hour(r.end),r.present===true?'Présent':r.present===false?'Absent':''])];const url=URL.createObjectURL(new Blob(['\ufeff'+values.map(r=>r.map(safe).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='ITBS-participants.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)};

function clearSession(message=''){
 stopScanner();sessionGeneration++;token='';rows=[];clearTimeout(idleTimer);clearTimeout(expiryTimer);
 $('rows').innerHTML='';$('activity').innerHTML='';$('slot').innerHTML='';$('stats').textContent='';
 $('dashboard').hidden=true;$('login').hidden=false;$('login').reset();$('status').textContent=message;$('scan-result').textContent='';
}
function touchSession(){
 if(!token)return;
 if(lastActivity&&Date.now()-lastActivity>=15*60*1000){clearSession('Session fermée après 15 minutes d’inactivité.');return;}
 lastActivity=Date.now();clearTimeout(idleTimer);idleTimer=setTimeout(()=>clearSession('Session fermée après 15 minutes d’inactivité.'),15*60*1000);
}
function armSession(seconds){lastActivity=0;touchSession();clearTimeout(expiryTimer);expiryTimer=setTimeout(()=>clearSession('Votre session a expiré. Reconnectez-vous.'),Math.max(1,Number(seconds)||3600)*1000);}
['pointerdown','keydown'].forEach(event=>document.addEventListener(event,touchSession,{passive:true}));
window.addEventListener('pagehide',()=>clearSession());

let cameraStream=null,scanEpoch=0,scanFrame=0,scanSubmitting=false;
function scanMessage(message,kind=''){$('scan-result').textContent=message;$('scan-result').dataset.kind=kind;}
function stopScanner(){
 scanEpoch++;if(scanFrame)cancelAnimationFrame(scanFrame);scanFrame=0;
 if(cameraStream)cameraStream.getTracks().forEach(track=>track.stop());cameraStream=null;
 $('scan-video').srcObject=null;$('scan-view').hidden=true;$('scan-stop').hidden=true;
 $('scan-start').disabled=scanSubmitting;
}
function selectedScanSlot(){
 if(!$('activity').value||!$('slot').value)throw Error('Choisissez une activité et un créneau avant de scanner.');
 const selected=filtered(),ids=[...new Set(selected.map(r=>r.slot_id).filter(Boolean))];
 if(!selected.length)throw Error('Aucun participant dans cette séance. Actualisez la liste si nécessaire.');
 if(ids.length!==1)throw Error('Le scan nécessite la mise à jour SQL. Contactez l’organisateur.');
 return ids[0];
}
async function submitScan(payload,slot){
 if(scanSubmitting||!token)return;
 const match=/^ITBS1:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(payload);
 if(!match){scanMessage('QR non reconnu. Présentez le QR du reçu ITBS.','error');return;}
 if(pendingAttendance.size){scanMessage('Un pointage est en cours. Réessayez dans un instant.','error');return;}
 const generation=sessionGeneration;scanSubmitting=true;$('scan-start').disabled=true;
 scanMessage('Vérification et enregistrement…');
 try{
  const result=await request('/rest/v1/rpc/check_in_qr',{p_reference:match[1],p_slot:slot});
  if(!result||!result.id)throw Error('Confirmation non reçue. Vous pouvez scanner à nouveau sans créer de doublon.');
  const row=rows.find(r=>r.id===result.id);if(row)row.present=true;draw();touchSession();
  scanMessage(`${result.already_present?'Déjà présent':'Présence enregistrée'} : ${result.first_name} ${result.last_name} · ${result.activity} · ${hour(result.start)}–${hour(result.end)}`,result.already_present?'repeat':'success');
 }catch(e){if(generation===sessionGeneration)scanMessage(e.message,'error');}
 finally{scanSubmitting=false;$('scan-start').disabled=false;$('scan-start').textContent='Scanner le suivant';}
}
$('scan-start').onclick=async()=>{
 if(scanSubmitting)return;stopScanner();let selected;
 try{selected=selectedScanSlot();if(!navigator.mediaDevices?.getUserMedia||typeof jsQR!=='function')throw Error('Caméra indisponible. Utilisez les boutons P / A / —.');}
 catch(e){scanMessage(e.message,'error');return;}
 const epoch=scanEpoch;$('scan-start').disabled=true;$('scan-stop').hidden=false;scanMessage('Autorisez la caméra puis présentez le QR du participant.');
 try{
  const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:640},height:{ideal:480}},audio:false});
  if(epoch!==scanEpoch||!token){stream.getTracks().forEach(t=>t.stop());return;}
  cameraStream=stream;const video=$('scan-video');video.srcObject=stream;$('scan-view').hidden=false;await video.play();
  if(epoch!==scanEpoch)return;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Lecture caméra indisponible.');let last=0;
  const frame=timestamp=>{
   if(epoch!==scanEpoch)return;
   try{if(timestamp-last>=200&&video.readyState>=2){last=timestamp;
    const scale=Math.min(1,640/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
    if(canvas.width&&canvas.height){ctx.drawImage(video,0,0,canvas.width,canvas.height);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);const code=jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'dontInvert'});
     if(code){stopScanner();void submitScan(code.data,selected);return;}}
   }}catch{stopScanner();scanMessage('Lecture impossible. Réessayez ou utilisez les boutons de présence.','error');return;}
   scanFrame=requestAnimationFrame(frame);
  };scanFrame=requestAnimationFrame(frame);
 }catch(e){if(epoch===scanEpoch){stopScanner();scanMessage(e.name==='NotAllowedError'?'Caméra refusée. Autorisez-la dans le navigateur ou utilisez les boutons P / A / —.':'Caméra indisponible. Fermez les autres applications caméra ou utilisez les boutons P / A / —.','error');}}
};
$('scan-stop').onclick=()=>{stopScanner();scanMessage('Caméra fermée.');};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopScanner();});
