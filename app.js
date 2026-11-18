const $ = id => document.getElementById(id);
const tokenInput = $('token');
tokenInput.value = sessionStorage.getItem('ollyDashboardToken') || '';
function headers(){return {'Content-Type':'application/json','x-dashboard-token':tokenInput.value.trim()};}
async function api(url, options={}){const r=await fetch(url,{...options,headers:{...headers(),...(options.headers||{})}});const data=await r.json().catch(()=>({error:'Invalid server response'}));if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);return data;}
function notice(text,isError=false){$('notice').textContent=text;$('notice').style.color=isError?'#ff8b8b':'#f4b942';}
$('saveToken').onclick=()=>{sessionStorage.setItem('ollyDashboardToken',tokenInput.value.trim());notice('Token saved for this browser tab.');refreshStatus();};
document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll('.tab-content').forEach(x=>x.classList.toggle('hidden',x.id!==btn.dataset.tab));});
async function refreshStatus(){try{const s=await api('/api/status');$('status').classList.toggle('online',s.connected);$('status').innerHTML=`<i></i>${s.connected?'Connected':'Not connected'}`;if(s.connected){$('qrMessage').textContent='WhatsApp is connected.';$('qrImage').classList.add('hidden');}else{$('qrImage').classList.remove('hidden');$('qrMessage').textContent=s.qrAvailable?'QR is ready.':'Waiting for QR code…';}return s;}catch(e){$('status').classList.remove('online');$('status').innerHTML='<i></i> Access required';notice(e.message,true);}}
async function refreshQr(){try{const d=await api('/api/qr');$('qrImage').src=d.qrImage;$('qrImage').classList.remove('hidden');$('qrMessage').textContent='Scan using WhatsApp Linked Devices.';notice('QR code refreshed.');}catch(e){$('qrImage').classList.add('hidden');$('qrMessage').textContent=e.message;notice(e.message,true);}}
$('refreshQr').onclick=refreshQr;$('checkStatus').onclick=async()=>{await refreshStatus();await refreshQr();};
$('generatePair').onclick=async()=>{try{$('generatePair').disabled=true;notice('Generating pairing code…');const d=await api('/api/pair',{method:'POST',body:JSON.stringify({phone:$('phone').value})});$('pairCode').textContent=d.code.match(/.{1,4}/g)?.join(' ')||d.code;$('pairMessage').textContent=d.message;notice('Pairing code generated.');}catch(e){notice(e.message,true);}finally{$('generatePair').disabled=false;}};
$('restart').onclick=async()=>{try{await api('/api/restart',{method:'POST',body:'{}'});notice('Bot restart requested.');setTimeout(refreshStatus,3000);}catch(e){notice(e.message,true);}};
refreshStatus();setInterval(refreshStatus,12000);
