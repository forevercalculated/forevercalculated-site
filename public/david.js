/* David - Forever Careers AI assistant widget */
(function () {
  if (window.__fcDavid) return; window.__fcDavid = 1;
  if (/^\/(admin|stats)(\/|$)/.test(location.pathname)) return;

  var SKEY = "fcDavidChat", HKEY = "fcDavidHintSeen";
  var CHIPS = ["How does the free trial work?", "How do I cancel?", "What do I get for £50 a month?", "Which countries do you cover?"];
  var GREETING = "Hi, I'm David, Forever Careers' AI assistant. I can help with the free trial, pricing, CVs and job alerts. What would you like to know?";

  function avatar(p, bubble) {
    var face = '<path d="M88 148 L112 148 L114 176 L86 176Z" fill="#7A4A2E"/><path d="M88 150 Q100 164 112 150 L112 162 Q100 170 88 162Z" fill="#5E3721"/><ellipse cx="71" cy="114" rx="5.5" ry="10" fill="#7A4A2E"/><ellipse cx="129" cy="114" rx="5.5" ry="10" fill="#7A4A2E"/><path d="M72 102 Q72 70 100 68 Q128 70 128 102 L127 122 Q124 146 108 157 Q100 161 92 157 Q76 146 73 122Z" fill="#8D5A3B"/><path d="M121 104 Q127 128 114 150 Q108 156 104 158 Q120 140 120 104Z" fill="#744629"/><path d="M80 124 Q84 132 90 134 Q82 134 78 128Z" fill="#9E6A48"/><path d="M70 104 Q64 64 100 58 Q136 62 130 104 Q129 88 124 82 Q112 74 100 75 Q84 75 76 84 Q71 92 70 104Z" fill="#1A1512"/><path d="M76 84 Q88 72 100 74 Q116 73 124 82 Q112 78 100 79 Q86 79 76 84Z" fill="#2A221C"/><path d="M82 100 Q89 96 96 99" stroke="#1A1512" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M104 99 Q111 96 118 100" stroke="#1A1512" stroke-width="3.2" fill="none" stroke-linecap="round"/><ellipse cx="89" cy="111" rx="6.2" ry="3.8" fill="#F1E9E1"/><ellipse cx="111" cy="111" rx="6.2" ry="3.8" fill="#F1E9E1"/><circle cx="89.5" cy="111" r="3.1" fill="#3B2415"/><circle cx="110.5" cy="111" r="3.1" fill="#3B2415"/><circle cx="89.5" cy="111" r="1.4" fill="#0B0806"/><circle cx="110.5" cy="111" r="1.4" fill="#0B0806"/><circle cx="90.5" cy="110" r=".9" fill="#FFF"/><circle cx="111.5" cy="110" r=".9" fill="#FFF"/><path d="M82.5 110 Q89 105.5 95.5 110" stroke="#2A1A10" stroke-width="1.6" fill="none"/><path d="M104.5 110 Q111 105.5 117.5 110" stroke="#2A1A10" stroke-width="1.6" fill="none"/><path d="M100 114 L101 126 Q104 129 106 127 L104 118Z" fill="#744629"/><path d="M94 128 Q97 131 100 130 Q103 131 106 128" stroke="#5E3721" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M90 139 Q95 136 100 137.5 Q105 136 110 139 Q100 141 90 139Z" fill="#5A2E20"/><path d="M90 139 Q100 150 110 139 Q100 143 90 139Z" fill="#7C4230"/><path d="M92.5 140 Q100 145 107.5 140 Q100 142.5 92.5 140Z" fill="#F4EEE8"/>';
    var body = '<path d="M30 240 Q34 184 86 172 L100 182 L114 172 Q166 184 170 240Z" fill="#1E2A44"/><path d="M86 172 L100 196 L114 172 L108 170 L100 184 L92 170Z" fill="#F4F6F8"/><path d="M92 170 L100 184 L88 190 L84 174Z" fill="#E4E8EC"/><path d="M108 170 L100 184 L112 190 L116 174Z" fill="#E4E8EC"/>';
    var glasses = '<rect x="79" y="104" width="19" height="14" rx="5" fill="none" stroke="#1A1512" stroke-width="2.4"/><rect x="102" y="104" width="19" height="14" rx="5" fill="none" stroke="#1A1512" stroke-width="2.4"/><path d="M98 109 Q100 107 102 109" stroke="#1A1512" stroke-width="2.2" fill="none"/><path d="M79 108 L73 106" stroke="#1A1512" stroke-width="2.2"/><path d="M121 108 L127 106" stroke="#1A1512" stroke-width="2.2"/>';
    var bub = bubble ? '<g transform="translate(128,6)"><rect width="56" height="30" rx="15" fill="#F2F4F3"/><path d="M12 28 L6 40 L24 29Z" fill="#F2F4F3"/><circle class="d d1" cx="16" cy="15" r="3.8" fill="#16A672"/><circle class="d d2" cx="28" cy="15" r="3.8" fill="#16A672"/><circle class="d d3" cx="40" cy="15" r="3.8" fill="#16A672"/></g>' : "";
    var vb = bubble ? "8 2 190 222" : "12 47 176 176";
    return '<svg viewBox="' + vb + '" aria-hidden="true" focusable="false"><defs><clipPath id="' + p + 'c"><circle cx="100" cy="135" r="88"/></clipPath></defs><circle cx="100" cy="135" r="88" fill="#16A672"/><g clip-path="url(#' + p + 'c)">' + body + face + '</g>' + glasses + bub + '</svg>';
  }

  var css = ':host{all:initial}*{box-sizing:border-box;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
    '@keyframes blink{0%,80%,100%{opacity:.35}40%{opacity:1}}.d1{animation:blink 1.4s infinite}.d2{animation:blink 1.4s .2s infinite}.d3{animation:blink 1.4s .4s infinite}' +
    '.launch{position:fixed;right:22px;bottom:calc(22px + env(safe-area-inset-bottom,0px));z-index:2147483000;display:flex;align-items:center;gap:10px}' +
    '@media (max-width:1299px){.launch{right:14px;bottom:calc(108px + env(safe-area-inset-bottom,0px))}}' +
    '.fab{width:76px;height:88px;border:0;background:none;padding:0;cursor:pointer;transition:transform .2s}.fab:hover{transform:translateY(-3px)}.fab svg{width:100%;height:100%;filter:drop-shadow(0 6px 14px rgba(0,0,0,.45))}' +
    '.fab:focus-visible,.x:focus-visible,.send:focus-visible,.chip:focus-visible,.link:focus-visible,.btn:focus-visible{outline:2px solid #22E58A;outline-offset:2px;border-radius:12px}' +
    '.hint{background:#141917;color:#F2F4F3;border:1px solid rgba(34,229,138,.35);border-radius:999px;padding:8px 14px;font-size:13px;cursor:pointer;white-space:nowrap}' +
    '.panel{position:fixed;right:22px;bottom:calc(22px + env(safe-area-inset-bottom,0px));z-index:2147483001;width:380px;max-width:calc(100vw - 24px);height:600px;max-height:calc(100vh - 44px);background:#0A0D0C;color:#F2F4F3;border:1px solid rgba(242,244,243,.12);border-radius:18px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,.55)}' +
    '.panel.open{display:flex}@media (max-width:560px){.panel{inset:0;width:100%;max-width:none;height:100%;max-height:none;border-radius:0;border:0;padding-top:env(safe-area-inset-top,0px)}}' +
    '.hd{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#141917;border-bottom:1px solid rgba(242,244,243,.09)}.hd .av{width:40px;height:40px;flex:none}.hd .av svg{width:100%;height:100%}' +
    '.hd .t{flex:1;min-width:0}.hd .n{font-size:15px;font-weight:600;margin:0}.hd .s{font-size:11.5px;color:#22E58A;margin:2px 0 0}' +
    '.x{background:none;border:0;color:#8B948F;font-size:22px;line-height:1;cursor:pointer;padding:6px 8px}.x:hover{color:#F2F4F3}' +
    '.body{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:9px;font-size:14px;line-height:1.5}' +
    '.m{max-width:86%;padding:9px 12px;white-space:pre-wrap;word-wrap:break-word}.m.a{background:#141917;border-radius:14px 14px 14px 4px;align-self:flex-start}.m.u{background:#16A672;color:#06120D;border-radius:14px 14px 4px 14px;align-self:flex-end}' +
    '.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{background:none;border:1px solid rgba(95,201,191,.45);color:#5FC9BF;border-radius:999px;padding:6px 11px;font-size:12.5px;cursor:pointer}.chip:hover{background:rgba(95,201,191,.12)}' +
    '.typing{display:flex;gap:4px;padding:12px}.typing i{width:7px;height:7px;border-radius:50%;background:#8B948F;display:block}' +
    '.ft{border-top:1px solid rgba(242,244,243,.09);padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px))}.row{display:flex;gap:8px;align-items:flex-end}' +
    'textarea,input{width:100%;background:#141917;color:#F2F4F3;border:1px solid rgba(242,244,243,.12);border-radius:12px;padding:10px 12px;font-size:16px;resize:none;outline:none}textarea:focus,input:focus{border-color:#16A672}textarea{max-height:110px}' +
    '.send{flex:none;width:40px;height:40px;border-radius:50%;border:0;background:#16A672;color:#06120D;font-size:18px;font-weight:700;cursor:pointer}.send:disabled{opacity:.5;cursor:default}' +
    '.link{display:block;margin:8px auto 0;background:none;border:0;color:#5FC9BF;font-size:12.5px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}' +
    '.note{font-size:11px;color:#8B948F;text-align:center;margin:6px 0 0}' +
    '.form{display:none;flex-direction:column;gap:10px;padding:16px;overflow-y:auto;flex:1}.form.on{display:flex}.form h3{margin:0;font-size:16px}.form p{margin:0;color:#8B948F;font-size:13px}' +
    '.btn{background:#16A672;color:#06120D;border:0;border-radius:999px;padding:11px;font-weight:600;font-size:14px;cursor:pointer}.btn:disabled{opacity:.6}.err{color:#FF8A8A;font-size:12.5px;min-height:16px}.hp{position:absolute;left:-9999px}';

  var host = document.createElement("div"); host.id = "fc-david";
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML = '<style>' + css + '</style>' +
    '<div class="launch"><div class="hint" id="hint" hidden>Ask David</div><button class="fab" id="fab" aria-label="Chat with David, our AI assistant">' + avatar("l", true) + '</button></div>' +
    '<section class="panel" id="panel" role="dialog" aria-label="Chat with David">' +
      '<div class="hd"><div class="av">' + avatar("h", false) + '</div><div class="t"><p class="n">David</p><p class="s">AI assistant · replies instantly</p></div><button class="x" id="close" aria-label="Close chat">×</button></div>' +
      '<div class="body" id="body" aria-live="polite"></div>' +
      '<div class="ft" id="ft"><div class="row"><textarea id="in" rows="1" maxlength="800" placeholder="Type your question" aria-label="Your message"></textarea><button class="send" id="send" aria-label="Send">↑</button></div>' +
        '<button class="link" id="human">Talk to a person</button><p class="note">David is an AI and can make mistakes.</p></div>' +
      '<form class="form" id="form" novalidate><h3>Talk to a person</h3><p>Leave your details and the Forever Careers team will reply by email within 24 hours. Your chat with David is included so you don\'t need to repeat yourself.</p>' +
        '<input id="fn" autocomplete="name" placeholder="Your name" aria-label="Your name" maxlength="100">' +
        '<input id="fe" type="email" autocomplete="email" placeholder="name@email.com" aria-label="Your email" maxlength="200">' +
        '<textarea id="fq" rows="4" placeholder="Your question" aria-label="Your question" maxlength="2000"></textarea>' +
        '<input class="hp" id="fw" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<div class="err" id="ferr"></div><button class="btn" id="fsend" type="submit">Send message</button><button class="link" id="back" type="button">Back to chat</button></form>' +
    '</section>';
  (document.body || document.documentElement).appendChild(host);

  var g = function (id) { return root.getElementById(id); };
  var panel = g("panel"), body = g("body"), inp = g("in"), send = g("send"), ft = g("ft"), form = g("form");
  var msgs = [];
  try { msgs = JSON.parse(sessionStorage.getItem(SKEY) || "[]"); } catch (e) {}
  var busy = false;
  function save() { try { sessionStorage.setItem(SKEY, JSON.stringify(msgs.slice(-30))); } catch (e) {} }

  function bubble(role, text) { var d = document.createElement("div"); d.className = "m " + (role === "user" ? "u" : "a"); d.textContent = text; body.appendChild(d); body.scrollTop = body.scrollHeight; return d; }
  function render() {
    body.innerHTML = ""; bubble("assistant", GREETING);
    if (!msgs.length) { var c = document.createElement("div"); c.className = "chips"; CHIPS.forEach(function (q) { var b = document.createElement("button"); b.className = "chip"; b.textContent = q; b.onclick = function () { ask(q); }; c.appendChild(b); }); body.appendChild(c); }
    msgs.forEach(function (m) { bubble(m.role, m.content); });
  }
  function typing(on) { var t = root.getElementById("typing"); if (on && !t) { t = document.createElement("div"); t.id = "typing"; t.className = "m a typing"; t.innerHTML = '<i class="d1"></i><i class="d2"></i><i class="d3"></i>'; body.appendChild(t); body.scrollTop = body.scrollHeight; } if (!on && t) t.remove(); }

  function ask(text) {
    text = String(text || "").trim(); if (!text || busy) return;
    var chips = body.querySelector(".chips"); if (chips) chips.remove();
    msgs.push({ role: "user", content: text }); bubble("user", text); save();
    inp.value = ""; grow(); busy = true; send.disabled = true; typing(true);
    fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: msgs }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { return d.reply || d.error || "Sorry, something went wrong."; })
      .catch(function () { return "Sorry, I couldn't connect. Check your internet or tap \"Talk to a person\"."; })
      .then(function (reply) { typing(false); msgs.push({ role: "assistant", content: reply }); bubble("assistant", reply); save(); busy = false; send.disabled = false; });
  }
  function grow() { inp.style.height = "auto"; inp.style.height = Math.min(inp.scrollHeight, 110) + "px"; }

  function open() { panel.classList.add("open"); g("hint").hidden = true; try { localStorage.setItem(HKEY, "1"); } catch (e) {} if (!body.childNodes.length) render(); setTimeout(function () { if (window.innerWidth > 560) inp.focus(); }, 50); }
  function close() { panel.classList.remove("open"); g("fab").focus(); }
  function showForm(on) { form.classList.toggle("on", on); body.style.display = on ? "none" : ""; ft.style.display = on ? "none" : ""; if (on) { var last = ""; for (var i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "user") { last = msgs[i].content; break; } if (!g("fq").value) g("fq").value = last; g("fn").focus(); } }

  g("fab").onclick = function () { panel.classList.contains("open") ? close() : open(); };
  g("hint").onclick = open; g("close").onclick = close;
  send.onclick = function () { ask(inp.value); };
  inp.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(inp.value); } });
  inp.addEventListener("input", grow);
  panel.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  g("human").onclick = function () { showForm(true); };
  g("back").onclick = function () { showForm(false); };
  form.addEventListener("input", function () { g("ferr").textContent = ""; });
  form.onsubmit = function (e) {
    e.preventDefault();
    var n = g("fn").value.trim(), em = g("fe").value.trim(), q = g("fq").value.trim(), err = g("ferr");
    if (!n) { err.textContent = "Add your name."; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { err.textContent = "Add a valid email so we can reply."; return; }
    if (!q) { err.textContent = "Add your question."; return; }
    var b = g("fsend"); b.disabled = true; b.textContent = "Sending…";
    fetch("/api/chat-handoff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: n, email: em, question: q, website: g("fw").value, page: location.href, transcript: msgs }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        b.disabled = false; b.textContent = "Send message";
        if (!x.ok) { err.textContent = (x.d && x.d.error) || "That didn't send. Try again."; return; }
        g("fq").value = ""; showForm(false);
        var t = "Thanks " + n.split(" ")[0] + ", your message is with the team. They'll reply to " + em + " within 24 hours.";
        msgs.push({ role: "assistant", content: t }); bubble("assistant", t); save();
      })
      .catch(function () { b.disabled = false; b.textContent = "Send message"; err.textContent = "That didn't send. Check your connection and try again."; });
  };

  try { if (!localStorage.getItem(HKEY)) { setTimeout(function () { if (!panel.classList.contains("open")) g("hint").hidden = false; }, 2500); setTimeout(function () { g("hint").hidden = true; try { localStorage.setItem(HKEY, "1"); } catch (e) {} }, 14000); } } catch (e) {}

  var st = document.createElement("style");
  st.textContent = "@media (max-width:1299px){#urgentTimer{bottom:calc(206px + env(safe-area-inset-bottom,0px)) !important}}";
  document.head.appendChild(st);
})();
