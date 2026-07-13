import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResponsiveDisclosure from '../ResponsiveDisclosure';

const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe('ResponsiveDisclosure', () => {
  test('keeps desktop content expanded without adding a disclosure control', () => {
    mockMatchMedia(false);

    render(
      <ResponsiveDisclosure label="详细数据">
        <div>详细内容</div>
      </ResponsiveDisclosure>
    );

    expect(screen.getByText('详细内容')).toBeVisible();
    expect(screen.queryByRole('button', { name: '展开详细数据' })).not.toBeInTheDocument();
  });

  test('starts collapsed on mobile and exposes an accessible toggle', async () => {
    mockMatchMedia(true);

    render(
      <ResponsiveDisclosure label="详细数据">
        <div>详细内容</div>
      </ResponsiveDisclosure>
    );

    const toggle = screen.getByRole('button', { name: '展开详细数据' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: '收起详细数据' })).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() => expect(screen.getByText('详细内容')).toBeVisible());
  });
});
