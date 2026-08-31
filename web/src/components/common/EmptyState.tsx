import type { ReactNode } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';

interface EmptyStateProps {
  id?: string;
  icon: ReactNode;
  title: string;
  description: string;
  action: ReactNode;
  headingComponent?: 'h1' | 'h2';
}

const EmptyState = ({
  id,
  icon,
  title,
  description,
  action,
  headingComponent = 'h2',
}: EmptyStateProps) => (
  <Paper
    component="section"
    variant="outlined"
    aria-labelledby={id}
    sx={{ px: { xs: 3, sm: 5 }, py: { xs: 6, sm: 8 }, textAlign: 'center' }}
  >
    <Stack alignItems="center" spacing={2}>
      <Box
        aria-hidden="true"
        sx={{
          display: 'grid',
          placeItems: 'center',
          width: 56,
          height: 56,
          color: 'primary.dark',
          bgcolor: 'primary.light',
          borderRadius: '50%',
          '& svg': { fontSize: 28 },
        }}
      >
        {icon}
      </Box>
      <Typography id={id} component={headingComponent} variant="h4">
        {title}
      </Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 560 }}>
        {description}
      </Typography>
      <Box sx={{ pt: 1 }}>{action}</Box>
    </Stack>
  </Paper>
);

export default EmptyState;
