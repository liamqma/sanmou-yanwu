import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RoundInfo from '../RoundInfo';

describe('RoundInfo', () => {
  test('shows all ten rounds and marks round 9 as the active hero round', () => {
    render(
      <MemoryRouter>
        <RoundInfo roundNumber={9} />
      </MemoryRouter>
    );

    expect(
      screen.getByRole('heading', { level: 1, name: '第 9 轮：选择武将' })
    ).toBeInTheDocument();
    expect(screen.getByText('第 9 / 10 轮')).toBeInTheDocument();

    const progress = screen.getByRole('list', { name: '10 轮进度' });
    expect(within(progress).getAllByRole('listitem')).toHaveLength(10);
    expect(
      within(progress).getByRole('listitem', {
        name: '第 9 轮，武将，当前',
      })
    ).toHaveAttribute('aria-current', 'step');
  });
});
