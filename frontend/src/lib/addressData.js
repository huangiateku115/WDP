// Curated address cascade data for the facility form.
// Country -> City/Province -> Ward/Commune. Extend or replace with a full
// administrative dataset (e.g. a JSON import) without touching the UI.

export const COUNTRIES = [
  "Vietnam",
  "Laos",
  "Cambodia",
  "Thailand",
  "Singapore",
  "Japan",
  "South Korea",
  "China",
  "United States",
  "Australia",
];

export const CITIES_BY_COUNTRY = {
  "Vietnam": [
    "Ho Chi Minh City",
    "Hanoi",
    "Hai Phong",
    "Da Nang",
    "Can Tho",
    "Hue",
    "Dong Nai",
    "Binh Duong",
    "Ba Ria - Vung Tau",
    "Long An",
    "Tay Ninh",
    "Khanh Hoa",
    "Lam Dong",
    "Quang Ninh",
    "Nghe An",
    "Thanh Hoa",
  ],
  "Laos": ["Vientiane", "Luang Prabang", "Champasak"],
  "Cambodia": ["Phnom Penh", "Siem Reap", "Battambang"],
  "Thailand": ["Bangkok", "Chiang Mai", "Phuket"],
  "Singapore": ["Singapore"],
  "Japan": ["Tokyo", "Osaka", "Fukuoka"],
  "South Korea": ["Seoul", "Busan", "Incheon"],
  "China": ["Beijing", "Shanghai", "Guangzhou"],
  "United States": ["California", "Texas", "New York"],
  "Australia": ["New South Wales", "Victoria", "Queensland"],
};

export const WARDS_BY_CITY = {
  "Ho Chi Minh City": [
    "Ben Nghe Ward", "Ben Thanh Ward", "Da Kao Ward", "Tan Dinh Ward",
    "Thao Dien Ward", "An Phu Ward", "Hiep Phu Ward", "Tan Phu Ward",
    "Cong Hoa Ward", "Binh Thanh Ward",
  ],
  "Hanoi": [
    "Hang Bai Ward", "Trang Tien Ward", "Cua Nam Ward", "Kim Ma Ward",
    "Ngoc Khanh Ward", "Lang Ha Ward", "Dich Vong Ward", "My Dinh Ward",
  ],
  "Da Nang": [
    "Hai Chau Ward", "Thach Thang Ward", "Thanh Binh Ward",
    "An Hai Bac Ward", "Son Tra Ward",
  ],
  "Hai Phong": [
    "Hoang Van Thu Ward", "Minh Khai Ward", "Le Chan Ward", "Ngo Quyen Ward",
  ],
  "Can Tho": [
    "Ninh Kieu Ward", "An Khanh Ward", "Cai Khe Ward", "Binh Thuy Ward",
  ],
  "Hue": [
    "Phu Hoi Ward", "Vinh Ninh Ward", "Xuan Phu Ward", "Thuan Hoa Ward",
  ],
};

// Sentinel used by the Ward select to switch to a free-text input.
export const CUSTOM_WARD = "__CUSTOM_WARD__";

export const citiesFor = (country) => CITIES_BY_COUNTRY[country] || [];
export const wardsFor = (city) => WARDS_BY_CITY[city] || [];
