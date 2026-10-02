# WDP

Self-Storage Facility Rental and Inventory Management System.

## Cấu trúc

```text
WDP/
├── frontend/                 # React + TypeScript + Vite
│   ├── src/                  # Mã nguồn giao diện
│   ├── public/               # Tài nguyên tĩnh
│   └── package.json
├── backend/                  # Express + TypeScript
│   ├── src/                  # Backend hiện tại
│   ├── .env.example
│   ├── docker-compose.yml    # Keycloak cho phát triển
│   └── package.json
├── docs/
│   └── PROJECT_CONTEXT.md    # Bản ghi nhớ yêu cầu SRS
└── README.md
```

Frontend và backend có dependencies, lockfile và lệnh chạy riêng. Chạy các lệnh npm trong đúng thư mục; thư mục gốc không có package.json.

## Yêu cầu

- Node.js 22.12+ (đã kiểm tra với 22.23.3), npm.
- MongoDB đang chạy và URI phù hợp cho backend.
- Docker nếu chạy Keycloak bằng Compose. Compose hiện chỉ cung cấp Keycloak, không tạo MongoDB.

## Backend

```powershell
cd backend
npm ci
Copy-Item .env.example .env
docker compose up -d
npm run dev
```

Chỉ sao chép `.env.example` lần đầu; chỉnh `MONGO_URL` theo môi trường thực tế. Không commit `.env`.
Backend mặc định chạy tại `http://localhost:3000`, API prefix `/api/v1`. Server chỉ bắt đầu lắng nghe sau khi kết nối MongoDB thành công.

Keycloak được expose ở `http://localhost:8081`. Cần tạo realm `wdp-realm`, client và roles phù hợp với backend; Compose chưa tự import realm. Các giá trị KEYCLOAK trong `.env.example` khớp cổng Compose.

```powershell
npm run build
npm start
```

Build sinh vào `backend/dist/`. Lệnh start chạy bản đã build.

## Frontend

Mở terminal thứ hai từ thư mục gốc:

```powershell
cd frontend
npm ci
npm run dev
```

Truy cập `http://localhost:5173`. Frontend hiện là bộ khung React–TypeScript từ [Vite](https://vite.dev/guide/), chưa triển khai các màn hình nghiệp vụ SRS.

Trong development, gọi đường dẫn tương đối `/api/v1/...`; Vite chuyển tiếp `/api` đến `http://localhost:3000`. Nếu đổi cổng backend, cập nhật target trong `frontend/vite.config.ts`. Proxy này chỉ dùng cho dev; triển khai production cần cấu hình reverse proxy hoặc địa chỉ API riêng.

```powershell
npm run lint
npm run build
npm run preview
```

Build sinh vào `frontend/dist/`. Preview chỉ dùng kiểm tra bản build, không thay thế production server.

## Tài liệu

Xem [bản ghi nhớ SRS](docs/PROJECT_CONTEXT.md) để hiểu hai mô hình SELF_STORAGE/MANAGED_INVENTORY, vòng đời, phân quyền và các yêu cầu cần làm rõ.
