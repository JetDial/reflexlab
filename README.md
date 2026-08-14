# ReflexLab

A browser game with five quick drills for improving reaction time and eye movement. No frameworks, no build step — plain HTML, CSS, and JavaScript.

## Run it

Open `index.html` in any modern browser. That's it.

## The drills

| Drill | What it trains | How it's scored |
|---|---|---|
| ⚡ Reaction Test | Raw visual reaction speed | Average ms over 5 rounds (lower is better) |
| 🎯 Target Hunt | Saccades (fast eye jumps) + hand–eye coordination | Targets hit in 30 seconds |
| 🌀 Smooth Pursuit | Smooth-pursuit eye tracking of a moving object | % of time your cursor stays inside the moving circle |
| 👁️ Peripheral Flash | Peripheral vision awareness | Average reaction ms to edge flashes, answered with arrow keys while fixating on a centre cross |
| 🔢 Schulte Table | Visual field width and search speed | Seconds to click 1 → 25 in order |

Best scores are saved in the browser (localStorage). Press **Esc** during any drill to return to the menu.

## Tips for training

- Short, frequent sessions beat long ones — a few minutes a day.
- In Peripheral Flash and the Schulte Table, resist the urge to move your eyes; the point is to answer using peripheral vision.
- In Smooth Pursuit, follow the dot with your eyes and let your hand trail it — don't stare at your cursor.
