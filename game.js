'use strict';

const $ = (s) => document.querySelector(s);
const arena = $('#arena');
const hudInfo = $('#hud-info');

const STORE_KEY = 'reflexlab-v1';

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch { return {}; }
}

function saveStore(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }
  catch { /* private browsing — scores just won't persist */ }
}

function recordResult(modeId, value, betterIs) {
  const store = loadStore();
  const entry = store[modeId] || { best: null, plays: 0 };
  entry.plays += 1;
  let isBest = false;
  if (value != null && (entry.best == null || (betterIs === 'lower' ? value < entry.best : value > entry.best))) {
    entry.best = value;
    isBest = true;
  }
  store[modeId] = entry;
  saveStore(store);
  return isBest;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Everything a drill starts (timers, rAF loops, listeners) is registered here
// so switching drills or quitting can tear it all down in one call.
const session = {
  timers: new Set(),
  intervals: new Set(),
  rafId: null,
  listeners: [],
  after(fn, ms) {
    const id = window.setTimeout(() => { session.timers.delete(id); fn(); }, ms);
    session.timers.add(id);
    return id;
  },
  cancelAfter(id) {
    window.clearTimeout(id);
    session.timers.delete(id);
  },
  every(fn, ms) {
    const id = window.setInterval(fn, ms);
    session.intervals.add(id);
    return id;
  },
  loop(fn) {
    // schedule the next frame before running fn, so fn can cancel it via clear()
    const step = () => {
      session.rafId = requestAnimationFrame(step);
      fn();
    };
    session.rafId = requestAnimationFrame(step);
  },
  on(target, ev, fn, opts) {
    target.addEventListener(ev, fn, opts);
    session.listeners.push([target, ev, fn, opts]);
  },
  clear() {
    for (const id of session.timers) window.clearTimeout(id);
    for (const id of session.intervals) window.clearInterval(id);
    session.timers.clear();
    session.intervals.clear();
    if (session.rafId !== null) {
      cancelAnimationFrame(session.rafId);
      session.rafId = null;
    }
    for (const [t, e, f, o] of session.listeners) t.removeEventListener(e, f, o);
    session.listeners.length = 0;
  },
};

let currentMode = null;

const MODES = [
  {
    id: 'reaction',
    icon: '⚡',
    name: 'Reaction Test',
    desc: 'Wait for green, then click the instant it appears. Five rounds, averaged.',
    betterIs: 'lower',
    format: (v) => `${Math.round(v)} ms`,
    start() {
      const TOTAL = 5;
      let round = 1;
      const times = [];
      let state = 'idle';
      let armId = 0;
      let t0 = 0;
      let lockUntil = 0;

      arena.className = 'arena reaction';
      const label = el('div', 'big-label');
      const sub = el('div', 'sub-label');
      arena.replaceChildren(label, sub);

      const set = (s, text, subText = '') => {
        state = s;
        arena.dataset.state = s;
        label.textContent = text;
        sub.textContent = subText;
        hudInfo.textContent = `Round ${Math.min(round, TOTAL)} / ${TOTAL}`;
      };

      const arm = () => {
        set('waiting', 'Wait for green…');
        armId = session.after(() => {
          set('go', 'CLICK!');
          t0 = performance.now();
        }, 1200 + Math.random() * 2600);
      };

      set('idle', `Round 1 of ${TOTAL}`, 'Click anywhere to arm — then click the instant the screen turns green');

      session.on(arena, 'pointerdown', () => {
        const now = performance.now();
        if (now < lockUntil) return;
        if (state === 'idle' || state === 'early') {
          arm();
        } else if (state === 'waiting') {
          session.cancelAfter(armId);
          set('early', 'Too soon!', 'Click to retry this round');
        } else if (state === 'go') {
          const dt = now - t0;
          times.push(dt);
          lockUntil = now + 300;
          if (round < TOTAL) {
            round += 1;
            set('idle', `${Math.round(dt)} ms`, `Round ${round} of ${TOTAL} — click to arm`);
          } else {
            const avg = mean(times);
            finishMode({
              value: avg,
              primary: `${Math.round(avg)} ms`,
              primaryLabel: 'average over 5 rounds',
              lines: [
                `Rounds: ${times.map((t) => Math.round(t)).join(' · ')} ms`,
                `Fastest: ${Math.round(Math.min(...times))} ms`,
              ],
            });
          }
        }
      });
    },
  },

  {
    id: 'targets',
    icon: '🎯',
    name: 'Target Hunt',
    desc: 'Targets jump across the arena — snap your eyes to each one and hit as many as you can in 30 seconds.',
    betterIs: 'higher',
    format: (v) => plural(v, 'hit'),
    start() {
      const DURATION = 30000;
      const SIZE = 52;
      const MARGIN = 14;
      let hits = 0;
      let misses = 0;
      let spawnT = 0;
      let endAt = 0;
      const reactions = [];
      let last = null;
      let running = false;

      arena.className = 'arena targets';
      const startBtn = el('button', 'start-btn', 'Start — 30 seconds');
      const tip = el('div', 'sub-label', 'Each hit makes the target jump somewhere far away, forcing a fast eye movement before the next shot.');
      arena.replaceChildren(startBtn, tip);

      const target = el('button', 'target');

      const spawn = () => {
        const r = arena.getBoundingClientRect();
        const maxX = Math.max(1, r.width - SIZE - MARGIN * 2);
        const maxY = Math.max(1, r.height - SIZE - MARGIN * 2);
        const minJump = Math.min(280, Math.min(r.width, r.height) * 0.45);
        let x = MARGIN;
        let y = MARGIN;
        for (let tries = 0; tries < 24; tries++) {
          x = MARGIN + Math.random() * maxX;
          y = MARGIN + Math.random() * maxY;
          if (!last || Math.hypot(x - last.x, y - last.y) > minJump) break;
        }
        last = { x, y };
        target.style.left = `${x}px`;
        target.style.top = `${y}px`;
        spawnT = performance.now();
      };

      const end = () => {
        running = false;
        const acc = hits + misses ? Math.round((hits / (hits + misses)) * 100) : 100;
        finishMode({
          value: hits,
          primary: `${hits}`,
          primaryLabel: 'targets hit in 30 seconds',
          lines: [
            reactions.length ? `Average time per target: ${Math.round(mean(reactions))} ms` : 'No targets hit',
            `Click accuracy: ${acc}%`,
          ],
        });
      };

      startBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      startBtn.addEventListener('click', () => {
        running = true;
        endAt = performance.now() + DURATION;
        arena.replaceChildren(target);
        spawn();
        session.after(end, DURATION);
        session.every(() => {
          hudInfo.textContent = `${Math.max(0, (endAt - performance.now()) / 1000).toFixed(1)} s · ${plural(hits, 'hit')}`;
        }, 100);
      });

      target.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (!running) return;
        hits += 1;
        reactions.push(performance.now() - spawnT);
        spawn();
      });

      session.on(arena, 'pointerdown', () => {
        if (running) misses += 1;
      });
    },
  },

  {
    id: 'pursuit',
    icon: '🌀',
    name: 'Smooth Pursuit',
    desc: 'Keep your cursor glued to a dot that never stops moving. Trains smooth-pursuit eye tracking.',
    betterIs: 'higher',
    format: (v) => `${v.toFixed(1)}%`,
    start() {
      const DURATION = 30000;
      const R = 34;

      arena.className = 'arena pursuit';
      const startBtn = el('button', 'start-btn', 'Start — follow the dot for 30 seconds');
      const tip = el('div', 'sub-label', 'Lock your eyes (and cursor) on the circle. It speeds up as you go — score is the share of time you stay inside it.');
      arena.replaceChildren(startBtn, tip);

      const dot = el('div', 'pursuit-dot');
      let px = -10000;
      let py = -10000;

      startBtn.addEventListener('click', () => {
        arena.replaceChildren(dot);
        const rect0 = arena.getBoundingClientRect();
        let x = rect0.width / 2;
        let y = rect0.height / 2;
        let vx = 0;
        let vy = 0;
        let wp = null;
        const t0 = performance.now();
        let prev = t0;
        let onMs = 0;

        const pickWp = (w, h) => ({
          x: 80 + Math.random() * Math.max(1, w - 160),
          y: 80 + Math.random() * Math.max(1, h - 160),
        });

        session.on(arena, 'pointermove', (ev) => {
          const r = arena.getBoundingClientRect();
          px = ev.clientX - r.left;
          py = ev.clientY - r.top;
        });

        session.loop(() => {
          const now = performance.now();
          const dt = Math.min(0.05, (now - prev) / 1000);
          prev = now;
          const elapsed = now - t0;

          if (elapsed >= DURATION) {
            const pct = (onMs / DURATION) * 100;
            finishMode({
              value: pct,
              primary: `${pct.toFixed(1)}%`,
              primaryLabel: 'time on target',
              lines: [`${(onMs / 1000).toFixed(1)} s of 30 s inside the circle`],
            });
            return;
          }

          const r = arena.getBoundingClientRect();
          const w = r.width;
          const h = r.height;
          if (!wp) wp = pickWp(w, h);

          const speed = 150 + 170 * Math.min(1, elapsed / DURATION);
          const dxw = wp.x - x;
          const dyw = wp.y - y;
          const distW = Math.hypot(dxw, dyw) || 1;
          if (distW < 26) wp = pickWp(w, h);

          // steer smoothly toward the waypoint so the path curves instead of zig-zagging
          const k = Math.min(1, dt * 2.5);
          vx += ((dxw / distW) * speed - vx) * k;
          vy += ((dyw / distW) * speed - vy) * k;
          x = Math.min(w - R, Math.max(R, x + vx * dt));
          y = Math.min(h - R, Math.max(R, y + vy * dt));
          dot.style.left = `${x}px`;
          dot.style.top = `${y}px`;

          if (Math.hypot(px - x, py - y) <= R) onMs += dt * 1000;
          const pct = elapsed > 0 ? (onMs / elapsed) * 100 : 0;
          hudInfo.textContent = `${Math.max(0, (DURATION - elapsed) / 1000).toFixed(1)} s · on target ${pct.toFixed(0)}%`;
        });
      });
    },
  },

  {
    id: 'peripheral',
    icon: '👁️',
    name: 'Peripheral Flash',
    desc: 'Eyes locked on the cross — catch dots at the edge of your vision and answer with the arrow keys.',
    betterIs: 'lower',
    format: (v) => `${Math.round(v)} ms`,
    start() {
      const ROUNDS = 12;
      const DIRS = ['up', 'right', 'down', 'left'];
      const KEYS = { ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down', ArrowLeft: 'left' };

      arena.className = 'arena peripheral';
      const cross = el('div', 'fix-cross');
      const msg = el('div', 'sub-label peripheral-msg',
        'Keep your eyes on the cross. When a dot appears near an edge, press the arrow key for that side — without looking at it. Press any arrow key to begin.');
      arena.replaceChildren(cross, msg);

      const dot = el('div', 'peri-dot');
      let round = 0;
      let state = 'intro'; // intro | waiting | show | done
      let shownAt = 0;
      let dir = '';
      let missId = 0;
      const correct = [];
      let wrong = 0;
      let missed = 0;

      const place = (d) => {
        const along = `${15 + Math.random() * 70}%`;
        if (d === 'up') { dot.style.left = along; dot.style.top = '7%'; }
        else if (d === 'down') { dot.style.left = along; dot.style.top = '93%'; }
        else if (d === 'left') { dot.style.left = '5%'; dot.style.top = along; }
        else { dot.style.left = '95%'; dot.style.top = along; }
      };

      const end = () => {
        state = 'done';
        const avg = correct.length ? mean(correct) : null;
        finishMode({
          value: avg,
          primary: avg == null ? '—' : `${Math.round(avg)} ms`,
          primaryLabel: 'average reaction (correct answers)',
          lines: [
            `Correct: ${correct.length} / ${ROUNDS}`,
            `Wrong direction: ${wrong} · Too slow: ${missed}`,
          ],
        });
      };

      const nextRound = () => {
        dot.remove();
        round += 1;
        if (round > ROUNDS) return end();
        state = 'waiting';
        msg.textContent = '';
        hudInfo.textContent = `Round ${round} / ${ROUNDS}`;
        session.after(() => {
          dir = DIRS[(Math.random() * 4) | 0];
          place(dir);
          arena.append(dot);
          shownAt = performance.now();
          state = 'show';
          missId = session.after(() => {
            missed += 1;
            nextRound();
          }, 1500);
        }, 700 + Math.random() * 1600);
      };

      session.on(window, 'keydown', (e) => {
        const d = KEYS[e.key];
        if (!d) return;
        e.preventDefault();
        if (state === 'intro') {
          nextRound();
        } else if (state === 'show') {
          session.cancelAfter(missId);
          if (d === dir) correct.push(performance.now() - shownAt);
          else wrong += 1;
          nextRound();
        }
      });
    },
  },

  {
    id: 'schulte',
    icon: '🔢',
    name: 'Schulte Table',
    desc: 'Find 1 → 25 in order while keeping your eyes near the centre. A classic drill for widening your visual field.',
    betterIs: 'lower',
    format: (v) => `${v.toFixed(1)} s`,
    start() {
      arena.className = 'arena schulte';
      const tip = el('div', 'sub-label',
        'Click 1 → 25 in order. Try to keep your eyes near the centre of the grid and find the numbers with your peripheral vision.');
      const startBtn = el('button', 'start-btn', 'Start');
      const wrap = el('div', 'schulte-intro');
      wrap.append(tip, startBtn);
      arena.replaceChildren(wrap);

      startBtn.addEventListener('click', () => {
        const nums = Array.from({ length: 25 }, (_, i) => i + 1);
        for (let i = nums.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0;
          [nums[i], nums[j]] = [nums[j], nums[i]];
        }

        const grid = el('div', 'schulte-grid');
        let next = 1;
        let mistakes = 0;
        const t0 = performance.now();

        session.every(() => {
          hudInfo.textContent = `Find ${next} · ${((performance.now() - t0) / 1000).toFixed(1)} s`;
        }, 100);

        for (const n of nums) {
          const b = el('button', 'cell', String(n));
          b.addEventListener('pointerdown', () => {
            if (n === next) {
              b.classList.add('done');
              next += 1;
              if (next > 25) {
                const secs = (performance.now() - t0) / 1000;
                finishMode({
                  value: secs,
                  primary: `${secs.toFixed(1)} s`,
                  primaryLabel: 'to clear the table',
                  lines: [`Mistakes: ${mistakes}`],
                });
              }
            } else if (!b.classList.contains('done')) {
              mistakes += 1;
              b.classList.add('wrong');
              window.setTimeout(() => b.classList.remove('wrong'), 250);
            }
          });
          grid.append(b);
        }
        arena.replaceChildren(grid);
      });
    },
  },
];

function renderMenu() {
  const store = loadStore();
  const wrap = $('#mode-cards');
  wrap.replaceChildren(...MODES.map((mode) => {
    const card = el('button', 'card');
    card.append(
      el('div', 'card-icon', mode.icon),
      el('h3', '', mode.name),
      el('p', '', mode.desc),
    );
    const s = store[mode.id];
    card.append(el('div', 'card-best', s && s.best != null ? `Best: ${mode.format(s.best)}` : 'Not played yet'));
    card.addEventListener('click', () => startMode(mode));
    return card;
  }));
}

function showMenu() {
  session.clear();
  currentMode = null;
  $('#results').classList.add('hidden');
  $('#game').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  renderMenu();
}

function startMode(mode) {
  session.clear();
  currentMode = mode;
  $('#results').classList.add('hidden');
  $('#menu').classList.add('hidden');
  $('#game').classList.remove('hidden');
  $('#hud-title').textContent = `${mode.icon} ${mode.name}`;
  hudInfo.textContent = '';
  arena.dataset.state = '';
  mode.start();
}

function finishMode({ value, primary, primaryLabel, lines }) {
  session.clear();
  const isBest = recordResult(currentMode.id, value, currentMode.betterIs);
  $('#results-badge').classList.toggle('hidden', !isBest);
  $('#results-title').textContent = currentMode.name;
  $('#results-primary').textContent = primary;
  $('#results-primary-label').textContent = primaryLabel;
  $('#results-lines').replaceChildren(...lines.map((l) => el('li', '', l)));
  $('#results').classList.remove('hidden');
}

$('#quit').addEventListener('click', showMenu);
$('#to-menu').addEventListener('click', showMenu);
$('#replay').addEventListener('click', () => { if (currentMode) startMode(currentMode); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#game').classList.contains('hidden')) showMenu();
});

renderMenu();
