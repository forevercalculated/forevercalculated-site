# Forever Careers standard CV layout: "Mono" (black and white), approved by Kenneth on 2 Oct 2026

Every tailored CV we build for a client uses this layout. It copies the layout of Kenneth's own "Kenneth Nzegbulem - AI and Customer Success" CV exactly. It replaces the older blue "accent" layout from 30 Sep 2026.
Reference build: `reference_build_tade_it_support.js` (docx npm library). Copy it, replace EVERYTHING inside `DATA` with the client's own facts, and keep all the styling code. Run `node <file>.js Firstname_Surname_<Role>_CV` to write the .docx, then `soffice --headless --convert-to pdf <file>.docx`.
Approved sample: Grace_Olanrewaju_Receptionist_and_Customer_Service_CV (2 Oct 2026).

## Colour
- Black and white ONLY. All text, lines, bullets and markers are black (#000000) on white. No blue, no grey, no accent colours. Website links are black and underlined.

## Page
- A4, one page wherever possible (two pages only for long careers). Margins: top and bottom 720, left and right 1080 (DXA).
- Font: Calibri throughout. Body 9.5pt; secondary lines (employer, location, university, language level) 9pt; dates 9pt italic.

## Header
1. NAME in capitals, 22pt bold.
2. Title line in capitals, 12pt bold (the target role, for example "CUSTOMER SERVICE ADVISOR | REMOTE"), with a thin black rule across the full width underneath.
3. Contact line: phone   •   email   •   town or city   •   website (only if the client has one), separated by round bullets.

## Sections, in this order (headings: capitals, 11pt bold, no rule underneath). Leave out any section the client has nothing real for.
1. PROFESSIONAL SUMMARY: one paragraph, 4 to 6 lines, honest about level.
2. SKILLS: two columns of square bullets, filled left, right, left, right.
3. EXPERIENCE: most recent first, joined by a thin vertical line on the left with a black square marker for each role.
   - Line 1: JOB TITLE in bold capitals, then the employer in normal weight.
   - Line 2: location or working pattern (for example "London", "Remote", "Hybrid") on the left, dates in italics on the right, written "June 2023 - November 2023" or "May 2024 - Present".
   - Then the bullets in two columns (left, right, left, right), square bullets, full sentences ending with a full stop.
4. EDUCATION: square marker, QUALIFICATION in bold capitals, institution underneath with dates on the right in italics, then any grade or achievement as a bold square bullet.
5. CERTIFICATIONS: two columns of square bullets, "Name | Issuer | Month Year | Credential ID: X" exactly as the client gives them.
6. KEY PROJECTS: for each project a bullet with the name in bold and underlined, a bullet "TOOLS:" in bold followed by the tools in italics, then a bullet with the description.
7. LANGUAGES: bullet with the language in bold, the level underneath.
8. WEBSITE, PORTFOLIO AND PROFILES: plain links, only if the client has them.

## Honesty rules
- Only use facts the client has given us (their CVs, emails, sign up details). Never invent employers, dates, grades, skills, certifications, projects, languages or tools.
- Keep contact details, employers, job titles, dates and qualifications exactly as the client's CV gives them.
- Never overstate technical skills: skills still being learned are described as developing through study.
- If sources disagree on a date, use the part they agree on (for example the year) and flag it to Kenneth.
- British English. Apart from the date ranges in the layout above, no hyphens or dashes in the text we write.
