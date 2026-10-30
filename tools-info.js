/* Public page → "Hands-on with the tools security teams use": a short details card for each tool chip.
   Opens on hover, keyboard focus and tap (mobile); Escape or a tap elsewhere closes it.
   Each entry: [category, what it is, where it appears in Yojo training]. Kept high level on purpose. */
(function () {
  'use strict';
  var T = {
    'Wireshark': ['Network analysis', 'A widely used tool for viewing and understanding network traffic.', 'Defensive track: networking and SOC modules'],
    'Cisco Packet Tracer': ['Network simulation', 'Cisco’s simulator for building and testing virtual networks without real hardware.', 'Foundations: networking basics'],
    'GNS3': ['Network emulation', 'Runs virtual routers, firewalls and servers together as a lab network.', 'Foundations and Defensive: network labs'],
    'Nmap': ['Network discovery', 'A standard tool for taking inventory of hosts and services on a network you are authorised to assess.', 'Offensive track: reconnaissance modules'],
    'Metasploit': ['Penetration-testing framework', 'A framework security teams use in authorised tests to check whether known weaknesses are present.', 'Offensive track: controlled lab exercises'],
    'Burp Suite Pro': ['Web application testing', 'A proxy-based toolkit for reviewing how a web application handles requests.', 'Offensive track: web security modules'],
    'Gobuster': ['Web content discovery', 'Checks a web server you are authorised to test for unlinked paths and resources.', 'Offensive track: web reconnaissance'],
    'ffuf': ['Web content discovery', 'A fast tool for testing how a web application responds to many inputs during an authorised assessment.', 'Offensive track: web reconnaissance'],
    'Nessus': ['Vulnerability scanning', 'A commercial scanner that reports missing patches and misconfigurations.', 'Defensive and GRC: vulnerability management'],
    'OpenVAS': ['Vulnerability scanning', 'An open-source scanner (Greenbone) for finding known vulnerabilities.', 'Defensive and GRC: vulnerability management'],
    'Hashcat': ['Password auditing', 'Used by security teams to test whether stored password hashes would withstand guessing.', 'Offensive track: password security module'],
    'John the Ripper': ['Password auditing', 'A long-standing open-source tool for checking password strength.', 'Offensive track: password security module'],
    'BloodHound': ['Active Directory analysis', 'Maps relationships in Active Directory so defenders can see risky permission paths.', 'Offensive and Defensive: Active Directory modules'],
    'Impacket': ['Windows protocol library', 'A Python library for working with Windows network protocols, used in authorised assessments.', 'Offensive track: Active Directory modules'],
    'CrackMapExec': ['Windows network assessment', 'Helps assess the security of Windows networks during authorised tests.', 'Offensive track: Active Directory modules'],
    'Chisel': ['Network tunnelling', 'Creates tunnels between hosts; covered so learners understand how traffic can move inside a network.', 'Offensive track: lab exercises'],
    'LinPEAS': ['Linux configuration review', 'A script that lists Linux misconfigurations worth reviewing.', 'Offensive track: Linux security module'],
    'WinPEAS': ['Windows configuration review', 'A script that lists Windows misconfigurations worth reviewing.', 'Offensive track: Windows security module'],
    'MobSF': ['Mobile app security', 'Mobile Security Framework analyses Android and iOS apps for security issues.', 'Offensive track: mobile security module'],
    'Splunk': ['SIEM', 'A platform for collecting and searching logs; widely used in security operations centres.', 'Defensive track: SOC and log analysis'],
    'Wazuh': ['Open-source SIEM / XDR', 'Collects security events from endpoints and raises alerts.', 'Defensive track: SOC and detection'],
    'Security Onion': ['Security monitoring platform', 'A free Linux distribution bundling tools for network monitoring and threat hunting.', 'Defensive track: network monitoring'],
    'Zeek': ['Network monitoring', 'Turns network traffic into detailed logs for investigation.', 'Defensive track: network monitoring'],
    'Suricata': ['Intrusion detection', 'An open-source engine that inspects traffic against detection rules.', 'Defensive track: detection engineering'],
    'MISP': ['Threat intelligence sharing', 'A platform for storing and sharing indicators of compromise.', 'Defensive track: threat intelligence'],
    'Sigma': ['Detection rules', 'A common format for writing log detection rules that work across SIEMs.', 'Defensive track: detection engineering'],
    'Autopsy': ['Digital forensics', 'A graphical tool for examining disk images during an investigation.', 'Defensive track: digital forensics'],
    'Volatility': ['Memory forensics', 'Analyses memory captures to understand what was running on a machine.', 'Defensive track: digital forensics and incident response'],
    'AWS GuardDuty': ['Cloud threat detection', 'Amazon’s managed service that flags suspicious activity in AWS accounts.', 'Defensive track: cloud security'],
    'Azure Sentinel': ['Cloud SIEM', 'Microsoft’s cloud SIEM, now named Microsoft Sentinel.', 'Defensive track: cloud SOC'],
    'Atomic Red Team': ['Detection testing', 'A library of small, safe tests mapped to MITRE ATT&CK to check that detections work.', 'Defensive track: detection validation'],
    'TryHackMe': ['Training platform', 'An online platform with guided security rooms.', 'Extra practice alongside the course'],
    'Hack The Box': ['Training platform', 'An online platform with practice machines and challenges.', 'Extra practice alongside the course'],
    'CyberDefenders': ['Blue-team training platform', 'Online defensive challenges based on real investigation scenarios.', 'Extra practice for the Defensive track'],
  };

  // Tracks for the filter chips (owner, 30 Oct): O = Offensive, D = Defensive, G = GRC. A tool can be in more than one.
  var TRACK = {
    'Wireshark': 'D', 'Cisco Packet Tracer': 'D', 'GNS3': 'D', 'Nmap': 'O', 'Metasploit': 'O', 'Burp Suite Pro': 'O', 'Gobuster': 'O', 'ffuf': 'O',
    'Nessus': 'DG', 'OpenVAS': 'DG', 'Hashcat': 'O', 'John the Ripper': 'O', 'BloodHound': 'OD', 'Impacket': 'O', 'CrackMapExec': 'O', 'Chisel': 'O',
    'LinPEAS': 'O', 'WinPEAS': 'O', 'MobSF': 'O', 'Splunk': 'D', 'Wazuh': 'DG', 'Security Onion': 'D', 'Zeek': 'D', 'Suricata': 'D', 'MISP': 'D', 'Sigma': 'D',
    'Autopsy': 'D', 'Volatility': 'D', 'AWS GuardDuty': 'D', 'Azure Sentinel': 'D', 'Atomic Red Team': 'D', 'TryHackMe': 'OD', 'Hack The Box': 'O', 'CyberDefenders': 'D'
  };
  var box = document.querySelector('.tp-tools');
  if (!box) return;
  (function filters() {
    var chips = [['', 'All'], ['O', 'Offensive'], ['D', 'Defensive'], ['G', 'GRC']];
    var tools = [].slice.call(box.querySelectorAll('span')).filter(function (el) { return TRACK[el.textContent.trim()]; });
    var bar = document.createElement('div');
    bar.className = 'tp-filter'; bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', 'Filter tools by track');
    bar.innerHTML = chips.map(function (c, i) {
      var n = c[0] ? tools.filter(function (el) { return TRACK[el.textContent.trim()].indexOf(c[0]) >= 0; }).length : tools.length;
      return '<button type="button" role="tab" data-tr="' + c[0] + '" aria-selected="' + (i === 0) + '">' + c[1] + ' <small>' + n + '</small></button>';
    }).join('');
    box.parentNode.insertBefore(bar, box);
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      [].forEach.call(bar.children, function (x) { x.setAttribute('aria-selected', String(x === b)); });
      var t = b.dataset.tr;
      tools.forEach(function (el) { el.hidden = !!t && TRACK[el.textContent.trim()].indexOf(t) < 0; });
    });
  })();
  var css = document.createElement('style');
  css.textContent = '.tp-tools span{cursor:help;transition:border-color .15s,transform .15s}.tp-tools span:hover,.tp-tools span:focus-visible,.tp-tools span[aria-expanded="true"]{border-color:var(--green);transform:translateY(-1px);outline:none}' +
    '.tp-tip{position:absolute;z-index:60;max-width:300px;padding:.8rem .9rem;border-radius:12px;background:var(--surface);border:1px solid var(--green);box-shadow:0 12px 30px rgba(0,0,0,.45);font-size:.86rem;line-height:1.45;color:var(--text)}' +
    '.tp-tip b{display:block;font:700 .95rem var(--f-display,inherit)}.tp-tip .cat{font:600 .7rem var(--f-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--green)}.tp-tip p{margin:.35rem 0 0}.tp-tip .where{color:var(--muted)}';
  css.textContent += '.tp-filter{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;margin:0 0 1rem}.tp-filter button{font:600 .85rem var(--f-mono,inherit);padding:.45rem .95rem;border-radius:999px;border:1px solid var(--border,#2a3346);background:transparent;color:var(--text,#e6edf3);cursor:pointer}' +
    '.tp-filter button small{opacity:.6;margin-left:.2rem}.tp-filter button[aria-selected="true"]{border-color:var(--green,#39d98a);color:var(--green,#39d98a);box-shadow:0 0 0 1px var(--green,#39d98a) inset}.tp-tools span[hidden]{display:none!important}';
  document.head.appendChild(css);
  var tip = document.createElement('div');
  tip.className = 'tp-tip'; tip.id = 'tpTip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  document.body.appendChild(tip);
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var open = null;

  function show(el) {
    var name = el.textContent.trim(), d = T[name];
    if (!d) return;
    if (open && open !== el) open.setAttribute('aria-expanded', 'false');
    tip.innerHTML = '<span class="cat">' + esc(d[0]) + '</span><b>' + esc(name) + '</b><p>' + esc(d[1]) + '</p><p class="where">In Yojo training: ' + esc(d[2]) + '</p>';
    tip.hidden = false;
    var r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    var left = Math.min(Math.max(8, r.left + window.scrollX + r.width / 2 - w / 2), window.scrollX + document.documentElement.clientWidth - w - 8);
    var top = r.top + window.scrollY - h - 10;
    if (top < window.scrollY + 8) top = r.bottom + window.scrollY + 10; // no room above: show below
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
    el.setAttribute('aria-expanded', 'true'); open = el;
  }
  function hide() { tip.hidden = true; if (open) open.setAttribute('aria-expanded', 'false'); open = null; }

  [].forEach.call(box.querySelectorAll('span'), function (el) {
    if (!T[el.textContent.trim()]) return;
    el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-describedby', 'tpTip'); el.setAttribute('aria-expanded', 'false');
    el.addEventListener('mouseenter', function () { show(el); });
    el.addEventListener('mouseleave', hide);
    el.addEventListener('focus', function () { show(el); });
    el.addEventListener('blur', hide);
    el.addEventListener('click', function (e) { e.stopPropagation(); open === el ? hide() : show(el); });
  });
  document.addEventListener('click', function (e) { if (open && !tip.contains(e.target)) hide(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', function () { if (open) show(open); }, { passive: true });
})();
