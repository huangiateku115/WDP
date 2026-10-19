import http from 'http';

async function start(): Promise<void> {
  // Validate configuration before importing application modules.
  const { env } = await import('./config/env');
  const { connectDatabase, disconnectDatabase } = await import('./config/database');
  const { authKeycloakAdmin } = await import('./config/keycloak-admin.config');
  const { default: app } = await import('./app');
  const { ManagedInventoryImageService } = await import('./services/upload/managed-inventory-image.service');
  const { ManagedReceivingEvidenceService } = await import('./services/upload/managed-receiving-evidence.service');
  const server = http.createServer(app);
  const imageCleanupTimer = setInterval(() => {
    void ManagedInventoryImageService.cleanupExpired().catch(() => console.error('Managed inventory image cleanup will retry on the next interval'));
    void ManagedReceivingEvidenceService.cleanupExpired().catch(() => console.error('Managed receiving evidence cleanup will retry on the next interval'));
  }, 15 * 60 * 1000);
  imageCleanupTimer.unref();
  let shuttingDown = false;

  async function shutdown(exitCode: number): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(imageCleanupTimer);
    const timeout = setTimeout(() => {
      console.error('Shutdown timed out');
      process.exit(1);
    }, 15000);
    timeout.unref();
    try {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
          server.closeIdleConnections();
        });
      }
    } catch {
      exitCode = 1;
      console.error('HTTP shutdown failed');
    }
    try {
      await disconnectDatabase();
    } catch {
      exitCode = 1;
      console.error('MongoDB shutdown failed');
    }
    clearTimeout(timeout);
    process.exit(exitCode);
  }

  process.on('SIGINT', () => { void shutdown(0); });
  process.on('SIGTERM', () => { void shutdown(0); });
  try {
    await connectDatabase();
    if (shuttingDown) return;
    await authKeycloakAdmin();
    if (shuttingDown) return;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(env.port, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    console.log(`Server is running on port ${env.port}`);
  } catch {
    console.error('Backend startup failed; check database and Keycloak configuration/availability');
    await shutdown(1);
  }
}

void start().catch(error => {
  // ConfigurationError messages contain variable names, never their values.
  console.error(error?.constructor?.name === 'ConfigurationError'
    ? `Invalid configuration: ${error.message}` : 'Backend initialization failed');
  process.exit(1);
});
