from pathlib import Path
p=Path('src/lib/managerDemoStore.js');s=p.read_text(encoding='utf-8').replace("else rental.allocated_capacity_m3=row.requested_capacity_m3;timeline(rental", "else {rental.monthly=row.requested_capacity_m3*200000;rental.allocated_capacity_m3=row.requested_capacity_m3;}timeline(rental");p.write_text(s,encoding='utf-8')
