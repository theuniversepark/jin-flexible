// 화면 패널 — Zone 카드·KPI·차트·셀 목록·에이전트 로그·정보 창·도크(시나리오·단계 비교·운영 계층·데이터·설계)
import {
  ZONE, CELLS, MODES, MIXES, PRODUCTS, AGENTS, CELL_STATES, FAULTS, TASKS, CYCLE, ROUTES, CELL_ROSTER, HOOD_PARTS, AMR, TIP, SEAL_OPEN_TIME, family,
} from './zone.js';
import { fmtClock, compareModes, countBy } from './sim.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const f1 = (v) => (v == null || Number.isNaN(v) ? '—' : v.toFixed(1));
const CELL_ORDER = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C10', 'C08', 'C09'];

export class UI {
  constructor() {
    this.filter = 'all'; this.logN = 0;
    this.blockHits = Object.fromEntries(Object.keys(AGENTS).map((k) => [k, { n: 0, t: -99 }]));
    $('mixSeg').innerHTML = Object.entries(MIXES).map(([k, m]) => `<button data-mix="${k}">${m.label.replace('후드 ', '').replace(' : 도어 ', ':').replace('도어만 (LH/RH)', '도어만')}</button>`).join('');
    $('logFilters').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.filter = b.dataset.f;
      for (const x of $('logFilters').children) x.classList.toggle('on', x === b);
      this.redrawLog();
    });
    const inj = [['POS_DEV', '위치편차'], ['WELD_MISS', '용접 누락'], ['SEAL_BEAD', '실링 비드'], ['HEM_SEAT', '헤밍 착좌'], ['ID_MISMATCH', '오투입'], ['MOUNT_DEV', '장착 편차(도어)'], ['AMR_DELAY', 'AMR 지연'], ['ROBOT_ALARM', 'C03 로봇 알람']];
    $('injBtns').innerHTML = inj.map(([k, l]) => `<button data-inj="${k}" title="${esc(FAULTS[k]?.label ?? l)}">${l}</button>`).join('');
  }
  bind(sim) { this.sim = sim; this.logN = 0; $('log').innerHTML = ''; for (const k in this.blockHits) this.blockHits[k] = { n: 0, t: -99 }; this.renderStatic(); }
  renderStatic() {
    const sim = this.sim, m = MODES[sim.modeKey];
    document.body.dataset.mode = sim.modeKey;
    for (const b of $('modeSeg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.mode === sim.modeKey);
    for (const b of $('mixSeg').children) b.classList.toggle('on', b.dataset.mix === sim.mix);
    $('modeDesc').innerHTML = `<b>${m.label}</b>${m.desc}`;
    const head = { legacy: ['작', '현장 작업자·반장', '사람이 보고 판단 · 안돈 호출 · 수기 기록'], smart: ['OCS', 'Cell OCS (룰 기반)', '기존 PLC 유지 + 셀 시퀀스·정해진 재시도 · 실패 시 운영자 원격 승인'], dark: ['PA', 'PA Agent · Cell OCS', '6블록 에이전트 · 명령 검증 계층 · 안전 PLC 최종 권한'] }[sim.modeKey];
    $('agentAvatar').textContent = head[0]; $('agentTitle').textContent = head[1]; $('agentSub').textContent = head[2];
    $('agentBlocks').hidden = sim.modeKey !== 'dark';
    $('agentBlocks').innerHTML = Object.entries(AGENTS).map(([k, a]) => `<div class="ab" id="ab-${k}" title="${esc(a.desc)}"><b>${a.ko}</b><span>${a.label}</span> <span id="abn-${k}">0</span></div>`).join('');
  }

  // ── 왼쪽 ──
  renderKpis(sim) {
    const k = sim.kpis(), leg = sim.modeKey === 'legacy';
    const cls = (v, g, w) => (v >= g ? 'good' : v >= w ? 'warn' : 'bad');
    const items = [
      ['양품 출하', `${k.good}`, `투입 ${k.released} · WIP ${k.wip}`],
      ['UPH (10분)', f1(k.uph), `평균 ${f1(k.uphAvg)} · 병목 ${k.bottleneck}`],
      ['OEE', `${f1(k.oee)}<small>%</small>`, '이상 C/T 58초 기준'],
      ['직행률 (FPY)', `${f1(k.fpy)}<small>%</small>`, `재작업 회복 ${f1(k.reworkRate)}% · 폐기 ${k.scrap}`, cls(k.fpy, 97, 93)],
      ['통합 연계 성공률', leg ? '—' : `${f1(k.linkRate)}<small>%</small>`, leg ? '수작업 단계 — 해당 없음' : '목표 95% 이상 ([S2])', leg ? '' : cls(k.linkRate, 95, 90)],
      ['이상 복구 평균', `${f1(k.recoverAvg)}<small>초</small>`, `이상 ${k.faults} · L1 성공 ${leg ? '—' : f1(k.l1Rate) + '%'}`, cls(-k.recoverAvg, -12, -40)],
      ['사람 개입', `${k.human}`, `현장 인원 ${k.humans}명 · 로봇 알람 ${k.alarms}`],
      ['전환 손실', `${Math.round(k.changeLoss / 60)}<small>분</small>`, `전환 ${k.changes}회 · LOT ${sim.mode.lot}`],
      ['유출 불량', `${k.leaked}`, '검사 미검출 출하', k.leaked ? 'bad' : 'good'],
      [sim.modeKey === 'legacy' ? '대차 운반' : 'AMR 적재 가동', `${f1(k.amrUtil)}<small>%</small>`, k.battMin != null ? `배터리 최저 ${k.battMin.toFixed(0)}% · 평균 ${k.battAvg.toFixed(0)}%` : `작업자·대차 ${sim.carriers.length}조`],
    ];
    if (sim.modeKey === 'dark') items.push(['명령 검증', `${k.cmdOk}<small>/${k.cmdOk + k.cmdRej}</small>`, `거부 ${k.cmdRej} → 룰 기반 대체`], ['실러 대기 관리', `${k.sealHold}`, `초과 ${k.sealOver} · 팁 예지 드레싱 ${k.dress}`]);
    else items.push(['실러 대기 초과', `${k.sealOver}`, `허용 ${SEAL_OPEN_TIME}초 · 팁 드레싱 ${k.dress}`, k.sealOver ? 'warn' : 'good'], ['L2 상위 판단', `${k.l2}`, sim.modeKey === 'smart' ? '운영자 원격 승인' : '반장 판단']);
    $('kpis').innerHTML = items.map(([n, v, e, c]) => `<div class="kpi ${c ?? ''}"><span>${n}</span><b>${v}</b><em>${e}</em></div>`).join('');
    $('uphNow').textContent = f1(k.uph); $('linkNow').textContent = leg ? '—' : `${f1(k.linkRate)}%`;
    this.chart($('chartUph'), sim.series.map((r) => r.uph), { max: 60, color: '#37a0ff' });
    this.chart($('chartLink'), sim.series.map((r) => r.link), { min: 80, max: 100, color: '#3ddc84', target: 95 });
    // 주문
    const od = sim.orders.slice(-3).reverse();
    $('orders').innerHTML = (this.orderErr ? `<div class="order-err">${esc(this.orderErr)}</div>` : '') + od.map((o) => {
      const n = o.good + o.scrap;
      return `<div class="ord"><div class="ord-h"><span><b>${o.id}</b> ${esc(o.label)}</span><span>${o.doneAt ? '완료' : `${n}/${o.qty}`}</span></div><div class="bar"><i style="width:${(o.good * 100) / o.qty}%"></i><i class="s" style="width:${(o.scrap * 100) / o.qty}%"></i></div></div>`;
    }).join('') + (sim.orders.some((o) => !o.doneAt) ? '' : `<div class="ord" style="color:var(--muted)">지시가 없으면 혼류 비율대로 연속 생산합니다.</div>`);
    // 셀 목록
    $('cellList').innerHTML = CELL_ORDER.map((id) => {
      const st = sim.stations[id], S = CELL_STATES[st.state] ?? CELL_STATES.IDLE, job = st.carrier?.job;
      const sub = st.plan && job ? `${PRODUCTS[job.product].short} ${job.id} · ${st.cur?.label ?? ''}` : st.state === 'DONE' && job ? `인계 대기 → ${job.ng ? 'C07' : job.route[job.route.indexOf(id) + 1] ?? ''}` : CELLS[id].note;
      return `<div class="cell-row" data-cell="${id}" style="border-left-color:${S.color}"><b>${id}</b><span>${CELLS[id].label} <span style="color:${S.color}">${S.label}</span></span><small>${f1(k.cellUtil[id])}%</small><span class="sub">${esc(sub)}</span></div>`;
    }).join('');
  }
  chart(cv, data, { min = 0, max = 100, color, target } = {}) {
    const w = (cv.width = cv.clientWidth * devicePixelRatio), h = (cv.height = 64 * devicePixelRatio), c = cv.getContext('2d');
    c.clearRect(0, 0, w, h);
    const pts = data.slice(-120);
    if (target != null) { const y = h - ((target - min) / (max - min)) * h; c.strokeStyle = 'rgba(245,184,46,0.6)'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); c.setLineDash([]); }
    if (pts.length < 2) return;
    c.strokeStyle = color; c.lineWidth = 2 * devicePixelRatio; c.beginPath();
    pts.forEach((v, i) => { const x = (i / (pts.length - 1)) * w, y = h - (Math.max(0, Math.min(1, (v - min) / (max - min)))) * (h - 4) - 2; i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.stroke();
  }

  // ── 오른쪽: 로그 ──
  passes(e) {
    if (this.filter === 'all') return true;
    if (this.filter === 'fault') return ['warn', 'L1', 'L2', 'alarm'].includes(e.level);
    if (this.filter === 'agent') return ['agent', 'cmd', 'L2'].includes(e.level);
    if (this.filter === 'ok') return e.level === 'ok';
    return true;
  }
  entryHTML(e) {
    const lv = ['L1', 'L2'].includes(e.level) ? `<span class="lv ${e.level}">${e.level}</span>` : e.level === 'cmd' ? '<span class="lv cmd">명령 검증</span>' : '';
    return `<div class="entry e-${e.level}"><time>${fmtClock(e.t)}</time>${lv}<span class="by">${esc(e.by)}</span>${e.cell ? `<span class="cl">${e.cell}</span>` : ''}${esc(e.msg)}</div>`;
  }
  addLog(e) {
    const bh = this.blockHits[e.block];
    if (bh && this.sim?.modeKey === 'dark' && e.by.startsWith('PA')) { bh.n++; bh.t = performance.now(); }
    if (!this.passes(e)) return;
    const log = $('log');
    log.insertAdjacentHTML('afterbegin', this.entryHTML(e));
    while (log.childElementCount > 160) log.lastElementChild.remove();
  }
  redrawLog() { $('log').innerHTML = this.sim.events.slice(-160).reverse().filter((e) => this.passes(e)).map((e) => this.entryHTML(e)).join(''); }
  renderBlocks() {
    if (this.sim?.modeKey !== 'dark') return;
    const now = performance.now();
    for (const [k, h] of Object.entries(this.blockHits)) {
      const el = $(`ab-${k}`); if (!el) continue;
      el.classList.toggle('hot', now - h.t < 900);
      $(`abn-${k}`).textContent = h.n;
    }
  }

  // ── 정보 창 ──
  showInfo(sel) {
    this.sel = sel; $('info').hidden = !sel; if (sel) this.renderInfo();
  }
  renderInfo() {
    const sim = this.sim, sel = this.sel;
    if (!sel || $('info').hidden) return;
    if (sel.kind === 'cell' || sel.kind === 'robot') {
      const id = sel.kind === 'robot' ? sel.cell : sel.id, st = sim.stations[id], def = CELLS[id], S = CELL_STATES[st.state];
      $('infoTitle').textContent = `${id} ${def.label}`;
      $('infoSub').innerHTML = `<span style="color:${S.color}">${S.label}</span> · STEP ${def.step || '-'} · ${def.aseq ? `AS-IS ${def.aseq}` : def.note}`;
      const job = st.carrier?.job;
      const fam = job ? family(job.product) : 'HOOD';
      const ct = CYCLE[id]?.[fam] ? `${(CYCLE[id][fam] * sim.mode.cycleMul).toFixed(0)}초 (${PRODUCTS[job?.product ?? 'HOOD'].short} 기준, 가정)` : '—';
      const ep = st.ep && st.plan ? st.ep : null;
      $('infoBody').innerHTML = `<div class="kv">
        <span>로봇</span><b>${def.robots.map((r) => `${r.id} ${r.label}`).join('<br>') || (id === 'C07' ? (sim.modeKey === 'dark' ? 'RW-01 협동로봇 (재작업)' : '작업자 (재작업·재검 승인)') : '—')}</b>
        <span>설비</span><b>${def.equip.join(' · ')}</b>
        <span>작업</span><b>${(TASKS[id] ?? []).join(' → ') || '—'}</b>
        <span>작업 시간</span><b>${ct}</b>
        <span>현재 작업</span><b>${job ? `${job.id} ${PRODUCTS[job.product].label}${job.order ? ` · ${job.order.id}` : ''}` : '—'}</b>
        <span>단계</span><b>${st.cur ? `${st.cur.label} (${st.phaseT.toFixed(0)}/${st.phaseDur.toFixed(0)}초)` : st.state === 'DONE' ? '인계 대기 (다음 셀 예약 대기)' : '—'}</b>
        <span>누적</span><b>완료 ${st.done} · 가동 ${f1((st.busyT * 100) / Math.max(1, sim.t))}% · 막힘 ${f1((st.blockedT * 100) / Math.max(1, sim.t))}% · 전환 ${Math.round(st.changeT)}초 · 고장 ${Math.round(st.downT)}초</b>
        ${id === 'C03' ? `<span>전극 팁</span><b>마모 ${(st.tipWear * 100).toFixed(0)}% · 드레싱 후 ${st.weldsSinceDress}건 (정책: ${{ reactive: '품질 저하 확인 후', schedule: `정기 ${TIP.schedule}건`, predictive: `예지 ${TIP.predictAt * 100}%` }[sim.mode.tipDress]})</b>` : ''}
        <span>이상 (L1/L2)</span><b>${Object.entries(FAULTS).filter(([, f]) => f.cell === id || f.cell === '*').map(([, f]) => `${f.label}: ${f.l1} / ${f.l2}`).join('<br>') || '—'}</b>
      </div>${ep ? `<h4>이번 작업 에피소드 ${job.ep.episode_id}</h4><div class="tl">${ep.phases.map((p) => `<div><i>${fmtClock(p.t0).slice(3)}</i><span>${esc(p.label)}</span><i>${(p.t1 - p.t0).toFixed(0)}s</i></div>`).join('')}<div><i>${fmtClock(st.cur?.t0 ?? sim.t).slice(3)}</i><span>▶ ${esc(st.cur?.label ?? '')}</span><i>진행</i></div></div>` : ''}`;
    } else {
      const c = sim.carriers.find((x) => x.id === sel.id); if (!c) return;
      const job = c.job;
      $('infoTitle').textContent = c.kind === 'amr' ? `${c.id} 고하중 AMR` : `${c.id} 작업자 + 대차`;
      $('infoSub').textContent = c.kind === 'amr' ? 'KMP 1500P급 전방향 · 후드·도어 겸용 지그 (A-1-3)' : '레거시: 사람이 밀어 운반 · 수작업 로딩';
      const where = c.docked ? `${c.docked.cell} 도킹${c.state === 'charge' ? ' (충전 중)' : ''}` : c.target ? `→ ${c.target.cell}${c.reserved ? ' (예약 완료)' : c.target.queueBy === c ? ' (선행 대기)' : ' (대기열)'}` : '대기';
      $('infoBody').innerHTML = `<div class="kv">
        <span>상태</span><b>${where}${c.blockedT > 1 ? ' · 앞차 대기' : ''}${sim.t < c.delayUntil ? ' · <span style="color:var(--warn)">지연</span>' : ''}</b>
        <span>작업물</span><b>${job ? `${job.id} ${PRODUCTS[job.product].label}` : '공차'}</b>
        ${job ? `<span>경로</span><b>${job.route.map((s, i) => (i < job.step ? `<s>${s}</s>` : i === job.step ? `<b style="color:#7ff3ff">${s}</b>` : s)).join(' → ')}${job.ng ? ' · <span style="color:var(--bad)">NG → C07</span>' : ''}${job.reworked ? ` · 재작업 ${job.reworked}회` : ''}</b>` : ''}
        ${c.kind === 'amr' ? `<span>배터리</span><b>${c.battery.toFixed(1)}% (${sim.mode.battery === 'opportunistic' ? '기회 충전' : `${30}% 이하 충전`})</b>` : ''}
        <span>속도</span><b>${c.speed.toFixed(2)} m/s · 누적 ${c.odo.toFixed(0)} m</b>
        <span>적재 가동</span><b>${f1((c.loadedT * 100) / Math.max(1, sim.t))}%</b>
      </div>${job ? `<h4>에피소드 ${job.ep.episode_id} (Long-Horizon, 작업 1건)</h4><div class="tl">${job.ep.steps.map((s) => `<div><i>${s.cell}</i><span>${s.phases.map((p) => p.label).join(' · ').slice(0, 60)}${s.faults.length ? ` <span style="color:var(--warn)">⚠ ${s.faults.map((f) => FAULTS[f.kind]?.label ?? f.kind).join(', ')}</span>` : ''}</span><i>${s.t1 ? (s.t1 - s.t0).toFixed(0) + 's' : '진행'}</i></div>`).join('')}</div>` : ''}`;
    }
  }

  // ── 도크 ──
  openDock(tab) {
    this.tab = tab; $('dock').hidden = false;
    for (const b of $('dockTabs').children) b.classList.toggle('on', b.dataset.tab === tab);
    const T = { scenario: '📋 공정 시나리오 — 도어·차체 판넬 혼류생산을 위한 PA Agent 기반 복수 Cell 협업', compare: '🧭 단계 비교 — 같은 조건 8시간 시뮬레이션', arch: '🧩 운영 계층 · 셀 상태머신 · WP 연계', data: '📡 데이터 연동 — AAS · OPC UA PubSub over MQTT · 에피소드', design: '📐 유연생산 Zone 설계 요약' };
    $('dockTitle').textContent = T[tab];
    this.renderDock();
  }
  closeDock() { this.tab = null; $('dock').hidden = true; for (const b of $('dockTabs').children) b.classList.remove('on'); }
  renderDock() {
    const sim = this.sim, b = $('dockBody');
    if (!this.tab) return;
    if (this.tab === 'scenario') b.innerHTML = this.scenarioHTML(sim);
    if (this.tab === 'arch') b.innerHTML = this.archHTML(sim);
    if (this.tab === 'data') b.innerHTML = this.dataHTML(sim);
    if (this.tab === 'design') b.innerHTML = designHTML();
    if (this.tab === 'compare') {
      if (!this.cmp || this.cmp.mix !== sim.mix) {
        b.innerHTML = '<p>레거시 · 자동화 · 피지컬AI 단계를 같은 혼류·같은 난수로 8시간씩 돌리는 중…</p>';
        setTimeout(() => { this.cmp = { mix: sim.mix, r: compareModes({ hours: 8, mix: sim.mix, seed: 11 }) }; if (this.tab === 'compare') b.innerHTML = this.compareHTML(); }, 30);
      } else b.innerHTML = this.compareHTML();
    }
  }
  scenarioHTML(sim) {
    const steps = [['C01', 'STEP 1 공급·키팅', '일치: 투입 / 불일치: 보류'], ['C02', 'STEP 2 파지·안착·AMR 이송', '정상: 인계 / 편차: 보정'], ['C03', 'STEP 3 정렬·취부·용접', '정상: 진행 / NG: 재작업'], ['C04', 'STEP 4 실링 (·헤밍 C05)', '정상: 진행 / NG: 보류'], ['C10', 'STEP 5 도어·BIW 정밀 장착', '정상: 검사 / 편차: 보정'], ['C06', 'STEP 6 검사·재작업·인계', 'OK: 인계 / 미복구: 보류']];
    const st = (id) => { const s = sim.stations[id]; return `<span style="color:${CELL_STATES[s.state].color}">${id} ${CELL_STATES[s.state].label}</span> · 완료 ${s.done}`; };
    return `<p><b>수요기업</b> 삼진산업 · <b>대상</b> 상용트럭 LT2 후드 Ass'y (외판·내판·힌지·스트라이커) + 도어 LH/RH 혼류 확장 · <b>공정</b> 공급→취부→Spot 용접→실링→헤밍→검사→적재 (AS-IS A10~A80) · <b>KPI</b> 표준모델 3건 이상, 통합 연계 작업 성공률 95% 이상</p>
    <div class="steps">${steps.map(([id, h, j]) => `<div class="stp"><h5>${h}</h5><ol>${(TASKS[id] ?? []).map((t) => `<li>${esc(t)}</li>`).join('')}</ol><div class="j">판정 <em>${j}</em></div><div class="j">${st(id)}${id === 'C04' ? `<br>${st('C05')}` : ''}${id === 'C06' ? `<br>${st('C07')}` : ''}</div></div>`).join('')}</div>
    <h4>제품별 경로 (NG는 C06 → C07 재작업 → C06 재검)</h4>
    <table><tr><th>제품</th><th>경로</th><th>현재 시스템 내 수</th><th>출하</th></tr>${Object.entries(PRODUCTS).map(([p, P]) => `<tr><td><span style="color:${P.css}">■</span> ${P.label}</td><td>${ROUTES[family(p)].join(' → ')}</td><td class="num">${[...sim.jobs.values()].filter((j) => j.product === p).length}</td><td class="num">${sim.k.byProduct[p]}</td></tr>`).join('')}</table>
    <h4>이상 대응 (2레벨 — L1 셀 즉각 조치 / L2 상위 판단)</h4>
    <table><tr><th>이상</th><th>셀</th><th>L1 셀 즉각 조치</th><th>L2 상위 판단</th><th>못 막으면</th></tr>${Object.values(FAULTS).map((f) => `<tr><td>${f.label}</td><td>${f.cell === '*' ? '모든 도킹' : f.cell}</td><td>${f.l1}</td><td>${f.l2}</td><td>${f.defect ? `잠재 불량 → C06 검사` : '지연만'}</td></tr>`).join('')}</table>
    <p class="note">출처: (유연제조)공정시나리오_도출_서식 ver.1 (2026-09-21, 국호형) · WP6 셀 운영통제시스템 협의자료 R3 (2026-10-01). 도출서의 C/T는 모두 "실측 후 산정" — 화면의 작업 시간은 시뮬레이션용 가정값입니다.</p>`;
  }
  compareHTML() {
    const r = this.cmp.r, ms = ['legacy', 'smart', 'dark'];
    const rows = [
      ['양품 출하 (8시간)', (k) => k.good, 0, 1], ['평균 UPH', (k) => k.uphAvg, 1, 1], ['OEE (%)', (k) => k.oee, 1, 1], ['직행률 FPY (%)', (k) => k.fpy, 1, 1],
      ['통합 연계 성공률 (%)', (k, m) => (m === 'legacy' ? null : k.linkRate), 1, 1], ['이상 복구 평균 (초)', (k) => k.recoverAvg, 1, -1], ['사람 개입 (건)', (k) => k.human, 0, -1],
      ['전환 손실 (분)', (k) => k.changeLoss / 60, 0, -1], ['전환 횟수', (k) => k.changes, 0, 0], ['폐기', (k) => k.scrap, 0, -1], ['유출 불량', (k) => k.leaked, 0, -1], ['현장 인원 (명)', (k) => k.humans, 0, -1],
    ];
    const cell = (v, d) => (v == null ? '—' : v.toFixed(d));
    const tbl = rows.map(([n, f, d, better]) => {
      const vals = ms.map((m) => f(r[m], m));
      const ok = vals.filter((v) => v != null);
      const best = better === 1 ? Math.max(...ok) : better === -1 ? Math.min(...ok) : null;
      return `<tr><td>${n}</td>${vals.map((v) => `<td class="num ${v === best ? 'best' : ''}">${cell(v, d)}</td>`).join('')}</tr>`;
    }).join('');
    const util = Object.keys(CELLS).filter((id) => id !== 'C09').map((id) => `<div class="b2"><span>${id} ${CELLS[id].label}</span><div class="tr">${ms.map((m, i) => `<div style="width:${Math.max(2, r[m].cellUtil[id])}%;background:${['#c27c2c', '#37a0ff', '#8f6bff'][i]}">${r[m].cellUtil[id].toFixed(0)}%</div>`).join('')}</div></div>`).join('');
    return `<p>혼류 <b>${MIXES[this.cmp.mix].label}</b> · 시작 08:00부터 8시간 · 같은 난수(seed 11). 왼쪽 위 혼류 버튼을 바꾸고 이 탭을 다시 열면 그 조건으로 다시 계산합니다.</p>
    <table><tr><th>지표</th>${ms.map((m) => `<th class="num">${MODES[m].label}</th>`).join('')}</tr>${tbl}</table>
    <h4>셀 가동률 (주황 레거시 · 파랑 자동화 · 보라 피지컬AI)</h4><div class="bars2">${util}</div>
    <h4>읽는 법</h4>
    <p>· <b>혼류 대응력</b>: 레거시는 지그·그리퍼를 사람이 바꾸므로 LOT 10개로 묶어 전환을 줄이고, 그래도 셀마다 240초씩 멈춥니다. 자동화는 툴체인저·레시피 자동 호출(25초, LOT 3), 피지컬AI는 PA Agent가 다음 작업 레시피를 미리 올려 1개 단위 혼류(6초)로 돕니다.<br>
    · <b>품질 회복</b>: 이상을 셀에서 바로 잡으면(L1) 잠재 불량이 남지 않습니다. 레거시는 사람이 늦게 알아채 불량이 검사까지 가고, 수검사가 일부를 놓쳐 유출됩니다.<br>
    · <b>병목</b>: 세 단계 모두 C03 가접·본용접(로봇 2대 협업)이 병목입니다. 처리량을 더 올리려면 C03 로봇 추가(A-1-1 용접·접합 16대 확장) 또는 용접점 분할이 필요합니다.</p>
    <p class="note">사이클·이상 확률·대응 시간은 시뮬레이션용 가정값입니다(zone.js). 실측 C/T가 나오면 CYCLE·FAULTS 값을 바꿔 다시 계산합니다.</p>`;
  }
  archHTML(sim) {
    const counts = countBy(Object.values(sim.stations).map((s) => s.state));
    const layers = [
      ['자율제조 운영관리 계층', 'WP1·WP2 (생기원) · Multi-Agent(FAC) · Global Orchestrator', '작업지시·우선순위·LOT 분할 · 장기 지연·고장 상위 보고 수신 · 사전검증(What-if)', false],
      ['제조데이터 플랫폼', '세부1 · Kafka/MQTT 이벤트 버스 · 시계열 DB · AAS', '상태·이벤트·품질값·제품·운반대 ID 표준화·이력 저장 — 이 화면의 OPC UA PubSub(MQTT)·AAS 내보내기', false],
      ['셀 운영통제 계층 (WP6 Cell OCS)', '캠틱 · Cell Controller · Local Orchestrator · Edge AI', '① 상태 인지 ② 미세 스케줄 조정 ③ 협업 제어(도킹·퇴피·작업 허가·인계) ④ 이상 대응·환류(NG·지연·고장 판단·격리·상위 보고)', true],
      ['현장 물리 셀', 'C01~C10 · R01~R08 · AMR 12대 · 지그·센서', '기존 PLC·안전 인터로킹 유지 — 안전 PLC가 최종 권한', false],
    ];
    const wp = [['세부1 제조데이터 플랫폼', '상태값 / 로그 / 제품·운반대 ID'], ['WP1 상위 Agent', '작업지시 / 자원 상태 / 지연 이벤트'], ['WP2 검증·DT', '공정 상태 / 알람 / 복구 결과'], ['WP3 로봇 협업', '파지 결과 / 안전 상태 / 인계 신호'], ['WP4 공정 기술', '조건 / 레시피 / 완료·이상 신호'], ['WP5 검사·품질', '측정값 / 판정 / 재검사 결과'], ['WP6 AMR 연계', '도킹 상태 / 허가 / 완료 / 오류 코드']];
    return `<div class="layers">${layers.map(([n, w, d, me]) => `<div class="layer ${me ? 'me' : ''}"><div><b>${n}</b><small>${w}</small></div><div>${d}</div></div>`).join('')}</div>
    <h4>셀 상태머신 (WP8 V12와 같은 상태 이름 — 존 간 정합)</h4>
    <div class="sm">${Object.entries(CELL_STATES).map(([k, s]) => `<div class="st" style="border-color:${s.color}"><b style="color:${s.color}">${k}</b>${s.label} · ${counts[k] ?? 0}셀</div>`).join('<span>→</span>')}</div>
    <p>IDLE → READY(도킹·클램프·ID 확인) → CHANGE(전환·드레싱) → RUN → (RECOVER: L1 셀 즉각 조치 / HOLD: L2 상위 판단 대기) → DONE(완료·인계 대기: 다음 셀 예약) → IDLE. DOWN은 로봇 알람(정비), SAFE_STOP은 비상정지(안전 PLC).</p>
    <h4>제어 주기 3단 분리 · 명령 검증</h4>
    <table><tr><th>주기</th><th>담당</th><th>이 시뮬레이션에서</th></tr>
    <tr><td>비실시간 (초~분)</td><td>PA Agent · LLM 계획</td><td>생산 지시 해석·LOT 분할·혼류 평준화·재계획·충전 배정</td></tr>
    <tr><td>준실시간 (수십 ms~초)</td><td>Cell OCS · Edge AI</td><td>셀 상태 전이·도킹 인계·L1 보정·실러 대기 관리·선행 대기</td></tr>
    <tr><td>실시간·결정론 (ms 이하)</td><td>로봇 제어기·PLC·안전 PLC</td><td>모션·인터록·비상정지 (AI는 직접 제어하지 않음)</td></tr></table>
    <p>AI(PA Agent)가 낸 보정 명령은 <b>명령 검증 계층</b>에서 작업공간·속도·힘 한계·금지영역·인터록 상태로 검사해 통과한 것만 실행하고, 거부되면 룰 기반 대체경로(재안착 등)로 갑니다. 현재 ${sim.k.cmdOk + sim.k.cmdRej}건 중 거부 ${sim.k.cmdRej}건.</p>
    <h4>WP 간 협업 입출력 (WP6 중심)</h4>
    <table><tr><th>상대</th><th>주고받는 데이터</th></tr>${wp.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
    <h4>PA Agent 6블록 (9/28 유연제조 존 에이전트 구조(안))</h4>
    <table><tr><th>블록</th><th>역할</th><th>이번 실행 판단 수</th></tr>${Object.entries(AGENTS).map(([k, a]) => `<tr><td>${a.ko} (${a.label})</td><td>${a.desc}</td><td class="num">${sim.events.filter((e) => e.block === k).length}</td></tr>`).join('')}</table>
    <p class="note">Perception·Asset, Handling·Process 통합은 논의 중 · 상위 PA·APS·ERP는 총괄1-1/1-2. 계층 수(셀–상위 2계층 vs 존 계층 포함)는 10/1 생기원 협의에서 미결.</p>`;
  }
  dataHTML(sim) {
    const hub = this.hub;
    const sample = hub.networkMessages(sim).find((m) => m.topic.endsWith('/C03'));
    return `<div class="kv"><span>기준 시계</span><b>시뮬레이션 0초 = 오늘 08:00 → 현재 ${hub.iso(sim.t)}</b>
      <span>MQTT</span><b>${hub.server ? (hub.mqtt?.listening ? `mqtt://${hub.mqtt.host}:${hub.mqtt.port} · 발행 ${hub.published}건 (2초마다 자산 ${hub.assets(sim).length}개 + 이벤트)` : `브로커 꺼짐 (${esc(hub.mqtt?.error ?? '')})`) : '서버 없음 — 파일 저장만 (npm start로 실행하면 내장 MQTT 브로커로 발행)'}</b>
      <span>토픽</span><b>opcua/json/data/camtic/MetaFactory/A1-FMS/&lt;자산&gt; · …/Events</b>
      <span>에피소드</span><b>${sim.episodes.length}건 보관 (작업 1건 = Long-Horizon 에피소드, 공통 ID: order · job · episode · asset · recipe)</b></div>
      <div class="btns"><button data-dl="episodes">⬇ 에피소드 (.jsonl)</button><button data-dl="events">⬇ 이벤트 (.csv)</button><button data-dl="series">⬇ KPI 추이 (.csv)</button><button data-dl="aas">⬇ AAS 환경 (.aas.json)</button><button data-dl="snapshot">⬇ 현재 상태 (.json)</button></div>
      <h4>OPC UA PubSub NetworkMessage 예 — C03</h4><pre class="code">${esc(JSON.stringify(JSON.parse(sample.payload), null, 2))}</pre>
      <h4>최근 에피소드</h4><pre class="code">${esc(sim.episodes.slice(-1).map((e) => JSON.stringify(e, null, 1)).join('\n').slice(0, 2500) || '(아직 없음)')}</pre>`;
  }
}

export function designHTML() {
  return `<p>이 시뮬레이션은 <b>A-1-4 유연생산 통합 OCS 시뮬레이션 Cell</b>(1차년도 21억)이 하는 일 — 제품·설비·로봇·AMR·지그 DT, 작업지시·레시피·스케줄링 검증, 병목·가동률 분석 — 을 웹에서 미리 해 보는 것입니다. 자세한 설계서는 <code>docs/ZONE_DESIGN.md</code>.</p>
  <h4>A-1 유연제조 Zone Cell 로스터 (협약용 부록 · 임시 테스트베드 구축계획)</h4>
  <table><tr><th>Cell</th><th>이름</th><th>구축</th><th class="num">비용(백만원)</th><th class="num">전력(kW)</th><th>주요 장비</th></tr>${CELL_ROSTER.map((c) => `<tr><td>${c.id}</td><td>${c.name}</td><td>${c.year}</td><td class="num">${c.cost.toLocaleString()}</td><td class="num">${c.kw}</td><td>${c.eq}</td></tr>`).join('')}</table>
  <h4>라인 개념 → 셀 배치 (WP6 협의자료 11쪽)</h4>
  <table><tr><th>셀</th><th>이름</th><th>로봇</th><th>설비</th><th>AS-IS</th></tr>${Object.values(CELLS).map((c) => `<tr><td>${c.no}</td><td>${c.label}${c.ext ? ' (확장)' : ''}</td><td>${c.robots.map((r) => `${r.id} ${r.label}`).join('<br>') || '—'}</td><td>${c.equip.join(' · ')}</td><td>${c.aseq ?? '—'}</td></tr>`).join('')}</table>
  <p>윗줄 C01~C05 순차 셀(뒤쪽 보전·유틸리티 공간) / 가운데 주 이송 동선(→, 부품·재공품) / 복귀 동선(←, 양품 회수·출하) / 오른쪽 통제 이송(인터록) / 아랫줄 C06 검사·C07 NG 재작업·C10 확장(도어-BIW 정밀조립, A-1-2 연계)·C09 AMR 충전(주 동선 외부)·C08 양품 FIFO. AMR ${AMR.count}대·지그 ${AMR.count}세트(A-1-3).</p>
  <h4>대상 부품 — LT2 Hood Ass'y (삼진산업)</h4>
  <table><tr><th>부품</th><th>이름</th><th>크기 (mm)</th><th class="num">중량 (kg)</th></tr>${HOOD_PARTS.map((p) => `<tr><td>${p.id}</td><td>${p.label}</td><td>${p.size ?? '—'}</td><td class="num">${p.kg ?? '—'}</td></tr>`).join('')}</table>
  <h4>미정·확인 필요</h4>
  <p>· 공정별 실측 C/T·허용오차·통신주기 (도출서: "실측 후 산정") · 로딩/언로딩 방식(삼진산업 협의 예정) · 실링·헤밍 설비 실물 도입 여부(DT 대체 가능성) · 도어 혼류 대상의 실제 부품·치수 · 셀 컨트롤러 개발·소유 주체와 API 경계(10/13 생기원 회의) · 계층 수(셀–상위 2계층 vs 존 계층) · 고하중 장비(A-1-1 600kW·로봇 16대) 창조2관 3층 허용하중 회신.</p>
  <h4>근거 자료</h4>
  <p class="note">[S1] [WP6] 제조셀_운영통제시스템_구조&내용_협의(KITECH)_R3 (2026-10-01) · [S2] (유연제조)공정시나리오_도출_서식_ver.1 (2026-09-21) · [S3] WP6_내용 정리 (발표 대본) · [S4] 연구개발계획서 부록(협약용) A-1 Cell 로스터 · [S5] 임시 테스트베드 구축계획 v2 (2026-09-02) · [S6] 9/28 피지컬AI 오후 논의 (존별 시나리오) · 이지로보틱스 DMWorks 방문 Q&A (2026-09-30) · llm-wiki 「제조 특화 메타팩토리」「셀 운영통제 계층」「PA Agent」「삼진산업」 · jin-3d(정밀조립 Zone) 상태머신·데이터 체계</p>`;
}
