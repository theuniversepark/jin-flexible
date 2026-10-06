# Jin-FMS — 피지컬AI 실증 메타팩토리 A-1 유연생산 Zone 운영 시뮬레이션

삼진산업 **LT2 후드 Ass'y 혼류생산**(+ 도어 LH/RH 확장)을 대상으로, 유연생산 Zone(A-1)의 셀·로봇·AMR·셀 운영통제(Cell OCS)·PA Agent 운영을 3D로 시뮬레이션합니다. 정밀조립 Zone 시뮬레이션 [jin-3d](https://github.com/theuniversepark/jin-3d)와 같은 구성(three.js · ES 모듈 · Node 서버 · 레거시 → 자동화 → 피지컬AI 3단계 · AAS / OPC UA PubSub over MQTT)으로 만들었습니다.

- 설계서: [docs/ZONE_DESIGN.md](docs/ZONE_DESIGN.md) — 근거 자료, 셀 구성, 동선, 운영 단계, Cell OCS·PA Agent, 데이터, KPI, 로드맵, 미정 사항

## 실행
```bash
npm install
npm start          # → http://localhost:8770  (내장 MQTT 브로커 mqtt://127.0.0.1:1884)
npm test           # 시뮬레이션·동선·데이터·지시 해석 자동 시험 13항목
```
ES 모듈을 쓰므로 `index.html`을 파일로 바로 열면 동작하지 않습니다. 정적 서버만 있어도 실행되며, 그때는 MQTT 발행 없이 파일 저장만 됩니다. 정밀조립 Zone(jin-3d, 8765·1883)과 동시에 켤 수 있습니다.

## 화면
- **상단**: 📋 시나리오(6 STEP·판정 분기·이상 대응표) · 🧭 단계 비교(같은 조건 8시간 3단계 비교) · 🧩 운영 계층(4계층·셀 상태머신·제어주기·WP 연계·PA Agent 6블록) · 📡 데이터(에피소드·이벤트·KPI·AAS 내보내기, OPC UA 메시지 예) · 📐 설계 / 단계 전환(레거시 › 자동화 › 피지컬AI, 키 1·2·3) · 🛑 비상정지 · 배속
- **왼쪽**: 혼류 비율(후드만 · 2:1 · 1:1 · 도어만), **생산 지시**("후드 100개 생산", "도어 LH 20 RH 20", "후드 60 도어 40", "혼류 1:1"), KPI(양품·UPH·OEE·직행률·통합 연계 성공률·이상 복구·사람 개입·전환 손실·유출 불량·AMR), 추이 차트, 셀 목록
- **오른쪽**: 운영 주체(작업자·반장 / Cell OCS 룰 / PA Agent 6블록), 판단·이상 로그(L1 셀 즉각 조치 · L2 상위 판단 · 명령 검증), **시나리오 실증 버튼**(위치편차·용접 누락·실링 비드·헤밍 착좌·오투입·장착 편차·AMR 지연·로봇 알람)
- **3D**: 셀·로봇·AMR을 클릭하면 상세 창(설비·작업·단계 타임라인·에피소드). 뒤쪽 벽은 Cell OCS 디지털트윈 디스플레이. 시점: 전체 · C01~C05 · C06~C10 · C03 용접 · 평면

## 구성
| 파일 | 역할 |
|---|---|
| `js/zone.js` | Zone 정의: 셀 C01~C10·로봇 R01~R08·제품·경로·가정 C/T·이상(L1/L2)·운영 단계·PA Agent 블록·Cell 로스터 (근거 태그 [S#]) |
| `js/lanes.js` | AMR 동선: 주 이송·복귀 일방통행 차로, 도킹 스퍼, C07→C06 재검·C08→C09 충전 직결 통로, AMR 대기 구역 |
| `js/sim.js` | 시뮬레이션 엔진(렌더링 분리): 셀 상태머신, 도킹 예약·선행 대기, 전환·팁 드레싱·실러 대기, 이상 2레벨·명령 검증, NG 재작업 루프, 충전, KPI, 에피소드 |
| `js/factory.js` | 3D: 바닥·차로·안전 펜스·셀 설비(스폿건·실러·헤밍 프레스·검사 갠트리·FIFO·충전기), 6축 로봇 2링크 IK, AMR·대차·작업자, 작업물 진행 표시(용접점·비드·헤밍·검사 태그) |
| `js/ui.js` | 패널·정보 창·도크 탭 |
| `js/datahub.js` | 기준 시계 · OPC UA PubSub JSON · AAS 환경 · 내보내기 · MQTT 발행 |
| `js/order.js` | 자연어 생산 지시 해석 (규칙 기반) |
| `server.mjs`, `server/` | 정적 파일 · `/api/status` · `/api/mqtt/publish` · `/api/episodes`, 내장 MQTT 브로커(aedes) |
| `tests/run.mjs` | 자동 시험 |

사이클·이상 확률·대응 시간·속도는 시뮬레이션용 **가정값**입니다(도출서 C/T는 "실측 후 산정"). 실측값이 나오면 `js/zone.js`만 고치면 됩니다.

## 오픈소스
three.js (MIT, `vendor/three`) · aedes (MIT) · MQTT.js (MIT)
