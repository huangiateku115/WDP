from pathlib import Path
f=Path('src/layouts/staff.css');s=f.read_text(encoding='utf-8').replace('.staff-blockers{','.staff-blocker,.staff-blockers{');f.write_text(s,encoding='utf-8')
f=Path('src/pages/staff/StaffPages.jsx');s=f.read_text(encoding='utf-8').replace("record.subject||record.title","record.subject||record.issue||record.title");f.write_text(s,encoding='utf-8')
