(function(){
  // Fixed chips UI
  const fixedNamesEl = document.getElementById('fixedNames');
  const selectedCountEl = document.getElementById('selectedCount');
  const chipsSelectAllBtn = document.getElementById('chipsSelectAllBtn');
  const chipsClearBtn = document.getElementById('chipsClearBtn');

  const messageEl = document.getElementById('message');

  const resultTableBody = document.querySelector('#resultTable tbody');
  const copyTableBtn = document.getElementById('copyTableBtn');
  const copyMsgEl = document.getElementById('copyMsg');

  // Round (1 minute) elements
  const startRoundBtn = document.getElementById('startRoundBtn');
  const roundStatusEl = document.getElementById('roundStatus');
  const roundRingEl = document.getElementById('roundRing');
  const roundTimerText = document.getElementById('roundTimerText');

  const PRESET_NAMES = [
    'عبيدي',
    'عبدالله نجم',
    'نرجس',
    'شاكر',
    'مصطفى',
    'سجاد',
    'ريام',
    'زهراء',
    'محمد',
    'الحسن',
    'ابراهيم'
  ];
  const LS_KEY = 'scheduler:names:v1'; // legacy (not used now)
  const ROUND_KEY = 'scheduler:round:v1';
  const SCHEDULE_KEY = 'scheduler:schedule:v1';
  const ROUND_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours lock
  let roundTimerId = null;
  const DEFAULT_START = '08:00';
  const DEFAULT_END = '16:30';

  // Firebase Realtime DB (REST) — public rules assumed true
  const DB_URL = 'https://random-14737-default-rtdb.firebaseio.com';
  async function dbGet(path){
    try{
      const r = await fetch(`${DB_URL}${path}.json`);
      return await r.json();
    }catch(e){ return null; }
  }
  async function dbSet(path, data){
    try{
      await fetch(`${DB_URL}${path}.json`, { method: 'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      return true;
    }catch(e){ return false; }
  }
  async function dbPatch(path, data){
    try{
      await fetch(`${DB_URL}${path}.json`, { method: 'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(data) });
      return true;
    }catch(e){ return false; }
  }

  // Chips rendering & selection
  function updateSelectedCount(){
    if(!selectedCountEl) return;
    const count = fixedNamesEl ? fixedNamesEl.querySelectorAll('.chip.selected').length : 0;
    selectedCountEl.textContent = String(count);
  }
  function renderChips(){
    if(!fixedNamesEl) return;
    fixedNamesEl.innerHTML = '';
    PRESET_NAMES.forEach(n => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = n;
      chip.setAttribute('data-name', n);
      chip.addEventListener('click', ()=>{
        chip.classList.toggle('selected');
        updateSelectedCount();
      });
      fixedNamesEl.appendChild(chip);
    });
    updateSelectedCount();
  }

  function setMessage(msg){
    messageEl.textContent = msg || '';
  }

  function selectAllChips(){
    if(!fixedNamesEl) return;
    fixedNamesEl.querySelectorAll('.chip').forEach(c => c.classList.add('selected'));
    updateSelectedCount();
  }
  function clearAllChips(){
    if(!fixedNamesEl) return;
    fixedNamesEl.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
    updateSelectedCount();
  }

  function parseTimeToMinutes(hhmm){
    const [h,m] = hhmm.split(':').map(Number);
    return h*60 + m;
  }
  function minutesTo12h(mins){
    let h24 = Math.floor(mins/60);
    const m = mins%60;
    const am = h24 < 12;
    let h12 = h24 % 12;
    if(h12 === 0) h12 = 12;
    const suffix = am ? 'ص' : 'م';
    return `${String(h12).padStart(2,'0')}:${String(m).padStart(2,'0')} ${suffix}`;
  }

  // Round helpers
  function loadRound(){
    try {
      const raw = localStorage.getItem(ROUND_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(e){ return null; }
  }
  function saveRound(data){
    localStorage.setItem(ROUND_KEY, JSON.stringify(data));
  }
  function clearRound(){
    localStorage.removeItem(ROUND_KEY);
  }
  // Schedule persistence
  function saveSchedule(payload){
    try { localStorage.setItem(SCHEDULE_KEY, JSON.stringify(payload)); } catch(e) {}
  }
  function loadSchedule(){
    try { const raw = localStorage.getItem(SCHEDULE_KEY); return raw ? JSON.parse(raw) : null; } catch(e){ return null; }
  }
  function clearSchedule(){
    localStorage.removeItem(SCHEDULE_KEY);
  }

  function formatHMS(ms){
    const totalSec = Math.max(0, Math.floor(ms/1000));
    const h = Math.floor(totalSec/3600);
    const m = Math.floor((totalSec%3600)/60);
    const s = totalSec%60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  function setRingPct(pct){
    if(!roundRingEl) return;
    const p = Math.min(100, Math.max(0, pct));
    roundRingEl.style.background = `conic-gradient(var(--primary) ${p}%, var(--ring-track) 0)`;
  }
  function updateRoundUI(){
    const data = loadRound();
    const now = Date.now();
    if(data && data.endAt && data.startAt){
      const remaining = data.endAt - now;
      if(remaining > 0){
        startRoundBtn.disabled = true;
        const total = data.endAt - data.startAt;
        const pct = ((total - remaining) / total) * 100;
        roundStatusEl.textContent = `الوقت المتبقي`;
        if(roundTimerText) roundTimerText.textContent = formatHMS(remaining);
        setRingPct(pct);
        return;
      }
    }
    // Not active
    startRoundBtn.disabled = false;
    roundStatusEl.textContent = 'لا توجد جولة نشطة.';
    if(roundTimerText) roundTimerText.textContent = '00:00:00';
    setRingPct(0);
  }
  function tickRound(){
    const data = loadRound();
    if(!data || !data.endAt){
      if(roundTimerId) { clearInterval(roundTimerId); roundTimerId = null; }
      updateRoundUI();
      return;
    }
    const now = Date.now();
    if(now >= data.endAt){
      clearRound();
      clearSchedule();
      // try clear remote as well (best effort)
      dbSet('/round', null);
      dbSet('/schedule', null);
      if(roundTimerId) { clearInterval(roundTimerId); roundTimerId = null; }
      updateRoundUI();
      return;
    }
    updateRoundUI();
  }
  function startRound(){
    const data = loadRound();
    const now = Date.now();
    if(data && data.endAt && data.endAt > now){
      updateRoundUI();
      return; // already active
    }
    const startAt = now;
    const endAt = now + ROUND_DURATION_MS;
    // persist locally and remotely
    saveRound({ startAt, endAt });
    dbSet('/round', { startAt, endAt, updatedAt: now });
    updateRoundUI();
    if(roundTimerId) clearInterval(roundTimerId);
    roundTimerId = setInterval(tickRound, 1000);
  }

  function getSelectedNames(){
    const chips = fixedNamesEl ? Array.from(fixedNamesEl.querySelectorAll('.chip.selected')) : [];
    return chips.map(c => c.getAttribute('data-name'));
  }

  function buildSchedule(){
    setMessage('');
    resultTableBody.innerHTML = '';

    let names = getSelectedNames();
    // إذا لم يتم اختيار أحد، استخدم جميع الأسماء الثابتة
    if(names.length === 0){
      names = PRESET_NAMES.slice();
    }

    // Force: random order
    for(let i=names.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [names[i], names[j]] = [names[j], names[i]];
    }

    // Fixed time range and equal distribution across contiguous intervals
    const start = parseTimeToMinutes(DEFAULT_START);
    const end = parseTimeToMinutes(DEFAULT_END);
    if(isNaN(start) || isNaN(end) || end <= start){
      setMessage('يرجى التحقق من وقت البداية والنهاية.');
      return;
    }

    const duration = end - start;
    const slots = [];
    if(names.length === 1){
      slots.push({ name: names[0], start, end });
    } else {
      const step = duration / names.length; // equal contiguous chunks covering entire range
      // build boundaries to avoid drift and to pin edges
      const boundaries = new Array(names.length + 1);
      boundaries[0] = start;
      for(let k=1;k<names.length;k++){
        boundaries[k] = Math.round(start + k * step);
      }
      boundaries[names.length] = end;
      for(let i=0;i<names.length;i++){
        slots.push({ name: names[i], start: boundaries[i], end: boundaries[i+1] });
      }
    }

    renderSlots(slots);

    // persist schedule bound to current round (if active)
    const r = loadRound();
    if(r && r.startAt && r.endAt && (r.endAt > Date.now())){
      const payload = { roundStartAt: r.startAt, roundEndAt: r.endAt, slots };
      saveSchedule(payload);
      dbSet('/schedule', payload);
    }
  }

  function renderSlots(slots){
    resultTableBody.innerHTML = '';
    for(const s of slots){
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      const tdStart = document.createElement('td');
      const tdEnd = document.createElement('td');
      tdName.textContent = s.name;
      if(typeof s.start === 'number' && typeof s.end === 'number'){
        tdStart.textContent = minutesTo12h(s.start);
        tdEnd.textContent = minutesTo12h(s.end);
      } else if(typeof s.time === 'number') {
        // backward compatibility with older payloads
        tdStart.textContent = minutesTo12h(s.time);
        tdEnd.textContent = '';
      } else {
        tdStart.textContent = '';
        tdEnd.textContent = '';
      }
      tr.appendChild(tdName);
      tr.appendChild(tdStart);
      tr.appendChild(tdEnd);
      resultTableBody.appendChild(tr);
    }
  }

  async function copyTable(){
    const rows = Array.from(resultTableBody.querySelectorAll('tr')).map(tr => {
      const tds = tr.querySelectorAll('td');
      return [tds[0]?.textContent || '', tds[1]?.textContent || '', tds[2]?.textContent || ''];
    });
    if(rows.length === 0){ if(copyMsgEl) copyMsgEl.textContent = 'لا يوجد جدول لنسخه.'; return; }
    const header = ['الاسم','البداية','النهاية'];
    const tsv = [header, ...rows].map(r => r.join('\t')).join('\r\n');
    try {
      if(navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(tsv);
      } else {
        const ta = document.createElement('textarea');
        ta.value = tsv; ta.style.position='fixed'; ta.style.opacity='0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
      }
      if(copyMsgEl){ copyMsgEl.textContent = 'تم نسخ الجدول إلى الحافظة.'; setTimeout(()=> copyMsgEl.textContent = '', 3000); }
    } catch(e){ if(copyMsgEl){ copyMsgEl.textContent = 'تعذّر النسخ. جرّب نسخًا يدويًا.'; setTimeout(()=> copyMsgEl.textContent = '', 4000); } }
  }

  function updateSlotVisibility(){}

  // Events
  if(chipsSelectAllBtn){ chipsSelectAllBtn.addEventListener('click', selectAllChips); }
  if(chipsClearBtn){ chipsClearBtn.addEventListener('click', clearAllChips); }
  if(copyTableBtn){ copyTableBtn.addEventListener('click', copyTable); }

  if(startRoundBtn){
    startRoundBtn.addEventListener('click', ()=>{ startRound(); buildSchedule(); });
  }

  // Init
  renderChips();
  updateSlotVisibility();
  // Round init
  updateRoundUI();
  const existingRound = loadRound();
  if(existingRound && existingRound.endAt && existingRound.endAt > Date.now()){
    roundTimerId = setInterval(tickRound, 1000);
    // restore schedule if it belongs to current round
    const saved = loadSchedule();
    if(saved && saved.roundEndAt === existingRound.endAt && saved.roundStartAt === existingRound.startAt && Array.isArray(saved.slots)){
      renderSlots(saved.slots);
    } else if(saved && saved.roundEndAt && Date.now() >= saved.roundEndAt){
      clearSchedule();
    }
  }

  // Remote sync: fetch on load and poll every 5s
  async function syncFromRemote(){
    const r = await dbGet('/round');
    const now = Date.now();
    if(r && r.endAt && r.endAt > now){
      // ensure local matches remote
      saveRound({ startAt: r.startAt, endAt: r.endAt });
      updateRoundUI();
      if(!roundTimerId) roundTimerId = setInterval(tickRound, 1000);
      const sched = await dbGet('/schedule');
      if(sched && sched.roundEndAt === r.endAt && Array.isArray(sched.slots)){
        saveSchedule(sched);
        renderSlots(sched.slots);
      }
    } else {
      // remote inactive
      clearRound();
      updateRoundUI();
    }
  }
  syncFromRemote();
  setInterval(syncFromRemote, 5000);
})();
