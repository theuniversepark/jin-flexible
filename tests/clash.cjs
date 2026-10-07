// 로봇·설비 간섭 검사 (Electron) — 서버(npm start, 8770)를 띄운 뒤: npx electron tests/clash.cjs [초]
// 레거시·자동화·피지컬AI 각각 30배속으로 돌리며 매 프레임 js/clash.js 검사를 하고, 겹친 쌍을 모아 보고한다.
const { app, BrowserWindow } = require('electron');
const URL = process.env.URL || 'http://127.0.0.1:8770/';
const SEC = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 40);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1400, height: 860, show: false });
  w.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('CONSOLE', e.message); });
  await w.loadURL(URL);
  await new Promise((r) => setTimeout(r, 9000));
  let total = 0;
  for (const mode of ['traditional', 'smart', 'dark']) {
    const res = await w.webContents.executeJavaScript(`new Promise((done) => {
      document.querySelector('#modeSeg [data-mode=${mode}]').click();
      setTimeout(() => {
        [...document.querySelectorAll('#speedSeg button')].pop().click();
        const t = window.__twin, log = new t.ClashLog(); let n = 0;
        const end = performance.now() + ${SEC * 1000};
        const tick = () => { if (n++ % 2 === 0) log.add(t.clash(), t.sim.time); if (performance.now() < end) requestAnimationFrame(tick); else done({ frames: log.frames, simT: Math.round(t.sim.time), list: log.list().slice(0, 40) }); };
        requestAnimationFrame(tick);
      }, 2500);
    })`);
    console.log(`== ${mode}: ${res.frames}프레임 검사 · 시뮬레이션 ${res.simT}초 · 간섭 ${res.list.length}종`);
    for (const c of res.list) console.log(`  ${c.kind.padEnd(18)} ${String(c.cell).padEnd(8)} ${c.a} ↔ ${c.b ?? '통로'}  (${c.n}프레임${c.y != null ? ` · y ${c.y}` : ''})`);
    total += res.list.length;
  }
  console.log(`\n결과: 간섭 ${total}종`);
  process.exitCode = total ? 1 : 0;
  app.quit();
});
