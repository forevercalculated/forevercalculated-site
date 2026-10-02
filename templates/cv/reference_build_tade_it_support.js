// Forever Careers CV layout "Mono" (black and white), based on Kenneth's AI and Customer Success CV (approved 2 Oct 2026).
// HOW TO USE: copy this file, replace EVERYTHING inside DATA (bottom of file) with the client's own facts, keep all styling code,
// then run: node <file>.js Firstname_Surname_<Role>_CV   (writes the .docx), and convert with soffice to PDF.
// The example DATA below is Tade's: none of it may appear in anyone else's CV.
const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, ExternalHyperlink, AlignmentType, BorderStyle, LevelFormat,
        Table, TableRow, TableCell, WidthType, TabStopType, VerticalAlign } = require('docx');
const BLACK = "000000", FONT = "Calibri";
const PAGE_W = 11906, MX = 1080, W = PAGE_W - 2 * MX;           // A4, 0.75 inch side margins
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noB = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const r = (t, o = {}) => new TextRun({ text: t, font: FONT, size: o.size || 19, bold: o.bold, italics: o.italics, color: BLACK, characterSpacing: o.cs });
const p = (children, o = {}) => new Paragraph({ spacing: { before: o.before || 0, after: o.after == null ? 40 : o.after, line: o.line || 264 }, alignment: o.align, tabStops: o.tabs, numbering: o.num, children });
const heading = (t) => p([r(t.toUpperCase(), { bold: true, size: 22 })], { before: 200, after: 90 });
const bullet = (children, after = 50) => new Paragraph({ numbering: { reference: "sq", level: 0 }, spacing: { after, line: 252 }, children: Array.isArray(children) ? children : [r(children)] });
const cell = (w, children, o = {}) => new TableCell({ width: { size: w, type: WidthType.DXA }, borders: o.borders || noB, verticalAlign: o.va,
  margins: { top: 0, bottom: 0, left: o.ml == null ? 0 : o.ml, right: o.mr == null ? 80 : o.mr }, children: children.length ? children : [p([r("")], { after: 0 })] });
const table = (widths, rows) => new Table({ width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths, borders: { ...noB, insideHorizontal: NONE, insideVertical: NONE }, rows });
// two column bullets, filled left, right, left, right (as in the approved layout)
const twoCol = (items, w, mkBullet = (t) => bullet(t)) => {
  const L = [], R = []; items.forEach((t, i) => (i % 2 ? R : L).push(mkBullet(t)));
  return table([w / 2, w / 2], [new TableRow({ children: [cell(w / 2, L, { mr: 200 }), cell(w / 2, R, { mr: 0 })] })]);
};
// Experience block: a vertical line on the left with a square marker for each role
const MARK = 300, IN = W - MARK;
const lineB = { ...noB, right: { style: BorderStyle.SINGLE, size: 6, color: BLACK } };
const roleRows = (x) => [
  new TableRow({ children: [
    cell(MARK, [p([r("■", { size: 16 })], { after: 0, align: AlignmentType.RIGHT })], { borders: lineB, mr: 0 }),
    cell(IN, [
      p([r(x.title.toUpperCase(), { bold: true, size: 20 }), r("  " + (x.org || ""), { size: 18 })], { after: 0 }),
      p([r(x.place || "", { size: 18 }), r("\t" + (x.dates || ""), { italics: true, size: 18 })], { after: 90, tabs: [{ type: TabStopType.RIGHT, position: IN - 160 }] }),
    ], { ml: 160 }) ] }),
  new TableRow({ children: [cell(MARK, [], { borders: lineB, mr: 0 }), cell(IN, [twoCol(x.bullets, IN - 160), p([r("")], { after: 60 })], { ml: 160 })] }),
];
const eduBlock = (x) => [
  table([MARK, IN], [new TableRow({ children: [
    cell(MARK, [p([r("■", { size: 16 })], { after: 0, align: AlignmentType.RIGHT })], { mr: 0 }),
    cell(IN, [p([r(x.title.toUpperCase(), { bold: true, size: 20 })], { after: 0 }),
              p([r(x.org || "", { size: 18 }), r(x.dates ? "\t" + x.dates : "", { italics: true, size: 18 })], { after: 70, tabs: [{ type: TabStopType.RIGHT, position: IN - 160 }] }),
              ...(x.bullets || []).map((b) => new Paragraph({ numbering: { reference: "sq", level: 1 }, spacing: { after: 40 }, children: [r(b, { bold: !!x.boldBullets, size: 18 })] }))], { ml: 160 }) ] })]),
  p([r("")], { after: 40 }),
];
module.exports = function build(d, out) {
  const contact = [];
  d.contact.forEach((c, i) => {
    if (i) contact.push(r("   •   ", { size: 18 }));
    if (/^https?:/.test(c)) contact.push(new ExternalHyperlink({ link: c, children: [new TextRun({ text: c, font: FONT, size: 18, color: BLACK, underline: {} })] }));
    else contact.push(r(c, { size: 18 }));
  });
  const kids = [
    p([r(d.name.toUpperCase(), { bold: true, size: 44 })], { after: 0, line: 240 }),
    new Paragraph({ spacing: { after: 110 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLACK, space: 6 } }, children: [r(d.title.toUpperCase(), { bold: true, size: 24 })] }),
    p(contact, { after: 60 }),
  ];
  for (const s of d.sections) {
    kids.push(heading(s.heading));
    if (s.type === "text") kids.push(p([r(s.text)], { after: 40, line: 276 }));
    if (s.type === "columns") kids.push(twoCol(s.items, W));
    if (s.type === "roles") kids.push(table([MARK, IN], s.items.flatMap(roleRows)));
    if (s.type === "education") s.items.forEach((x) => kids.push(...eduBlock(x)));
    if (s.type === "projects") s.items.forEach((x) => { kids.push(bullet([r(x.name, { bold: true, underline: {} })], 20)); if (x.tools) kids.push(bullet([r("TOOLS: ", { bold: true }), r(x.tools, { italics: true })], 20)); kids.push(bullet(x.text, 60)); });
    if (s.type === "languages") s.items.forEach((x) => { kids.push(bullet([r(x.name, { bold: true })], 0)); kids.push(new Paragraph({ indent: { left: 420 }, spacing: { after: 60 }, children: [r(x.level, { size: 18 })] })); });
    if (s.type === "lines") s.items.forEach((t) => kids.push(p([r(t)], { after: 30 })));
  }
  const doc = new Document({ creator: "Forever Careers", title: d.name + " CV",
    styles: { default: { document: { run: { font: FONT, size: 19, color: BLACK } } } },
    numbering: { config: [{ reference: "sq", levels: [
      { level: 0, format: LevelFormat.BULLET, text: "▪", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 240 } }, run: { color: BLACK } } },
      { level: 1, format: LevelFormat.BULLET, text: "▪", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 240 } }, run: { color: BLACK } } } ] }] },
    sections: [{ properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: 720, bottom: 720, left: MX, right: MX } } }, children: kids }] });
  return Packer.toBuffer(doc).then((b) => { fs.writeFileSync(out + ".docx", b); console.log("wrote " + out + ".docx"); });
};

// ===================== DATA (replace all of this for each client) =====================
const DATA = {
 name: "Tade Olanrewaju",
 title: "Entry Level IT Support and Service Desk | Part Time",
 contact: ["07477 030678", "tadeolanrewaju@gmail.com", "London"],
 sections: [
  { heading: "Professional Summary", type: "text", text: "Computer Science undergraduate at Canterbury Christ Church University (expected graduation 2028), with first class results in Mathematics for Computer Science and Computational Thinking. My technical knowledge is developing through my degree rather than professional IT employment, and I bring over three years of customer facing experience as a receptionist, managing bookings, enquiries and client records. I am looking for part time, flexible or zero hours entry level IT support, helpdesk or service desk work, or a student placement, that I can balance with my studies." },
  { heading: "Skills", type: "columns", items: ["Computational thinking and problem solving", "Customer support by phone and in person", "Mathematical and logical reasoning", "Booking systems and accurate record keeping", "Breaking problems down step by step", "Handheld scanners and stock tracking systems", "Research and critical evaluation", "Clear, patient communication"] },
  { heading: "Experience", type: "roles", items: [
   { title: "Crew Member", org: "Olympus Crew", place: "London", dates: "May 2024 - Present", bullets: [
     "Set up and break down event equipment, following detailed instructions accurately under time pressure.",
     "Adapt quickly to different venues, event requirements and equipment types.",
     "Communicate clearly with team leads to flag issues or delays so tasks finish on schedule."] },
   { title: "Online Assistant", org: "Sainsbury's", place: "Charlton Riverside, London", dates: "October 2022 - January 2023", bullets: [
     "Used handheld devices to log order status and update stock information in real time.",
     "Cross checked items against system records so every order was accurate before dispatch."] },
   { title: "Receptionist", org: "Standard Studio", place: "Blackheath, London", dates: "August 2019 - October 2022", bullets: [
     "First point of contact for clients in person and by phone, answering enquiries about availability, pricing and services.",
     "Managed the booking system, coordinating schedules to avoid overlaps.",
     "Processed customer payments and kept accurate records of appointments and client details."] } ] },
  { heading: "Education", type: "education", items: [
   { title: "BSc (Hons) Computer Science with Foundation Year", org: "Canterbury Christ Church University", dates: "Expected 2028", bullets: ["First class results in Mathematics for Computer Science and Computational Thinking"], boldBullets: true } ] }
 ]
};
module.exports(DATA, process.argv[2] || "CV");
