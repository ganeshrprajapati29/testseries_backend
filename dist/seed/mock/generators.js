import { barChart, circleFigure, directionPath, rectangleFigure, rightTriangle, seriesCircuit, solutionCard, squareFigure } from './svg.js';
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
/** Four distinct options around a numeric answer; returns options and the index of the answer. */
function numeric(rng, answer, deltas = [], render = fmt) {
    const set = new Set([render(answer)]);
    const candidates = rng.shuffle([
        ...deltas.map((d) => answer + d),
        answer + Math.max(1, Math.round(Math.abs(answer) * 0.1)),
        answer - Math.max(1, Math.round(Math.abs(answer) * 0.1)),
        answer * 2,
        Math.round(answer / 2),
        answer + 1,
        answer - 1,
        answer + 2,
        answer + 5,
    ]);
    for (const c of candidates) {
        if (set.size >= 4)
            break;
        if (answer > 0 && c <= 0)
            continue;
        set.add(render(c));
    }
    let k = 3;
    while (set.size < 4)
        set.add(render(answer + k++));
    const options = rng.shuffle([...set]);
    return { options, correct: options.indexOf(render(answer)) };
}
function choice(rng, answer, wrong) {
    const options = rng.shuffle([answer, ...rng.shuffle(wrong.filter((w) => w !== answer)).slice(0, 3)]);
    return { options, correct: options.indexOf(answer) };
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
export const MATHS = [
    (rng) => {
        const p = rng.pick([5, 10, 12, 15, 20, 25, 30, 40, 45, 60, 75]);
        const n = rng.pick([80, 120, 160, 240, 300, 360, 400, 480, 500, 600, 640, 720, 800, 900, 1200]);
        const ans = (p * n) / 100;
        return { subject: 'Maths', topic: 'Percentage', difficulty: 'easy', q: `What is ${p}% of ${n}?`, ...numeric(rng, ans, [p, -p]), explanation: `${p}% of ${n} = ${p} × ${n} / 100 = ${fmt(ans)}.`, hi: { q: `${n} का ${p}% कितना है?`, explanation: `${p} × ${n} / 100 = ${fmt(ans)}` } };
    },
    (rng) => {
        const P = rng.pick([1000, 1500, 2000, 2500, 4000, 5000, 8000, 10000]);
        const R = rng.pick([4, 5, 6, 8, 10, 12]);
        const T = rng.int(2, 5);
        const si = (P * R * T) / 100;
        return { subject: 'Maths', topic: 'Simple Interest', difficulty: 'easy', q: `Find the simple interest on ₹${P} at ${R}% per annum for ${T} years.`, ...numeric(rng, si, [P * R / 100, -P * R / 100], (n) => `₹${fmt(n)}`), explanation: `SI = P × R × T / 100 = ${P} × ${R} × ${T} / 100 = ₹${fmt(si)}.`, hi: { q: `₹${P} पर ${R}% वार्षिक दर से ${T} वर्ष का साधारण ब्याज ज्ञात कीजिए।`, explanation: `साधारण ब्याज = P × R × T / 100 = ₹${fmt(si)}` } };
    },
    (rng) => {
        const P = rng.pick([1000, 2000, 4000, 5000, 10000]);
        const R = rng.pick([5, 10, 20]);
        const amt = P * (1 + R / 100) ** 2;
        const ci = Math.round((amt - P) * 100) / 100;
        return { subject: 'Maths', topic: 'Compound Interest', difficulty: 'medium', q: `What is the compound interest on ₹${P} at ${R}% per annum for 2 years, compounded annually?`, ...numeric(rng, ci, [-(P * R * R) / 10000, P * R / 100], (n) => `₹${fmt(n)}`), explanation: `Amount = ${P} × (1 + ${R}/100)² = ₹${fmt(amt)}; CI = ₹${fmt(amt)} − ₹${P} = ₹${fmt(ci)}.`, hi: { q: `₹${P} पर ${R}% वार्षिक चक्रवृद्धि दर से 2 वर्ष का चक्रवृद्धि ब्याज कितना होगा?`, explanation: `मिश्रधन = ₹${fmt(amt)}, चक्रवृद्धि ब्याज = ₹${fmt(ci)}` } };
    },
    (rng) => {
        const cp = rng.pick([200, 250, 400, 500, 800, 1000, 1200, 1500, 2000]);
        const p = rng.pick([10, 15, 20, 25, 30, 40, 50]);
        const sp = cp + (cp * p) / 100;
        return { subject: 'Maths', topic: 'Profit & Loss', difficulty: 'easy', q: `An article bought for ₹${cp} is sold for ₹${fmt(sp)}. What is the profit percentage?`, ...numeric(rng, p, [5, -5, 10], (n) => `${fmt(n)}%`), explanation: `Profit = ₹${fmt(sp - cp)}; Profit % = ${fmt(sp - cp)} / ${cp} × 100 = ${p}%.`, hi: { q: `एक वस्तु ₹${cp} में खरीदकर ₹${fmt(sp)} में बेची गई। लाभ प्रतिशत कितना है?`, explanation: `लाभ % = ${fmt(sp - cp)} / ${cp} × 100 = ${p}%` } };
    },
    (rng) => {
        const count = rng.int(4, 6);
        const nums = Array.from({ length: count }, () => rng.int(10, 99));
        const sum = nums.reduce((a, b) => a + b, 0);
        const extra = (count - (sum % count)) % count;
        nums[0] += extra;
        const avg = (sum + extra) / count;
        return { subject: 'Maths', topic: 'Average', difficulty: 'easy', q: `Find the average of ${nums.join(', ')}.`, ...numeric(rng, avg), explanation: `Sum = ${sum + extra}; average = ${sum + extra} / ${count} = ${avg}.`, hi: { q: `${nums.join(', ')} का औसत ज्ञात कीजिए।`, explanation: `योग = ${sum + extra}, औसत = ${avg}` } };
    },
    (rng) => {
        const a = rng.pick([4, 6, 8, 9, 10, 12, 14, 15, 16, 18, 20, 21, 24]);
        let b = rng.pick([6, 9, 10, 12, 15, 16, 18, 25, 27, 28, 30, 36]);
        if (b === a)
            b += 2;
        const lcm = (a * b) / gcd(a, b);
        return { subject: 'Maths', topic: 'LCM & HCF', difficulty: 'easy', q: `What is the LCM of ${a} and ${b}?`, ...numeric(rng, lcm, [a, b, -a]), explanation: `HCF(${a}, ${b}) = ${gcd(a, b)}; LCM = ${a} × ${b} / ${gcd(a, b)} = ${lcm}.`, hi: { q: `${a} और ${b} का लघुत्तम समापवर्त्य (LCM) क्या है?`, explanation: `LCM = ${a} × ${b} / ${gcd(a, b)} = ${lcm}` } };
    },
    (rng) => {
        const h = rng.pick([4, 6, 7, 8, 9, 12, 14, 15, 18]);
        const a = h * rng.pick([2, 3, 4, 5]);
        let b = h * rng.pick([3, 5, 7]);
        if (gcd(a, b) !== h)
            b = h * 7 === a ? h * 9 : h * 7;
        const ans = gcd(a, b);
        return { subject: 'Maths', topic: 'LCM & HCF', difficulty: 'easy', q: `What is the HCF of ${a} and ${b}?`, ...numeric(rng, ans, [ans, 2, -2]), explanation: `The greatest number dividing both ${a} and ${b} is ${ans}.`, hi: { q: `${a} और ${b} का महत्तम समापवर्तक (HCF) क्या है?`, explanation: `HCF = ${ans}` } };
    },
    (rng) => {
        const speed = rng.pick([36, 40, 45, 48, 50, 54, 60, 72, 75, 80, 90]);
        const t = rng.pick([2, 3, 4, 5]);
        const d = speed * t;
        return { subject: 'Maths', topic: 'Speed, Time & Distance', difficulty: 'easy', q: `A car covers ${d} km in ${t} hours. What is its speed?`, ...numeric(rng, speed, [5, -5, 10], (n) => `${n} km/h`), explanation: `Speed = distance / time = ${d} / ${t} = ${speed} km/h.`, hi: { q: `एक कार ${t} घंटे में ${d} किमी चलती है। उसकी चाल क्या है?`, explanation: `चाल = दूरी / समय = ${speed} किमी/घंटा` } };
    },
    (rng) => {
        const kmh = rng.pick([18, 36, 54, 72, 90, 108]);
        const ms = (kmh * 5) / 18;
        return { subject: 'Maths', topic: 'Speed, Time & Distance', difficulty: 'easy', q: `Convert ${kmh} km/h into m/s.`, ...numeric(rng, ms, [5, -5, 10], (n) => `${fmt(n)} m/s`), explanation: `Multiply by 5/18: ${kmh} × 5/18 = ${ms} m/s.`, hi: { q: `${kmh} किमी/घंटा को मीटर/सेकंड में बदलिए।`, explanation: `${kmh} × 5/18 = ${ms} मी/से` } };
    },
    (rng) => {
        const pairs = [[10, 15], [12, 24], [20, 30], [15, 30], [6, 12], [18, 36], [10, 40], [12, 36], [20, 60], [24, 12]];
        const [a, b] = rng.pick(pairs);
        const t = (a * b) / (a + b);
        return { subject: 'Maths', topic: 'Time & Work', difficulty: 'medium', q: `A can complete a work in ${a} days and B in ${b} days. In how many days can they finish it together?`, ...numeric(rng, t, [2, -2, 3], (n) => `${fmt(n)} days`), explanation: `Together per day = 1/${a} + 1/${b} = ${a + b}/${a * b}; time = ${a * b}/${a + b} = ${fmt(t)} days.`, hi: { q: `A किसी काम को ${a} दिनों में और B ${b} दिनों में कर सकता है। दोनों मिलकर कितने दिनों में करेंगे?`, explanation: `समय = ${a * b}/${a + b} = ${fmt(t)} दिन` } };
    },
    (rng) => {
        const r1 = rng.int(2, 5);
        const r2 = rng.int(2, 7);
        const unit = rng.pick([50, 100, 120, 150, 200]);
        const total = (r1 + r2) * unit;
        return { subject: 'Maths', topic: 'Ratio & Proportion', difficulty: 'easy', q: `₹${total} is divided between A and B in the ratio ${r1} : ${r2}. What is A's share?`, ...numeric(rng, r1 * unit, [unit, -unit, r2 * unit - r1 * unit || unit * 2], (n) => `₹${n}`), explanation: `A's share = ${r1}/${r1 + r2} × ${total} = ₹${r1 * unit}.`, hi: { q: `₹${total} को A और B में ${r1} : ${r2} के अनुपात में बाँटा गया। A का हिस्सा कितना है?`, explanation: `A का हिस्सा = ${r1}/${r1 + r2} × ${total} = ₹${r1 * unit}` } };
    },
    (rng) => {
        const n = rng.int(11, 35);
        return { subject: 'Maths', topic: 'Square Roots', difficulty: 'easy', q: `What is the square root of ${n * n}?`, ...numeric(rng, n, [1, -1, 2]), explanation: `${n} × ${n} = ${n * n}.`, hi: { q: `${n * n} का वर्गमूल क्या है?`, explanation: `${n} × ${n} = ${n * n}` } };
    },
    (rng) => {
        const a = rng.int(2, 9);
        const x = rng.int(-6, 12);
        const b = rng.int(-20, 20);
        const c = a * x + b;
        const bs = b >= 0 ? `+ ${b}` : `− ${-b}`;
        return { subject: 'Maths', topic: 'Linear Equations', difficulty: 'easy', q: `Solve for x: ${a}x ${bs} = ${c}`, ...numeric(rng, x, [1, -1, 2, -2]), explanation: `${a}x = ${c} ${b >= 0 ? '−' : '+'} ${Math.abs(b)} = ${a * x}, so x = ${x}.`, hi: { q: `x का मान ज्ञात कीजिए: ${a}x ${bs} = ${c}`, explanation: `x = ${x}` } };
    },
    (rng) => {
        const a = rng.int(2, 15);
        const d = rng.int(2, 9);
        const n = rng.int(10, 30);
        const t = a + (n - 1) * d;
        return { subject: 'Maths', topic: 'Arithmetic Progression', difficulty: 'medium', q: `Find the ${ordinal(n)} term of the AP: ${a}, ${a + d}, ${a + 2 * d}, …`, ...numeric(rng, t, [d, -d, a]), explanation: `aₙ = a + (n − 1)d = ${a} + ${n - 1} × ${d} = ${t}.`, hi: { q: `समांतर श्रेढ़ी ${a}, ${a + d}, ${a + 2 * d}, … का ${n}वाँ पद ज्ञात कीजिए।`, explanation: `aₙ = ${a} + ${n - 1} × ${d} = ${t}` } };
    },
    (rng) => {
        const k = rng.int(3, 10);
        const base = rng.pick([2, 3]);
        return { subject: 'Maths', topic: 'Logarithms', difficulty: 'easy', q: `What is the value of log${base === 2 ? '₂' : '₃'} ${base ** k}?`, ...numeric(rng, k, [1, -1, 2]), explanation: `${base}^${k} = ${base ** k}, so the logarithm is ${k}.`, hi: { q: `log${base === 2 ? '₂' : '₃'} ${base ** k} का मान क्या है?`, explanation: `${base}^${k} = ${base ** k}` } };
    },
    (rng) => {
        const r1 = rng.pick([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8]);
        let r2 = rng.int(-5, 8);
        if (r2 === r1 || r2 === -r1 || r2 === 0)
            r2 = r1 + 3 === 0 ? 4 : r1 + 3;
        const s = r1 + r2;
        const p = r1 * r2;
        const eq = `x² ${s >= 0 ? '−' : '+'} ${Math.abs(s)}x ${p >= 0 ? '+' : '−'} ${Math.abs(p)} = 0`;
        return { subject: 'Maths', topic: 'Quadratic Equations', difficulty: 'medium', q: `What is the sum of the roots of ${eq}?`, ...numeric(rng, s, [1, -1, 2, -2]), explanation: `For x² + bx + c = 0, sum of roots = −b. Here the roots are ${r1} and ${r2}; sum = ${s}.`, hi: { q: `${eq} के मूलों का योग क्या है?`, explanation: `मूलों का योग = −b = ${s}` } };
    },
    (rng) => {
        const n = rng.int(2, 5);
        const a = rng.int(1, 4);
        const x = rng.int(1, 4);
        const ans = a * n * x ** (n - 1);
        return { subject: 'Maths', topic: 'Differentiation', difficulty: 'medium', q: `If f(x) = ${a === 1 ? '' : a}x${['', '', '²', '³', '⁴', '⁵'][n]}, what is f′(${x})?`, ...numeric(rng, ans, [a, -a, x]), explanation: `f′(x) = ${a * n}x^${n - 1}, so f′(${x}) = ${a * n} × ${x}^${n - 1} = ${ans}.`, hi: { q: `यदि f(x) = ${a === 1 ? '' : a}x${['', '', '²', '³', '⁴', '⁵'][n]} है, तो f′(${x}) का मान क्या है?`, explanation: `f′(${x}) = ${ans}` } };
    },
    (rng) => {
        const items = [['sin 30°', '1/2'], ['cos 60°', '1/2'], ['tan 45°', '1'], ['sin 90°', '1'], ['cos 0°', '1'], ['sin 0°', '0'], ['cos 90°', '0'], ['tan 60°', '√3'], ['tan 30°', '1/√3'], ['sin 60°', '√3/2'], ['cos 30°', '√3/2'], ['sin 45°', '1/√2']];
        const [expr, val] = rng.pick(items);
        const all = ['0', '1/2', '1', '√3', '1/√3', '√3/2', '1/√2', '2'];
        return { subject: 'Maths', topic: 'Trigonometry', difficulty: 'easy', q: `What is the value of ${expr}?`, ...choice(rng, val, all), explanation: `Standard value: ${expr} = ${val}.`, hi: { q: `${expr} का मान क्या है?`, explanation: `${expr} = ${val}` } };
    },
    (rng) => {
        const target = rng.int(2, 12);
        const ways = 6 - Math.abs(7 - target);
        const g = gcd(ways, 36);
        const frac = `${ways / g}/${36 / g}`;
        const pool = ['1/36', '1/18', '1/12', '1/9', '5/36', '1/6', '7/36', '1/4', '1/3'];
        return { subject: 'Maths', topic: 'Probability', difficulty: 'medium', q: `Two fair dice are thrown. What is the probability that the sum is ${target}?`, ...choice(rng, frac, pool), explanation: `There ${ways === 1 ? "is 1 favourable outcome" : `are ${ways} favourable outcomes`} out of 36, so P = ${frac}.`, hi: { q: `दो पासे फेंके जाते हैं। योग ${target} आने की प्रायिकता क्या है?`, explanation: `अनुकूल परिणाम ${ways}, कुल 36, P = ${frac}` } };
    },
];
export const MATHS_IMAGE = [
    (rng) => {
        const [a, b, c] = rng.pick([[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15], [12, 16, 20], [7, 24, 25]]);
        return { subject: 'Maths', topic: 'Geometry', difficulty: 'easy', q: 'In the right-angled triangle shown, find the length of the hypotenuse x.', ...numeric(rng, c, [1, -1, 2], (n) => `${n} cm`), explanation: `By Pythagoras, x² = ${a}² + ${b}² = ${a * a + b * b}, so x = ${c} cm.`, hi: { q: 'चित्र में दिए गए समकोण त्रिभुज का कर्ण x ज्ञात कीजिए।', explanation: `x² = ${a}² + ${b}² = ${a * a + b * b}, x = ${c} सेमी` }, image: rightTriangle(a, b) };
    },
    (rng) => {
        const r = rng.pick([7, 14, 21, 28, 35]);
        const area = (22 / 7) * r * r;
        return { subject: 'Maths', topic: 'Mensuration', difficulty: 'easy', q: 'Find the area of the circle shown. (Take π = 22/7)', ...numeric(rng, area, [2 * (22 / 7) * r - area + area, -r * 7, r * 11], (n) => `${fmt(n)} cm²`), explanation: `Area = πr² = 22/7 × ${r} × ${r} = ${fmt(area)} cm².`, hi: { q: 'चित्र में दिखाए गए वृत्त का क्षेत्रफल ज्ञात कीजिए। (π = 22/7)', explanation: `क्षेत्रफल = πr² = ${fmt(area)} सेमी²` }, image: circleFigure(r) };
    },
    (rng) => {
        const l = rng.int(8, 30);
        const w = rng.int(4, l - 2);
        const per = 2 * (l + w);
        return { subject: 'Maths', topic: 'Mensuration', difficulty: 'easy', q: 'What is the perimeter of the rectangular field shown in the figure?', ...numeric(rng, per, [-(per - l * w), 2, -2, l]), explanation: `Perimeter = 2(l + b) = 2(${l} + ${w}) = ${per} m.`, hi: { q: 'चित्र में दिखाए गए आयताकार खेत का परिमाप क्या है?', explanation: `परिमाप = 2(${l} + ${w}) = ${per} मी` }, image: rectangleFigure(l, w) };
    },
    (rng) => {
        const years = ['2019', '2020', '2021', '2022', '2023'];
        const values = years.map(() => rng.int(4, 19) * 10);
        const max = Math.max(...values);
        if (values.filter((v) => v === max).length > 1)
            values[values.indexOf(max)] = max + 10;
        const best = years[values.indexOf(Math.max(...values))];
        return { subject: 'Maths', topic: 'Data Interpretation', difficulty: 'easy', q: 'Study the bar chart of a factory\'s production (in thousand units). In which year was production the highest?', ...choice(rng, best, years), explanation: `The tallest bar is for ${best} (${Math.max(...values)} thousand units).`, hi: { q: 'बार चार्ट (हज़ार इकाइयों में उत्पादन) देखिए। किस वर्ष उत्पादन सबसे अधिक था?', explanation: `सबसे ऊँचा बार ${best} का है।` }, image: barChart('Production (thousand units)', years, values, 'thousand units') };
    },
    (rng) => {
        const years = ['2019', '2020', '2021', '2022', '2023'];
        const values = years.map(() => rng.int(3, 18) * 10);
        const total = values.reduce((a, b) => a + b, 0);
        return { subject: 'Maths', topic: 'Data Interpretation', difficulty: 'medium', q: 'Using the bar chart, find the total sales (in ₹ lakh) over all five years.', ...numeric(rng, total, [10, -10, 20, -20], (n) => `₹${n} lakh`), explanation: `Total = ${values.join(' + ')} = ${total}.`, hi: { q: 'बार चार्ट से पाँचों वर्षों की कुल बिक्री (₹ लाख में) ज्ञात कीजिए।', explanation: `कुल = ${values.join(' + ')} = ${total}` }, image: barChart('Sales (₹ lakh)', years, values, '₹ lakh') };
    },
];
export const REASONING = [
    (rng) => {
        const a = rng.int(2, 20);
        const d = rng.int(3, 11);
        const seq = Array.from({ length: 5 }, (_, i) => a + i * d);
        const next = a + 5 * d;
        return { subject: 'Reasoning', topic: 'Number Series', difficulty: 'easy', q: `Find the next number in the series: ${seq.join(', ')}, ?`, ...numeric(rng, next, [d, -d, 1]), explanation: `Each term increases by ${d}: ${seq[4]} + ${d} = ${next}.`, hi: { q: `श्रेणी का अगला पद ज्ञात कीजिए: ${seq.join(', ')}, ?`, explanation: `हर पद में ${d} जुड़ता है: ${next}` } };
    },
    (rng) => {
        const a = rng.int(1, 5);
        const r = rng.pick([2, 3]);
        const seq = Array.from({ length: 5 }, (_, i) => a * r ** i);
        const next = a * r ** 5;
        return { subject: 'Reasoning', topic: 'Number Series', difficulty: 'easy', q: `Find the next number in the series: ${seq.join(', ')}, ?`, ...numeric(rng, next, [seq[4], -seq[4], r]), explanation: `Each term is multiplied by ${r}: ${seq[4]} × ${r} = ${next}.`, hi: { q: `श्रेणी का अगला पद ज्ञात कीजिए: ${seq.join(', ')}, ?`, explanation: `हर पद ${r} से गुणा होता है: ${next}` } };
    },
    (rng) => {
        const start = rng.int(2, 8);
        const seq = Array.from({ length: 5 }, (_, i) => (start + i) ** 2);
        const next = (start + 5) ** 2;
        return { subject: 'Reasoning', topic: 'Number Series', difficulty: 'easy', q: `Find the next number in the series: ${seq.join(', ')}, ?`, ...numeric(rng, next, [start + 5, 2, -2]), explanation: `These are squares of ${start} to ${start + 4}; next is ${start + 5}² = ${next}.`, hi: { q: `श्रेणी का अगला पद ज्ञात कीजिए: ${seq.join(', ')}, ?`, explanation: `${start + 5}² = ${next}` } };
    },
    (rng) => {
        const words = ['TABLE', 'CHAIR', 'MONEY', 'PLANT', 'RIVER', 'LIGHT', 'HOUSE', 'WATER', 'EARTH', 'BRAIN', 'CLOUD', 'SMILE'];
        const [w1, w2] = rng.shuffle(words);
        const k = rng.int(1, 3);
        const enc = (w, s) => w.replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 65 + s + 26) % 26) + 65));
        const ans = enc(w2, k);
        return { subject: 'Reasoning', topic: 'Coding-Decoding', difficulty: 'medium', q: `If ${w1} is written as ${enc(w1, k)}, how is ${w2} written in that code?`, ...choice(rng, ans, [enc(w2, k + 1), enc(w2, k - 1), enc(w2, -k), enc(w2, k + 2)]), explanation: `Each letter is shifted ${k} place(s) forward in the alphabet.`, hi: { q: `यदि ${w1} को ${enc(w1, k)} लिखा जाता है, तो उसी कूट में ${w2} को कैसे लिखा जाएगा?`, explanation: `हर अक्षर ${k} स्थान आगे खिसकता है।` } };
    },
    (rng) => {
        const primes = [11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71];
        const composites = [21, 27, 33, 39, 49, 51, 57, 63, 69, 77, 81, 87, 91];
        const odd = rng.pick(composites);
        const group = rng.shuffle(primes).slice(0, 3);
        return { subject: 'Reasoning', topic: 'Odd One Out', difficulty: 'medium', q: 'Find the odd one out.', ...choice(rng, String(odd), group.map(String)), explanation: `All others are prime numbers; ${odd} is composite.`, hi: { q: 'विषम संख्या चुनिए।', explanation: `बाकी सभी अभाज्य हैं; ${odd} भाज्य है।` } };
    },
    (rng) => {
        const h = rng.int(1, 11);
        const m = rng.pick([0, 10, 15, 20, 30, 40, 45, 50]);
        let angle = Math.abs(30 * h - 5.5 * m);
        if (angle > 180)
            angle = 360 - angle;
        return { subject: 'Reasoning', topic: 'Clock', difficulty: 'medium', q: `What is the angle between the hour and minute hands of a clock at ${h}:${String(m).padStart(2, '0')}?`, ...numeric(rng, angle, [15, -15, 30, 5], (n) => `${fmt(n)}°`), explanation: `Angle = |30H − 5.5M| = |${30 * h} − ${5.5 * m}| = ${fmt(angle)}°.`, hi: { q: `${h}:${String(m).padStart(2, '0')} बजे घड़ी की सुइयों के बीच का कोण क्या है?`, explanation: `कोण = |30H − 5.5M| = ${fmt(angle)}°` } };
    },
    (rng) => {
        const [n, e, d] = rng.pick([[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 6, 10], [9, 12, 15], [12, 5, 13]]);
        return { subject: 'Reasoning', topic: 'Direction Sense', difficulty: 'easy', q: `A person walks ${n} km North and then ${e} km East, as shown. How far is he from the starting point?`, ...numeric(rng, d, [n, e, -1], (x) => `${x} km`), explanation: `Distance = √(${n}² + ${e}²) = √${n * n + e * e} = ${d} km.`, hi: { q: `एक व्यक्ति ${n} किमी उत्तर और फिर ${e} किमी पूर्व चलता है। वह प्रारंभिक बिंदु से कितनी दूर है?`, explanation: `दूरी = √(${n}² + ${e}²) = ${d} किमी` }, image: directionPath(n, e) };
    },
];
export const PHYSICS_NUM = [
    (rng) => {
        const u = rng.int(0, 10);
        const a = rng.int(1, 5);
        const t = rng.int(2, 10);
        const v = u + a * t;
        return { subject: 'Physics', topic: 'Kinematics', difficulty: 'easy', q: `A body starts with a velocity of ${u} m/s and accelerates uniformly at ${a} m/s² for ${t} s. What is its final velocity?`, ...numeric(rng, v, [a, -a, u], (n) => `${n} m/s`), explanation: `v = u + at = ${u} + ${a} × ${t} = ${v} m/s.`, hi: { q: `एक वस्तु ${u} मी/से के वेग से चलना शुरू करती है और ${t} सेकंड तक ${a} मी/से² से त्वरित होती है। अंतिम वेग क्या है?`, explanation: `v = u + at = ${v} मी/से` } };
    },
    (rng) => {
        const i = rng.pick([0.5, 1, 2, 3, 4, 5]);
        const r = rng.pick([2, 4, 5, 6, 10, 12, 20]);
        const v = i * r;
        return { subject: 'Physics', topic: 'Electricity', difficulty: 'easy', q: `A current of ${i} A flows through a resistor of ${r} Ω. What is the potential difference across it?`, ...numeric(rng, v, [r, -i, 2], (n) => `${fmt(n)} V`), explanation: `By Ohm's law, V = IR = ${i} × ${r} = ${fmt(v)} V.`, hi: { q: `${r} Ω के प्रतिरोध में ${i} A धारा बहती है। इसके सिरों पर विभवांतर कितना है?`, explanation: `V = IR = ${fmt(v)} V` } };
    },
    (rng) => {
        const m = rng.pick([2, 4, 5, 10, 20, 50]);
        const v = rng.pick([2, 3, 4, 5, 10]);
        const ke = 0.5 * m * v * v;
        return { subject: 'Physics', topic: 'Work & Energy', difficulty: 'easy', q: `What is the kinetic energy of a ${m} kg body moving at ${v} m/s?`, ...numeric(rng, ke, [ke, m * v - ke, 10], (n) => `${fmt(n)} J`), explanation: `KE = ½mv² = ½ × ${m} × ${v}² = ${fmt(ke)} J.`, hi: { q: `${v} मी/से से चल रही ${m} किग्रा की वस्तु की गतिज ऊर्जा कितनी है?`, explanation: `KE = ½mv² = ${fmt(ke)} J` } };
    },
    (rng) => {
        const m = rng.pick([5, 10, 15, 20, 25, 40, 50, 60]);
        return { subject: 'Physics', topic: 'Gravitation', difficulty: 'easy', q: `What is the weight of a ${m} kg object on Earth? (Take g = 10 m/s²)`, ...numeric(rng, m * 10, [m, -m, 100], (n) => `${n} N`), explanation: `W = mg = ${m} × 10 = ${m * 10} N.`, hi: { q: `पृथ्वी पर ${m} किग्रा की वस्तु का भार कितना है? (g = 10 मी/से²)`, explanation: `W = mg = ${m * 10} N` } };
    },
    (rng) => {
        const rs = rng.shuffle([2, 3, 4, 5, 6, 8, 10]).slice(0, rng.int(2, 3));
        const total = rs.reduce((a, b) => a + b, 0);
        const volts = total * rng.pick([1, 2, 3]);
        const i = volts / total;
        return { subject: 'Physics', topic: 'Electricity', difficulty: 'medium', q: 'In the circuit shown, the resistors are connected in series with the battery. What current flows in the circuit?', ...numeric(rng, i, [1, -0.5, 2, 0.5], (n) => `${fmt(n)} A`), explanation: `Total resistance = ${rs.join(' + ')} = ${total} Ω; I = V/R = ${volts}/${total} = ${fmt(i)} A.`, hi: { q: 'चित्र में प्रतिरोध बैटरी के साथ श्रेणीक्रम में जुड़े हैं। परिपथ में कितनी धारा बहेगी?', explanation: `कुल प्रतिरोध = ${total} Ω; I = ${volts}/${total} = ${fmt(i)} A` }, image: seriesCircuit(rs, volts) };
    },
];
const ATOMIC = { H: 1, C: 12, N: 14, O: 16, Na: 23, Mg: 24, S: 32, Cl: 35.5, K: 39, Ca: 40 };
const COMPOUNDS = [
    ['water', 'H₂O', { H: 2, O: 1 }], ['carbon dioxide', 'CO₂', { C: 1, O: 2 }], ['ammonia', 'NH₃', { N: 1, H: 3 }], ['methane', 'CH₄', { C: 1, H: 4 }],
    ['sodium chloride', 'NaCl', { Na: 1, Cl: 1 }], ['calcium carbonate', 'CaCO₃', { Ca: 1, C: 1, O: 3 }], ['sulphuric acid', 'H₂SO₄', { H: 2, S: 1, O: 4 }],
    ['sodium hydroxide', 'NaOH', { Na: 1, O: 1, H: 1 }], ['magnesium oxide', 'MgO', { Mg: 1, O: 1 }], ['nitric acid', 'HNO₃', { H: 1, N: 1, O: 3 }],
    ['glucose', 'C₆H₁₂O₆', { C: 6, H: 12, O: 6 }], ['hydrochloric acid', 'HCl', { H: 1, Cl: 1 }], ['potassium chloride', 'KCl', { K: 1, Cl: 1 }],
];
export const CHEMISTRY_NUM = [
    (rng) => {
        const [name, formula, comp] = rng.pick(COMPOUNDS);
        const mass = Object.entries(comp).reduce((s, [el, n]) => s + ATOMIC[el] * n, 0);
        const working = Object.entries(comp).map(([el, n]) => `${n} × ${ATOMIC[el]}`).join(' + ');
        return { subject: 'Chemistry', topic: 'Mole Concept', difficulty: 'easy', q: `What is the molar mass of ${name} (${formula})? (H = 1, C = 12, N = 14, O = 16, Na = 23, Mg = 24, S = 32, Cl = 35.5, K = 39, Ca = 40)`, ...numeric(rng, mass, [16, -1, 2, 12], (n) => `${fmt(n)} g/mol`), explanation: `${working} = ${fmt(mass)} g/mol.`, hi: { q: `${formula} का मोलर द्रव्यमान कितना है?`, explanation: `${working} = ${fmt(mass)} g/mol` } };
    },
];
import { ANTONYMS, SYNONYMS } from './curated.js';
export const ENGLISH_VOCAB = [
    (rng) => {
        const [word, syn] = rng.pick(SYNONYMS);
        return { subject: 'English', topic: 'Synonyms', difficulty: 'easy', q: `Choose the word most similar in meaning to "${word}".`, ...choice(rng, syn, ANTONYMS.map((p) => p[1])), explanation: `"${word}" means "${syn.toLowerCase()}".` };
    },
    (rng) => {
        const [word, ant] = rng.pick(ANTONYMS);
        return { subject: 'English', topic: 'Antonyms', difficulty: 'easy', q: `Choose the word opposite in meaning to "${word}".`, ...choice(rng, ant, SYNONYMS.map((p) => p[1])), explanation: `The opposite of "${word}" is "${ant.toLowerCase()}".` };
    },
];
/** Questions that need two figures, and image questions with a worked-solution image. */
export const MULTI_IMAGE = [
    (rng) => {
        const [r1, r2] = rng.shuffle([7, 14, 21, 28]).slice(0, 2);
        const g2 = gcd(r1 * r1, r2 * r2);
        const ans = `${(r1 * r1) / g2} : ${(r2 * r2) / g2}`;
        const g1 = gcd(r1, r2);
        const wrong = [`${r1 / g1} : ${r2 / g1}`, `${r2 * r2 / g2} : ${r1 * r1 / g2}`, `${(2 * r1) / g1} : ${r2 / g1}`, '1 : 1'];
        return {
            subject: 'Maths', topic: 'Mensuration', difficulty: 'medium',
            q: 'Figure 1 and Figure 2 show two circles. What is the ratio of the area of the circle in Figure 1 to the area of the circle in Figure 2?',
            ...choice(rng, ans, wrong),
            explanation: `Area ∝ r². Ratio = ${r1}² : ${r2}² = ${r1 * r1} : ${r2 * r2} = ${ans}.`,
            hi: { q: 'चित्र 1 और चित्र 2 में दो वृत्त हैं। चित्र 1 के वृत्त और चित्र 2 के वृत्त के क्षेत्रफलों का अनुपात क्या है?', explanation: `क्षेत्रफल ∝ r²; अनुपात = ${ans}` },
            image: circleFigure(r1),
            images: [circleFigure(r2)],
            explanationImages: [solutionCard('Worked solution', [`Area = πr²  ⇒  ratio = r₁² : r₂²`, `= ${r1}² : ${r2}² = ${r1 * r1} : ${r2 * r2}`, `= ${ans}`])],
        };
    },
    (rng) => {
        const a = rng.pick([6, 8, 10, 12, 14]);
        const r = rng.pick([7, 14]);
        const sq = a * a;
        const circle = (22 / 7) * r * r;
        const bigger = circle > sq ? 'The circle (Figure 2)' : 'The square (Figure 1)';
        const diff = Math.abs(circle - sq);
        return {
            subject: 'Maths', topic: 'Mensuration', difficulty: 'medium',
            q: `Figure 1 shows a square and Figure 2 shows a circle. Which figure has the larger area, and by how much? (π = 22/7)`,
            ...choice(rng, `${bigger}, by ${fmt(diff)} cm²`, [`${bigger === 'The circle (Figure 2)' ? 'The square (Figure 1)' : 'The circle (Figure 2)'}, by ${fmt(diff)} cm²`, `${bigger}, by ${fmt(diff + 10)} cm²`, 'Both have equal area']),
            explanation: `Square = ${a}² = ${sq} cm². Circle = 22/7 × ${r}² = ${fmt(circle)} cm². Difference = ${fmt(diff)} cm².`,
            image: squareFigure(a),
            images: [circleFigure(r)],
            explanationImages: [solutionCard('Compare the areas', [`Square: ${a} × ${a} = ${sq} cm²`, `Circle: 22/7 × ${r} × ${r} = ${fmt(circle)} cm²`, `Difference = ${fmt(diff)} cm²`])],
        };
    },
    (rng) => {
        const [a, b, c] = rng.pick([[3, 4, 5], [6, 8, 10], [5, 12, 13], [8, 15, 17], [9, 12, 15]]);
        return {
            subject: 'Maths', topic: 'Geometry', difficulty: 'easy',
            q: 'Find the perimeter of the right-angled triangle shown.',
            ...numeric(rng, a + b + c, [c, -c, 2], (n) => `${n} cm`),
            explanation: `Hypotenuse = √(${a}² + ${b}²) = ${c} cm, so perimeter = ${a} + ${b} + ${c} = ${a + b + c} cm.`,
            hi: { q: 'दिखाए गए समकोण त्रिभुज का परिमाप ज्ञात कीजिए।', explanation: `कर्ण = ${c} सेमी, परिमाप = ${a + b + c} सेमी` },
            image: rightTriangle(a, b),
            explanationImages: [solutionCard('Step 1: hypotenuse', [`x² = ${a}² + ${b}² = ${a * a + b * b}`, `x = ${c} cm`]), solutionCard('Step 2: perimeter', [`P = ${a} + ${b} + ${c}`, `P = ${a + b + c} cm`])],
        };
    },
];
//# sourceMappingURL=generators.js.map