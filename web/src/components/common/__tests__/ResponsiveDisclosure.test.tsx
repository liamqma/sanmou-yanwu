import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResponsiveDisclosure from '../ResponsiveDisclosure';

const StatefulContent = () => {
  const [value, setValue] = useState('');
  return (
    <input
      aria-label="保留状态"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
};

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

  test('can stay collapsed on desktop without unmounting child state', async () => {
    mockMatchMedia(false);

    render(
      <ResponsiveDisclosure
        label="完整资料"
        collapseOn="all-viewports"
      >
        <StatefulContent />
      </ResponsiveDisclosure>
    );

    const input = screen.getByLabelText('保留状态');
    expect(input).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开完整资料' }))
      .toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: '展开完整资料' }));
    fireEvent.change(input, { target: { value: '仍然保留' } });
    fireEvent.click(screen.getByRole('button', { name: '收起完整资料' }));
    fireEvent.click(screen.getByRole('button', { name: '展开完整资料' }));

    await waitFor(() => expect(input).toHaveValue('仍然保留'));
  });
});
