// 앱 아이콘 생성 (Electron 오프스크린 캔버스 → build/icon.png 1024px). npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const html = `<canvas id=c width=1024 height=1024></canvas><script>
const c=document.getElementById('c').getContext('2d');
const r=(x,y,w,h,rad)=>{c.beginPath();c.roundRect(x,y,w,h,rad);};
const g=c.createLinearGradient(0,0,1024,1024);g.addColorStop(0,'#0f2a4d');g.addColorStop(1,'#0b1a2e');
r(100,100,824,824,185);c.fillStyle=g;c.fill();
c.lineWidth=10;c.strokeStyle='rgba(55,232,255,0.35)';c.stroke();
// 윗줄 셀 5개 (C01~C05)
const cols=['#37a0ff','#37a0ff','#f08a24','#f5c518','#37a0ff'];
for(let i=0;i<5;i++){r(185+i*136,250,112,150,18);c.fillStyle=cols[i];c.globalAlpha=.92;c.fill();}
c.globalAlpha=1;
// 주 이송 동선 →
c.fillStyle='#2b6fd6';r(170,450,684,62,14);c.fill();
c.fillStyle='#ffffff';for(let i=0;i<4;i++){c.beginPath();const x=255+i*165;c.moveTo(x,462);c.lineTo(x+48,481);c.lineTo(x,500);c.closePath();c.fill();}
// 복귀 동선 ←
c.fillStyle='#2fbf71';r(170,545,684,62,14);c.fill();
c.fillStyle='#ffffff';for(let i=0;i<4;i++){c.beginPath();const x=330+i*165;c.moveTo(x,557);c.lineTo(x-48,576);c.lineTo(x,595);c.closePath();c.fill();}
// 오른쪽 통제 이송
c.fillStyle='#f5c518';r(824,450,30,157,10);c.fill();
// AMR + 후드 판넬
c.fillStyle='#d5dbe2';r(390,660,250,70,16);c.fill();
c.fillStyle='#f08a24';c.fillRect(395,700,240,8);
c.fillStyle='#c8ced6';c.beginPath();c.moveTo(370,660);c.quadraticCurveTo(515,610,660,660);c.lineTo(640,672);c.quadraticCurveTo(515,630,390,672);c.closePath();c.fill();
c.fillStyle='#ffffff';c.font='bold 120px -apple-system, Helvetica';c.textAlign='center';c.fillText('FMS',512,860);
</script>`;
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="margin:0;background:transparent">${html}</body>`));
  await new Promise((r) => setTimeout(r, 400));
  const url = await w.webContents.executeJavaScript("document.getElementById('c').toDataURL('image/png')");
  fs.writeFileSync(path.join(__dirname, 'icon.png'), Buffer.from(url.split(',')[1], 'base64'));
  console.log('build/icon.png');
  app.quit();
});
