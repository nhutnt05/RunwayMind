// Shared flat config for every TypeScript workspace package.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/coverage/**', 'lib/**', 'out/**', 'cache/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Rule 2: money is bigint. Flag accidental float parsing in engines/shared.
      'no-restricted-globals': ['error', { name: 'parseFloat', message: 'Use bigint base units for amounts.' }],
      // NFR-03 (docs/14 §3): no `number`-typed variables, parameters or properties named *amount* / *balance*.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Identifier[name=/amount|balance/i] > TSTypeAnnotation > TSNumberKeyword',
          message: 'Amounts and balances must be bigint (base units), not number (NFR-03).',
        },
        {
          selector: 'TSPropertySignature[key.name=/amount|balance/i] > TSTypeAnnotation > TSNumberKeyword',
          message: 'Amounts and balances must be bigint (base units), not number (NFR-03).',
        },
        {
          selector: 'PropertyDefinition[key.name=/amount|balance/i] > TSTypeAnnotation > TSNumberKeyword',
          message: 'Amounts and balances must be bigint (base units), not number (NFR-03).',
        },
      ],
    },
  },
  {
    // Rule 3: engines take time from chain snapshots, never the wall clock.
    files: ['agent/src/engines/**/*.ts'],
    rules: {
      'no-restricted-properties': ['error', { object: 'Date', property: 'now', message: 'Use chain time (Treasury.currentTime()).' }],
    },
  },
);
