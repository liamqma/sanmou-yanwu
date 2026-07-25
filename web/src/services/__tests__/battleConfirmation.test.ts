import type { UploadedBattle } from '../../types/battleUpload';
import {
  battleToConfirmation,
  emptyBattleConfirmation,
} from '../battleConfirmation';

describe('battle confirmation state', () => {
  test('starts with every required position and skill slot present but empty', () => {
    const confirmation = emptyBattleConfirmation();

    expect(confirmation).toEqual({
      '1': [
        { name: '', skills: ['', '', ''] },
        { name: '', skills: ['', '', ''] },
        { name: '', skills: ['', '', ''] },
      ],
      '2': [
        { name: '', skills: ['', '', ''] },
        { name: '', skills: ['', '', ''] },
        { name: '', skills: ['', '', ''] },
      ],
      winner: '',
    });
  });

  test('copies a pasted battle without retaining mutable array references', () => {
    const battle = {
      '1': [
        { name: '甲', skills: ['甲法', '乙法', '丙法'] },
        { name: '乙', skills: ['丁法', '戊法', '己法'] },
        { name: '丙', skills: ['庚法', '辛法', '壬法'] },
      ],
      '2': [
        { name: '丁', skills: ['癸法', '子法', '丑法'] },
        { name: '戊', skills: ['寅法', '卯法', '辰法'] },
        { name: '己', skills: ['巳法', '午法', '未法'] },
      ],
      winner: '1',
    } as UploadedBattle;

    const confirmation = battleToConfirmation(battle);
    confirmation['1'][0].skills[1] = '已修改';

    expect(battle['1'][0].skills[1]).toBe('乙法');
  });
});
