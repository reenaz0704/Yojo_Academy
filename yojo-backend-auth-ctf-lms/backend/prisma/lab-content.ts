/**
 * Steps, briefings, quizzes and hints for the 9 Academy labs (ported from mission-api and academy-mission1.js,
 * 24 Oct). The seed hashes every answer and quiz key with a fresh salt before storing it; the database never holds
 * them in plain text. This file does, like mission-api's source did, so keep the repository private. An admin can
 * replace an answer at any time (the hash changes; the plain value is never shown again).
 * Hints are first drafts for Yojo to review (OPEN-ITEMS OI-56). `{LAB_URL}` in a briefing is filled in by the page
 * with the student's own lab address once their lab is running.
 */
export interface LabQuizQ {
  prompt: string;
  options: string[];
  answer: number;
}
export interface LabStep {
  kind: 'read' | 'quiz' | 'answer' | 'lab_answer';
  title: string;
  body?: string;
  xp?: number;
  perCorrectXp?: number;
  format?: 'text' | 'set' | 'date' | 'count' | 'session_flag';
  answer?: string;
  placeholder?: string;
  quiz?: LabQuizQ[];
}
export interface LabContent {
  provider: 'native' | 'mission-api';
  steps: LabStep[];
  hints: string[];
}

const INT01: LabQuizQ[] = [
  {
    prompt: 'Which part of the CIA triad is broken when an unauthorized person reads a private document?',
    options: ['Confidentiality', 'Integrity', 'Availability', 'Authentication'],
    answer: 0,
  },
  {
    prompt: 'An attacker secretly changes the amount in a bank transfer. Which principle is violated?',
    options: ['Confidentiality', 'Availability', 'Integrity', 'Non-repudiation'],
    answer: 2,
  },
  {
    prompt: 'A flood of fake traffic makes a company website unreachable for real customers. What is this attack?',
    options: ['Phishing', 'Denial-of-service', 'SQL injection', 'Ransomware'],
    answer: 1,
  },
  {
    prompt: 'An email pretending to be your bank asks you to click a link and enter your password. What is this?',
    options: ['Phishing', 'Cross-site scripting', 'A data breach', 'An insider threat'],
    answer: 0,
  },
  {
    prompt: 'Which weakness lets an attacker send malicious database commands through a web form field?',
    options: ['Cross-site scripting', 'SQL injection', 'Weak Wi-Fi', 'Social engineering'],
    answer: 1,
  },
  {
    prompt: 'Which security domain is mainly about policies, risk assessment and compliance?',
    options: ['Offensive security', 'Defensive security', 'Governance, Risk and Compliance (GRC)', 'Threat hunting'],
    answer: 2,
  },
  {
    prompt: 'Which tool is mainly used to capture and analyze network traffic?',
    options: ['Nessus', 'Splunk', 'Wireshark', 'Burp Suite'],
    answer: 2,
  },
  {
    prompt: 'Which role watches alerts and logs in a Security Operations Center and triages possible incidents?',
    options: ['Penetration Tester', 'GRC Analyst', 'SOC Analyst', 'Security Consultant'],
    answer: 2,
  },
];
const REC01: LabQuizQ[] = [
  {
    prompt: 'What is the main purpose of reconnaissance in an authorized security assessment?',
    options: [
      'Understand the in-scope assets and their public attack surface',
      'Exploit every system found as fast as possible',
      'Erase evidence of the assessment',
      'Guess employee passwords',
    ],
    answer: 0,
  },
  {
    prompt: 'Which of these is passive reconnaissance?',
    options: [
      'Running a full port scan on a host',
      'Sending crafted requests to a login page',
      "Searching Certificate Transparency logs for a domain's public certificates",
      'Brute-forcing hidden directories',
    ],
    answer: 2,
  },
  {
    prompt: 'Which activity is active reconnaissance?',
    options: [
      'Reading an archived page on the Wayback Machine',
      'Running Nmap against an authorized lab host',
      "Reading the company's public job postings",
      'Looking up domain registration data with RDAP',
    ],
    answer: 1,
  },
  {
    prompt: 'What is the key difference between passive and active reconnaissance?',
    options: [
      'Passive is always illegal and active is always legal',
      'Active reconnaissance never creates logs',
      'They are the same thing with different names',
      "Passive does not contact the target's systems directly; active does",
    ],
    answer: 3,
  },
  {
    prompt: 'Which tool is best for viewing the HTTP response headers of an authorized test web server?',
    options: ['The Wayback Machine', 'curl with the -I option', 'A WHOIS lookup', 'A search engine'],
    answer: 1,
  },
  {
    prompt:
      'During an authorized assessment you find a subdomain that is not listed in the scope document. What should you do?',
    options: [
      'Scan it quickly since it belongs to the same company',
      'Test it only lightly',
      'Stop and confirm with the client whether it is in scope',
      'Publish it in your report as a vulnerability',
    ],
    answer: 2,
  },
];

const brief = (title: string, body: string): LabStep => ({ kind: 'read', title, body, xp: 0 });

export const LAB_CONTENT: Record<string, LabContent> = {
  'INT-01': {
    provider: 'native',
    steps: [
      {
        kind: 'read',
        title: 'Lesson: Introduction to Cybersecurity',
        body: 'Six short sections: what cybersecurity is, the CIA triad, common threats, security domains, common tools and career paths.',
        xp: 20,
      },
      { kind: 'quiz', title: 'Knowledge check', perCorrectXp: 10, quiz: INT01 },
    ],
    hints: [],
  },
  'REC-01': {
    provider: 'native',
    steps: [
      {
        kind: 'read',
        title: 'Lesson: Reconnaissance Fundamentals',
        body: 'Seven short sections: what reconnaissance is, passive and active recon, how they differ, common tools, scope and a recon workflow.',
        xp: 20,
      },
      { kind: 'quiz', title: 'Knowledge check', perCorrectXp: 5, quiz: REC01 },
    ],
    hints: [],
  },
  'DOM-01': {
    provider: 'native',
    steps: [
      brief(
        'Briefing: domain expiration',
        'You are performing a domain intelligence assessment for YOJO Solutions. Find when the company domain registration expires.\n\nTarget domain: yojosolutions.com\n\nWhy it matters: an expired domain can be re-registered by someone else, who then receives the company email and can host look-alike pages.\n\nUse a WHOIS or RDAP service (for example lookup.icann.org or rdap.org), or run whois yojosolutions.com in a terminal. This is read-only: never try to renew, transfer or change a domain.',
      ),
      {
        kind: 'answer',
        title: 'Submit the expiration date',
        format: 'date',
        answer: '2028-12-18',
        xp: 50,
        placeholder: 'YYYY-MM-DD',
      },
    ],
    hints: [
      'The expiry date is part of the domain registration record, which WHOIS and RDAP lookups show.',
      'Search for yojosolutions.com on lookup.icann.org or rdap.org.',
      'Read the field called Expiration (RDAP) or Registry Expiry Date (WHOIS) and enter it as YYYY-MM-DD.',
    ],
  },
  'WEB-01': {
    provider: 'mission-api',
    steps: [
      brief(
        'Briefing: fingerprint a website',
        'Identify the technologies that power your target website and report only what you observed.\n\n1. Start your lab. Your own target website opens at {LAB_URL}.\n2. Install the Wappalyzer browser extension and pin it. If it stays quiet, allow it on this site.\n3. With the target open, click the Wappalyzer icon and read the technologies it lists.\n4. Come back here and enter the technologies, separated by commas.\n\nAlternative: run curl -I {LAB_URL} and read the response headers, and view the page source.',
      ),
      {
        kind: 'lab_answer',
        title: 'Submit the technologies',
        format: 'set',
        answer: 'Apache, Express, Node.js',
        xp: 50,
        placeholder: 'e.g. Alpha, Bravo, Charlie',
      },
    ],
    hints: [
      'Wappalyzer groups what it finds by type. Look at Web servers, Web frameworks and Programming languages.',
      'Run curl -I against your lab URL and read the Server and X-Powered-By headers.',
      'There are three: one web server, one web framework and the language that framework runs on.',
    ],
  },
  'INFO-01': {
    provider: 'mission-api',
    steps: [
      brief(
        'Briefing: information in page source',
        'Websites sometimes expose information by accident in their own source code. Find the flag hidden in your target site.\n\n1. Start your lab. Your target website opens at {LAB_URL}.\n2. Explore it like any visitor.\n3. Open the page source: right-click and choose View Page Source, or press Ctrl+U (Cmd+Option+U on Mac).\n4. Read the HTML, including comments, for an internal reference in the flag format.\n5. Come back and submit the flag. Format: YOJO_information_disclose_<number>. Each student gets their own flag.',
      ),
      {
        kind: 'lab_answer',
        title: 'Submit the flag',
        format: 'session_flag',
        xp: 50,
        placeholder: 'YOJO_information_disclose_000000',
      },
    ],
    hints: [
      'Developers sometimes leave notes in HTML comments, which the browser does not display.',
      'Open View Page Source on the home page and search for <!-- .',
      'Search the source for YOJO_ : the flag sits inside an HTML comment on the home page.',
    ],
  },
  'SUB-01': {
    provider: 'mission-api',
    steps: [
      brief(
        'Briefing: subdomain enumeration',
        'Discover the subdomains of the assigned target and count the unique results. This is a controlled simulation: the lab helper answers from a fixed training dataset, not from live public sources.\n\nTarget domain: yojocorp.test\n\n1. Start your lab to open the target company website.\n2. In your own terminal fetch the helper: curl -fsS {LAB_URL}tools/subfinder.sh -o subfinder-lab.sh\n3. Run it: sh subfinder-lab.sh -d yojocorp.test -silent\n4. Count each subdomain once and submit the number.',
      ),
      {
        kind: 'lab_answer',
        title: 'Submit the number of unique subdomains',
        format: 'count',
        answer: '10',
        xp: 50,
        placeholder: 'e.g. 7',
      },
    ],
    hints: [
      'Fetch the helper script from your own lab first; it only answers for yojocorp.test.',
      'Pipe the helper output through sort -u to remove duplicates.',
      'Count the remaining lines with wc -l: sh subfinder-lab.sh -d yojocorp.test -silent | sort -u | wc -l',
    ],
  },
  'END-01': {
    provider: 'mission-api',
    steps: [
      brief(
        'Briefing: endpoint discovery',
        'Explore your training website with Katana and count the unique endpoints the crawler finds.\n\nTarget URL: {LAB_URL}\n\n1. Start your lab. Your training website gets its own address.\n2. In your own terminal run: katana -u {LAB_URL} -silent\n3. Count each unique URL once, including the homepage.\n4. Submit the number. Only crawl this lab URL.',
      ),
      {
        kind: 'lab_answer',
        title: 'Submit the number of unique endpoints',
        format: 'count',
        answer: '8',
        xp: 50,
        placeholder: 'e.g. 5',
      },
    ],
    hints: [
      'Katana prints one URL per line. The homepage counts as an endpoint too.',
      'Use -silent so Katana prints only URLs, nothing else.',
      'Count unique lines: katana -u <your lab URL> -silent | sort -u | wc -l',
    ],
  },
  'DIR-01': {
    provider: 'mission-api',
    steps: [
      brief(
        'Briefing: hidden directory discovery',
        'Find a web directory that is not linked anywhere and submit the flag inside it.\n\nTarget URL: {LAB_URL}\n\n1. Start your lab. The site looks ordinary and does not link the hidden directory.\n2. Download the wordlist from {LAB_URL}tools/wordlist.txt\n3. Run a directory enumeration tool against your lab URL, for example: gobuster dir -u {LAB_URL} -w wordlist.txt\n4. Open the path that returns 200 or 301 while the others return 404, read its flag and submit it. Format: YOJO_directory_bruteforcing_<number>.',
      ),
      {
        kind: 'lab_answer',
        title: 'Submit the flag',
        format: 'session_flag',
        xp: 50,
        placeholder: 'YOJO_directory_bruteforcing_000000',
      },
    ],
    hints: [
      'The wordlist is served by your own lab at /tools/wordlist.txt. Download it first.',
      'Most paths answer 404. Look for the one that returns 200 or a redirect.',
      'Once you find the directory, open flag.txt inside it.',
    ],
  },
  'IMG-01': {
    provider: 'mission-api',
    steps: [
      brief(
        'Briefing: image metadata',
        'Image files can carry hidden metadata such as a camera model, a location or a text comment. One product image in your shop hides a flag in its metadata.\n\nTarget URL: {LAB_URL}\n\n1. Start your lab. Your shop opens with several product images.\n2. Download the images, for example product-01.jpg to product-10.jpg from {LAB_URL}images/\n3. Inspect them with ExifTool: exiftool -Comment -ImageDescription *.jpg\n4. Submit the flag. Format: YOJO_image_metadata_<number>.',
      ),
      {
        kind: 'lab_answer',
        title: 'Submit the flag',
        format: 'session_flag',
        xp: 50,
        placeholder: 'YOJO_image_metadata_000000',
      },
    ],
    hints: [
      'The flag is not visible in any picture. It is stored in the files themselves.',
      'Download every product image, then run exiftool on all of them at once.',
      'Look at the Comment field: exiftool -Comment *.jpg',
    ],
  },
};
