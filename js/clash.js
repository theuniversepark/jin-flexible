// 로봇·설비 간섭 검사 — 3D 장면의 메시를 회전 박스(OBB)로 보고 분리축 판정(SAT)으로 겹침을 찾는다.
//  ① 같은 셀 로봇끼리  ② 로봇 팔 ↔ 그 셀 설비  ③ 설비·로봇 팔 ↔ AMR·작업물 통로(셀 가운데, 판넬 높이까지)  ④ 이웃 셀 로봇끼리
//  ⑤ 이동체(운반 AMR·AGV·지게차·휴머노이드·사족보행·작업자) ↔ 셀 로봇·설비  ⑥ 이동체끼리
// 그리퍼(공구 끝) 아래는 작업물·부품 빈과 닿는 것이 정상 작업이라 ②·③에서 뺀다. 얇은 바닥 판·투명 패드·라벨·입자는 보지 않는다.
// tests/clash.cjs(Electron)가 시뮬레이션을 돌리며 매 프레임 부른다 — 화면에서도 window.__twin.clash()로 부를 수 있다.
import * as THREE from 'three';
import { moverRadius, moverWidth } from './sim.js';

const V = () => new THREE.Vector3();
const _m = new THREE.Matrix4();

// 메시 → OBB { c: 중심, u: [축 3개], e: [반길이 3개] } (월드 좌표)
function obbOf(mesh, shrink = 0) {
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox, mw = mesh.matrixWorld;
  const lc = bb.getCenter(V()), le = bb.getSize(V()).multiplyScalar(0.5);
  const c = lc.applyMatrix4(mw);
  const u = [V(), V(), V()], e = [0, 0, 0];
  mw.extractBasis(u[0], u[1], u[2]);
  for (let i = 0; i < 3; i++) { const len = u[i].length() || 1; u[i].divideScalar(len); e[i] = Math.max(0, le.getComponent(i) * len - shrink); }
  return { c, u, e };
}
export function boxOBB(center, axes, half) { return { c: center.clone(), u: axes.map((a) => a.clone().normalize()), e: half.slice() }; }

// 두 OBB가 겹치는가 (분리축 15개). margin: 이만큼 떨어져 있어도 겹침으로 본다
export function obbHit(A, B, margin = 0) {
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], AR = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], EPS = 1e-6;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { R[i][j] = A.u[i].dot(B.u[j]); AR[i][j] = Math.abs(R[i][j]) + EPS; }
  const d = B.c.clone().sub(A.c), t = [d.dot(A.u[0]), d.dot(A.u[1]), d.dot(A.u[2])];
  const a = A.e, b = B.e;
  for (let i = 0; i < 3; i++) if (Math.abs(t[i]) > a[i] + b[0] * AR[i][0] + b[1] * AR[i][1] + b[2] * AR[i][2] + margin) return false;
  for (let j = 0; j < 3; j++) if (Math.abs(t[0] * R[0][j] + t[1] * R[1][j] + t[2] * R[2][j]) > b[j] + a[0] * AR[0][j] + a[1] * AR[1][j] + a[2] * AR[2][j] + margin) return false;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const i1 = (i + 1) % 3, i2 = (i + 2) % 3, j1 = (j + 1) % 3, j2 = (j + 2) % 3;
    const ra = a[i1] * AR[i2][j] + a[i2] * AR[i1][j], rb = b[j1] * AR[i][j2] + b[j2] * AR[i][j1];
    if (Math.abs(t[i2] * R[i1][j] - t[i1] * R[i2][j]) > ra + rb + margin) return false;
  }
  return true;
}

const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
const isSolid = (o) => {
  if (!o.isMesh || o.isPoints || o.isSprite || !shown(o)) return false;
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  if (m?.transparent && m.opacity < 0.3) return false;   // 투명 패드·스캔 빔
  if (m?.isMeshBasicMaterial && m.blending === THREE.AdditiveBlending) return false;
  return true;
};
// 바닥에 깔린 얇은 판 (셀 바닥·로봇 받침판·라벨 판) — 부딪힐 몸체가 아니다
function flat(o) { const b = obbOf(o); return b.c.y - Math.max(b.e[1], b.e[0] * Math.abs(b.u[0].y), b.e[2] * Math.abs(b.u[2].y)) < 0.12 && minHalf(b) < 0.03; }   // 바닥 표시(높이 0.12m 아래, 두께 6cm 미만)
const minHalf = (b) => Math.min(...b.e);

// 로봇 한 대의 메시: 몸체(links) · 공구 끝 아래(tool — 작업물·부품과 닿아도 정상)
function robotParts(r) {
  const links = [], tool = [];
  const tips = [r.tip, r.tip2].filter(Boolean);
  const toolRoots = new Set(tips.map((t) => t.parent ?? t));   // 공구 플랜지(마지막 마디)부터
  r.root.traverse((o) => {
    if (!isSolid(o)) return;
    let p = o, under = false; for (; p && p !== r.root; p = p.parent) if (toolRoots.has(p)) { under = true; break; }
    (under ? tool : links).push(o);
  });
  return { links, tool };
}

// AMR·작업물 통로: 셀 로컬 x ±2.35(셀 길이), z ±0.62(AMR 폭·판넬 반폭), 높이 0.05~1.12(지그 0.92m + 판넬 두께 0.15m + 여유)
export const CORRIDOR = { hx: 2.35, hz: 0.62, y0: 0.05, y1: 1.12 };
function corridorOBB(sv) {
  const g = sv.group; g.updateMatrixWorld();
  const c = new THREE.Vector3(0, (CORRIDOR.y0 + CORRIDOR.y1) / 2, 0).applyMatrix4(g.matrixWorld);
  const u = [V(), V(), V()]; g.matrixWorld.extractBasis(u[0], u[1], u[2]);
  return { c, u: u.map((a) => a.normalize()), e: [CORRIDOR.hx, (CORRIDOR.y1 - CORRIDOR.y0) / 2, CORRIDOR.hz] };
}

// 이름이 없는 메시는 셀 로컬 위치·크기로 알아보게 쓴다
const nameOf = (o, root) => {
  for (let p = o; p && p !== root; p = p.parent) if (p.name) return p.name;
  const b = obbOf(o), inv = _m.copy(root.matrixWorld).invert(), lp = b.c.clone().applyMatrix4(inv);
  const size = b.e.map((x) => (x * 2).toFixed(2)).join('×');
  return `${o.geometry?.type?.replace('Geometry', '') ?? 'mesh'}@(${lp.x.toFixed(2)},${lp.y.toFixed(2)},${lp.z.toFixed(2)}) ${size}`;
};

// 한 번 검사 — 겹친 쌍 목록. opts.margin: 여유 간격(m)
export function checkClashes(view, opts = {}) {
  const margin = opts.margin ?? 0.0, out = [], amr = opts.amr ?? !!view.sim?.useAMR;   // 레거시는 컨베이어 — AMR 통로 검사 없음
  const svs = view.stationViews.filter((sv) => sv.st.type !== 'source');
  view.root.updateMatrixWorld(true);
  const robotsAll = [];
  for (const sv of svs) {
    const sinkArms = sv.st.type === 'sink' ? Object.entries(sv.parts.arms ?? {}).map(([k, A], i) => ({ root: A.arm.root, tip: A.arm.tip, uid: view.sim?.sinkRobotUids?.[i] ?? `적재 로봇 ${k}` })) : [];
    const robots = [...(sv.parts.robots ?? []).map((r, i) => ({ r, uid: sv.st.robotUids?.[i] ?? `${sv.st.id}#${i + 1}` })), ...sinkArms.map((r) => ({ r, uid: r.uid }))]
      .filter((x) => shown(x.r.root)).map((x) => ({ ...x, ...robotParts(x.r) }));
    const robotRoots = new Set(robots.map((x) => x.r.root));
    const inRobot = (o) => { for (let p = o; p && p !== sv.group; p = p.parent) if (robotRoots.has(p)) return true; return false; };
    const equip = [];
    sv.group.traverse((o) => { if (isSolid(o) && !inRobot(o) && !flat(o)) equip.push(o); });
    const eqO = equip.map((o) => ({ o, b: obbOf(o, 0.005) }));
    const cor = corridorOBB(sv);
    sv._eq = eqO;   // ⑤ 이동체 검사에 쓴다
    // ③ 설비 ↔ 통로
    if (amr && sv.st.type !== 'sink') for (const { o, b } of eqO) if (obbHit(cor, b)) out.push({ kind: 'equip-corridor', cell: sv.st.id, a: nameOf(o, sv.group), y: +b.c.y.toFixed(2) });
    for (const R of robots) {
      R.lb = R.links.map((o) => ({ o, b: obbOf(o, 0.005) })); R.tb = R.tool.map((o) => ({ o, b: obbOf(o, 0.005) }));
      // ② 로봇 몸체 ↔ 설비 (공구 끝은 부품 빈·작업물과 닿아도 된다 — 설비 몸체(키 0.4m 넘는 것)와만 본다)
      for (const L of R.lb) for (const E of eqO) if (obbHit(L.b, E.b, margin)) out.push({ kind: 'robot-equip', cell: sv.st.id, a: R.uid, b: nameOf(E.o, sv.group), y: +L.b.c.y.toFixed(2) });
      for (const T of R.tb) for (const E of eqO) if (E.b.e[1] > 0.2 && E.b.c.y + E.b.e[1] > 0.5 && obbHit(T.b, E.b, margin)) out.push({ kind: 'tool-equip', cell: sv.st.id, a: R.uid, b: nameOf(E.o, sv.group), y: +T.b.c.y.toFixed(2) });
      // ③ 로봇 몸체 ↔ 통로 (팔이 AMR·판넬을 치고 지나가는지)
      if (amr && sv.st.type !== 'sink') for (const L of R.lb) if (obbHit(L.b, cor)) out.push({ kind: 'robot-corridor', cell: sv.st.id, a: R.uid, y: +L.b.c.y.toFixed(2) });
      robotsAll.push({ ...R, cell: sv.st.id });
    }
  }
  // ①·④ 로봇끼리 (같은 셀·이웃 셀) — 몸체·공구 모두
  for (let i = 0; i < robotsAll.length; i++) for (let j = i + 1; j < robotsAll.length; j++) {
    const A = robotsAll[i], B = robotsAll[j];
    const pa = A.r.root.getWorldPosition(V()), pb = B.r.root.getWorldPosition(V());
    if (pa.distanceTo(pb) > 4.5) continue;
    const aa = [...A.lb, ...A.tb], bb = [...B.lb, ...B.tb];
    let hit = false;
    for (const x of aa) { for (const y of bb) if (obbHit(x.b, y.b, margin)) { hit = true; break; } if (hit) break; }
    if (hit) out.push({ kind: A.cell === B.cell ? 'robot-robot' : 'robot-robot-cells', cell: A.cell === B.cell ? A.cell : `${A.cell}/${B.cell}`, a: A.uid, b: B.uid });
  }
  // ⑤ 이동체(AGV·지게차·정비/물류 휴머노이드·사족보행·작업자) ↔ 셀 로봇 팔·키 큰 설비 — 이동체는 충돌 반지름의 기둥으로 본다
  if (opts.movers !== false && view.sim) {
    // 운반 AMR(carrier)은 셀 안 통로를 지나며 로봇 공구가 그 위 판넬을 집는다 — 공구 끝은 빼고 로봇 몸체·설비와만 보고, 셀 통로 안에서는 ③ 통로 검사가 맡는다
    const S = view.sim, movers = [...S.carriers, ...S.vehicles, ...S.forklifts, ...S.techs, ...S.helpers, ...S.quads, ...S.workers];
    const H = { forklift: 2.3, agv: 0.5, carrier: 0.45, humanoid: 1.75, human: 1.75, worker: 1.75, quadruped: 0.7, robot: 1.2 };
    // 이동체 몸체: 옆으로는 차체 폭의 반, 앞뒤로는 충돌 반지름의 85% (사족보행·지게차처럼 긴 몸체)
    const box2 = (m) => { const r = moverRadius(m) * 0.85, w = Math.min(r, moverWidth(m) / 2), h = H[m.kind] ?? 1.6, yaw = m.heading ?? 0;
      return { c: new THREE.Vector3(m.x, h / 2, m.z), u: [new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))], e: [w, h / 2, r] }; };
    const inCell = (m) => m.kind === 'carrier' && svs.some((sv) => { const dx = m.x - sv.st.x, dz = m.z - sv.st.z, a = -sv.st.rot, lx = dx * Math.cos(a) + dz * Math.sin(a), lz = -dx * Math.sin(a) + dz * Math.cos(a); return Math.abs(lx) < 2.6 && Math.abs(lz) < CORRIDOR.hz + 0.1; });
    const mos = movers.map((m) => ({ m, b: box2(m) }));
    for (const { m, b: mo } of mos) {
      const amrIn = inCell(m);
      for (const R of robotsAll) {
        if (amrIn) continue;
        const p = R.r.root.getWorldPosition(V()); if (Math.hypot(p.x - m.x, p.z - m.z) > 3.5) continue;
        if ([...R.lb, ...(m.kind === 'carrier' ? [] : R.tb)].some((x) => obbHit(x.b, mo))) out.push({ kind: 'mover-robot', cell: R.cell, a: m.uid ?? m.id, b: R.uid });
      }
      for (const sv of svs) {
        if (amrIn) break;
        if (Math.hypot(sv.st.x - m.x, sv.st.z - m.z) > 5) continue;
        for (const E of sv._eq ?? []) if (E.b.e[1] > 0.2 && E.b.c.y + E.b.e[1] > 0.4 && obbHit(E.b, mo)) { out.push({ kind: 'mover-equip', cell: sv.st.id, a: m.uid ?? m.id, b: nameOf(E.o, sv.group) }); break; }
      }
    }
    // ⑥ 이동체끼리 — 바닥 자리(반지름 85%)가 겹치는지 (충전·도킹 중인 자기 도크는 sim이 따로 다룬다)
    for (let i = 0; i < mos.length; i++) for (let j = i + 1; j < mos.length; j++) {
      const A = mos[i], B = mos[j];
      if (Math.hypot(A.m.x - B.m.x, A.m.z - B.m.z) > 3) continue;
      if (obbHit(A.b, B.b)) out.push({ kind: 'mover-mover', cell: '-', a: A.m.uid ?? A.m.id, b: B.m.uid ?? B.m.id });
    }
  }
  return out;
}

// 여러 프레임 결과를 모아 요약 — 쌍마다 처음 본 시각과 횟수
export class ClashLog {
  constructor() { this.map = new Map(); this.frames = 0; }
  add(list, t) {
    this.frames++;
    for (const c of list) { const k = `${c.kind}|${c.cell}|${c.a}|${c.b ?? ''}`; const e = this.map.get(k); if (e) e.n++; else this.map.set(k, { ...c, n: 1, t0: t }); }
  }
  list() { return [...this.map.values()].sort((a, b) => b.n - a.n); }
}
