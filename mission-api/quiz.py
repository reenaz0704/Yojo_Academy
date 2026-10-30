"""Mission 1 quiz. The answer key lives ONLY on the server; public_questions() strips it."""
INT01 = [
    {"q": "Which part of the CIA triad is broken when an unauthorized person reads a private document?",
     "options": ["Confidentiality", "Integrity", "Availability", "Authentication"], "answer": 0,
     "why": "Confidentiality means only authorized people can see information. Integrity is about accuracy and availability is about access when needed."},
    {"q": "An attacker secretly changes the amount in a bank transfer. Which principle is violated?",
     "options": ["Confidentiality", "Availability", "Integrity", "Non-repudiation"], "answer": 2,
     "why": "Integrity means data stays accurate and is not changed without authorization."},
    {"q": "A flood of fake traffic makes a company website unreachable for real customers. What is this attack?",
     "options": ["Phishing", "Denial-of-service", "SQL injection", "Ransomware"], "answer": 1,
     "why": "A denial-of-service attack targets availability by overwhelming a system so legitimate users cannot reach it."},
    {"q": "An email pretending to be your bank asks you to click a link and enter your password. What is this?",
     "options": ["Phishing", "Cross-site scripting", "A data breach", "An insider threat"], "answer": 0,
     "why": "Phishing tricks people with fake messages into giving up credentials or running something harmful. Awareness training and MFA help."},
    {"q": "Which weakness lets an attacker send malicious database commands through a web form field?",
     "options": ["Cross-site scripting", "SQL injection", "Weak Wi-Fi", "Social engineering"], "answer": 1,
     "why": "SQL injection happens when user input is mixed into database queries. Parameterized queries prevent it."},
    {"q": "Which security domain is mainly about policies, risk assessment and compliance?",
     "options": ["Offensive security", "Defensive security", "Governance, Risk and Compliance (GRC)", "Threat hunting"], "answer": 2,
     "why": "GRC covers policies, risk management, audits and compliance. Offensive security tests systems and defensive security monitors and responds."},
    {"q": "Which tool is mainly used to capture and analyze network traffic?",
     "options": ["Nessus", "Splunk", "Wireshark", "Burp Suite"], "answer": 2,
     "why": "Wireshark inspects network packets. Nessus scans for vulnerabilities, Splunk analyzes logs and Burp Suite tests web applications."},
    {"q": "Which role watches alerts and logs in a Security Operations Center and triages possible incidents?",
     "options": ["Penetration Tester", "GRC Analyst", "SOC Analyst", "Security Consultant"], "answer": 2,
     "why": "SOC Analysts monitor alerts and logs, triage them and escalate real incidents. Penetration Testers run authorized attacks to find weaknesses."},
]


REC01 = [
    {"q": "What is the main purpose of reconnaissance in an authorized security assessment?",
     "options": ["Understand the in-scope assets and their public attack surface", "Exploit every system found as fast as possible", "Erase evidence of the assessment", "Guess employee passwords"], "answer": 0,
     "why": "Reconnaissance gathers information so testers understand what is in scope and exposed. It is separate from exploiting weaknesses."},
    {"q": "Which of these is passive reconnaissance?",
     "options": ["Running a full port scan on a host", "Sending crafted requests to a login page", "Searching Certificate Transparency logs for a domain's public certificates", "Brute-forcing hidden directories"], "answer": 2,
     "why": "Certificate Transparency logs are public records, so searching them does not touch the target's systems."},
    {"q": "Which activity is active reconnaissance?",
     "options": ["Reading an archived page on the Wayback Machine", "Running Nmap against an authorized lab host", "Reading the company's public job postings", "Looking up domain registration data with RDAP"], "answer": 1,
     "why": "Active reconnaissance interacts directly with the target. Nmap sends packets to the host, so it needs authorization and a defined scope."},
    {"q": "What is the key difference between passive and active reconnaissance?",
     "options": ["Passive is always illegal and active is always legal", "Active reconnaissance never creates logs", "They are the same thing with different names", "Passive does not contact the target's systems directly; active does"], "answer": 3,
     "why": "The difference is whether the target's infrastructure is contacted. Whether either is acceptable still depends on source, method, permission and scope."},
    {"q": "Which tool is best for viewing the HTTP response headers of an authorized test web server?",
     "options": ["The Wayback Machine", "curl with the -I option", "A WHOIS lookup", "A search engine"], "answer": 1,
     "why": "curl -I requests only the headers so you can see the Server header and similar details. The others do not query the live server."},
    {"q": "During an authorized assessment you find a subdomain that is not listed in the scope document. What should you do?",
     "options": ["Scan it quickly since it belongs to the same company", "Test it only lightly", "Stop and confirm with the client whether it is in scope", "Publish it in your report as a vulnerability"], "answer": 2,
     "why": "Discovering a hostname does not authorize testing it. Only assets named in the written scope are allowed, so you stop and ask."},
]
QUIZZES = {"INT-01": INT01, "REC-01": REC01}
QUESTIONS = INT01  # kept for Mission 1 tests


def public_questions(mission="INT-01"):
    return [{"id": i, "q": x["q"], "options": x["options"]} for i, x in enumerate(QUIZZES[mission])]


def grade(answers, mission="INT-01"):
    """answers: list of ints (0-3), one per question. Returns (correct_count, per-question review)."""
    review, correct = [], 0
    for i, x in enumerate(QUIZZES[mission]):
        ok = answers[i] == x["answer"]
        correct += ok
        review.append({"id": i, "correct": ok, "your_answer": answers[i], "correct_answer": x["answer"], "why": x["why"]})
    return correct, review
