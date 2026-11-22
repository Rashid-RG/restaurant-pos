import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import LegacySupportTicketsView from '../src/components/SupportTicketsView.jsx';
import PosSupportTicketsView from '../apps/pos-web/src/components/SupportTicketsView.jsx';

describe('POS support tickets view compatibility', () => {
  it('keeps the existing POS view pointing to the exact same React component', () => {
    expect(LegacySupportTicketsView).toBe(PosSupportTicketsView);
  });

  it('continues using the existing POS context and support ticket APIs', () => {
    const source = readFileSync('apps/pos-web/src/components/SupportTicketsView.jsx', 'utf8');
    expect(source).toContain("from '../../../../src/context/POSContext'");
    expect(source).toContain("fetch('/api/tickets'");
    expect(source).toContain("/api/tickets/${ticketId}/messages");
    expect(source).toContain("gastroflow_token");
  });

  it('preserves the old POS route and print/live entrypoint while relocating the view', () => {
    const app = readFileSync('src/App.jsx', 'utf8');
    const legacy = readFileSync('src/components/SupportTicketsView.jsx','utf8');
    const html = readFileSync('index.html','utf8');
    expect(app).toContain("import SupportTicketsView from './components/SupportTicketsView'");
    expect(app).toContain("case 'tickets':");
    expect(legacy).toContain("../../apps/pos-web/src/components/SupportTicketsView.jsx");
    expect(html).toContain('src="/src/main.jsx"');
  });
});
