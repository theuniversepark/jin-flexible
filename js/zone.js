// 유연생산 Zone(A-1) 정의 — 셀·로봇·제품·경로·레이아웃·운영 단계 파라미터.
// 브라우저(시뮬레이션·3D·UI)와 Node(시험)가 함께 쓴다. DOM 의존 없음.
//
// 근거 자료 (docs/ZONE_DESIGN.md에 자세히):
//  [S1] WP6 제조셀 운영통제시스템 구조&내용 협의(KITECH) R3, 2026-10-01 — LT2 Hood Ass'y, A10~A80, C01~C10 라인 개념도
//  [S2] (유연제조) 공정시나리오 도출서 ver.1, 2026-09-21 국호형 — 6 STEP, 판정 분기, KPI(표준모델 3건·연계 성공률 95%)
//  [S3] WP6 내용 정리(발표 대본) — Cell OCS 핵심 역할 4종, 적용 순서 4단계
//  [S4] 연구개발계획서 부록(협약용) — A-1-1~A-1-4 Cell, 비용·구축 연차
//  [S5] 임시 테스트베드 구축계획 v2, 2026-09-02 — 창조2관 3층, A-1-1 600kW·A-1-2 200kW·A-1-3 100kW(KMP 1500P급)·A-1-4 50kW
//  [S6] 9/28 오후 논의 — 유연제조 존 에이전트 구조(안) 6블록
// 사이클·확률·속도 등 숫자 중 출처 표기가 없는 것은 시뮬레이션용 가정값이다 (도출서의 C/T는 모두 "실측 후 산정").

export const ZONE = {
  code: 'A-1',
  name: '유연생산 Zone',
  site: '피지컬AI 실증 메타팩토리 (임시: 전북대 창조2관 3층 → 완주 연구클러스터 공장동)',
  customer: '삼진산업',
  scenario: '도어·차체 판넬 혼류생산을 위한 PA Agent 기반 복수 Cell 협업',   // [S2]
  kpiTarget: { linkSuccess: 95, standardModels: 3 },                        // [S2]
};

// ── 제품 ──────────────────────────────────────────
// HOOD: [S1] 6쪽 — 외판(OTR) 1606×555×146mm 3.683kg, 내판(INR) 1603×543×141mm 3.101kg, 힌지·보강재·레일·스트라이커
// DOOR_*: [S2] "상용트럭 도어·차체 구성품" 혼류 확장 — 치수·중량은 가정값
export const PRODUCTS = {
  HOOD:    { label: 'LT2 후드 Ass\'y', short: '후드', color: 0x4aa3ff, css: '#4aa3ff', size: [1.606, 0.147, 0.555], massKg: 8.8, src: 'S1' },
  DOOR_LH: { label: '도어 Ass\'y LH', short: '도어L', color: 0xf0a030, css: '#f0a030', size: [1.25, 0.16, 1.10], massKg: 16, src: 'S2·가정' },
  DOOR_RH: { label: '도어 Ass\'y RH', short: '도어R', color: 0xff7a59, css: '#ff7a59', size: [1.25, 0.16, 1.10], massKg: 16, src: 'S2·가정' },
};
export const HOOD_PARTS = [
  { id: 'PNL-HOOD,OTR', label: '후드 외판', size: '1606×555×146', kg: 3.683 },
  { id: 'PNL-HOOD,INR', label: '후드 내판', size: '1603×543×141', kg: 3.101 },
  { id: 'HINGE ASS\'Y-HOOD LH/RH', label: '후드 힌지 LH/RH' },
  { id: 'REINF ASSY-HOOD HINGE LH/RH', label: '힌지 보강재 LH/RH' },
  { id: 'RAIL-HOOD,OTR', label: '외판 레일' },
  { id: 'STRIKER ASSY-HOOD', label: '스트라이커' },
];
export const isDoor = (p) => p === 'DOOR_LH' || p === 'DOOR_RH';
export const family = (p) => (isDoor(p) ? 'DOOR' : 'HOOD');

// 혼류 비율 (투입 순서는 비율대로 평준화 — 레거시는 LOT 단위로 묶는다)
export const MIXES = {
  hood: { label: '후드만', w: { HOOD: 1, DOOR_LH: 0, DOOR_RH: 0 } },
  '2:1': { label: '후드 2 : 도어 1', w: { HOOD: 2, DOOR_LH: 0.5, DOOR_RH: 0.5 } },
  '1:1': { label: '후드 1 : 도어 1', w: { HOOD: 1, DOOR_LH: 0.5, DOOR_RH: 0.5 } },
  door: { label: '도어만 (LH/RH)', w: { HOOD: 0, DOOR_LH: 1, DOOR_RH: 1 } },
};

// ── 레이아웃 (m) ──────────────────────────────────
// 좌표: x = 동쪽(공정 흐름 방향), z = 남쪽(화면 앞). [S1] 11쪽 라인 개념도를 그대로 옮겼다:
//  윗줄 C01~C05 순차 셀(뒤쪽 보전·유틸리티 공간) / 가운데 주 이송 동선(→) / 복귀 동선(←, 양품 회수·출하)
//  아랫줄 C08 양품·출하, C09 AMR 충전, C10 확장 예비공간, C07 NG·재작업, C06 치수·외관검사 / 오른쪽 끝 통제 이송(인터록)
export const LAY = {
  cellW: 6, cellD: 5.2,
  topZ: -7.0, dockTopZ: -3.95,
  mainZ: -2.55,          // 주 이송 동선 (동쪽 방향)
  retZ: 0.65,            // 복귀 동선 (서쪽 방향)
  dockBotZ: 2.05, botZ: 5.0, innerZ: 3.4,   // innerZ: 아랫줄 셀 안쪽 직결 통로 (C07→C06 재검, C08→C09 충전)
  leftX: -21, rightX: 19.2,
  bounds: { x0: -23.5, x1: 23.5, z0: -12, z1: 10.5 },
};

// type: 시각 모델·작업 애니메이션 종류. robots: 셀 로봇 (id는 [S1] 개념도의 R01~R06)
export const CELLS = {
  C01: { no: 'C01', label: '공급·키팅', step: 1, type: 'kitting', x: -14, z: LAY.topZ, w: 6, row: 'top',
    robots: [{ id: 'R01', kind: 'handling', label: '핸들링 로봇 (진공 그리퍼)' }],
    equip: ['부품 랙 (INR/OTR/SUB)', '부품 ID 인식 (바코드·RFID)', '겹침 감지 센서'], note: '로딩 / ID 확인', aseq: 'A10' },
  C02: { no: 'C02', label: '안착·보정', step: 2, type: 'locate', x: -7, z: LAY.topZ, w: 6, row: 'top',
    robots: [{ id: 'R02', kind: 'handling', label: '핸들링 로봇 + 3D 비전' }],
    equip: ['3D 비전 (6DoF 위치 보정)', '지그·클램프', '기준핀 센서'], note: '비전 / 6DoF 보정', aseq: 'A10·A40' },
  C03: { no: 'C03', label: '가접·본용접', step: 3, type: 'weld', x: 0, z: LAY.topZ, w: 6, row: 'top',
    robots: [{ id: 'R03', kind: 'spot', label: '스폿용접 로봇 (HS220급)' }, { id: 'R04', kind: 'spot', label: '스폿용접 로봇 (HS220급)' }],
    equip: ['서보 스폿건 2', '중앙 지그', '팁 드레서', '용접 타이머 (전류·가압 모니터링)'], note: '2대 협업 / 중앙 지그', aseq: 'A10·A20' },
  C04: { no: 'C04', label: '실링', step: 4, type: 'seal', x: 7, z: LAY.topZ, w: 6, row: 'top',
    robots: [{ id: 'R05', kind: 'sealer', label: '실링 로봇 (디스펜서)' }],
    equip: ['실러 디스펜서 (MASTIC·HEM\'G SEALER)', '비드 검사 카메라', '국소 배기'], note: '도포 / 비드 검사', aseq: 'A30·A40' },
  C05: { no: 'C05', label: '헤밍', step: 5, type: 'hem', x: 14, z: LAY.topZ, w: 6, row: 'top',
    robots: [{ id: 'R06', kind: 'handling', label: '로딩 로봇 (대형 판넬 그리퍼)' }],
    equip: ['전용 헤밍 프레스', '착좌 센서', '안전 위치 확인'], note: '로봇 투입 / 전용 프레스', aseq: 'A40·A50' },
  C06: { no: 'C06', label: '치수·외관검사', step: 6, type: 'inspect', x: 14, z: LAY.botZ, w: 6, row: 'bot',
    robots: [], equip: ['비전 카메라 2', '치수 게이지 (갭·단차)', '판정 PC'], note: '비전 / 치수 검사', aseq: 'A60~A80' },
  C07: { no: 'C07', label: 'NG·재작업', step: 6, type: 'rework', x: 6.9, z: LAY.botZ, w: 5.6, row: 'bot', cap: 2,
    robots: [], equip: ['NG 대기 1~2대', '재작업 스테이션 (재용접·재도포)', '격리 랙'], note: '격리 / 재검 승인' },
  C08: { no: 'C08', label: '양품·출하', step: 7, type: 'outbound', x: -14, z: LAY.botZ, w: 6, row: 'bot',
    robots: [], equip: ['양품 FIFO 랙 2', '리프트 이재기', '팔레트 적재'], note: 'FIFO 대기 / 출하' },
  C09: { no: 'C09', label: 'AMR 충전', step: 0, type: 'charge', x: -7.6, z: LAY.botZ, w: 4.6, row: 'bot', cap: 2,
    robots: [], equip: ['분리형 충전기 2'], note: '주 동선 외부 배치' },
  C10: { no: 'C10', label: '정밀 장착 (확장)', step: 5, type: 'mount', x: -0.6, z: LAY.botZ, w: 7.2, row: 'bot',
    robots: [{ id: 'R07', kind: 'handling', label: '장착 로봇 (A-1-2 연계)' }, { id: 'R08', kind: 'nutrunner', label: '체결 로봇 (너트러너)' }],
    equip: ['비전 인식 2', '툴체인저', '너트러너'], note: '도어-BIW 정밀조립 (A-1-2 확장)', ext: true },
};
// AMR 대기 구역 (차로 밖) — 일감이 없거나 C01 대기열이 차면 빈 AMR이 여기서 기다린다 (C01 서쪽 2 · C08 서쪽 2)
export const PARK = [{ x: -19.4, row: 'top' }, { x: -17.0, row: 'top' }, { x: -19.4, row: 'bot' }, { x: -17.0, row: 'bot' }];
export const QUEUE_CAP = 5;   // C01 대기열 (차로 위) 최대 대수 — 넘으면 복귀 동선의 C08 진입부를 막는다
export const WORK_CELLS = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C10', 'C08'];
export const dockOf = (id) => {
  const c = CELLS[id];
  return { x: c.x, z: c.row === 'top' ? LAY.dockTopZ : LAY.dockBotZ };
};

// 제품별 경로 ([S2] STEP 1~6, 도어는 STEP 5 정밀 장착을 C10에서). NG는 C06 → C07 → C06 재검
export const ROUTES = {
  HOOD: ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C08'],
  DOOR: ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C10', 'C08'],
};
export const routeOf = (p) => ROUTES[family(p)];

// 셀 작업 시간(초, 자동화 단계 기준 가정값) — 도출서 C/T는 "실측 후 산정"
export const CYCLE = {
  C01: { HOOD: 38, DOOR: 34 }, C02: { HOOD: 42, DOOR: 40 }, C03: { HOOD: 64, DOOR: 58 },
  C04: { HOOD: 46, DOOR: 40 }, C05: { HOOD: 52, DOOR: 48 }, C06: { HOOD: 30, DOOR: 30 },
  C07: { HOOD: 150, DOOR: 150 }, C10: { HOOD: 0, DOOR: 60 }, C08: { HOOD: 12, DOOR: 12 },
};
// 셀별 작업 내용 ([S2] 공정별 상세 Task 요약)
export const TASKS = {
  C01: ['작업지시·부품 ID 수신', '부품 종류·수량 확인', '투입 순서·키팅', '누락·오투입 시 보류', '후속 셀 가용 확인'],
  C02: ['형상·기준점·자세 인식', '파지점·접근자세 산출', '지그 안착·클램프 확인', '위치편차 6DoF 보정'],
  C03: ['기준점·위치편차 측정', '용접점·순서·조건 선택', 'DT 경로·간섭 검증', '가접·본용접 (2대 협업)', '누락·조건 이탈 확인'],
  C04: ['부품별 실링경로 선택', '속도·토출 조건 설정', '실링 실행·비드 확인', '대기시간 관리'],
  C05: ['외판·내판 위치 정렬', '헤밍 조건 확인', '헤밍 실행·착좌 확인', '안전 확인 후 취출 허가'],
  C06: ['작업 ID별 품질이력 조회', '치수·갭·단차·외관 판정', 'OK 인계 / NG 재작업 배정'],
  C07: ['NG 유형 확인', '재용접·재도포 보수', '재검 승인 요청'],
  C10: ['도어 작업 ID 대조', '상대 위치 측정·보정량 산출', '경로 검증 후 장착', '체결·갭·단차 확인'],
  C08: ['양품 이재 (FIFO)', '출하 실적 기록'],
};

// ── 이송 ──────────────────────────────────────────
// [S4] A-1-3: 고하중 AMR 12대·지그 12세트·Fleet 1식 / [S5] KMP 1500P급
export const AMR = { count: 12, loaded: 1.1, empty: 1.5, accel: 0.8, spacing: 2.3, len: 2.0, wid: 1.2 };
export const CART = { count: 10, speed: 0.75 };   // 레거시: 작업자 + 대차 (사람·지게차 운반 [S1] 15쪽)
export const BATTERY = { moveDrain: 0.009, idleDrain: 0.0022, charge: 0.06, low: 30, full: 92, opportunistic: 65 };   // %/초 (가정 — 연속 주행 약 3시간)
// 선행 대기: 다음 셀이 차 있으면 그 셀 앞 차로 대기 지점까지 미리 가서 기다린다 (Fleet 관제, 셀당 1대).
// 주 이송 동선의 셀과 C06 진입로만 — 복귀 동선은 다른 흐름(C06→C08)이 지나가므로 대기 차를 세우지 않는다
export const PREQUEUE = ['C02', 'C03', 'C04', 'C05', 'C06'];

// ── 운영 단계 ──────────────────────────────────────
// legacy: AS-IS ([S1] 15쪽 — 사람·지게차 운반, 수작업 로딩, 로봇 용접·실링, 프레스 헤밍, 수검사, 수작업 적재)
// smart:  TO-BE 1단계 — 기존 PLC 제어 유지 + AMR 이송·로봇 로딩 + 룰 기반 Cell OCS ([S3] 적용 순서 ①~③)
// dark:   TO-BE 최종 — PA Agent 기반 Cell OCS·Edge AI·복수 셀 협업 ([S2]·[S3] ④, 에이전트 6블록 [S6])
export const MODES = {
  legacy: {
    label: '레거시 (AS-IS)', short: '레거시', carrier: 'cart', lot: 10,
    cycleMul: 1.3, handOff: 14, changeover: 240, drift: 1.6, prequeue: true,
    detect: 0.86, rework: 0.85, faultMul: 1.3,
    l1: { ok: 0.0, t: 0 }, l2: { ok: 0.92, t: [70, 160] }, latent: 0.14,
    mttr: 900, tipDress: 'reactive', battery: false, humans: 9,
    desc: '사람이 운반·로딩하고 사람이 판단합니다. 대차·지게차 운반, 수작업 부품 로딩, 로봇 용접·실링, 프레스 헤밍, 수검사, 수작업 적재. 혼류는 LOT 10개 단위로 묶고 전환은 수작업입니다.',
  },
  smart: {
    label: '자동화 (TO-BE 1단계)', short: '자동화', carrier: 'amr', lot: 3,
    cycleMul: 1.0, handOff: 5, changeover: 25, drift: 1.0, prequeue: true,
    detect: 0.97, rework: 0.9, faultMul: 1.0,
    l1: { ok: 0.78, t: 14 }, l2: { ok: 0.95, t: [40, 75] }, latent: 0.05,
    mttr: 420, tipDress: 'schedule', battery: 'threshold', humans: 3,
    desc: '기존 PLC 제어를 유지하고 AMR 이송·로봇 로딩·룰 기반 Cell OCS를 붙였습니다. 이상은 정해진 재시도로 대응하고, 실패하면 운영자 원격 승인(L2)을 기다립니다.',
  },
  dark: {
    label: '피지컬AI (PA Agent)', short: '피지컬AI', carrier: 'amr', lot: 1,
    cycleMul: 0.93, handOff: 4, changeover: 6, drift: 0.55, prequeue: true,
    detect: 0.995, rework: 0.96, faultMul: 0.7,
    l1: { ok: 0.94, t: 6 }, l2: { ok: 0.985, t: [10, 22] }, latent: 0.012,
    mttr: 240, tipDress: 'predictive', battery: 'opportunistic', humans: 0,
    desc: 'PA Agent가 상태·품질을 보고 작업조건·순서·보정·재작업을 판단해 로봇·AMR·PLC로 실행합니다. AI 명령은 검증 계층을 통과해야 실행되고, 안전 PLC가 최종 권한을 가집니다.',
  },
};

// ── 이상 (셀 즉각 조치 L1 / 상위 판단 L2 — 2레벨 분류) ─────────
// p: 작업 1건당 발생 확률(자동화 기준, 가정값), defect: L1·L2로도 못 막으면 남는 잠재 불량
export const FAULTS = {
  ID_MISMATCH: { cell: 'C01', p: 0.025, label: '오투입·부품 누락', l1: '보류 후 재키팅', l2: '작업지시 재대조·투입 순서 조정', defect: 'MISSING' },
  OVERLAP:     { cell: 'C01', p: 0.012, label: '판넬 겹침 감지', l1: '재확인 후 격리', l2: '공급 랙 점검 요청', defect: null },
  POS_DEV:     { cell: 'C02', p: 0.06, label: '위치편차 허용 초과', l1: '비전 6DoF 보정·재안착', l2: '재도킹·지그 점검', defect: 'GAP' },
  WELD_MISS:   { cell: 'C03', p: 0.03, label: '용접 누락·신호 이상', l1: '추가 검사 후 재용접', l2: '용접 조건 재승인', defect: 'WELD' },
  SEAL_BEAD:   { cell: 'C04', p: 0.04, label: '실링 비드 불량', l1: '재도포 판단', l2: '토출 조건 보정', defect: 'SEAL' },
  HEM_SEAT:    { cell: 'C05', p: 0.03, label: '헤밍 착좌 이상', l1: '재안착', l2: '형상 NG 격리·원인 검토', defect: 'HEM' },
  MOUNT_DEV:   { cell: 'C10', p: 0.05, label: '장착 갭·단차 편차', l1: '재보정·재체결', l2: '경로 재검증', defect: 'GAP' },
  AMR_DOCK:    { cell: '*', p: 0.02, label: 'AMR 도킹 편차', l1: '재도킹', l2: '임무 재배정', defect: null },
};
export const DEFECTS = {
  MISSING: '부품 누락', GAP: '갭·단차 이탈', WELD: '용접 누락', SEAL: '실링 비드', HEM: '헤밍 형상', TIP: '팁 마모 용접 품질',
};
// 공정 산포로 생기는 기본 불량률 (작업 1건당, 자동화 기준 가정값) — 단계별 배율: 레거시 1.6 · 자동화 1 · 피지컬AI 0.55 (AI 공정 보정)
export const DRIFT = { C02: ['GAP', 0.004], C03: ['WELD', 0.006], C04: ['SEAL', 0.008], C05: ['HEM', 0.005], C10: ['GAP', 0.006] };
// C03 전극 팁: 용접 작업 n건마다 마모가 쌓이고 1.0을 넘으면 용접 품질 저하
export const TIP = { wearPerJob: 1 / 180, dressTime: 40, schedule: 120, predictAt: 0.78 };
// 로봇 고장 (L2 정비) — 로봇 셀 작업 1건당
export const ROBOT_ALARM_P = 0.0025;
// 실링 후 헤밍까지 대기 허용 시간(초) — 초과하면 실러 경화로 품질 위험 ([S1] C04 "대기시간 확인, 시간 초과 → 격리")
export const SEAL_OPEN_TIME = 180;

// ── PA Agent 6블록 ([S6] 9/28 유연제조 존 에이전트 구조(안)) ─────────
export const AGENTS = {
  ORCH: { label: 'Orchestration', ko: '오케스트레이션', desc: '작업지시·LOT 투입·혼류 평준화·AMR 임무 배정·재계획' },
  PERC: { label: 'Perception', ko: '인식', desc: '부품 ID·형상·기준점·편차 인식, 비드·외관 이상 감지' },
  HAND: { label: 'Handling', ko: '핸들링', desc: '파지·안착·도킹·인계, 재도킹 판단' },
  PROC: { label: 'Process', ko: '공정', desc: '레시피 선택·사전 로딩, 용접·실링·헤밍 조건 보정' },
  QREC: { label: 'Quality & Recovery', ko: '품질·복구', desc: 'OK/NG 판정, 재작업 배정, 격리, 결과 환류' },
  ASSET: { label: 'Asset Management', ko: '자산 관리', desc: '팁 드레싱 시점, AMR 배터리·충전, 로봇 건강도' },
};

// 셀 상태머신 — WP8 V12와 같은 상태 이름을 써서 존 간 정합을 맞춘다
export const CELL_STATES = {
  IDLE: { label: '대기', color: '#6c7a89' },
  READY: { label: '준비', color: '#37a0ff' },
  RUN: { label: '가동', color: '#3ddc84' },
  CHANGE: { label: '전환', color: '#b48cff' },
  DONE: { label: '완료·인계대기', color: '#2bb3a6' },
  HOLD: { label: '보류', color: '#f5b82e' },
  RECOVER: { label: '복구', color: '#ff9f43' },
  DOWN: { label: '고장', color: '#ff5a5a' },
  SAFE_STOP: { label: '안전정지', color: '#ff2d55' },
};

// 메타팩토리 A-1 Cell 로스터 ([S4] 협약용 부록, 비용 백만원 / [S5] 전력)
export const CELL_ROSTER = [
  { id: 'A-1-4', name: '유연생산 통합 OCS 시뮬레이션', year: 2026, cost: 2100, kw: 50, eq: 'DT 공정 시뮬레이션 SW · PLC 가상시운전 SW · DT·AI 서버 (RAM 256GB+, RTX 6000 Ada급)' },
  { id: 'A-1-3', name: 'AMR/AGV Cell 간 이동연계', year: 2027, cost: 2300, kw: 100, eq: '고하중 AMR 12대 · 지그 12세트 · Fleet 1식 (KMP 1500P급)' },
  { id: 'A-1-1', name: '금속 판넬 유연 제조 (용접조립)', year: 2028, cost: 3700, kw: 600, eq: '로봇 용접·접합 16대 · 실링·헤밍 2대 · 다중 캐리지' },
  { id: 'A-1-2', name: '정밀 위치 제어 부품 장착 조립', year: 2028, cost: 3250, kw: 200, eq: '비전 인식 2대 · 대형 판넬 그리퍼·툴체인저 · 6축 로봇 8대' },
];

// 혼류 평준화 순서 (가중치 비율을 최대한 고르게 섞음). lot>1이면 같은 제품을 lot개씩 묶는다
export function mixSequence(mixKey, n, lot = 1) {
  const w = (MIXES[mixKey] ?? MIXES['2:1']).w;
  const keys = Object.keys(w).filter((k) => w[k] > 0);
  const tot = keys.reduce((a, k) => a + w[k], 0);
  const acc = Object.fromEntries(keys.map((k) => [k, 0]));
  const units = [];
  for (let i = 0; i < Math.ceil(n / lot); i++) {
    for (const k of keys) acc[k] += w[k] / tot;
    let best = keys[0];
    for (const k of keys) if (acc[k] > acc[best]) best = k;
    acc[best] -= 1;
    units.push(best);
  }
  const out = [];
  for (const u of units) for (let j = 0; j < lot && out.length < n; j++) out.push(u);
  return out;
}
