// Accounts and WebRTC signaling only. This service never executes remote input.
const { createService } = require('./signaling/service.cjs');
const { startupMessage } = require('./signaling/startup-error.cjs');

async function main() {
  const service = await createService();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  try {
    await new Promise((resolve, reject) => {
      service.server.once('error', reject);
      service.server.listen(port, host, () => {
        service.server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) { await service.close(); throw error; }
  console.log('Mac Remote account service is listening.');
  const shutdown = () => service.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
if (require.main === module) main().catch(error => {
  console.error(startupMessage(error));
  process.exitCode = 1;
});
