import {
  Autocomplete,
  Box,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { usePinyin } from '../../hooks/usePinyin';
import type {
  BattleConfirmation,
  UploadedHero,
  UploadedTeam,
} from '../../types/battleUpload';
import type { GameplayDatabase } from '../../types/domain';

interface SearchableCatalogFieldProps {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}

const SearchableCatalogField = ({
  label,
  value,
  options,
  onChange,
}: SearchableCatalogFieldProps) => {
  const { filterByPinyin } = usePinyin();
  const visibleOptions =
    value && !options.includes(value) ? [value, ...options] : options;

  return (
    <Autocomplete
      options={visibleOptions}
      value={value || null}
      onChange={(_event, nextValue) => onChange(nextValue ?? '')}
      filterOptions={(items, state) =>
        state.inputValue
          ? filterByPinyin(items, state.inputValue).slice(0, 20)
          : items.slice(0, 20)
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder="输入名称或拼音搜索"
        />
      )}
      noOptionsText="无匹配结果"
      fullWidth
    />
  );
};

interface BattleConfirmationFormProps {
  value: BattleConfirmation;
  database: GameplayDatabase;
  season: number;
  onChange: (value: BattleConfirmation) => void;
}

const BattleConfirmationForm = ({
  value,
  database,
  season,
  onChange,
}: BattleConfirmationFormProps) => {
  const availableHeroes = Object.entries(database.heroes)
    .filter(([, hero]) => hero.season === undefined || hero.season <= season)
    .map(([name]) => name);
  const availableSkills = Object.entries(database.skills)
    .filter(([, skill]) => skill.season === undefined || skill.season <= season)
    .map(([name]) => name);

  const updateTeam = (teamKey: '1' | '2', team: UploadedTeam) => {
    onChange({ ...value, [teamKey]: team });
  };

  const updateHero = (
    teamKey: '1' | '2',
    heroIndex: number,
    hero: UploadedHero
  ) => {
    const team = value[teamKey].map((current, index) =>
      index === heroIndex ? hero : current
    ) as UploadedTeam;
    updateTeam(teamKey, team);
  };

  const selectHero = (
    teamKey: '1' | '2',
    heroIndex: number,
    name: string
  ) => {
    const current = value[teamKey][heroIndex];
    updateHero(teamKey, heroIndex, {
      name,
      skills: [
        name ? database.heroes[name].skill : '',
        current.skills[1],
        current.skills[2],
      ],
    });
  };

  const selectCarriedSkill = (
    teamKey: '1' | '2',
    heroIndex: number,
    skillIndex: 1 | 2,
    skill: string
  ) => {
    const current = value[teamKey][heroIndex];
    const skills = [...current.skills] as [string, string, string];
    skills[skillIndex] = skill;
    updateHero(teamKey, heroIndex, { ...current, skills });
  };

  return (
    <Stack spacing={2.5}>
      {(['1', '2'] as const).map((teamKey) => {
        const team = value[teamKey];
        const teamHeroNames = new Set(team.map((hero) => hero.name).filter(Boolean));
        const teamSkillNames = new Set(
          team.flatMap((hero) => hero.skills).filter(Boolean)
        );

        return (
          <Card
            key={teamKey}
            component="section"
            aria-labelledby={`confirmation-team-${teamKey}-title`}
            variant="outlined"
          >
            <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
              <Typography
                id={`confirmation-team-${teamKey}-title`}
                component="h3"
                variant="h6"
                sx={{ mb: 2 }}
              >
                确认阵容 {teamKey}
              </Typography>
              <Stack spacing={2}>
                {team.map((hero, heroIndex) => {
                  const heroOptions = availableHeroes.filter(
                    (name) => name === hero.name || !teamHeroNames.has(name)
                  );
                  return (
                    <Box
                      key={`${teamKey}-${heroIndex}`}
                      sx={{
                        borderTop: heroIndex === 0 ? 0 : '1px solid',
                        borderColor: 'divider',
                        pt: heroIndex === 0 ? 0 : 2,
                      }}
                    >
                      <Typography
                        component="div"
                        variant="overline"
                        color="text.secondary"
                        sx={{ mb: 1 }}
                      >
                        第 {heroIndex + 1} 位
                      </Typography>
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: {
                            xs: 'minmax(0, 1fr)',
                            md: 'repeat(2, minmax(0, 1fr))',
                            xl: 'repeat(4, minmax(0, 1fr))',
                          },
                          gap: 1.5,
                        }}
                      >
                        <SearchableCatalogField
                          label={`阵容 ${teamKey} 第 ${heroIndex + 1} 位武将`}
                          value={hero.name}
                          options={heroOptions}
                          onChange={(name) =>
                            selectHero(teamKey, heroIndex, name)
                          }
                        />
                        <TextField
                          label={`阵容 ${teamKey} 第 ${heroIndex + 1} 位自带战法`}
                          value={hero.skills[0]}
                          placeholder="选择武将后自动填写"
                          fullWidth
                          slotProps={{ htmlInput: { readOnly: true } }}
                        />
                        {([1, 2] as const).map((skillIndex) => {
                          const currentSkill = hero.skills[skillIndex];
                          const skillOptions = availableSkills.filter(
                            (skill) =>
                              skill === currentSkill || !teamSkillNames.has(skill)
                          );
                          return (
                            <SearchableCatalogField
                              key={skillIndex}
                              label={`阵容 ${teamKey} 第 ${heroIndex + 1} 位携带战法 ${skillIndex}`}
                              value={currentSkill}
                              options={skillOptions}
                              onChange={(skill) =>
                                selectCarriedSkill(
                                  teamKey,
                                  heroIndex,
                                  skillIndex,
                                  skill
                                )
                              }
                            />
                          );
                        })}
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            </CardContent>
          </Card>
        );
      })}

      <FormControl fullWidth>
        <InputLabel id="battle-winner-label">本场胜方</InputLabel>
        <Select
          labelId="battle-winner-label"
          value={value.winner}
          label="本场胜方"
          onChange={(event) =>
            onChange({
              ...value,
              winner: event.target.value as '' | '1' | '2',
            })
          }
        >
          <MenuItem value="">
            <em>请选择</em>
          </MenuItem>
          <MenuItem value="1">阵容 1</MenuItem>
          <MenuItem value="2">阵容 2</MenuItem>
        </Select>
      </FormControl>
    </Stack>
  );
};

export default BattleConfirmationForm;
