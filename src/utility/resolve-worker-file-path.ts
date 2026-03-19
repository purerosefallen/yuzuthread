import { fileURLToPath } from 'node:url';

type WorkerFilePathOptions = {
  filePath?: string;
  moduleUrl?: string;
};

export const resolveWorkerFilePath = (
  options: WorkerFilePathOptions,
  fallbackFilePath: string | null,
): string | null => {
  if (options.filePath) {
    return options.filePath;
  }

  if (options.moduleUrl) {
    return fileURLToPath(options.moduleUrl);
  }

  return fallbackFilePath;
};
