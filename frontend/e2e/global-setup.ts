import { startStack, stopStack } from './stack';

export default async function globalSetup(): Promise<void> {
  try {
    await startStack();
  } catch (e) {
    stopStack();
    throw e;
  }
}
