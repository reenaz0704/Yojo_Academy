/**
 * The 18-question onboarding questionnaire (design document pages 06A/06B), moved from login.html to the server so
 * answer keys and weights stay private. Scoring is the prototype's, unchanged: version ONBOARDING_RULES_VERSION.
 */
export const ONBOARDING_RULES_VERSION = 'onboarding-2026-10-v1';

type Cat = 'O' | 'D' | 'G';
type Weights = Partial<Record<Cat, number>>;
interface Q {
  b: string;
  q: string;
  sub?: string;
  o?: string[];
  key?: number;
  part?: number[];
  w?: Weights;
  map?: Cat[];
  scale?: boolean;
  forced?: Record<Cat, number>[];
}

const QBANK: Q[] = [
  {
    b: 'LOGIC PUZZLE',
    q: 'Which one is the odd one out?',
    o: ['Apple', 'Banana', 'Carrot', 'Mango'],
    key: 2,
    w: { D: 0.5, G: 0.5 },
  },
  {
    b: 'LOGIC PUZZLE',
    q: 'What number comes next in this series?',
    sub: '3   6   11   18   ?',
    o: ['25', '27', '29', '31'],
    key: 1,
    w: { D: 0.6, G: 0.4 },
  },
  {
    b: 'LOGIC PUZZLE',
    q: 'What number comes next?',
    sub: '1   1   2   3   5   8   ?',
    o: ['11', '12', '13', '15'],
    key: 2,
    w: { D: 0.6, O: 0.4 },
  },
  {
    b: 'LOGIC PUZZLE',
    q: 'Order four files by these rules: C comes first, D comes last, B comes before A. What is the order?',
    o: ['C, A, B, D', 'C, B, A, D', 'B, C, A, D', 'C, B, D, A'],
    key: 1,
    w: { G: 0.7, D: 0.3 },
  },
  {
    b: 'RIDDLE',
    q: 'What has keys but cannot open a single lock?',
    o: ['A piano', 'A map', 'A locksmith', 'A diary'],
    key: 0,
    part: [3],
    w: { O: 0.5, D: 0.5 },
  },
  {
    b: 'RIDDLE',
    q: 'A man pushes his car up to a hotel, then tells its owner he is bankrupt. Why?',
    o: [
      'He is playing a board game',
      'He lost his job that morning',
      'The car was stolen from him',
      'The hotel is closed',
    ],
    key: 0,
    w: { O: 0.7, D: 0.3 },
  },
  {
    b: 'RIDDLE',
    q: 'The more of these you take, the more you leave behind. What are they?',
    o: ['Photos', 'Footsteps', 'Notes', 'Breaths'],
    key: 1,
    part: [0],
    w: { O: 0.6, G: 0.4 },
  },
  {
    b: 'SCENARIO',
    q: 'A new phone app asks for many permissions. What do you do first?',
    o: [
      'Deny each one and test what breaks',
      'Check its reviews and watch its data usage',
      'Read the privacy policy and company terms',
    ],
    map: ['O', 'D', 'G'],
  },
  {
    b: 'SCENARIO',
    q: 'Your office water bill doubles this month. What do you do first?',
    o: [
      'Compare the meter readings day by day',
      'Shut valves one by one to test for a leak',
      'Read the billing terms and raise a ticket with records',
    ],
    map: ['D', 'O', 'G'],
  },
  {
    b: 'SCENARIO',
    q: 'Things keep going missing from a shared cupboard. Your first move?',
    o: [
      'Work out every way someone could get in',
      'Set up a simple log of who opens it and when',
      'Propose a check-in and check-out rule for everyone',
    ],
    map: ['O', 'D', 'G'],
  },
  {
    b: 'SCENARIO',
    q: 'Your college fest has half the budget it needs. You:',
    o: [
      'Find a clever shortcut nobody has tried',
      'Track every rupee daily to catch overspending early',
      'Agree spending rules and approvals before anything is bought',
    ],
    map: ['O', 'D', 'G'],
  },
  {
    b: 'SCENARIO',
    q: 'A team shortcut saves a day but skips an agreed step. You:',
    o: [
      'Use it and see if anything breaks',
      'Follow the step and report the delay',
      "Ask the rule owner's view and note the risk",
    ],
    map: ['O', 'D', 'G'],
  },
  { b: 'PSYCHOMETRIC', q: 'I enjoy working out how something could be made to fail.', scale: true, w: { O: 1 } },
  { b: 'PSYCHOMETRIC', q: 'I stay calm and methodical when many things go wrong at once.', scale: true, w: { D: 1 } },
  { b: 'PSYCHOMETRIC', q: 'I like writing clear checklists and step-by-step procedures.', scale: true, w: { G: 1 } },
  { b: 'PSYCHOMETRIC', q: 'I like taking things apart to see how they work.', scale: true, w: { O: 1 } },
  { b: 'PSYCHOMETRIC', q: 'I notice small details that other people miss.', scale: true, w: { D: 1 } },
  {
    b: 'PSYCHOMETRIC',
    q: 'When I start something new, I usually...',
    o: ['Plan first, then act', 'Try things and adjust as I go'],
    forced: [
      { G: 1, D: 0.5, O: 0 },
      { O: 1, D: 0.5, G: 0 },
    ],
  },
];

export const QUESTION_COUNT = QBANK.length;
export const MAX_SKIPS = 3;
const CAT: Record<Cat, 'Offensive' | 'Defensive' | 'GRC'> = { O: 'Offensive', D: 'Defensive', G: 'GRC' };

/** Questions as the page shows them: no keys, weights or maps. */
export function publicQuestions() {
  return QBANK.map((q, i) => ({
    index: i,
    block: q.b,
    question: q.q,
    sub: q.sub ?? null,
    kind: q.scale ? 'scale' : q.map ? 'scenario' : q.forced ? 'forced' : 'choice',
    options: q.scale ? ['1', '2', '3', '4', '5'] : q.o!,
  }));
}

/** Answer per question: option index, 1..5 for scale items, or 'skip'. Returns null when an answer is invalid. */
export function validAnswers(ans: unknown[]): boolean {
  if (ans.length !== QBANK.length) return false;
  let skips = 0;
  for (let i = 0; i < QBANK.length; i++) {
    const a = ans[i],
      q = QBANK[i];
    if (a === 'skip') {
      skips++;
      continue;
    }
    if (typeof a !== 'number' || !Number.isInteger(a)) return false;
    if (q.scale ? a < 1 || a > 5 : a < 0 || a >= q.o!.length) return false;
  }
  return skips <= MAX_SKIPS;
}

function itemScore(q: Q, a: number | 'skip'): Partial<Record<Cat, { w: number; s: number }>> | null {
  if (a === 'skip') return null;
  if (q.scale) return Object.fromEntries(Object.entries(q.w!).map(([c, w]) => [c, { w, s: (a - 1) / 4 }]));
  if (q.map)
    return Object.fromEntries((['O', 'D', 'G'] as Cat[]).map((c) => [c, { w: 1, s: q.map![a] === c ? 1 : 0.5 }]));
  if (q.forced) return Object.fromEntries(Object.entries(q.forced[a]).map(([c, s]) => [c, { w: 1, s }]));
  const s = a === q.key ? 1 : (q.part ?? []).includes(a) ? 0.5 : 0;
  return Object.fromEntries(Object.entries(q.w!).map(([c, w]) => [c, { w, s }]));
}

export interface OnboardingScore {
  scores: { Offensive: number; Defensive: number; GRC: number };
  primary: 'Offensive' | 'Defensive' | 'GRC';
  secondary: 'Offensive' | 'Defensive' | 'GRC';
  provisional: boolean;
  answered: number;
  confidence: 'High' | 'Medium' | 'Low';
}

/** The prototype's scoring (login.html scoreQuiz), unchanged. */
export function scoreOnboarding(ans: (number | 'skip')[]): OnboardingScore {
  const num = { O: 0, D: 0, G: 0 },
    den = { O: 0, D: 0, G: 0 },
    cnt = { O: 0, D: 0, G: 0 };
  const puz = { O: [0, 0], D: [0, 0], G: [0, 0] };
  let answered = 0;
  QBANK.forEach((q, i) => {
    const r = itemScore(q, ans[i]);
    if (!r) return;
    answered++;
    (Object.entries(r) as [Cat, { w: number; s: number }][]).forEach(([c, { w, s }]) => {
      if (!w) return;
      num[c] += w * s;
      den[c] += w;
      cnt[c]++;
      if (i < 7) {
        puz[c][0] += s;
        puz[c][1]++;
      }
    });
  });
  const pct = (c: Cat) => (den[c] ? Math.round((100 * num[c]) / den[c]) : 0);
  const acc = (c: Cat) => (puz[c][1] ? puz[c][0] / puz[c][1] : 0);
  const order = (['O', 'D', 'G'] as Cat[]).sort((a, b) => {
    const d = pct(b) - pct(a);
    return Math.abs(d) > 3 ? d : acc(b) - acc(a) || d;
  });
  const top = pct(order[0]);
  return {
    scores: { Offensive: pct('O'), Defensive: pct('D'), GRC: pct('G') },
    primary: CAT[order[0]],
    secondary: CAT[order[1]],
    provisional: answered < 15 || Object.values(cnt).some((n) => n < 3),
    answered,
    confidence: top >= 70 ? 'High' : top >= 50 ? 'Medium' : 'Low',
  };
}
