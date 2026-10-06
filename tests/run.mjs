// 자동 시험 — npm test. 렌더링 없이 시뮬레이션·동선·데이터·지시 해석을 검증한다.
import assert from 'node:assert/strict';
import { Simulation, compareModes } from '../js/sim.js';
import { buildLanes, shortestPath } from '../js/lanes.js';
import { CELLS, ROUTES, MODES, MIXES, mixSequence } from '../js/zone.js';
import { parseOrder } from '../js/order.js';
import { DataHub } from '../js/datahub.js';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('동선');
await t('모든 경로 단계 사이에 차로 경로가 있다 (NG·재검·충전 포함)', () => {
  const L = buildLanes();
  const pairs = [];
  for (const r of Object.values(ROUTES)) for (let i = 1; i < r.length; i++) pairs.push([r[i - 1], r[i]]);
  pairs.push(['C06', 'C07'], ['C07', 'C06'], ['C08', 'C09'], ['C09', 'C01'], ['C08', 'C01'], ['C07', 'C01']);
  for (const [a, b] of pairs) for (const sa of L.slots[a]) for (const sb of L.slots[b]) assert.ok(shortestPath(L, sa.dock, sb.dock), `${a}→${b} 경로 없음`);
});
await t('셀이 서로 겹치지 않는다', () => {
  const ids = Object.keys(CELLS);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = CELLS[ids[i]], b = CELLS[ids[j]];
    if (a.row !== b.row) continue;
    assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 - 1e-6, `${ids[i]}·${ids[j]} 겹침`);
  }
});

console.log('시뮬레이션');
await t('3단계 × 4혼류 × 3시드 8시간 — 교착 없이 생산 (UPH 하한)', () => {
  const floor = { legacy: 12, smart: 30, dark: 36 };
  for (const mode of Object.keys(MODES)) for (const mix of Object.keys(MIXES)) for (let seed = 1; seed <= 3; seed++) {
    const k = new Simulation({ mode, mix, seed }).run(8 * 3600, 0.25).kpis();
    assert.ok(k.uphAvg >= floor[mode], `${mode}/${mix}/seed${seed} UPH ${k.uphAvg.toFixed(1)} < ${floor[mode]}`);
  }
});
await t('단계가 올라갈수록 생산량·직행률이 좋아지고 사람 개입이 준다', () => {
  const r = compareModes({ hours: 8, mix: '2:1', seed: 5 });
  assert.ok(r.legacy.good < r.smart.good && r.smart.good < r.dark.good, `양품 ${r.legacy.good}/${r.smart.good}/${r.dark.good}`);
  assert.ok(r.legacy.fpy < r.dark.fpy, 'FPY');
  assert.ok(r.dark.human < r.smart.human && r.smart.human < r.legacy.human, '사람 개입');
});
await t('자동화·피지컬AI 통합 연계 성공률 ≥ 95% (도출서 KPI)', () => {
  for (const mode of ['smart', 'dark']) {
    const k = new Simulation({ mode, mix: '2:1', seed: 9 }).run(8 * 3600, 0.25).kpis();
    assert.ok(k.linkRate >= 95, `${mode} ${k.linkRate.toFixed(1)}%`);
  }
});
await t('혼류 손실: 레거시는 혼류 시 크게 떨어지고 피지컬AI는 거의 그대로', () => {
  const u = (mode, mix) => new Simulation({ mode, mix, seed: 4 }).run(8 * 3600, 0.25).kpis().uphAvg;
  const lg = u('legacy', '2:1') / u('legacy', 'hood'), dk = u('dark', '2:1') / u('dark', 'hood');
  assert.ok(lg < 0.85, `레거시 비율 ${lg.toFixed(2)}`);
  assert.ok(dk > 0.93, `피지컬AI 비율 ${dk.toFixed(2)}`);
});
await t('생산 지시 100개 → 완료 기록 · 공통 ID 에피소드', () => {
  const s = new Simulation({ mode: 'dark', mix: '2:1', seed: 2, continuous: false });
  const o = s.addOrder({ items: { HOOD: 60, DOOR_LH: 20, DOOR_RH: 20 } });
  s.run(4 * 3600, 0.25);
  assert.ok(o.doneAt, `완료 안 됨 (${o.good + o.scrap}/${o.qty})`);
  assert.equal(o.good + o.scrap, 100);
  const ep = s.episodes.find((e) => e.order_id === o.id);
  assert.ok(ep && ep.job_id && ep.episode_id && ep.steps.length >= 7, '에피소드 구조');
  assert.deepEqual(ep.steps.slice(0, 6).map((x) => x.cell), ['C01', 'C02', 'C03', 'C04', 'C05', 'C06']);
});
await t('이상 주입 → L1/L2 기록, NG → C07 재작업 → C06 재검', () => {
  const s = new Simulation({ mode: 'smart', mix: 'hood', seed: 3 });
  s.run(600, 0.25);
  for (let i = 0; i < 4; i++) s.inject('POS_DEV');
  s.inject('ROBOT_ALARM', 'C03');
  s.run(3 * 3600, 0.25);
  assert.ok(s.events.some((e) => e.level === 'L1' && e.cell === 'C02'), 'L1 없음');
  assert.ok(s.events.some((e) => e.level === 'alarm' && e.cell === 'C03'), '로봇 알람 없음');
  const rw = s.episodes.find((e) => e.steps.some((x) => x.cell === 'C07' && x.outcome === 'repaired'));
  assert.ok(rw, '재작업 성공 에피소드 없음');
  const cells = rw.steps.map((x) => x.cell), i = cells.indexOf('C07');
  assert.equal(cells[i + 1], 'C06', '재검');
  assert.ok(s.k.rework > 0, '재작업 없음');
});
await t('비상정지 동안 시간·이동이 멈춘다', () => {
  const s = new Simulation({ mode: 'dark', seed: 1 }); s.run(300, 0.25);
  const t0 = s.t, pos = s.carriers.map((c) => c.x + c.z);
  s.estop = true; s.run(120, 0.25);
  assert.equal(s.t, t0); assert.deepEqual(s.carriers.map((c) => c.x + c.z), pos);
  assert.ok(Object.values(s.stations).every((x) => x.state === 'SAFE_STOP'));
});
await t('AMR가 충전소를 쓰고 배터리가 바닥나지 않는다', () => {
  const s = new Simulation({ mode: 'smart', seed: 6 }).run(10 * 3600, 0.25);
  assert.ok(s.events.some((e) => /충전 시작/.test(e.msg)), '충전 없음');
  assert.ok(Math.min(...s.carriers.map((c) => c.battery)) > 5, '배터리 고갈');
});
await t('혼류 평준화 순서 (2:1 → 후드 비율 2/3, LOT 묶음)', () => {
  const q = mixSequence('2:1', 90);
  assert.equal(q.filter((p) => p === 'HOOD').length, 60);
  const lot = mixSequence('2:1', 40, 10);
  assert.ok(lot.slice(0, 10).every((p) => p === lot[0]));
});

console.log('지시 해석');
await t('자연어 생산 지시', () => {
  assert.deepEqual(parseOrder('후드 100개 생산').items, { HOOD: 100 });
  assert.deepEqual(parseOrder('도어 LH 20 RH 30').items, { DOOR_LH: 20, DOOR_RH: 30 });
  assert.deepEqual(parseOrder('후드 60 도어 40').items, { HOOD: 60, DOOR_LH: 20, DOOR_RH: 20 });
  assert.deepEqual(parseOrder('L타입 50개 R타입 50개').items, { DOOR_LH: 50, DOOR_RH: 50 });
  assert.equal(parseOrder('100개 생산').qty, 100);
  assert.equal(parseOrder('혼류 1:1').mix, '1:1');
  assert.ok(parseOrder('안녕').error);
});

console.log('데이터');
await t('OPC UA PubSub JSON · AAS 환경 · 내보내기', () => {
  const s = new Simulation({ mode: 'dark', seed: 3 }).run(1800, 0.25);
  const hub = new DataHub();
  const msgs = hub.networkMessages(s);
  assert.ok(msgs.length >= 10 + 12);
  const m = JSON.parse(msgs.find((x) => x.topic.endsWith('/C03')).payload);
  assert.equal(m.MessageType, 'ua-data');
  assert.equal(m.Messages[0].MessageType, 'ua-keyframe');
  assert.ok('TipWear' in m.Messages[0].Payload && 'State' in m.Messages[0].Payload);
  const env = hub.aasEnvironment(s);
  assert.equal(env.submodels.length, env.assetAdministrationShells.length * 3);
  assert.ok(env.assetAdministrationShells.every((a) => a.id.startsWith('urn:camtic:metafactory:A-1:')));
  const csv = hub.eventsCsv(s).split('\n');
  assert.ok(csv[0].startsWith('utc,') && csv.length > 5);
  const jl = hub.episodesJsonl(s).split('\n').map((l) => JSON.parse(l));
  assert.ok(jl.length > 0 && jl[0].t0_utc.endsWith('Z'));
});

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
