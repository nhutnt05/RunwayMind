import { stopStack } from './stack';

export default async function globalTeardown(): Promise<void> {
  stopStack();
}
