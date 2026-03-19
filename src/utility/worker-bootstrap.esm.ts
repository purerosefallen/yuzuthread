export const WORKER_BOOTSTRAP = `
const { parentPort, workerData } = require('node:worker_threads');
const { pathToFileURL } = require('node:url');

const serializeError = (error) => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
};

const reportInitError = (error) => {
  if (!parentPort) {
    setImmediate(() => {
      throw error;
    });
    return;
  }

  parentPort.postMessage({
    type: 'init-error',
    error: serializeError(error),
  });
  process.exit(1);
};

void import(pathToFileURL(workerData.__entryFile).href).catch(reportInitError);
`;
