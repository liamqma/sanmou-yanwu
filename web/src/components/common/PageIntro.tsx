import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

interface PageIntroProps {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  maxWidth?: number;
}

const PageIntro = ({
  eyebrow,
  title,
  description,
  actions,
  maxWidth = 760,
}: PageIntroProps) => (
  <Box component="header" sx={{ mb: { xs: 3, sm: 4 } }}>
    <Typography
      variant="overline"
      color="error.main"
      sx={{ display: 'block', mb: 1 }}
    >
      {eyebrow}
    </Typography>
    <Typography component="h1" variant="h3">
      {title}
    </Typography>
    {description && (
      <Box sx={{ mt: 1.5, maxWidth }}>
        {typeof description === 'string' ? (
          <Typography color="text.secondary">{description}</Typography>
        ) : (
          description
        )}
      </Box>
    )}
    {actions && (
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        flexWrap="wrap"
        sx={{ mt: 2 }}
      >
        {actions}
      </Stack>
    )}
  </Box>
);

export default PageIntro;
