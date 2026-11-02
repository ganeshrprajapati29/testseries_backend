/** SVG figures for image-based mock questions and series cover images. */
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const frame = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Arial, Helvetica, sans-serif"><rect width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`;
export function rightTriangle(a, b, unit = 'cm') {
    // Legs a (vertical) and b (horizontal), hypotenuse unknown.
    return frame(360, 260, `<polygon points="60,210 60,40 300,210" fill="#eef6ff" stroke="#1e6fd0" stroke-width="3"/>
     <rect x="60" y="192" width="18" height="18" fill="none" stroke="#1e6fd0" stroke-width="2"/>
     <text x="30" y="130" font-size="18" fill="#0f172a">${a} ${unit}</text>
     <text x="160" y="240" font-size="18" fill="#0f172a">${b} ${unit}</text>
     <text x="195" y="115" font-size="20" font-weight="bold" fill="#f26b1d">x</text>
     <text x="45" y="35" font-size="16" fill="#475569">A</text><text x="45" y="228" font-size="16" fill="#475569">B</text><text x="305" y="228" font-size="16" fill="#475569">C</text>`);
}
export function circleFigure(r, unit = 'cm') {
    return frame(300, 260, `<circle cx="150" cy="130" r="100" fill="#eef6ff" stroke="#1e6fd0" stroke-width="3"/>
     <circle cx="150" cy="130" r="4" fill="#0f172a"/>
     <line x1="150" y1="130" x2="250" y2="130" stroke="#f26b1d" stroke-width="3"/>
     <text x="175" y="122" font-size="18" fill="#0f172a">r = ${r} ${unit}</text>
     <text x="138" y="152" font-size="16" fill="#475569">O</text>`);
}
export function rectangleFigure(l, w, unit = 'm') {
    return frame(360, 240, `<rect x="50" y="50" width="260" height="140" fill="#fff5ed" stroke="#f26b1d" stroke-width="3"/>
     <text x="150" y="40" font-size="18" fill="#0f172a">${l} ${unit}</text>
     <text x="318" y="125" font-size="18" fill="#0f172a">${w} ${unit}</text>`);
}
export function barChart(title, labels, values, unit) {
    const max = Math.max(...values);
    const top = Math.ceil(max / 50) * 50;
    const w = 520;
    const h = 320;
    const plotH = 220;
    const barW = 50;
    const gap = (w - 100 - labels.length * barW) / (labels.length + 1);
    let body = `<text x="${w / 2}" y="26" font-size="17" font-weight="bold" text-anchor="middle" fill="#0f172a">${esc(title)}</text>`;
    for (let i = 0; i <= 4; i++) {
        const y = 270 - (plotH * i) / 4;
        body += `<line x1="70" y1="${y}" x2="${w - 20}" y2="${y}" stroke="#e2e8f0"/><text x="62" y="${y + 5}" font-size="12" text-anchor="end" fill="#475569">${(top * i) / 4}</text>`;
    }
    values.forEach((v, i) => {
        const x = 70 + gap + i * (barW + gap);
        const bh = (v / top) * plotH;
        body += `<rect x="${x}" y="${270 - bh}" width="${barW}" height="${bh}" fill="#1e6fd0" rx="3"/>`;
        body += `<text x="${x + barW / 2}" y="${266 - bh}" font-size="12" text-anchor="middle" fill="#0f172a">${v}</text>`;
        body += `<text x="${x + barW / 2}" y="290" font-size="13" text-anchor="middle" fill="#0f172a">${esc(labels[i])}</text>`;
    });
    body += `<line x1="70" y1="270" x2="${w - 20}" y2="270" stroke="#0f172a"/><text x="16" y="150" font-size="12" fill="#475569" transform="rotate(-90 16 150)">${esc(unit)}</text>`;
    return frame(w, h, body);
}
export function seriesCircuit(resistors, volts) {
    const n = resistors.length;
    const span = 360 / n;
    let body = `<rect x="40" y="40" width="400" height="180" fill="none" stroke="#0f172a" stroke-width="2"/>`;
    resistors.forEach((r, i) => {
        const x = 60 + i * span + span / 2 - 35;
        body += `<rect x="${x}" y="28" width="70" height="24" fill="#fff5ed" stroke="#f26b1d" stroke-width="2"/><text x="${x + 35}" y="45" font-size="14" text-anchor="middle" fill="#0f172a">${r} Ω</text>`;
    });
    body += `<line x1="225" y1="206" x2="225" y2="234" stroke="#0f172a" stroke-width="3"/><line x1="240" y1="212" x2="240" y2="228" stroke="#0f172a" stroke-width="5"/>`;
    body += `<rect x="226" y="214" width="13" height="12" fill="#ffffff"/><text x="232" y="256" font-size="15" text-anchor="middle" fill="#0f172a">${volts} V</text>`;
    return frame(480, 270, body);
}
export function directionPath(north, east) {
    const scale = 18;
    const sx = 80;
    const sy = 250;
    const nx = sx;
    const ny = sy - north * scale;
    const ex = sx + east * scale;
    return frame(400, 300, `<text x="360" y="30" font-size="14" text-anchor="middle" fill="#475569">N</text><line x1="360" y1="36" x2="360" y2="70" stroke="#475569" stroke-width="2"/><polygon points="360,34 355,44 365,44" fill="#475569"/>
     <circle cx="${sx}" cy="${sy}" r="5" fill="#1e6fd0"/><text x="${sx - 10}" y="${sy + 22}" font-size="14" fill="#0f172a">Start</text>
     <line x1="${sx}" y1="${sy}" x2="${nx}" y2="${ny}" stroke="#1e6fd0" stroke-width="3"/>
     <text x="${sx - 52}" y="${(sy + ny) / 2}" font-size="14" fill="#0f172a">${north} km</text>
     <line x1="${nx}" y1="${ny}" x2="${ex}" y2="${ny}" stroke="#1e6fd0" stroke-width="3"/>
     <text x="${(nx + ex) / 2 - 15}" y="${ny - 8}" font-size="14" fill="#0f172a">${east} km</text>
     <circle cx="${ex}" cy="${ny}" r="5" fill="#f26b1d"/><text x="${ex + 8}" y="${ny + 5}" font-size="14" fill="#0f172a">End</text>
     <line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ny}" stroke="#f26b1d" stroke-width="2" stroke-dasharray="6 5"/>`);
}
const PALETTES = [
    ['#1e6fd0', '#1c3f72'],
    ['#f26b1d', '#ba360c'],
    ['#0f766e', '#134e4a'],
    ['#7c3aed', '#4c1d95'],
    ['#be123c', '#881337'],
    ['#0369a1', '#0c4a6e'],
    ['#15803d', '#14532d'],
    ['#b45309', '#78350f'],
];
export function seriesCover(exam, title, index) {
    const [c1, c2] = PALETTES[index % PALETTES.length];
    const words = title.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
        if ((line + ' ' + w).trim().length > 30) {
            lines.push(line.trim());
            line = w;
        }
        else
            line += ` ${w}`;
    }
    if (line.trim())
        lines.push(line.trim());
    const titleSvg = lines
        .slice(0, 3)
        .map((l, i) => `<text x="48" y="${215 + i * 44}" font-size="36" font-weight="bold" fill="#ffffff">${esc(l)}</text>`)
        .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="800" height="400" font-family="Arial, Helvetica, sans-serif">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <rect width="800" height="400" fill="url(#g)"/>
  <circle cx="700" cy="60" r="160" fill="#ffffff" opacity="0.08"/><circle cx="760" cy="360" r="120" fill="#ffffff" opacity="0.06"/>
  <rect x="48" y="60" rx="18" width="${Math.min(520, 26 + exam.length * 15)}" height="40" fill="#ffffff" opacity="0.18"/>
  <text x="62" y="88" font-size="22" font-weight="bold" fill="#ffffff">${esc(exam.toUpperCase())}</text>
  ${titleSvg}
  <text x="48" y="370" font-size="18" fill="#ffffff" opacity="0.85">CIVIL SANSAD • Achieving Excellence Together</text>
</svg>`;
}
/** A small "worked solution" card used as an explanation image. */
export function solutionCard(title, lines) {
    const h = 70 + lines.length * 30;
    const body = `<rect x="10" y="10" width="500" height="${h - 20}" rx="14" fill="#fffbeb" stroke="#f59e0b" stroke-width="2"/>` +
        `<text x="30" y="44" font-size="18" font-weight="bold" fill="#92400e">${esc(title)}</text>` +
        lines.map((l, i) => `<text x="30" y="${80 + i * 30}" font-size="17" fill="#0f172a">${esc(l)}</text>`).join('');
    return frame(520, h, body);
}
/** Square figure with its side labelled. */
export function squareFigure(a, unit = 'cm') {
    return frame(300, 260, `<rect x="70" y="40" width="170" height="170" fill="#ecfdf5" stroke="#059669" stroke-width="3"/>
     <text x="140" y="232" font-size="18" fill="#0f172a">${a} ${unit}</text>`);
}
/** Simple badge used as a category image. */
export function categoryBadge(label, index) {
    const colors = [['#1e6fd0', '#1c3f72'], ['#f26b1d', '#ba360c'], ['#0f766e', '#134e4a'], ['#7c3aed', '#4c1d95'], ['#be123c', '#881337'], ['#0369a1', '#0c4a6e'], ['#15803d', '#14532d']];
    const [c1, c2] = colors[index % colors.length];
    const initials = label.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase() || label.slice(0, 2).toUpperCase();
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200" font-family="Arial, Helvetica, sans-serif">
  <defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <rect width="200" height="200" rx="40" fill="url(#b)"/><circle cx="160" cy="40" r="50" fill="#fff" opacity="0.12"/>
  <text x="100" y="${initials.length > 2 ? 118 : 124}" font-size="${initials.length > 2 ? 56 : 70}" font-weight="bold" text-anchor="middle" fill="#fff">${esc(initials)}</text></svg>`;
}
//# sourceMappingURL=svg.js.map