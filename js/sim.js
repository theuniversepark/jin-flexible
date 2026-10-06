// 유연생산 Zone 시뮬레이션 엔진 — 렌더링과 분리되어 Node에서도 돈다 (tests/*.mjs).
// 작업 1건(Job) = 후드/도어 1개. AMR(레거시는 작업자+대차)이 지그에 작업물을 싣고 셀 도킹 위치에 서면
// 셀이 인계 → (전환) → 작업 → (이상: L1 셀 즉각 조치 / L2 상위 판단) → 완료·인계대기 순서로 처리한다.
// 셀 상태: IDLE · READY · RUN · CHANGE · DONE · HOLD · RECOVER · DOWN · SAFE_STOP
import {
  CELLS, MODES, FAULTS, DEFECTS, CYCLE, TASKS, AMR, CART, BATTERY, TIP, ROBOT_ALARM_P, SEAL_OPEN_TIME, PREQUEUE, DRIFT, QUEUE_CAP,
  PRODUCTS, AGENTS, MIXES, family, routeOf, mixSequence, ZONE,
} from './zone.js';
import { buildLanes, shortestPath, pathPoints, polyLength, pointOn } from './lanes.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const fmtClock = (t) => {
  const s = Math.floor(t + 8 * 3600) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const pad = (n, k = 5) => String(n).padStart(k, '0');

const ROBOT_CELLS = new Set(['C01', 'C02', 'C03', 'C04', 'C05', 'C10']);
const PH_STATE = { handoff: 'READY', wait: 'READY', change: 'CHANGE', dress: 'CHANGE', work: 'RUN', recover: 'RECOVER', escalate: 'HOLD', down: 'DOWN' };

export class Simulation {
  constructor({ mode = 'smart', mix = '2:1', seed = 7, continuous = true } = {}) {
    this.modeKey = mode; this.mode = MODES[mode];
    this.mix = mix; this.seed = seed; this.continuous = continuous;
    this.rand = mulberry32(seed);
    this.t = 0; this.estop = false; this.paused = false;
    this.L = buildLanes();
    this.events = []; this.evSeq = 0;
    this.listeners = [];
    this.jobs = new Map(); this.jobSeq = 0;
    this.orders = []; this.orderSeq = 0; this.seqBuf = [];
    this.episodes = []; this.epKeep = 1500;
    this.series = []; this.lastSample = -1;
    this.injected = [];
    this.k = {
      released: 0, good: 0, scrap: 0, leaked: 0, inspected1: 0, pass1: 0, rework: 0, reworkOk: 0,
      linkTotal: 0, linkOk: 0, faults: 0, l1: 0, l1ok: 0, l2: 0, l2ok: 0, human: 0, alarms: 0,
      recoverSum: 0, recoverN: 0, changes: 0, changeLoss: 0, dress: 0, sealOver: 0, sealHold: 0,
      cmdOk: 0, cmdRej: 0, amrDelay: 0, shippedAt: [], byProduct: { HOOD: 0, DOOR_LH: 0, DOOR_RH: 0 },
    };
    this.stations = {};
    for (const [id, def] of Object.entries(CELLS)) {
      this.stations[id] = {
        id, def, slots: this.L.slots[id], state: 'IDLE', plan: null, phase: null, phaseT: 0, phaseDur: 0,
        carrier: null, lastFam: null, lastProd: null, tipWear: id === 'C03' ? 0.35 : 0, weldsSinceDress: 0,
        done: 0, busyT: 0, downT: 0, changeT: 0, blockedT: 0, starvedT: 0, faultNow: null, health: 1,
        robots: def.robots.map((r) => ({ ...r, state: 'idle' })), lastAlarm: null,
      };
    }
    this.carriers = [];
    const n = this.mode.carrier === 'amr' ? AMR.count : CART.count;
    // 처음에는 C01 대기열(왼쪽 연결로·복귀 동선 서쪽)에 줄을 세운다
    const queue = this.queuePoints(n);
    for (let i = 0; i < n; i++) {
      const p = queue[i];
      this.carriers.push({
        id: this.mode.carrier === 'amr' ? `AMR-${String(i + 1).padStart(2, '0')}` : `CART-${i + 1}`,
        kind: this.mode.carrier, x: p.x, z: p.z, yaw: p.yaw, speed: 0, battery: 78 + this.rand() * 20,
        state: 'idle', job: null, path: null, pts: null, s: 0, len: 0, target: null, reserved: false, hold: null,
        release: null, waitT: 0, blockedT: 0, moveT: 0, loadedT: 0, delayUntil: 0, docked: null, odo: 0,
      });
    }
    for (const c of this.carriers) this.goTo(c, this.L.slots.C01[0], false);
    this.log('info', 'ORCH', null, `${ZONE.code} ${ZONE.name} 시작 — ${this.mode.label}, 혼류 ${MIXES[mix].label}, ${this.mode.carrier === 'amr' ? `AMR ${n}대` : `작업자·대차 ${n}조`}`);
  }

  // ── 공통 ──
  on(fn) { this.listeners.push(fn); }
  who(block) {
    if (this.modeKey === 'dark') return `PA·${AGENTS[block]?.ko ?? block}`;
    if (this.modeKey === 'smart') return block === 'HUMAN' ? '운영자 (원격 승인)' : 'Cell OCS (룰)';
    return block === 'HUMAN' || block === 'QREC' ? '반장' : '작업자';
  }
  log(level, block, cell, msg, extra = {}) {
    const e = { id: ++this.evSeq, t: this.t, level, block, by: this.who(block), cell, msg, ...extra };
    this.events.push(e);
    if (this.events.length > 600) this.events.shift();
    for (const f of this.listeners) f(e);
    return e;
  }
  r(a, b) { return a + (b - a) * this.rand(); }
  chance(p) { return this.rand() < p; }

  queuePoints(n) {
    const pts = [], sp = AMR.spacing, L = this.L;
    const mL = L.nodes.get('M:L'), c01 = L.nodes.get(L.slots.C01[0].lane), rL = L.nodes.get('R:L');
    for (let x = c01.x - 2.6; x > mL.x + 0.3 && pts.length < n; x -= sp) pts.push({ x, z: mL.z, yaw: 0 });
    for (let z = mL.z + 1.2; z < rL.z && pts.length < n; z += sp) pts.push({ x: mL.x, z, yaw: Math.PI / 2 });
    for (let x = rL.x + 1.4; pts.length < n; x += sp) pts.push({ x, z: rL.z, yaw: Math.PI });
    return pts;
  }

  // ── 주문·혼류 ──
  addOrder(spec) {
    const id = `ORD-${pad(++this.orderSeq, 4)}`;
    const items = [];
    const mix = spec.mix ?? null;
    if (spec.items) for (const [p, q] of Object.entries(spec.items)) for (let i = 0; i < q; i++) items.push(p);
    let seq;
    if (spec.items) {
      // 제품별 수량을 평준화된 순서로 섞는다 (레거시는 LOT 단위)
      const w = {}; let tot = 0;
      for (const [p, q] of Object.entries(spec.items)) { w[p] = q; tot += q; }
      seq = []; const acc = Object.fromEntries(Object.keys(w).map((k) => [k, 0])), left = { ...w };
      const lot = this.mode.lot;
      while (seq.length < tot) {
        for (const k in w) acc[k] += w[k] / tot;
        let best = null;
        for (const k in w) if (left[k] > 0 && (best === null || acc[k] > acc[best])) best = k;
        acc[best] -= 1;
        for (let j = 0; j < lot && left[best] > 0; j++) { seq.push(best); left[best]--; }
      }
    } else seq = mixSequence(mix ?? this.mix, spec.qty, this.mode.lot);
    const o = { id, label: spec.label ?? `${seq.length}개 생산`, seq, qty: seq.length, released: 0, good: 0, scrap: 0, createdAt: this.t, doneAt: null, source: spec.source ?? 'UI' };
    this.orders.push(o);
    this.log('agent', 'ORCH', null, `생산 지시 ${id} 접수 — ${o.label} (${Object.entries(countBy(seq)).map(([p, n]) => `${PRODUCTS[p].short} ${n}`).join(' · ')})${this.modeKey === 'dark' ? ' · DT 사전검증 통과 · 레시피 고정' : ''}`, { order: id });
    return o;
  }
  nextProduct() {
    const o = this.orders.find((x) => x.released < x.qty);
    if (o) return { product: o.seq[o.released++], order: o };
    if (!this.continuous) return null;
    if (!this.seqBuf.length) this.seqBuf = mixSequence(this.mix, 60, this.mode.lot);
    return { product: this.seqBuf.shift(), order: null };
  }
  setMix(mix) {
    if (!MIXES[mix]) return;
    this.mix = mix; this.seqBuf = [];
    this.log('agent', 'ORCH', null, `혼류 비율 변경 → ${MIXES[mix].label} (다음 투입부터)`);
  }

  // ── 이상 강제 발생 (시나리오 실증용) ──
  inject(kind, cell = null) {
    if (kind === 'AMR_DELAY') {
      const c = this.carriers.filter((x) => x.path && x.job).sort(() => this.rand() - 0.5)[0];
      if (!c) return false;
      this.delayCarrier(c, true); return true;
    }
    if (kind === 'ROBOT_ALARM') { this.injected.push({ kind, cell: cell ?? 'C03' }); return true; }
    if (!FAULTS[kind]) return false;
    this.injected.push({ kind, cell: cell ?? FAULTS[kind].cell });
    this.log('warn', 'ORCH', cell ?? FAULTS[kind].cell, `[시나리오] 다음 작업에 '${FAULTS[kind].label}' 발생 예약`);
    return true;
  }
  delayCarrier(c, forced = false) {
    const dur = this.modeKey === 'dark' ? 14 : this.modeKey === 'smart' ? 45 : 90;
    c.delayUntil = this.t + dur; this.k.amrDelay++;
    this.log('warn', 'HAND', null, `${c.id} 이송 지연 감지${forced ? ' [시나리오]' : ''} (${c.job ? c.job.id : '공차'})`, { amr: c.id });
    if (this.modeKey === 'dark') this.log('L2', 'ORCH', null, `${c.id} 주행 재계획 · 후속 셀 레시피 선행 전환 · 투입 간격 조정 (${dur}초 내 회복 예측)`, { amr: c.id });
    else if (this.modeKey === 'smart') this.log('L2', 'HUMAN', null, `${c.id} 지연 — Fleet 관제 경보, 운영자 확인 후 재출발`, { amr: c.id });
  }

  // ── 이동 ──
  slotFree(slot, c) { return !slot.reservedBy && (!slot.occupant || slot.occupant === c) && (!slot.queueBy || slot.queueBy === c); }
  reserve(slot, c) { slot.reservedBy = c; if (slot.queueBy === c) slot.queueBy = null; c.target = slot; c.reserved = true; }
  // 출발 지점의 노드: 도킹 중이면 도킹 노드, 아니면 가장 가까운 차로 노드(대기열)
  fromNode(c) {
    if (c.docked) return c.docked.dock;
    let best = null, bd = Infinity;
    for (const n of this.L.nodes.values()) {
      if (n.id.startsWith('D:') || n.id.startsWith('V:')) continue;
      const d = Math.hypot(n.x - c.x, n.z - c.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best.id;
  }
  goTo(c, slot, reserved) {
    let from = this.fromNode(c);
    let ids = shortestPath(this.L, from, slot.dock);
    if (!ids) return false;
    const pts = pathPoints(this.L, ids);
    const kinds = [];
    for (let i = 1; i < ids.length; i++) kinds.push(this.L.edges.get(ids[i - 1]).find((e) => e.to === ids[i])?.kind ?? 'lane');
    // 대기열에서 출발하면 현재 위치를 첫 점으로 (가장 가까운 노드를 이미 지났으면 그 노드는 건너뛴다)
    if (!c.docked) {
      const n0 = pts[0];
      if (pts.length > 1) {
        const a = { x: pts[1].x - n0.x, z: pts[1].z - n0.z }, b = { x: c.x - n0.x, z: c.z - n0.z };
        if (a.x * b.x + a.z * b.z > 0) { pts.shift(); kinds.shift(); }
      }
      pts.unshift({ x: c.x, z: c.z, id: 'here' }); kinds.unshift('lane');
    }
    if (c.docked) { c.release = { slot: c.docked, at: polyLength(pts.slice(0, 2)) + 0.2 }; c.docked = null; c.served = false; c.taskDone = false; }
    c.pts = pts; c.kinds = kinds; c.s = 0; c.len = polyLength(pts); c.state = 'move';
    c.target = slot;
    if (reserved) this.reserve(slot, c);
    else { c.reserved = false; c.hold = Math.max(0, c.len - polyLength(pts.slice(-2)) - (this.modeKey === 'dark' ? 2.2 : 2.4)); }
    return true;
  }
  laneClearForMerge(c, slot) {
    const lane = this.L.nodes.get(slot.lane);
    const dir = slot.lane.startsWith('M') ? 1 : -1;   // 주 이송 동선 동쪽, 복귀 동선 서쪽
    for (const o of this.carriers) {
      if (o === c || o.docked) continue;
      if (Math.abs(o.z - lane.z) > 0.6) continue;
      const ahead = (o.x - lane.x) * dir;
      if (ahead > -1.0 && ahead < AMR.spacing) return false;          // 합류 지점 위·앞
      if (ahead > -3.2 && ahead <= -1.0 && o.speed > 0.05) return false; // 다가오는 차
    }
    return true;
  }
  moveCarrier(c, dt) {
    if (!c.pts) return;
    const loaded = !!c.job;
    let vmax = c.kind === 'cart' ? CART.speed : loaded ? AMR.loaded : AMR.empty;
    if (this.t < c.delayUntil) vmax *= 0.25;
    // 예약 없이 대기열로 가는 중이면 대기 지점에서 멈추고 슬롯을 기다린다
    if (!c.reserved && c.s >= c.hold) {
      const tg = c.target;
      if (this.slotFree(tg, c) && (tg.cell === 'C01' ? this.queueHead(c) : tg.queueBy === c)) this.reserve(tg, c);
      else { c.speed = 0; c.waitT += dt; return; }
    }
    // 앞차 간격 유지
    const here = pointOn(c.pts, c.s);
    let blocker = null;
    for (const o of this.carriers) {
      if (o === c) continue;
      const dx = o.x - here.x, dz = o.z - here.z;
      const proj = dx * here.hx + dz * here.hz, lat = Math.abs(dx * here.hz - dz * here.hx);
      if (proj > 0.05 && proj < AMR.spacing && lat < 1.05) { blocker = o; break; }
    }
    // 서로를 가로막은 채 멈췄으면(드묾) 먼저 기다린 쪽이 저속으로 비켜 지나간다
    if (blocker && blocker.blocker === c && c.blockedT > 4 && c.blockedT >= blocker.blockedT) { this.deadlockBreak(c); blocker = null; }
    c.blocker = blocker;
    if (blocker) { c.speed = 0; c.blockedT += dt; return; }
    c.blockedT = 0;
    c.speed = Math.min(vmax, c.speed + AMR.accel * dt);
    const remain = c.len - c.s;
    if (remain < 1.2) c.speed = Math.min(c.speed, Math.max(0.25, remain));
    const ds = Math.min(remain, c.speed * dt);
    c.s += ds; c.odo += ds; c.moveT += dt; if (loaded) c.loadedT += dt;
    if (c.kind === 'amr') c.battery = Math.max(0, c.battery - BATTERY.moveDrain * dt);
    const p = pointOn(c.pts, c.s);
    c.x = p.x; c.z = p.z;
    const kind = c.kinds[Math.min(c.kinds.length - 1, p.seg - 1)];
    if (kind === 'lane' && (p.hx || p.hz)) c.yawT = Math.atan2(-p.hz, p.hx);
    if (c.release && c.s >= c.release.at) { const sl = c.release.slot; if (sl.occupant === c) sl.occupant = null; c.release = null; }
    if (c.s >= c.len - 1e-6) this.arrive(c);
  }
  queueHead(c) {
    // 대기 지점에 선 차가 여럿이면 가장 오래 기다린 차가 먼저
    const waiting = this.carriers.filter((o) => o.pts && !o.reserved && o.target === c.target && o.s >= o.hold);
    return waiting.every((o) => o.waitT <= c.waitT);
  }
  deadlockBreak(c) {
    // 서로 가로막은 채 오래 멈춘 경우 (드묾) — 오래 기다린 쪽이 천천히 비켜 지나간다
    if (!this.dlLogged || this.t - this.dlLogged > 300) { this.dlLogged = this.t; this.log('warn', 'HAND', null, `${c.id} 장시간 정체 — 저속 회피 주행 허가`); }
    return true;
  }
  arrive(c) {
    const slot = c.target;
    c.pts = null; c.state = 'docked'; c.docked = slot; slot.occupant = c; slot.reservedBy = null; c.reserved = false; c.target = null;
    c.x = slot.x; c.z = slot.z; c.speed = 0; c.waitT = 0; c.dockedAt = this.t;
    c.yawT = slot.lane.startsWith('M') ? 0 : Math.PI;
    if (slot.cell === 'PARK') { c.state = 'park'; return; }
    if (slot.cell === 'C09') { c.state = 'charge'; this.log('info', 'ASSET', 'C09', `${c.id} 충전 시작 (${c.battery.toFixed(0)}%)`, { amr: c.id }); }
  }

  // ── 셀 처리 ──
  cycleOf(st, job) {
    const base = CYCLE[st.id][family(job.product)] ?? 30;
    let m = this.mode.cycleMul;
    if (this.modeKey === 'legacy' && (st.id === 'C06' || st.id === 'C07')) m *= 1.25;   // 수검사·수작업 재작업
    return base * m * this.r(0.95, 1.06);
  }
  startTask(st, c) {
    const job = c.job, mode = this.mode, plan = [], fam = family(job.product);
    st.carrier = c; st.taskStart = this.t; c.served = true; c.taskDone = false;
    const ep = { cell: st.id, t0: this.t, phases: [], faults: [], robots: st.def.robots.map((r) => r.id), recipe: `${st.id}-${job.product}-v1` };
    job.ep.steps.push(ep); st.ep = ep;
    // 인계: 도킹·클램프·ID 확인 (레거시는 사람이 대차에서 내려 셀에 올린다)
    let ho = mode.handOff * this.r(0.85, 1.2);
    plan.push({ ph: 'handoff', d: ho, label: c.kind === 'cart' ? '수작업 로딩' : '도킹·클램프·ID 확인' });
    if (c.kind === 'amr' && this.chance(FAULTS.AMR_DOCK.p * mode.faultMul)) plan.push(this.faultSteps('AMR_DOCK', st, job));
    // 실러 대기시간 ([S1] C04: 대기시간 확인, 초과 → 격리 검토)
    if (st.id === 'C05' && job.sealedAt != null && this.t - job.sealedAt > SEAL_OPEN_TIME) {
      this.k.sealOver++;
      if (this.chance(0.55)) job.defects.add('SEAL');
      this.log('warn', 'PROC', 'C05', `${job.id} 실러 도포 후 ${Math.round(this.t - job.sealedAt)}초 경과 (허용 ${SEAL_OPEN_TIME}초 초과) — 비드 품질 위험`, { job: job.id });
    }
    // 전환: 제품군이 바뀌면 그리퍼·레시피·지그 프로그램 전환 (LH↔RH는 미러 레시피라 짧다)
    if (st.lastProd && st.lastProd !== job.product && st.id !== 'C08' && st.id !== 'C07') {
      const same = st.lastFam === fam;
      let d = mode.changeover * (same ? 0.4 : 1) * (st.id === 'C06' ? 0.3 : 1);
      plan.push({ ph: 'change', d, label: `${PRODUCTS[st.lastProd].short} → ${PRODUCTS[job.product].short} 전환`, famChange: !same });
      this.k.changes++; this.k.changeLoss += d;
    }
    st.lastProd = job.product; st.lastFam = fam;
    // 팁 드레싱 (C03)
    if (st.id === 'C03') {
      const pol = mode.tipDress;
      const need = pol === 'schedule' ? st.weldsSinceDress >= TIP.schedule : pol === 'predictive' ? st.tipWear >= TIP.predictAt : st.tipWear >= 1.3 || st.dressReq;
      if (need) {
        const d = TIP.dressTime * (pol === 'predictive' ? 0.8 : pol === 'reactive' ? 1.6 : 1);
        plan.push({ ph: 'dress', d, label: '전극 팁 드레싱', dress: true });
      }
    }
    const work = this.cycleOf(st, job);
    // 이상 판정 (계획 단계에서 정해 두고 해당 단계가 시작될 때 기록한다)
    const faults = [];
    for (const [k, f] of Object.entries(FAULTS)) if (f.cell === st.id && this.chance(f.p * mode.faultMul)) faults.push(k);
    const inj = this.injected.findIndex((x) => x.cell === st.id);
    let alarm = ROBOT_CELLS.has(st.id) && this.chance(ROBOT_ALARM_P * mode.faultMul);
    if (inj >= 0) { const x = this.injected.splice(inj, 1)[0]; if (x.kind === 'ROBOT_ALARM') alarm = true; else if (!faults.includes(x.kind)) faults.push(x.kind); }
    plan.push({ ph: 'work', d: work * 0.55, label: TASKS[st.id]?.[0] ?? '작업' });
    for (const k of faults) plan.push(this.faultSteps(k, st, job));
    if (alarm) plan.push(this.alarmSteps(st));
    plan.push({ ph: 'work', d: work * 0.45, label: TASKS[st.id]?.slice(-1)[0] ?? '작업', last: true });
    // 피지컬AI: 실링 시작 전에 헤밍 셀 가용을 예측해 대기시간 초과를 막는다
    if (st.id === 'C04' && this.modeKey === 'dark') plan.splice(1, 0, { ph: 'wait', d: 0, label: '헤밍 셀 가용 예측 대기', sealGate: true });
    st.plan = plan; st.pi = -1; this.nextPhase(st);
  }
  faultSteps(k, st, job) {
    const f = FAULTS[k], m = this.mode;
    // 레거시: 놓치면 그대로 잠재 불량, 잡으면 사람이 조치(L2) / 자동화·피지컬AI: L1 셀 즉각 조치 → 실패 시 L2 상위 판단
    const missed = this.chance(m.latent);
    let l1 = false, l2 = false, cmd = null, t1 = 0, t2 = 0;
    if (!missed) {
      if (m.l1.ok > 0) { t1 = m.l1.t * this.r(0.7, 1.4); l1 = this.chance(m.l1.ok); }
      if (this.modeKey === 'dark' && ['POS_DEV', 'MOUNT_DEV', 'SEAL_BEAD', 'WELD_MISS'].includes(k)) {
        // AI 보정 명령 → 명령 검증 계층 (작업공간·힘·속도 한계·인터록). 거부되면 룰 기반 대체경로(재안착 등)
        const val = k === 'SEAL_BEAD' ? `토출 +${this.r(3, 14).toFixed(1)}%` : k === 'WELD_MISS' ? `재용접 ${Math.ceil(this.r(1, 4))}점` : `보정 ${this.r(0.4, 3.6).toFixed(1)}mm / ${this.r(0.1, 1.2).toFixed(2)}°`;
        cmd = { val, ok: this.chance(0.93) };
        if (!cmd.ok) { t1 += 8; l1 = this.chance(0.85); }
      }
      if (!l1) { t2 = this.r(m.l2.t[0], m.l2.t[1]); l2 = this.chance(m.l2.ok); }
    }
    return { ph: 'recover', d: missed ? 0 : t1 + t2, fault: k, missed, l1, l2, cmd, t1, t2, label: f.label, job: job.id };
  }
  alarmSteps(st) {
    const r = st.robots[Math.floor(this.rand() * Math.max(1, st.robots.length))];
    return { ph: 'down', d: this.mode.mttr * this.r(0.7, 1.3), label: `${r?.id ?? st.id} 로봇 알람 (서보·통신)`, robot: r?.id };
  }
  nextPhase(st) {
    if (st.cur) st.ep.phases.push({ ph: st.cur.ph, label: st.cur.label, t0: st.cur.t0, t1: this.t });
    st.pi++;
    const p = st.plan[st.pi];
    if (!p) return this.finishTask(st);
    p.t0 = this.t; st.cur = p; st.phase = p.ph; st.phaseT = 0; st.phaseDur = p.d; st.state = PH_STATE[p.ph] ?? 'RUN';
    for (const r of st.robots) r.state = p.ph === 'work' ? 'work' : p.ph === 'down' && r.id === p.robot ? 'alarm' : p.ph === 'recover' ? 'adjust' : 'idle';
    const job = st.carrier.job;
    if (p.ph === 'recover') this.beginFault(st, p, job);
    if (p.ph === 'down') {
      this.k.alarms++; this.k.human++; st.lastAlarm = this.t; st.health = Math.max(0.5, st.health - 0.1);
      this.log('alarm', 'ASSET', st.id, `${p.label} — 셀 정지, 상위 보고 (L2 정비 출동, 예상 ${Math.round(p.d / 60)}분)`, { job: job?.id });
      st.ep.faults.push({ kind: 'ROBOT_ALARM', t: this.t, level: 'L2', result: 'maintenance' });
    }
    if (p.dress) {
      this.k.dress++;
      this.log(this.modeKey === 'dark' ? 'agent' : 'info', 'ASSET', 'C03', `전극 팁 드레싱 (마모 ${(st.tipWear * 100).toFixed(0)}%, ${this.modeKey === 'dark' ? '예지 — 전류·저항 추세 기반' : this.modeKey === 'smart' ? `정기 ${TIP.schedule}건 주기` : '품질 저하 확인 후'})`);
    }
    // 제품군 전환은 C01 투입 시점에 한 번만 기록 (후속 셀 레시피는 PA Agent가 선행 로딩)
    if (p.ph === 'change' && st.id === 'C01' && p.famChange) this.log(this.modeKey === 'dark' ? 'agent' : 'info', 'PROC', 'C01', `${p.label} — ${this.modeKey === 'dark' ? '후속 셀 C02~C06 레시피·그리퍼 선행 로딩' : this.modeKey === 'smart' ? '셀마다 툴체인저·레시피 호출' : '셀마다 지그·그리퍼 수작업 교체'}`, { job: job?.id });
  }
  beginFault(st, p, job) {
    const f = FAULTS[p.fault];
    this.k.faults++;
    const rec = { kind: p.fault, t: this.t, missed: p.missed, l1: p.l1, l2: p.l2, cmd: p.cmd };
    st.ep.faults.push(rec); st.faultNow = p.fault;
    if (p.missed) {
      if (f.defect) job.defects.add(f.defect);
      return;   // 놓친 이상은 기록되지 않는다 (검사에서 드러남)
    }
    const block = { ID_MISMATCH: 'PERC', OVERLAP: 'PERC', POS_DEV: 'HAND', WELD_MISS: 'PROC', SEAL_BEAD: 'PROC', HEM_SEAT: 'HAND', MOUNT_DEV: 'HAND', AMR_DOCK: 'HAND' }[p.fault] ?? 'PROC';
    this.log('warn', 'PERC', st.id, `${job.id} ${f.label} 감지`, { job: job.id, fault: p.fault });
    if (this.mode.l1.ok > 0) {
      this.k.l1++;
      if (p.cmd) {
        if (p.cmd.ok) this.k.cmdOk++; else this.k.cmdRej++;
        this.log('cmd', 'PROC', st.id, `명령 검증 ${p.cmd.ok ? '통과' : '거부 — 허용 범위 초과, 룰 기반 대체경로'}: ${p.cmd.val}`, { job: job.id });
      }
      if (p.l1) { this.k.l1ok++; this.log('L1', block, st.id, `L1 셀 즉각 조치: ${f.l1} → 복구 (${Math.round(p.t1)}초)`, { job: job.id }); }
      else this.log('L1', block, st.id, `L1 ${f.l1} 실패 → 상위 보고`, { job: job.id });
    }
    if (!p.l1) {
      this.k.l2++;
      const human = this.modeKey !== 'dark';
      if (human) this.k.human++;
      const by = human ? 'HUMAN' : 'ORCH';
      if (p.l2) this.k.l2ok++;
      else if (f.defect) job.defects.add(f.defect);
      this.log('L2', by, st.id, `L2 상위 판단: ${f.l2} → ${p.l2 ? '복구' : '미복구 (불량 위험 표시 후 진행)'} (${Math.round(p.t2)}초)`, { job: job.id });
    }
    this.k.recoverSum += p.d; this.k.recoverN++;
  }
  finishTask(st) {
    const c = st.carrier, job = c.job;
    st.ep.t1 = this.t; st.cur = null; st.faultNow = null;
    // 연계 실패: 사람 개입(원격 승인·수작업 조치)·미복구·고장 정지 ([S2] 성공률 = 정상 완료 ÷ 전체 수행, 실패 포함)
    const humanTouched = st.plan.some((p) => (p.ph === 'recover' && !p.missed && !p.l1 && (this.modeKey !== 'dark' || !p.l2)) || p.ph === 'down');
    st.ep.outcome = 'done';
    // 셀별 결과
    const dr = DRIFT[st.id];
    if (dr && this.chance(dr[1] * this.mode.drift)) job.defects.add(dr[0]);
    if (st.id === 'C03') {
      st.tipWear += TIP.wearPerJob * (family(job.product) === 'HOOD' ? 1 : 0.85); st.weldsSinceDress++;
      if (st.tipWear > 1 && this.chance(Math.min(0.5, (st.tipWear - 1) * 1.2))) job.defects.add('TIP');
    }
    if (st.id === 'C04') job.sealedAt = this.t;
    if (st.id === 'C06') this.inspect(st, job);
    if (st.id === 'C07') this.reworkDone(st, job);
    st.done++;
    this.linkStep(!humanTouched);
    st.state = 'DONE'; st.phase = 'done'; st.plan = null;
    for (const r of st.robots) r.state = 'idle';
    job.step++; c.taskDone = true;
    if (st.id === 'C08') this.ship(st, c);
  }
  linkStep(ok) { this.k.linkTotal++; if (ok) this.k.linkOk++; }
  inspect(st, job) {
    const first = !job.inspected;
    job.inspected = (job.inspected ?? 0) + 1;
    const found = [...job.defects].filter(() => this.chance(this.mode.detect));
    if (first) this.k.inspected1++;
    if (found.length) {
      job.ng = found;
      st.ep.outcome = 'NG';
      this.log('warn', 'QREC', 'C06', `${job.id} NG — ${found.map((d) => DEFECTS[d]).join(', ')} → C07 재작업 배정`, { job: job.id });
      if (found.includes('TIP')) {
        this.stations.C03.dressReq = true;
        if (this.modeKey !== 'dark') this.log('info', 'QREC', 'C03', '용접 품질 저하 추적 — 팁 드레싱 요청');
      }
    } else {
      job.ng = null;
      if (first) this.k.pass1++;
      st.ep.outcome = 'OK';
      if (job.defects.size) job.leaked = [...job.defects];   // 검사에서 못 잡은 불량
    }
  }
  reworkDone(st, job) {
    this.k.rework++;
    if (this.chance(this.mode.rework)) {
      this.k.reworkOk++; job.defects.clear(); job.ng = null; job.reworked = (job.reworked ?? 0) + 1;
      st.ep.outcome = 'repaired';
      this.log('ok', 'QREC', 'C07', `${job.id} 재작업 완료 → C06 재검${this.modeKey === 'dark' ? ' (재검 자동 승인)' : ' (재검 승인)'}`, { job: job.id });
    } else {
      job.scrap = true; st.ep.outcome = 'scrap';
      this.log('alarm', 'QREC', 'C07', `${job.id} 재작업 불가 — 격리 랙 이동 (폐기)`, { job: job.id });
    }
  }
  ship(st, c) {
    const job = c.job;
    this.k.good++; this.k.byProduct[job.product]++; this.k.shippedAt.push(this.t);
    if (this.k.shippedAt.length > 4000) this.k.shippedAt.splice(0, 1000);
    if (job.leaked) this.k.leaked++;
    if (job.order) { job.order.good++; this.orderProgress(job.order); }
    this.closeJob(job, job.leaked ? 'shipped_with_defect' : 'shipped');
    c.job = null;
  }
  orderProgress(o) {
    const n = o.good + o.scrap;
    if (n >= o.qty && !o.doneAt) {
      o.doneAt = this.t;
      this.log('ok', 'ORCH', null, `${o.id} 완료 — ${o.qty}개 중 양품 ${o.good}개 (${((o.doneAt - o.createdAt) / 60).toFixed(0)}분)`, { order: o.id });
    } else if (n % 10 === 0 && n > 0) this.log('info', 'ORCH', null, `${o.id} 진척 — ${o.qty}개 중 ${n}개 완료`, { order: o.id });
  }
  closeJob(job, result) {
    job.ep.t1 = this.t; job.ep.result = result; job.ep.defects = [...job.defects]; job.ep.reworked = job.reworked ?? 0;
    this.episodes.push(job.ep);
    if (this.episodes.length > this.epKeep) this.episodes.shift();
    this.jobs.delete(job.id);
  }
  releaseJob(c) {
    const nx = this.nextProduct();
    if (!nx) return false;
    const id = `JOB-${pad(++this.jobSeq)}`;
    const job = { id, product: nx.product, order: nx.order, route: routeOf(nx.product), step: 0, defects: new Set(), createdAt: this.t, carrier: c.id };
    job.ep = { episode_id: `EP-${pad(this.jobSeq)}`, job_id: id, order_id: nx.order?.id ?? null, product: nx.product, mode: this.modeKey, carrier: c.id, t0: this.t, steps: [] };
    this.jobs.set(id, job); c.job = job; this.k.released++;
    return true;
  }
  // 다음 행선지 (도킹 중인 셀의 작업이 끝났을 때)
  nextSlotFor(c, st) {
    const job = c.job;
    if (!job) {
      if (this.needCharge(c, st)) { const s = this.L.slots.C09.find((x) => this.slotFree(x, c)); if (s) return { slot: s, reserved: true }; }
      return this.emptyTarget(c);
    }
    if (st.id === 'C06' && job.ng) return this.pickSlot('C07', c);
    if (st.id === 'C07') return this.pickSlot('C06', c);
    const nextId = job.route[job.route.indexOf(st.id) + 1];
    return this.pickSlot(nextId, c);
  }
  // 빈 AMR 행선지: 일감이 있고 C01 대기열에 자리가 있으면 대기열, 아니면 대기 구역 (없으면 그래도 대기열)
  workAvailable() { return this.continuous || this.orders.some((o) => o.released < o.qty); }
  queueLen(except) { return this.carriers.filter((o) => o !== except && !o.job && !o.docked && o.target?.cell === 'C01' && !o.reserved).length; }
  emptyTarget(c) {
    if (this.workAvailable() && this.queueLen(c) < QUEUE_CAP) return { slot: this.L.slots.C01[0], reserved: false };
    const p = this.L.slots.PARK.find((x) => this.slotFree(x, c));
    if (p) return { slot: p, reserved: true };
    return this.queueLen(c) < QUEUE_CAP ? { slot: this.L.slots.C01[0], reserved: false } : null;
  }
  pickSlot(cell, c) {
    const slots = this.L.slots[cell];
    const free = slots.find((s) => this.slotFree(s, c));
    if (free) return { slot: free, reserved: true };
    // 선행 대기 (자동화·피지컬AI): 다음 셀 앞 차로 대기 지점까지 미리 간다
    const fromTop = c.docked && CELLS[c.docked.cell].row === 'top';   // 주 이송 동선에서 출발하는 흐름만
    if (this.mode.prequeue && fromTop && PREQUEUE.includes(cell) && slots.length === 1 && !slots[0].queueBy && slots[0].reservedBy !== c) {
      slots[0].queueBy = c; return { slot: slots[0], reserved: false, queued: true };
    }
    return null;
  }
  needCharge(c, st) {
    if (c.kind !== 'amr' || st?.id !== 'C08') return false;
    if (this.mode.battery === 'threshold') return c.battery < BATTERY.low;
    if (this.mode.battery === 'opportunistic') {
      const queued = this.carriers.filter((o) => !o.job && o !== c && o.target?.cell === 'C01').length;
      return c.battery < BATTERY.low || (c.battery < BATTERY.opportunistic && queued >= 3);
    }
    return false;
  }
  tryDepart(c) {
    const st = this.stations[c.docked.cell];
    if (c.job?.scrap) {
      if (c.job.order) { c.job.order.scrap++; this.orderProgress(c.job.order); }
      this.k.scrap++; this.closeJob(c.job, 'scrap'); c.job = null;
    }
    const want = this.nextSlotFor(c, st);
    if (!want) {
      if (st.id === 'C06' && c.job?.ng) this.trySwap(c);   // NG 대기가 꽉 차고 재검 차가 C06을 기다리면 맞교대
      return;
    }
    if (!this.laneClearForMerge(c, c.docked)) return;
    if (st.carrier === c) { st.carrier = null; if (!st.plan) { st.state = 'IDLE'; st.phase = null; } }
    this.goTo(c, want.slot, want.reserved);
    if (want.slot.cell === 'C09') this.log('agent', 'ASSET', 'C09', `${c.id} 충전 배정 (${c.battery.toFixed(0)}%${this.mode.battery === 'opportunistic' && c.battery >= BATTERY.low ? ', 대기열 여유 → 기회 충전' : ''})`, { amr: c.id });
  }
  trySwap(c) {
    const mate = this.L.slots.C07.map((s) => s.occupant).find((o) => o && o.taskDone && o.job && !o.job.ng && !o.job.scrap);
    if (!mate) return;
    const mySlot = c.docked, mateSlot = mate.docked;
    // 동시에 출발: mate는 C06로, c는 mate의 C07 슬롯으로
    this.stations.C06.carrier = null; this.stations.C06.state = 'IDLE';
    mateSlot.occupant = null; mySlot.occupant = null;
    this.goTo(c, mateSlot, true); this.goTo(mate, mySlot, true);
    c.release = null; mate.release = null;
    this.log('info', 'HAND', 'C07', `${c.id} ↔ ${mate.id} NG 대기·재검 맞교대`);
  }

  // ── 메인 스텝 ──
  step(dt) {
    if (this.paused) return;
    if (this.estop) { for (const st of Object.values(this.stations)) st.state = 'SAFE_STOP'; return; }
    this.t += dt;
    // 셀
    for (const st of Object.values(this.stations)) {
      if (st.plan) {
        const p = st.cur;
        if (p.sealGate) {
          const h = this.stations.C05, busyLeft = h.plan ? h.plan.slice(h.pi).reduce((a, x) => a + x.d, 0) - h.phaseT : 0;
          const myLeft = st.plan.slice(st.pi + 1).reduce((a, x) => a + x.d, 0);
          const ok = h.state !== 'DOWN' && (!h.slots[0].occupant || busyLeft < myLeft + 40) && !(h.state === 'DONE' && h.slots[0].occupant);
          if (!ok) {
            st.phaseT += dt; st.state = 'HOLD';
            if (!p.logged && st.phaseT > 3) { p.logged = true; this.k.sealHold++; this.log('agent', 'PROC', 'C04', `실링 시작 보류 — 헤밍 셀 가용 예측 대기 (실러 대기시간 ${SEAL_OPEN_TIME}초 관리)`, { job: st.carrier.job.id }); }
            continue;
          }
          this.nextPhase(st); continue;
        }
        st.phaseT += dt; st.busyT += dt;
        if (st.phase === 'down') st.downT += dt;
        if (st.phase === 'change' || st.phase === 'dress') st.changeT += dt;
        if (st.phaseT >= st.phaseDur) {
          if (st.phase === 'dress') { st.tipWear = 0; st.weldsSinceDress = 0; st.dressReq = false; }
          this.nextPhase(st);
        }
      } else {
        const occ = st.slots.map((s) => s.occupant).filter(Boolean);
        if (st.id === 'C09') { st.state = occ.length ? 'RUN' : 'IDLE'; continue; }
        if (occ.length && occ.every((o) => o.taskDone)) st.blockedT += dt;
        // 대기 중인 도킹 차 가운데 작업할 차를 고른다
        const ready = occ.filter((o) => o.state === 'docked' && !o.served);
        if (occ.some((o) => o.taskDone)) st.state = 'DONE';
        if (ready.length) {
          ready.sort((a, b) => a.dockedAt - b.dockedAt);
          const c = ready[0];
          if (st.id === 'C01' && !c.job) {
            if (this.releaseJob(c)) { c.served = true; this.startTask(st, c); }
            else { st.starvedT += dt; st.state = 'IDLE'; }
          } else if (c.job) {
            c.served = true; this.startTask(st, c);
          }
        } else if (!occ.length) { st.state = 'IDLE'; st.starvedT += dt; }
      }
    }
    // 이동체
    for (const c of this.carriers) {
      c.yaw = lerpAngle(c.yaw, c.yawT ?? c.yaw, Math.min(1, dt * 3));
      if (c.state === 'charge') {
        c.battery = Math.min(100, c.battery + BATTERY.charge * dt);
        const queued = this.carriers.filter((o) => !o.job && o.target?.cell === 'C01').length;
        const leave = c.battery >= BATTERY.full || (this.mode.battery === 'opportunistic' && c.battery > 60 && queued < 2);
        if (leave) {
          const w = this.emptyTarget(c);
          if (w) {
            this.log('info', 'ASSET', 'C09', `${c.id} 충전 완료 (${c.battery.toFixed(0)}%) → ${w.slot.cell === 'PARK' ? 'AMR 대기 구역' : 'C01 대기열'}`, { amr: c.id });
            c.state = 'docked'; this.goTo(c, w.slot, w.reserved);
          }
        }
        continue;
      }
      if (c.state === 'park') {
        if (c.kind === 'amr') c.battery = Math.max(0, c.battery - BATTERY.idleDrain * 0.3 * dt);
        if (this.workAvailable() && this.queueLen(c) < QUEUE_CAP - 1 && this.laneClearForMerge(c, c.docked)) { c.state = 'docked'; this.goTo(c, this.L.slots.C01[0], false); }
        continue;
      }
      if (c.state === 'docked') {
        if (c.kind === 'amr') c.battery = Math.max(0, c.battery - BATTERY.idleDrain * dt);
        if (c.taskDone) this.tryDepart(c);
        continue;
      }
      if (c.state === 'move') {
        if (c.kind === 'amr' && c.job && this.chance(dt * 0.00012 * this.mode.faultMul) && this.t > c.delayUntil + 120) this.delayCarrier(c);
        this.moveCarrier(c, dt);
      }
    }
    // 표본
    const sec = Math.floor(this.t / 30);
    if (sec !== this.lastSample) { this.lastSample = sec; this.sample(); }
  }
  run(seconds, dt = 0.2) { const n = Math.round(seconds / dt); for (let i = 0; i < n; i++) this.step(dt); return this; }

  // ── 지표 ──
  uph(window = 600) {
    const t0 = this.t - window;
    const n = this.k.shippedAt.filter((x) => x > t0).length;
    return (n * 3600) / Math.min(window, Math.max(60, this.t));
  }
  kpis() {
    const k = this.k, T = Math.max(1, this.t);
    const ideal = 58;   // 이상 C/T (C03 후드 기준 자동화 C/T의 90%, 가정)
    const st = Object.values(this.stations);
    const robotCells = st.filter((s) => ROBOT_CELLS.has(s.id) && s.done);
    const amrs = this.carriers;
    const wip = this.jobs.size;
    return {
      t: this.t, good: k.good, scrap: k.scrap, leaked: k.leaked, released: k.released, wip,
      uph: this.uph(), uphAvg: (k.good * 3600) / T,
      oee: Math.min(100, (k.good * ideal * 100) / T),
      fpy: k.inspected1 ? (k.pass1 * 100) / k.inspected1 : 100,
      reworkRate: k.rework ? (k.reworkOk * 100) / k.rework : 100,
      linkRate: k.linkTotal ? (k.linkOk * 100) / k.linkTotal : 100,
      recoverAvg: k.recoverN ? k.recoverSum / k.recoverN : 0,
      changes: k.changes, changeLoss: k.changeLoss, human: k.human, alarms: k.alarms, faults: k.faults,
      l1Rate: k.l1 ? (k.l1ok * 100) / k.l1 : 0, l2: k.l2, cmdOk: k.cmdOk, cmdRej: k.cmdRej, sealOver: k.sealOver, sealHold: k.sealHold, dress: k.dress,
      amrUtil: (amrs.reduce((a, c) => a + c.loadedT, 0) * 100) / (amrs.length * T),
      battAvg: amrs[0]?.kind === 'amr' ? amrs.reduce((a, c) => a + c.battery, 0) / amrs.length : null,
      battMin: amrs[0]?.kind === 'amr' ? Math.min(...amrs.map((c) => c.battery)) : null,
      cellUtil: Object.fromEntries(st.map((s) => [s.id, (s.busyT * 100) / T])),
      robotCells: robotCells.length, humans: this.mode.humans, byProduct: { ...k.byProduct },
      bottleneck: st.filter((s) => s.id !== 'C09').sort((a, b) => b.busyT - a.busyT)[0]?.id,
    };
  }
  sample() {
    const q = this.kpis();
    this.series.push({ t: this.t, uph: q.uph, oee: q.oee, link: q.linkRate, wip: q.wip, good: q.good });
    if (this.series.length > 2000) this.series.shift();
  }
  snapshot() {
    const q = this.kpis();
    return {
      clock: fmtClock(this.t), mode: this.modeKey, mix: this.mix, kpi: q,
      cells: Object.fromEntries(Object.values(this.stations).map((s) => [s.id, { state: s.state, phase: s.cur?.label ?? null, job: s.carrier?.job?.id ?? null, product: s.carrier?.job?.product ?? null, util: q.cellUtil[s.id], tipWear: s.id === 'C03' ? s.tipWear : undefined }])),
      amrs: this.carriers.map((c) => ({ id: c.id, state: c.state, job: c.job?.id ?? null, battery: c.kind === 'amr' ? +c.battery.toFixed(1) : null, at: c.docked?.cell ?? null })),
      orders: this.orders.map((o) => ({ id: o.id, label: o.label, qty: o.qty, good: o.good, scrap: o.scrap, done: !!o.doneAt })),
      recent: this.events.slice(-12).map((e) => `${fmtClock(e.t)} [${e.level}] ${e.cell ?? ''} ${e.msg}`),
    };
  }
}

function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}
export function countBy(arr) { const o = {}; for (const x of arr) o[x] = (o[x] ?? 0) + 1; return o; }

// 같은 조건으로 세 단계를 돌려 비교 (진화 컨셉 화면·시험용)
export function compareModes({ hours = 8, mix = '2:1', seed = 11, dt = 0.25 } = {}) {
  const out = {};
  for (const m of Object.keys(MODES)) out[m] = new Simulation({ mode: m, mix, seed }).run(hours * 3600, dt).kpis();
  return out;
}
