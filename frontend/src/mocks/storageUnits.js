export const mockStorageUnits = [
  {
    id: "LOCKER-A101", facilityId: "FAC001", serviceType: "LOCKER",
    code: "A-101", name: "Compact Locker", size: 3, volume: 7,
    dimensions: "1.5m × 2m", floor: "Level 1", monthlyRate: 1500000,
    available: true, features: ["Digital PIN Access", "24/7 CCTV"],
  },
  {
    id: "LOCKER-A203", facilityId: "FAC001", serviceType: "LOCKER",
    code: "A-203", name: "Standard Locker", size: 6, volume: 15,
    dimensions: "2m × 3m", floor: "Level 2", monthlyRate: 2800000,
    available: true, features: ["Digital PIN Access", "Biometric Access"],
  },
  {
    id: "LOCKER-B301", facilityId: "FAC002", serviceType: "LOCKER",
    code: "B-301", name: "Business Locker", size: 12, volume: 30,
    dimensions: "3m × 4m", floor: "Ground Floor", monthlyRate: 4500000,
    available: true, features: ["Drive-Up Access", "24/7 CCTV", "Heavy Duty Access"],
  },
  {
    id: "INV-A", facilityId: "FAC001", serviceType: "INVENTORY",
    code: "INV-A", name: "Inventory Storage – Small", size: 5, monthlyRate: 2000000,
    available: true, features: ["Item Tracking", "Inbound Management", "Outbound Management", "Movement History"],
  },
  {
    id: "INV-B", facilityId: "FAC001", serviceType: "INVENTORY",
    code: "INV-B", name: "Inventory Storage – Business", size: 10, monthlyRate: 3500000,
    available: true, features: ["Item Tracking", "Rack & Shelf Location", "Movement History", "Staff Managed Handling"],
  },
  {
    id: "INV-C", facilityId: "FAC003", serviceType: "INVENTORY",
    code: "INV-C", name: "Inventory Storage – Standard", size: 8, monthlyRate: 3000000,
    available: true, features: ["Item Tracking", "Location Tracking", "Movement History"],
  },
];
