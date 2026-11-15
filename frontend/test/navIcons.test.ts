// Every sidebar route has its own icon (the collapsed sidebar shows icons only).
import { describe, expect, it } from 'vitest';
import { ROUTES_WITH_ICONS } from '../components/layout/navIcons';
import { APP_ROUTES } from '../lib/routes';

describe('sidebar icons', () => {
  it('has an icon for every route', () => {
    expect([...ROUTES_WITH_ICONS].sort()).toEqual(APP_ROUTES.map((r) => r.href).sort());
  });
});
