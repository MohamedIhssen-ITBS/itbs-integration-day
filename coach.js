'use strict';
const cfg=window.ITBS_CONFIG,$=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hour=m=>`${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}`,PAGE_SIZE=15,STORAGE_KEY='itbs-team-session-v2',PREFERENCE_KEY='itbs-team-remember';
let token='',userId='',rows=[],schedule=[],page=1,sessionGeneration=0,writeVersion=0,loading=false,dirty=false,pollTimer,loadTimer,channel=null,realtimeReady=false,lastSync=0,blockedSession=false;
let cameraStream=null,scanEpoch=0,scanFrame=0,scanSubmitting=false;
const pendingAttendance=new Set(),memoryStorage=new Map();
const safeStorage=(store,method,...args)=>{try{return window[store][method](...args)}catch{return null}};
let remember=safeStorage('localStorage','getItem',PREFERENCE_KEY)==='true';$('remember').checked=remember;
const storage={getItem:key=>safeStorage(remember?'localStorage':'sessionStorage','getItem',key)||memoryStorage.get(key)||null,setItem(key,value){memoryStorage.set(key,value);safeStorage(remember?'localStorage':'sessionStorage','setItem',key,value)},removeItem(key){memoryStorage.delete(key);safeStorage('localStorage','removeItem',key);safeStorage('sessionStorage','removeItem',key)}};
const client=window.ITBSCreateClient(cfg.supabaseUrl,cfg.supabaseKey,{auth:{storage,storageKey:STORAGE_KEY,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
function setSync(){const offline=typeof navigator!=='undefined'&&navigator.onLine===false;const badge=$('sync-indicator');badge.dataset.state=offline?'offline':realtimeReady?'live':'fallback';badge.textContent=offline?'Hors connexion':realtimeReady?'● En direct':'Actualisation auto';}
async function request(path,body){
 const generation=sessionGeneration,name=path.split('/').pop();let query=client.rpc(name,body);
 if(typeof AbortSignal!=='undefined'&&AbortSignal.timeout)query=query.abortSignal(AbortSignal.timeout(15000));
 const {data,error}=await query;if(generation!==sessionGeneration)throw Error('Session fermée. Reconnectez-vous.');if(error)throw error;return data;
}
function filtered(){return rows.filter(r=>r.activity===$('activity').value&&(!$('slot').value||r.slot_id===$('slot').value))}
function rebuildFilters(){
 const oldActivity=$('activity').value,oldSlot=$('slot').value,activities=[...new Set(schedule.map(s=>s.activity))];
 const activity=activities.includes(oldActivity)?oldActivity:activities.includes('Golf')?'Golf':activities[0]||'';
 const html=activities.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('');if($('activity').innerHTML!==html)$('activity').innerHTML=html;$('activity').value=activity;
 const slots=schedule.filter(s=>s.activity===activity),slotHTML='<option value="">Tous les créneaux</option>'+slots.map(s=>`<option value="${esc(s.id)}">${hour(s.start)} – ${hour(s.end)}</option>`).join('');
 if($('slot').innerHTML!==slotHTML)$('slot').innerHTML=slotHTML;$('slot').value=slots.some(s=>s.id===oldSlot)?oldSlot:'';
 if(activity!==oldActivity||$('slot').value!==oldSlot){page=1;stopScanner();}
}
function draw(){
 const list=filtered(),pages=Math.max(1,Math.ceil(list.length/PAGE_SIZE));page=Math.max(1,Math.min(page,pages));
 const html=list.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE).map(r=>`<tr><td>${esc(r.first_name)} ${esc(r.last_name)}</td><td><div class="attendance-buttons" role="group" aria-label="Présence de ${esc(r.first_name+' '+r.last_name)}">${[['present','P','Présent',true],['absent','A','Absent',false],['unmarked','—','Non renseigné',null]].map(([value,label,title,state])=>`<button type="button" class="attendance-button ${value}" data-id="${r.id}" data-state="${value}" aria-label="${title}" title="${title}" ${pendingAttendance.has(r.id)||scanSubmitting?'disabled':''} aria-pressed="${state===null?r.present==null:r.present===state}">${label}</button>`).join('')}</div></td></tr>`).join('')||'<tr><td colspan="2" class="empty-table">Aucun participant pour cette sélection.</td></tr>';
 if($('rows').innerHTML!==html){const focus=document.activeElement?.dataset;$('rows').innerHTML=html;if(focus?.id&&focus?.state)$('rows').querySelector(`[data-id="${Number(focus.id)}"][data-state="${focus.state}"]`)?.focus({preventScroll:true});}
 $('stats').innerHTML=`<span>${list.length} participant${list.length>1?'s':''}</span><span>${list.filter(r=>r.present===true).length} présent(s)</span><span>${list.filter(r=>r.present===false).length} absent(s)</span><span>${list.filter(r=>r.present==null).length} non renseigné(s)</span>`;
 $('page-info').textContent=list.length?`${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,list.length)} sur ${list.length} · ${page}/${pages}`:'0 participant';$('previous').disabled=page<=1;$('next').disabled=page>=pages;
}
function queueLoad(delay=100){if(!token||document.hidden)return;dirty=true;clearTimeout(loadTimer);loadTimer=setTimeout(()=>void load(),delay);}
function armPoll(){clearTimeout(pollTimer);if(token&&!document.hidden)pollTimer=setTimeout(()=>void load(),realtimeReady?10000:3000);}
async function load(){
 if(!token||document.hidden)return;if(loading||pendingAttendance.size||scanSubmitting){dirty=true;return;}
 const generation=sessionGeneration,version=writeVersion;loading=true;dirty=false;$('refresh').disabled=true;
 try{
  const data=await request('/rest/v1/rpc/coach_snapshot',{});if(generation!==sessionGeneration)return;
  if(version!==writeVersion||pendingAttendance.size||scanSubmitting){dirty=true;return;}
  if(!data||!Array.isArray(data.rows)||!Array.isArray(data.slots))throw Error('Liste reçue incomplète. Réessayez.');
  rows=data.rows;schedule=data.slots;rebuildFilters();draw();lastSync=Date.now();$('sync-time').textContent='Mis à jour à '+new Date(lastSync).toLocaleTimeString('fr-FR');$('status').textContent='';setSync();
 }catch(e){if(generation===sessionGeneration){if(/Aucun accès/.test(e.message||'')){rows=[];schedule=[];rebuildFilters();draw();}$('sync-time').textContent='Synchronisation interrompue — nouvel essai automatique';$('sync-indicator').dataset.state='offline';$('sync-indicator').textContent='À reconnecter';$('status').textContent=lastSync?'La liste peut être ancienne. Vérifiez votre connexion.':'Chargement impossible. Vérifiez la connexion et la mise à jour SQL équipe.';}}
 finally{if(generation===sessionGeneration){loading=false;$('refresh').disabled=false;if(token){armPoll();if(dirty)queueLoad(150);}}}
}
async function startRealtime(generation){
 try{await client.realtime.setAuth(token);if(generation!==sessionGeneration||channel)return;
  channel=client.channel('itbs-team',{config:{private:true}}).on('broadcast',{event:'changed'},()=>queueLoad()).subscribe(status=>{
   if(generation!==sessionGeneration)return;realtimeReady=status==='SUBSCRIBED';setSync();armPoll();if(realtimeReady)queueLoad(0);
  });
 }catch{realtimeReady=false;setSync();armPoll();}
}
function clearSession(message=''){
 stopScanner();sessionGeneration++;token='';userId='';rows=[];schedule=[];page=1;writeVersion++;loading=false;dirty=false;lastSync=0;realtimeReady=false;pendingAttendance.clear();clearTimeout(pollTimer);clearTimeout(loadTimer);
 if(channel){const old=channel;channel=null;void client.removeChannel(old);}
 $('rows').innerHTML='';$('stats').innerHTML='';$('activity').innerHTML='';$('slot').innerHTML='';$('account').textContent='';$('scan-result').textContent='';$('dashboard').hidden=true;$('login').hidden=false;$('status').textContent=message;
}
function acceptSession(session){
 if(blockedSession)return;
 if(!session){clearSession();return;}
 if(userId===session.user.id&&token){token=session.access_token;void client.realtime.setAuth(token);return;}
 clearSession();token=session.access_token;userId=session.user.id;$('account').textContent=session.user.email||'';$('login').hidden=true;$('dashboard').hidden=false;$('error').textContent='';
 void load();void startRealtime(sessionGeneration);
}
client.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>acceptSession(session),0);});
$('login').onsubmit=async e=>{
 e.preventDefault();$('error').textContent='';$('login-button').disabled=true;blockedSession=false;
 const form=new FormData(e.target);remember=$('remember').checked;safeStorage('localStorage','setItem',PREFERENCE_KEY,String(remember));
 // Le choix s’applique à la nouvelle session, jamais au mot de passe.
 storage.removeItem(STORAGE_KEY);client.auth.startAutoRefresh();
 try{const {data,error}=await client.auth.signInWithPassword({email:String(form.get('email')).trim(),password:String(form.get('password'))});if(error)throw error;acceptSession(data.session);}
 catch(e){$('error').textContent=e.message||'Connexion impossible.';}
 finally{e.target.elements.password.value='';$('login-button').disabled=false;}
};
$('logout').onclick=async()=>{
 blockedSession=true;$('logout').disabled=true;
 // scope local : ne révoque pas les sessions des autres téléphones.
 try{await client.auth.signOut({scope:'local'});}catch{}
 finally{client.auth.stopAutoRefresh();storage.removeItem(STORAGE_KEY);clearSession('Vous êtes déconnecté de cet appareil.');$('logout').disabled=false;}
};
$('activity').onchange=()=>{stopScanner();$('slot').value='';page=1;rebuildFilters();draw();};$('slot').onchange=()=>{stopScanner();page=1;draw();};
$('previous').onclick=()=>{page--;draw();};$('next').onclick=()=>{page++;draw();};$('refresh').onclick=()=>queueLoad(0);
$('rows').onclick=async e=>{
 const button=e.target.closest('button[data-state]');if(!button||scanSubmitting)return;
 const id=Number(button.dataset.id),row=rows.find(r=>r.id===id);if(!row||pendingAttendance.has(id))return;
 const next=button.dataset.state==='present'?true:button.dataset.state==='absent'?false:null;if(row.present===next)return;
 const generation=sessionGeneration;pendingAttendance.add(id);writeVersion++;draw();$('error').textContent='';
 try{await request('/rest/v1/rpc/mark_present',{p_id:id,p_present:next});const current=rows.find(r=>r.id===id);if(current)current.present=next;}
 catch(e){if(generation===sessionGeneration)$('error').textContent=e.message||'Pointage non confirmé. Réessayez.';}
 finally{pendingAttendance.delete(id);writeVersion++;if(generation===sessionGeneration){draw();queueLoad(0);}}
};
$('export').onclick=()=>{
 const safe=v=>'"'+String(v??'').replace(/^(?:[\s]*[=+@\-]|[\t\r\n])/,"'"+'$&').replaceAll('"','""')+'"';
 const values=[['Prénom','Nom','Activité','Début','Fin','Présence'],...filtered().map(r=>[r.first_name,r.last_name,r.activity,hour(r.start),hour(r.end),r.present===true?'Présent':r.present===false?'Absent':''])];
 const url=URL.createObjectURL(new Blob(['\ufeff'+values.map(r=>r.map(safe).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='ITBS-participants.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
};
function touchSession(){} // Les sessions sont renouvelées par Supabase Auth, sans minuterie d’inactivité locale.
function scanMessage(message,kind=''){$('scan-result').textContent=message;$('scan-result').dataset.kind=kind;}
function stopScanner(){
 scanEpoch++;if(scanFrame)cancelAnimationFrame(scanFrame);scanFrame=0;
 if(cameraStream)cameraStream.getTracks().forEach(track=>track.stop());cameraStream=null;
 $('scan-video').srcObject=null;$('scan-view').hidden=true;$('scan-stop').hidden=true;
 $('scan-start').disabled=scanSubmitting;
}
function selectedScanSlot(){
 const slot=schedule.find(s=>s.id===$('slot').value&&s.activity===$('activity').value);
 if(!slot)throw Error('Choisissez une activité et un créneau avant de scanner.');return slot.id;
}
async function submitScan(payload,slot){
 if(scanSubmitting||!token)return;
 const match=/^ITBS1:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(payload);
 if(!match){scanMessage('QR non reconnu. Présentez le QR du reçu ITBS.','error');return;}
 if(pendingAttendance.size){scanMessage('Un pointage est en cours. Réessayez dans un instant.','error');return;}
 const generation=sessionGeneration;scanSubmitting=true;writeVersion++;draw();$('scan-start').disabled=true;
 scanMessage('Vérification et enregistrement…');
 try{
  const result=await request('/rest/v1/rpc/check_in_qr',{p_reference:match[1],p_slot:slot});
  if(!result||!result.id)throw Error('Confirmation non reçue. Vous pouvez scanner à nouveau sans créer de doublon.');
  const row=rows.find(r=>r.id===result.id);if(row)row.present=true;draw();touchSession();
  scanMessage(`${result.already_present?'Déjà présent':'Présence enregistrée'} : ${result.first_name} ${result.last_name} · ${result.activity} · ${hour(result.start)}–${hour(result.end)}`,result.already_present?'repeat':'success');
 }catch(e){if(generation===sessionGeneration)scanMessage(e.message,'error');}
 finally{scanSubmitting=false;writeVersion++;if(generation===sessionGeneration){draw();queueLoad(0);}$('scan-start').disabled=false;$('scan-start').textContent='Scanner le suivant';}
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
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopScanner();clearTimeout(pollTimer);}else if(token){queueLoad(0);armPoll();}});
window.addEventListener('online',()=>{if(token){queueLoad(0);armPoll();}});
window.addEventListener('offline',setSync);
window.addEventListener('pagehide',()=>{stopScanner();clearTimeout(pollTimer);clearTimeout(loadTimer);});
window.addEventListener('pageshow',()=>{if(token){queueLoad(0);armPoll();}});

