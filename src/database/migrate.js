import { MigrationError, errorDetails, runMigrations } from './migrations.js';

const controller = new AbortController();
const interrupt = (signal) => {
  process.exitCode = signal === 'SIGINT' ? 130 : 143;
  controller.abort();
};
const onInterrupt = () => interrupt('SIGINT');
const onTerminate = () => interrupt('SIGTERM');
process.once('SIGINT', onInterrupt);
process.once('SIGTERM', onTerminate);

try {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--directory' || !args[1])) {
    throw new MigrationError('Usage: npm run db:migrate -- [--directory path]');
  }
  await runMigrations({ directory: args[1], signal: controller.signal });
} catch (error) {
  const message = controller.signal.aborted
    ? 'Migration run interrupted; database connection closed.'
    : error instanceof MigrationError
      ? error.message
      : `Migration run failed${errorDetails(error)}. Check PostgreSQL availability, permissions and PG* settings.`;
  console.error(message);
  process.exitCode ||= 1;
} finally {
  process.removeListener('SIGINT', onInterrupt);
  process.removeListener('SIGTERM', onTerminate);
}
