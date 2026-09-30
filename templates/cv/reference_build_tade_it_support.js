const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle, LevelFormat, Table, TableRow, TableCell, WidthType, TabStopType } = require('docx');
const ACC = "1F5E7A", INK = "1B2530", MUTED = "5B6773", FONT = "Calibri";
const W = 11906 - 2 * 850; // A4 width minus margins (DXA)
const r = (t, o = {}) => new TextRun({ text: t, font: FONT, size: o.size || 19, bold: o.bold, italics: o.italics, color: o.color || INK });
const heading = (t) => new Paragraph({ spacing: { before: 150, after: 60 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACC, space: 2 } },
  children: [new TextRun({ text: t.toUpperCase(), font: FONT, size: 21, bold: true, color: ACC, characterSpacing: 20 })] });
const bullet = (t) => new Paragraph({ numbering: { reference: "b", level: 0 }, spacing: { after: 30 }, children: [r(t)] });
const role = (title, org, place, dates) => [
  new Paragraph({ spacing: { before: 90, after: 0 }, tabStops: [{ type: TabStopType.RIGHT, position: W }],
    children: [r(title, { bold: true, size: 21 }), r("\t" + dates, { color: MUTED, size: 19 })] }),
  new Paragraph({ spacing: { after: 40 }, children: [r(org + " | " + place, { italics: true, color: MUTED, size: 19 })] }),
];
const sub = (t) => new Paragraph({ spacing: { before: 60, after: 20 }, children: [r(t, { bold: true, color: ACC, size: 19 })] });
const noB = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } };
const skills = (h1, a, h2, b) => new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [W / 2, W / 2], rows: [new TableRow({ children: [
  new TableCell({ width: { size: W / 2, type: WidthType.DXA }, borders: noB, children: [sub(h1), ...a.map(bullet)] }),
  new TableCell({ width: { size: W / 2, type: WidthType.DXA }, borders: noB, children: [sub(h2), ...b.map(bullet)] }) ] })] });

const kids = [
  new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: "TADE OLANREWAJU", font: FONT, size: 44, bold: true, color: INK, characterSpacing: 30 })] }),
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: "Entry Level IT Support and Service Desk | Part Time", font: FONT, size: 24, color: ACC, bold: true })] }),
  new Paragraph({ spacing: { after: 20 }, children: [r("07477 030678  |  tadeolanrewaju@gmail.com  |  London", { color: MUTED, size: 19 })] }),
  new Paragraph({ spacing: { after: 60 }, children: [r("Available for part time, flexible or zero hours work alongside my degree. Remote or hybrid preferred.", { color: MUTED, size: 19, italics: true })] }),
  heading("Profile"),
  new Paragraph({ spacing: { after: 40 }, children: [r("Computer Science undergraduate at Canterbury Christ Church University (expected graduation 2028), with first class results in Mathematics for Computer Science and Computational Thinking. My technical knowledge is developing through my degree rather than professional IT employment, and I bring over three years of customer facing experience as a receptionist, managing bookings, enquiries and client records, alongside fast paced operational roles using scanning and stock systems. I am patient, reliable and quick to learn new systems, and I am looking for an entry level IT support, helpdesk or service desk role, or a student placement, that I can balance with my studies.")] }),
  heading("Education"),
  ...role("BSc (Hons) Computer Science with Foundation Year", "Canterbury Christ Church University", "Canterbury", "Expected 2028"),
  bullet("First class results in Mathematics for Computer Science and Computational Thinking"),
  ...role("A Level Mathematics", "Christ the King Sixth Form College", "Brockley", "2022"),
  ...role("9 GCSEs including Maths, English Language and English Literature", "St Matthew Academy", "Blackheath", "2019"),
  bullet("UK Mathematics Challenge Bronze Award"),
  heading("Skills"),
  skills("Developing through my degree", ["Computational thinking and problem solving", "Mathematical and logical reasoning", "Breaking problems down step by step", "Research and critical evaluation"],
         "From work", ["Customer support by phone and in person", "Booking systems and accurate record keeping", "Handheld scanners and stock tracking systems", "Clear, patient communication", "Reporting issues and discrepancies promptly"]),
  heading("Experience"),
  ...role("Crew Member", "Olympus Crew", "London", "May 2024 to Present"),
  bullet("Set up and break down event equipment, following detailed technical instructions accurately under time pressure"),
  bullet("Adapt quickly to different venues, event requirements and equipment types"),
  bullet("Communicate clearly with team leads to flag issues or delays so tasks finish on schedule"),
  ...role("Despatch Warehouse Operative", "Ocado", "Erith, London", "Feb 2023 to Dec 2023"),
  bullet("Scanned and tracked goods through the despatch system, keeping stock data accurate in a high volume automated warehouse"),
  bullet("Reported discrepancies and system errors promptly to keep inventory records reliable"),
  bullet("Worked to strict daily deadlines while following safety and process procedures precisely"),
  ...role("Online Assistant", "Sainsbury's", "Charlton Riverside, London", "Oct 2022 to Jan 2023"),
  bullet("Used handheld devices to log order status and update stock information in real time"),
  bullet("Cross checked items against system records to make sure every order was accurate before dispatch"),
  ...role("Receptionist", "Standard Studio", "Blackheath, London", "Aug 2019 to Oct 2022"),
  bullet("First point of contact for clients in person and by phone, answering enquiries about availability, pricing and services"),
  bullet("Managed the booking system, coordinating schedules to avoid overlaps and keep the studio running smoothly"),
  bullet("Processed customer payments and kept accurate records of appointments and client details"),
  ...role("Teaching Assistant", "Our Lady of Grace Primary School", "Charlton, London", "Feb 2019 to Aug 2019"),
  bullet("Supported individual pupils one to one, adapting explanations to each person's pace of learning"),
  bullet("Prepared materials and helped the class teacher deliver lessons, reporting observations back"),
];
const doc = new Document({ creator: "Forever Careers", title: "CV",
  styles: { default: { document: { run: { font: FONT, size: 19 } } } },
  numbering: { config: [{ reference: "b", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 300, hanging: 220 } }, run: { color: ACC } } }] }] },
  sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 680, bottom: 600, left: 850, right: 850 } } }, children: kids }] });
Packer.toBuffer(doc).then(b => { fs.writeFileSync("CV.docx", b); console.log("ok"); });
