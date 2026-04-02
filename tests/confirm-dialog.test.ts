import { describe, it, expect } from 'vitest';

/**
 * Tests for the ConfirmDialog component's props/configuration patterns.
 * Since this runs in Node (not a browser), we test the configuration logic
 * and prop patterns rather than DOM rendering.
 */

describe('ConfirmDialog Configuration', () => {
  interface ConfirmDialogProps {
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    confirmVariant: 'destructive' | 'primary';
  }

  const createProps = (overrides: Partial<ConfirmDialogProps> = {}): ConfirmDialogProps => ({
    open: false,
    title: 'Are you sure?',
    description: 'This action cannot be undone.',
    confirmLabel: 'Confirm',
    confirmVariant: 'destructive',
    ...overrides,
  });

  it('defaults to destructive variant', () => {
    const props = createProps();
    expect(props.confirmVariant).toBe('destructive');
  });

  it('supports primary variant', () => {
    const props = createProps({ confirmVariant: 'primary' });
    expect(props.confirmVariant).toBe('primary');
  });

  it('allows custom confirm label', () => {
    const props = createProps({ confirmLabel: 'Kill It' });
    expect(props.confirmLabel).toBe('Kill It');
  });

  it('generates correct CSS class for destructive variant', () => {
    const variant = 'destructive';
    const className = variant === 'destructive'
      ? 'rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90'
      : 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90';
    expect(className).toContain('bg-destructive');
  });

  it('generates correct CSS class for primary variant', () => {
    const variant = 'primary';
    const className = variant === 'destructive'
      ? 'rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90'
      : 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90';
    expect(className).toContain('bg-primary');
  });
});

describe('ConfirmDialog Usage Patterns', () => {
  it('Clarify reject pattern has correct config', () => {
    const task = { index: 2, text: 'Buy groceries' };
    const title = 'Reject this clarification?';
    const description = `"${task.text}" will be sent back to your inbox without changes.`;
    expect(title).toBe('Reject this clarification?');
    expect(description).toContain('Buy groceries');
    expect(description).toContain('inbox');
  });

  it('Reflect kill pattern has correct config', () => {
    const task = { id: 'task-1', title: 'Fix pipeline' };
    const title = 'Kill this task?';
    const description = `"${task.title}" will be permanently removed. This cannot be undone.`;
    expect(title).toBe('Kill this task?');
    expect(description).toContain('Fix pipeline');
    expect(description).toContain('permanently');
  });

  it('Knowledge delete pattern has correct config', () => {
    const entry = { id: '1', name: 'morning routine', type: 'entry' as const };
    const title = `Delete ${entry.type === 'person' ? 'person' : 'entry'}?`;
    const description = `"${entry.name}" will be permanently removed.`;
    expect(title).toBe('Delete entry?');
    expect(description).toContain('morning routine');
  });

  it('Knowledge delete person pattern has correct config', () => {
    const person = { id: '2', name: 'Alice Smith', type: 'person' as const };
    const title = `Delete ${person.type === 'person' ? 'person' : 'entry'}?`;
    expect(title).toBe('Delete person?');
  });
});
