import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import type { UploadedTeam } from '../../types/battleUpload';

interface BattleLineupProps {
  team: UploadedTeam;
  teamNumber: '1' | '2';
  winner: boolean;
  score: number;
}

const BattleLineup = ({
  team,
  teamNumber,
  winner,
  score,
}: BattleLineupProps) => (
  <Card
    component="section"
    aria-labelledby={`uploaded-team-${teamNumber}-title`}
    sx={{
      height: '100%',
      borderTop: '3px solid',
      borderTopColor: winner ? 'success.main' : 'divider',
    }}
  >
    <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        gap={1}
        sx={{ mb: 2 }}
      >
        <Stack
          direction="row"
          alignItems="baseline"
          columnGap={1}
          rowGap={0.25}
          flexWrap="wrap"
        >
          <Typography
            id={`uploaded-team-${teamNumber}-title`}
            component="h3"
            variant="h6"
          >
            阵容 {teamNumber}
          </Typography>
          <Typography
            variant="subtitle2"
            color="text.secondary"
            fontWeight={700}
            sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
          >
            评分：{score.toFixed(1)}
          </Typography>
        </Stack>
        {winner && <Chip label="本场胜方" color="success" size="small" />}
      </Stack>

      <Stack spacing={1.5}>
        {team.map((hero, index) => (
          <Box
            key={`${hero.name}-${index}`}
            sx={{
              borderTop: index === 0 ? 0 : '1px solid',
              borderColor: 'divider',
              pt: index === 0 ? 0 : 1.5,
            }}
          >
            <Typography fontWeight={750}>
              {index + 1}. {hero.name}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.5, overflowWrap: 'anywhere' }}
            >
              {hero.skills.join(' · ')}
            </Typography>
          </Box>
        ))}
      </Stack>
    </CardContent>
  </Card>
);

export default BattleLineup;
