/* Optional local-only introduction. No routing or data requests are performed. */
(function () {
  'use strict';
  const key = 'twvote:welcome:1';
  let completed = false, step = 0, highlighted = null, opener = null, savedMapView = null;
  const steps = [
    ['縣市長選舉觀察', '地圖著色使用 2022 縣市長歷史票差，搭配 2026 候選人名冊觀察地方選情；不是即時開票或勝選預測。', '#app-title'],
    ['找到自己的選區', '搜尋地區或候選人，也可點地圖。全台首頁直接顯示澎湖、金門、連江入口，不必展開工具尋找離島。', '[data-tour-anchor=search]'],
    ['讀圖例，再換圖層', '圖例常駐上方。使用「圖層與說明」切換指標；縮放、重設與離島入口也在頂列，地圖保留完整操作空間。', '[data-tour-anchor=map-controls]'],
    ['展開詳情，保留觀察空間', '手機直向按「查看清單／詳情」後，地圖操作會暫時停用；收合詳情即可回到地圖。橫向會分欄。歷史卡片可各自展開，注意年份與選區範圍。', '[data-tour-anchor=panel]']
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
  dialog.append(node('h2','用地圖看懂自己的選區',{id:'welcome-title'}),
    node('p','先選公職，再找地區。2026 顯示審定名冊與席次；歷史數據保留原年份，不是 2026 開票結果或預測。'),
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
