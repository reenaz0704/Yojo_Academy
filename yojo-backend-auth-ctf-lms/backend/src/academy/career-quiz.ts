/**
 * Career-path quiz (owner, 24 Oct): 15 real-life scenarios, 5 themed around each track. Every question offers one
 * answer per track, so every answer counts toward exactly one track. The option → track mapping never leaves the
 * server; the browser sees opaque option ids in a mixed order.
 *
 * Scoring: percentage per track = answers for that track ÷ 15 × 100, rounded to a whole number (the three can add
 * up to 99 or 101). Suggested track = the highest count; on a tie the order Defensive, Offensive, GRC decides and the
 * tie is reported so the student can pick. The quiz is optional; the student always chooses the path that is used.
 * Wording is a first draft for Yojo to review (OPEN-ITEMS OI-52).
 */
export const CAREER_QUIZ_VERSION = 'career-path-2026-10-v1';
export const CAREER_RETAKE_DAYS = 30;
export const TRACKS = ['Offensive', 'Defensive', 'GRC'] as const;
export type Track = (typeof TRACKS)[number];

interface Opt {
  id: string;
  text: string;
  track: Track;
}
interface CQ {
  id: string;
  theme: Track;
  scenario: string;
  options: Opt[];
}

const q = (id: string, theme: Track, scenario: string, options: [string, string, Track][]): CQ => ({
  id,
  theme,
  scenario,
  options: options.map(([oid, text, track]) => ({ id: oid, text, track })),
});

export const CAREER_QUESTIONS: CQ[] = [
  // ── themed around offensive security ──
  q(
    'o1',
    'Offensive',
    'You own a small online shop and it is under an external attack right now. What do you do first?',
    [
      [
        'a',
        'Cut off the affected servers, keep the shop running from clean backups and collect evidence of what happened.',
        'Defensive',
      ],
      [
        'b',
        'Study the attacker’s method on a safe copy of your system to understand exactly how they got in.',
        'Offensive',
      ],
      [
        'c',
        'Check which policy or contract was missed and make sure it is enforced so this cannot happen again.',
        'GRC',
      ],
    ],
  ),
  q(
    'o2',
    'Offensive',
    'Your college launches a new student portal. You are asked to help before it goes live. Which job do you pick?',
    [
      ['a', 'Write the rules for who may see which student records and get them approved.', 'GRC'],
      ['b', 'Try to break into it, with permission, and report every weakness you find.', 'Offensive'],
      ['c', 'Set up alerts so the team knows the moment something suspicious happens on it.', 'Defensive'],
    ],
  ),
  q('o3', 'Offensive', 'A friend says their game account was taken over. How do you want to help?', [
    ['a', 'Work out the trick the attacker used, step by step, so you can explain it.', 'Offensive'],
    ['b', 'Help them lock the account down: new password, two-step login, sign out other devices.', 'Defensive'],
    ['c', 'Explain the game’s account rules and how to report it so the company acts on it.', 'GRC'],
  ]),
  q('o4', 'Offensive', 'You find a door in a building that does not lock properly. What is your first thought?', [
    ['a', 'Tell security and check the camera covers that door until it is fixed.', 'Defensive'],
    ['b', 'Ask whether there is a rule for checking doors, and who is responsible for it.', 'GRC'],
    ['c', 'Wonder how many other doors have the same flaw and how someone could use it.', 'Offensive'],
  ]),
  q('o5', 'Offensive', 'In a capture-the-flag event you are stuck on a challenge. What keeps you going?', [
    ['a', 'The puzzle itself: finding the one clever way in that nobody else spotted.', 'Offensive'],
    ['b', 'Knowing the lesson will help me protect real systems from the same attack.', 'Defensive'],
    ['c', 'Writing up clear notes so the team learns from it, even if I do not solve it.', 'GRC'],
  ]),
  // ── themed around defensive security ──
  q('d1', 'Defensive', 'At 2 AM a monitoring screen shows hundreds of failed logins on one account. What do you do?', [
    ['a', 'Block the source, protect the account and keep watching for the next move.', 'Defensive'],
    ['b', 'Check the login policy: should accounts lock after a few failures, and who approves that?', 'GRC'],
    ['c', 'Look at which tool the attacker is likely using and what it is trying.', 'Offensive'],
  ]),
  q('d2', 'Defensive', 'Your family’s home Wi-Fi seems slow and a strange device is connected. Your move?', [
    ['a', 'Set simple house rules: who may join the Wi-Fi, and change the password every few months.', 'GRC'],
    ['b', 'Find out what the device is and how it got the password.', 'Offensive'],
    ['c', 'Kick it off, change the password, turn on WPA3 and update the router.', 'Defensive'],
  ]),
  q('d3', 'Defensive', 'An employee forwards a suspicious email with an attachment. What do you want to do with it?', [
    ['a', 'Open it safely in a sandbox to see exactly what the malware tries to do.', 'Offensive'],
    ['b', 'Find everyone else who got it, delete it from their inboxes and block the sender.', 'Defensive'],
    ['c', 'Update the staff training and the email policy so people report such mails quickly.', 'GRC'],
  ]),
  q('d4', 'Defensive', 'Which of these tasks would you enjoy most on a normal workday?', [
    ['a', 'Watching dashboards and logs, spotting the one event that does not look right.', 'Defensive'],
    ['b', 'Reviewing whether teams follow the security standards and preparing for an audit.', 'GRC'],
    ['c', 'Testing an application for weaknesses before attackers find them.', 'Offensive'],
  ]),
  q('d5', 'Defensive', 'Ransomware locked a few office computers. What part of the response do you want to lead?', [
    ['a', 'Tell the right people on time: management, customers and the authorities as the law requires.', 'GRC'],
    ['b', 'Stop the spread, restore from backups and get people working again.', 'Defensive'],
    ['c', 'Reverse-engineer the ransomware to learn how it spreads and whether it has a flaw.', 'Offensive'],
  ]),
  // ── themed around governance, risk and compliance ──
  q(
    'g1',
    'GRC',
    'A company wants to store customer data in the cloud. You are asked for advice. What do you focus on?',
    [
      ['a', 'Which laws and contracts apply to that data and what the cloud provider must promise.', 'GRC'],
      ['b', 'How an attacker could reach the data once it is in the cloud.', 'Offensive'],
      ['c', 'Encryption, access logs and alerts so misuse is caught quickly.', 'Defensive'],
    ],
  ),
  q('g2', 'GRC', 'Your team keeps using weak passwords like "Welcome@123". How would you fix it for good?', [
    ['a', 'Show them how fast such passwords can be cracked in a test.', 'Offensive'],
    ['b', 'Turn on two-step login and block common passwords in the system.', 'Defensive'],
    ['c', 'Write a password policy, get it approved and check that teams follow it.', 'GRC'],
  ]),
  q('g3', 'GRC', 'A new partner company will connect to your systems. What do you check first?', [
    ['a', 'Their security certificates, a signed agreement and what happens if they cause a breach.', 'GRC'],
    ['b', 'Limit what their connection can reach and monitor it closely.', 'Defensive'],
    ['c', 'Test their connection for weaknesses before it goes live.', 'Offensive'],
  ]),
  q('g4', 'GRC', 'Management asks: "How safe are we?" How do you like to answer?', [
    ['a', 'With the incidents we caught and stopped this quarter and how fast we reacted.', 'Defensive'],
    ['b', 'With the results of a fresh attack simulation against our systems.', 'Offensive'],
    ['c', 'With a risk register: our top risks, their likelihood and impact, and the plan for each.', 'GRC'],
  ]),
  q('g5', 'GRC', 'A rule says all laptops must be encrypted, but some are not. What do you do?', [
    ['a', 'Encrypt them now and add a check so unencrypted laptops cannot reach the network.', 'Defensive'],
    ['b', 'Record it as a gap, find out why the rule was missed and agree a deadline with each team.', 'GRC'],
    ['c', 'Show how easily data can be read from an unencrypted laptop that gets lost.', 'Offensive'],
  ]),
];

/** What the browser may see: scenario text and opaque option ids, never the track. */
export function publicCareerQuestions() {
  return CAREER_QUESTIONS.map((x, i) => ({
    index: i,
    id: x.id,
    scenario: x.scenario,
    options: x.options.map((o) => ({ id: o.id, text: o.text })),
  }));
}

/** answers: one option id per question, in question order. Returns null when the shape is wrong. */
export function scoreCareer(answers: unknown) {
  if (!Array.isArray(answers) || answers.length !== CAREER_QUESTIONS.length) return null;
  const count: Record<Track, number> = { Offensive: 0, Defensive: 0, GRC: 0 };
  for (let i = 0; i < CAREER_QUESTIONS.length; i++) {
    const o = CAREER_QUESTIONS[i].options.find((x) => x.id === answers[i]);
    if (!o) return null;
    count[o.track]++;
  }
  const n = CAREER_QUESTIONS.length;
  const pct = (t: Track) => Math.round((100 * count[t]) / n);
  const top = Math.max(...TRACKS.map((t) => count[t]));
  const TIE_ORDER: Track[] = ['Defensive', 'Offensive', 'GRC'];
  const tied = TIE_ORDER.filter((t) => count[t] === top);
  return {
    counts: count,
    percentages: { Offensive: pct('Offensive'), Defensive: pct('Defensive'), GRC: pct('GRC') },
    suggested: tied[0],
    tiedWith: tied.slice(1),
  };
}
