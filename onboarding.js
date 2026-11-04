/* Optional local-only introduction. No routing or data requests are performed. */
(function () {
  'use strict';
  const key = 'twvote:welcome:1';
  let completed = false, step = 0, highlighted = null, opener = null, savedMapView = null;
  const steps = [
    ['2022拉鋸選情地圖', '地圖顏色越深代表 2022 年兩大陣營票數越接近，適合觀察各區搖擺程度。此為四年前歷史紀錄，評估選情應考量現實狀態。', '#app-title'],
    ['快速定位選區', '點擊地圖或使用搜尋功能，可快速查詢全臺各縣市、鄉鎮市區及候選人。', '[data-tour-anchor=search]'],
    ['圖例與指標切換', '上方圖例可隨時查閱 2022 票差級距，並可切換不同選情指標或縮放地圖視野。', '[data-tour-anchor=map-controls]'],
    ['選區詳情面板', '展開右側面板，可查看該行政區的歷屆政黨得票趨勢、候選人名單與基層板塊變化。', '[data-tour-anchor=panel]']
  ];
  const dialog = document.createElement('dialog');
  dialog.className = 'welcome-dialog'; dialog.setAttribute('aria-labelledby', 'welcome-title');
  function node(tag, text, attrs = {}) {
    const el = document.createElement(tag); if (text) el.textContent = text;
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
  }
  function actions(items) {
    const box = node('div', '', {class:'welcome-actions'});
    for (const [action, text] of items) box.appendChild(node('button', text, {type:'button','data-action':action}));
    return box;
  }
  dialog.append(node('h2','看懂 2022 縣市長拉鋸地圖',{id:'welcome-title'}),
    node('p','透過 2022 年票差與歷屆得票走勢，協助觀察哪些選區較具搖擺特性。數據屬於四年前的歷史資料，評估最新選情時建議結合現實局勢綜合考量。'),
    actions([['skip','直接開始'],['tour','看 4 步操作']]));
  const coach = document.createElement('section');
  coach.className = 'tour-coach'; coach.hidden = true; coach.setAttribute('aria-label', '操作導覽');
  coach.append(node('p','',{class:'tour-progress','aria-live':'polite'}),node('h2','',{tabindex:'-1'}),node('p','',{class:'tour-copy'}),
    actions([['stop','略過導覽'],['previous','上一步'],['next','下一步']]));
  document.body.append(dialog, coach);
  function remember() { completed = true; try { localStorage.setItem(key, 'done'); } catch (_) {} }
  function restoreMapView(){
    if(!savedMapView)return;
    const dock=document.getElementById('map-dock');if(dock)dock.open=savedMapView.open;
    for(const [id,open] of savedMapView.groups){const node=document.getElementById(id);if(node)node.open=open;}
    if(typeof observation!=='undefined')observation.bottomSheet?.setDetent(savedMapView.detent);
    savedMapView=null;
  }
  function stop() {
    restoreMapView();
    coach.hidden = true; highlighted?.classList.remove('tour-highlight'); highlighted = null;
    if (opener?.isConnected) opener.focus({preventScroll: true});
  }
  function positionCoach(){
    coach.style.top='';coach.style.bottom='';coach.style.maxHeight='';
    if(step===2 && innerWidth<1024 && innerHeight>innerWidth && highlighted){
      const top=highlighted.getBoundingClientRect().bottom+8;
      coach.style.top=`${top}px`;coach.style.bottom='auto';coach.style.maxHeight=`${Math.max(60,innerHeight-top-8)}px`;
    }
  }
  window.addEventListener('resize',()=>{if(!coach.hidden)requestAnimationFrame(()=>requestAnimationFrame(positionCoach));});
  function showStep() {
    if(step!==2)restoreMapView();
    if(step===2&&!savedMapView){
      const dock=document.getElementById('map-dock');
      savedMapView={open:dock?.open,detent:typeof observation!=='undefined'?observation.bottomSheet?.getDetent():'summary',groups:[...document.querySelectorAll('.map-dock-content > details')].map(n=>[n.id,n.open])};
      if(typeof observation!=='undefined')observation.bottomSheet?.setDetent('summary');
      if(dock)dock.open=false;
      const legend=document.getElementById('map-dock-legend');if(legend)legend.open=true;
    }
    highlighted?.classList.remove('tour-highlight'); highlighted = document.querySelector(steps[step][2]); highlighted?.classList.add('tour-highlight');
    coach.dataset.step = String(step);
    coach.querySelector('[data-action="previous"]').disabled = step === 0;
    coach.hidden = false; coach.querySelector('.tour-progress').textContent = `${step + 1}／${steps.length}`;
    coach.querySelector('h2').textContent = steps[step][0]; coach.querySelector('.tour-copy').textContent = steps[step][1];
    coach.querySelector('[data-action="next"]').textContent = step === steps.length - 1 ? '完成，開始探索' : '下一步';
    positionCoach();
    coach.querySelector('h2').focus({preventScroll: true});
    requestAnimationFrame(()=>requestAnimationFrame(positionCoach));
  }
  function open() { stop(); opener = document.activeElement; dialog.showModal(); }
  dialog.querySelector('[data-action="skip"]').addEventListener('click', () => { remember(); dialog.close(); });
  dialog.querySelector('[data-action="tour"]').addEventListener('click', () => { remember(); dialog.close(); step = 0; showStep(); });
  dialog.addEventListener('cancel', remember);
  coach.querySelector('[data-action="stop"]').addEventListener('click', stop);
  coach.querySelector('[data-action="previous"]').addEventListener('click', () => { if (step > 0) { step--; showStep(); } });
  coach.querySelector('[data-action="next"]').addEventListener('click', () => { if (++step >= steps.length) stop(); else showStep(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !coach.hidden) { e.preventDefault(); stop(); } });
  document.getElementById('replay-tour-btn')?.addEventListener('click', () => { document.getElementById('topbar-more-menu').open = false; open(); });
  window.addEventListener('observation-ready', () => {
    try { completed = localStorage.getItem(key) === 'done'; } catch (_) {}
    if (!completed && /^#?\/?(mayor|council)?\/?$/.test(location.hash)) open();
  }, {once: true});
})();
