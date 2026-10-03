import app from './app';
import http from 'http';
import mongoose from 'mongoose';
import { authKeycloakAdmin } from './config/keycloak-admin.config';

const PORT = process.env.PORT || 3000;
const MONGO_URL = process.env.MONGO_URL || '';

const server = http.createServer(app);

// Kết nối với MongoDB trước khi start server
mongoose
  .connect(MONGO_URL)
  .then(async () => {
    console.log('Connected to MongoDB successfully');
    await authKeycloakAdmin(); // Khởi động Keycloak Admin Client
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1); // Dừng server nếu không kết nối được DB
  });
