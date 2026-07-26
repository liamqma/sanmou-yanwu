import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RoundInfo from '../RoundInfo';

describe('RoundInfo', () => {
  test('keeps an accessible round title and marks round 9 as active', () => {
    render(
      <MemoryRouter>
        <RoundInfo roundNumber={9} />
      </MemoryRouter>
    );

    const title = screen.getByRole('heading', {
      level: 1,
      name: '第 9 轮：选择武将',
    });
    expect(title).toBeInTheDocument();
    expect(title).toHaveStyle({
      position: 'absolute',
      width: '1px',
      height: '1px',
    });
    expect(screen.queryByText('第 9 / 10 轮')).not.toBeInTheDocument();

    const progress = screen.getByRole('list', { name: '10 轮进度' });
    expect(within(progress).getAllByRole('listitem')).toHaveLength(10);
    expect(
      within(progress).getByRole('listitem', {
        name: '第 9 轮，武将，当前',
      })
    ).toHaveAttribute('aria-current', 'step');
  });
});
