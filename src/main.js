import './style.css';

// ── Crazy entrance ──────────────────────────────────────────────
const title = document.getElementById('title');
const sub = document.getElementById('sub');

// Split title into letters
const letters = title.textContent.split('');
title.textContent = '';
letters.forEach((ch, i) => {
  const span = document.createElement('span');
  span.textContent = ch === ' ' ? '\u00A0' : ch;
  span.style.setProperty('--i', i);
  span.style.setProperty('--delay', (i * 60) + 'ms');
  span.classList.add('letter');
  title.appendChild(span);
});

// Sub text starts hidden
sub.style.opacity = '0';
sub.style.transform = 'translateY(20px)';

// ── Timeline helper ─────────────────────────────────────────────
function tl(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Entrance sequence (wrapped in IIFE for top-level safety) ────
(async () => {
  await tl(300);
  title.classList.add('entrance');
  await tl(1200);

  sub.style.transition = 'opacity 0.8s ease, transform 0.8s ease';
  sub.style.opacity = '1';
  sub.style.transform = 'translateY(0)';
  await tl(800);

  // ── Ambient particles ─────────────────────────────────────────
  const container = document.getElementById('particles');
  const COUNT = 40;
  for (let i = 0; i < COUNT; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = 2 + Math.random() * 5;
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    p.style.left = Math.random() * 100 + '%';
    p.style.top = Math.random() * 100 + '%';
    p.style.setProperty('--dur', (4 + Math.random() * 8) + 's');
    p.style.setProperty('--delay', (Math.random() * 5) + 's');
    container.appendChild(p);
  }

  // ── Title glow pulse ──────────────────────────────────────────
  const glow = () => {
    const hue = (Date.now() / 30) % 360;
    title.style.textShadow = `0 0 20px hsla(${hue}, 100%, 60%, 0.8), 0 0 40px hsla(${(hue+60)%360}, 100%, 50%, 0.5)`;
    requestAnimationFrame(glow);
  };
  requestAnimationFrame(glow);

  console.log('🚀 Vite hello world running — CICD pipeline deployed');
})();
