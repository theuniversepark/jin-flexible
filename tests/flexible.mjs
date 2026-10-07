// 유연생산 Zone(A-1) 검증 — 셀 구성·경로(후드/도어 분기, NG → C07 재작업), 단계별 제품 전환·LOT, 혼류 손실, 통합 연계 성공률. 실행: npm test
import { zoneLine, ZONE_CELLS, ZONE_EDGES, ZONE_ROUTES, lineEdges } from '../js/line.js';
import { Simulation, MODES } from '../js/sim.js';
import { FactoryAgent } from '../js/agent.js';
let pass = 0, fail = 0;
const check = (name, ok, info = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const run = (mode, mix, T, seed = 3) => {
  const s = new Simulation(mode, seed, { line: zoneLine(mix), quiet: true }), ag = new FactoryAgent(s);
  for (let t = 0; t < T; t += 0.1) { s.step(0.1); ag.update(0.1); }
  return s;
};

console.log('== 셀 구성 · 경로');
check('셀 8개: C01~C05 · C10 · C06 · C07 (WP6 라인 개념도)', Object.keys(ZONE_CELLS).join() === 'C01,C02,C03,C04,C05,C10,C06,C07');
check('후드는 C10을 거치지 않고, 도어만 C10 정밀 장착을 거친다', !ZONE_ROUTES.hood.includes('C10') && ZONE_ROUTES.door.includes('C10'));
check('NG 분기: C06 → C07 → C08 (구분 적재장)', ZONE_EDGES.some((e) => e[0] === 'C06' && e[1] === 'C07' && e[2] === 'ng') && ZONE_EDGES.some((e) => e[0] === 'C07' && e[1] === 'SINK'));
check('라인 연결 그래프 = ZONE_EDGES', lineEdges(zoneLine()).length === ZONE_EDGES.length);
{ const s = new Simulation('smart', 1, { line: zoneLine(), quiet: true });
  const c05 = s.stations.find((x) => x.id === 'C05'), c06 = s.stations.find((x) => x.id === 'C06');
  check('C05 출구: 후드 → C06 · 도어 → C10', c05.outs.hood?.to.id === 'C06' && c05.outs.door?.to.id === 'C10');
  check('C06 출구: 합격 → C08 · NG → C07', c06.outs['*']?.to.id === 'SINK' && c06.outs.ng?.to.id === 'C07');
  check('아랫줄·가운데 셀은 서쪽 흐름(rot π)', ['C06', 'C07', 'C10'].every((id) => Math.abs(s.stations.find((x) => x.id === id).rot - Math.PI) < 1e-9)); }

console.log('== 생산 흐름 (자동화 2시간, 2:1 혼류)');
{ const s = run('smart', '2:1', 7200);
  const c10 = s.stations.find((x) => x.id === 'C10');
  check('후드·도어 모두 출하', (s.stats.goodBy.hood ?? 0) > 20 && (s.stats.goodBy.door ?? 0) > 8, JSON.stringify(s.stats.goodBy));
  check('C10은 도어 수만큼만 작업 (후드 통과 없음)', c10.c.processed <= (s.releasedBy.door ?? 0) && c10.c.processed >= (s.stats.goodBy.door ?? 0), `C10 ${c10.c.processed} · 도어 투입 ${s.releasedBy.door} · 출하 ${s.stats.goodBy.door}`);
  const k = s.kpi();
  check('통합 연계 성공률 ≥ 95% (도출서 KPI)', k.linkRate >= 0.95, `${(k.linkRate * 100).toFixed(1)}%`);
  check('병목 = C03 가접·본용접 (가동률 최고)', s.processing.slice().sort((a, b) => b.c.busy - a.c.busy)[0].id === 'C03'); }

console.log('== NG → C07 재작업 → 재검');
{ const s = new Simulation('smart', 5, { line: zoneLine(), quiet: true }), ag = new FactoryAgent(s);
  s.mode.defectBase *= 12;   // 불량을 일부러 늘려 NG 흐름을 본다
  for (let t = 0; t < 7200; t += 0.1) { s.step(0.1); ag.update(0.1); }
  const c07 = s.stations.find((x) => x.id === 'C07');
  check('검사 NG가 폐기 대신 C07로 분기', (s.stats.ng ?? 0) > 0 && c07.c.processed > 0, `NG ${s.stats.ng} · C07 처리 ${c07.c.processed}`);
  check('재작업 성공분은 양품으로 출하', (s.stats.reworkOk ?? 0) > 0 && (s.stats.reworkOk ?? 0) <= (s.stats.reworked ?? 0), `재작업 ${s.stats.reworked} · 성공 ${s.stats.reworkOk}`);
  check('재작업 성공률 ≈ 단계 설정값', (s.stats.reworkOk ?? 0) / Math.max(1, s.stats.reworked) > MODES.smart.reworkRate - 0.15);
  const sink = s.stations.at(-1), fromC07 = sink.ins.find((c) => c.from.id === 'C07');
  check('재작업품이 C08 구분 적재장에 적재된다 (C07 → C08 경로에 멈춰 쌓이지 않음)', (s.stats.reworkShipped ?? 0) >= (s.stats.reworkOk ?? 0) - 2 && fromC07.items.length <= 2, `재작업 성공 ${s.stats.reworkOk} · 적재 ${s.stats.reworkShipped ?? 0} · C07 → C08 대기 ${fromC07.items.length}대`);
  check('NG가 많아도 라인이 멈추지 않는다 (양품 출하 계속)', s.stats.good > 40, `양품 ${s.stats.good}`); }

console.log('== 단계별 제품 전환 · LOT (1:1 혼류, 2시간)');
{ const R = Object.fromEntries(['traditional', 'smart', 'dark'].map((m) => [m, run(m, '1:1', 7200, 4)]));
  const L = R.traditional.stats, S = R.smart.stats, D = R.dark.stats;
  check('LOT: 레거시 10 · 자동화 3 · 피지컬AI 1', MODES.traditional.lot === 10 && MODES.smart.lot === 3 && MODES.dark.lot === 1);
  check('전환 횟수: 피지컬AI(1개 단위 혼류) > 자동화 > 레거시', (D.changes ?? 0) > (S.changes ?? 0) && (S.changes ?? 0) > (L.changes ?? 0), `레거시 ${L.changes} · 자동화 ${S.changes} · 피지컬AI ${D.changes}`);
  check('전환 1회 손실: 레거시 240초 > 자동화 25초 > 피지컬AI 2초', MODES.traditional.changeover > MODES.smart.changeover && MODES.smart.changeover > MODES.dark.changeover);
  check('생산량: 피지컬AI > 자동화 > 레거시', D.good > S.good && S.good > L.good, `${L.good} · ${S.good} · ${D.good}`); }

console.log('== 혼류 손실 (후드만 대비 1:1 혼류, 2시간)');
{ const u = (m, mix) => run(m, mix, 7200, 6).stats.good;
  const lg = u('traditional', '1:1') / u('traditional', 'dt'), dk = u('dark', '1:1') / u('dark', 'dt');
  check('레거시는 혼류 시 생산량이 크게 준다 (LOT 전환)', lg < 0.9, `${(lg * 100).toFixed(0)}%`);
  check('피지컬AI는 혼류해도 거의 그대로 (레거시보다 손실이 작다)', dk > lg && dk > 0.85, `${(dk * 100).toFixed(0)}%`); }

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
