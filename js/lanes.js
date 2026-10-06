// AMR 이송 동선 — 일방통행 차로 그래프와 도킹 슬롯.
// 주 이송 동선(동쪽 →) · 오른쪽 통제 이송(인터록) · 복귀 동선(서쪽 ←) · 왼쪽 연결로가 하나의 순환로를 이루고,
// 셀마다 차로에서 도킹 위치(D)로 들어가는 짧은 스퍼가 붙는다. ([S1] 11쪽 라인 개념도)
//  · C07 → C06 재검 링크, C08 ↔ C09 충전 링크는 차로를 거치지 않는 셀 사이 직결 통로다.
import { CELLS, LAY, PARK } from './zone.js';

// 슬롯: 셀의 도킹 위치. 다중 슬롯 셀(C07 NG 대기 2, C09 충전 2)은 x를 나눠 둔다
function slotXs(id) {
  const c = CELLS[id];
  if (id === 'C07') return [c.x - 1.3, c.x + 1.3];
  if (id === 'C09') return [c.x - 1.3, c.x + 1.3];
  return [c.x];
}

export function buildLanes() {
  const nodes = new Map(), edges = new Map();
  const node = (id, x, z) => { nodes.set(id, { id, x, z }); edges.set(id, []); return id; };
  const link = (a, b, kind = 'lane') => {
    const A = nodes.get(a), B = nodes.get(b);
    edges.get(a).push({ to: b, len: Math.hypot(B.x - A.x, B.z - A.z), kind });
  };
  const slots = {};
  const mainXs = [], retXs = [];
  for (const [id, c] of Object.entries(CELLS)) {
    slots[id] = slotXs(id).map((x, i) => {
      const top = c.row === 'top';
      const lane = node(`${top ? 'M' : 'R'}:${id}:${i}`, x, top ? LAY.mainZ : LAY.retZ);
      const dock = node(`D:${id}:${i}`, x, top ? LAY.dockTopZ : LAY.dockBotZ);
      (top ? mainXs : retXs).push({ x, id: lane });
      link(lane, dock, 'spur'); link(dock, lane, 'spur');
      return { cell: id, i, dock, lane, x, z: nodes.get(dock).z, occupant: null, reservedBy: null };
    });
  }
  slots.PARK = PARK.map((p, i) => {
    const top = p.row === 'top';
    const lane = node(`${top ? 'M' : 'R'}:PARK:${i}`, p.x, top ? LAY.mainZ : LAY.retZ);
    const dock = node(`D:PARK:${i}`, p.x, top ? LAY.dockTopZ : LAY.dockBotZ);
    (top ? mainXs : retXs).push({ x: p.x, id: lane });
    link(lane, dock, 'spur'); link(dock, lane, 'spur');
    return { cell: 'PARK', i, dock, lane, x: p.x, z: nodes.get(dock).z, occupant: null, reservedBy: null };
  });
  node('M:L', LAY.leftX, LAY.mainZ); node('M:R', LAY.rightX, LAY.mainZ);
  node('R:R', LAY.rightX, LAY.retZ); node('R:L', LAY.leftX, LAY.retZ);
  // 주 이송 동선: 서 → 동
  const main = ['M:L', ...mainXs.sort((a, b) => a.x - b.x).map((n) => n.id), 'M:R'];
  for (let i = 1; i < main.length; i++) link(main[i - 1], main[i]);
  link('M:R', 'R:R', 'interlock');   // 통제 이송 (C05 → C06 인터록 구간)
  // 복귀 동선: 동 → 서
  const ret = ['R:R', ...retXs.sort((a, b) => b.x - a.x).map((n) => n.id), 'R:L'];
  for (let i = 1; i < ret.length; i++) link(ret[i - 1], ret[i]);
  link('R:L', 'M:L');                // 왼쪽 연결로 (빈 AMR → C01 대기열)
  // 셀 사이 직결 통로 — 도킹 위치보다 셀 안쪽(innerZ)으로 지나가 옆 슬롯에 선 AMR과 부딪히지 않는다
  const c06 = slots.C06[0], c08 = slots.C08[0];
  node('V:C06:in', c06.x - 3.6, LAY.innerZ); link('V:C06:in', c06.dock, 'direct');
  for (const s of slots.C07) { const v = node(`V:C07:${s.i}`, s.x, LAY.innerZ); link(s.dock, v, 'direct'); link(v, 'V:C06:in', 'direct'); }   // 재검
  node('V:C08:out', c08.x + 2.6, LAY.innerZ); link(c08.dock, 'V:C08:out', 'direct');
  for (const s of slots.C09) { const v = node(`V:C09:${s.i}`, s.x, LAY.innerZ); link('V:C08:out', v, 'direct'); link(v, s.dock, 'direct'); }   // 충전 출동
  return { nodes, edges, slots, main, ret };
}

// 최단 경로 (Dijkstra) — 노드 id 배열
export function shortestPath(L, from, to) {
  if (from === to) return [from];
  const dist = new Map([[from, 0]]), prev = new Map(), done = new Set();
  const open = [from];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(open[i]) < dist.get(open[bi])) bi = i;
    const u = open.splice(bi, 1)[0];
    if (u === to) break;
    if (done.has(u)) continue;
    done.add(u);
    for (const e of L.edges.get(u)) {
      const d = dist.get(u) + e.len;
      if (d < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, d); prev.set(e.to, u); open.push(e.to); }
    }
  }
  if (!prev.has(to)) return null;
  const out = [to];
  while (out[0] !== from) out.unshift(prev.get(out[0]));
  return out;
}
export const pathPoints = (L, ids) => ids.map((id) => ({ x: L.nodes.get(id).x, z: L.nodes.get(id).z, id }));

export function polyLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return s;
}
// 경로 위 거리 s의 위치와 진행 방향
export function pointOn(pts, s) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (s <= L || i === pts.length - 1) {
      const k = L ? Math.max(0, Math.min(1, s / L)) : 1;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, hx: L ? (b.x - a.x) / L : 0, hz: L ? (b.z - a.z) / L : 0, seg: i };
    }
    s -= L;
  }
  const p = pts[pts.length - 1];
  return { x: p.x, z: p.z, hx: 0, hz: 0, seg: pts.length - 1 };
}
