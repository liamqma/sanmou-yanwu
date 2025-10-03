import React from 'react';
import { Box, Skeleton, Card, CardContent, Grid } from '@mui/material';

/**
 * Loading skeleton for game board and analytics pages
 */
export const GameBoardSkeleton = () => {
  return (
    <Box sx={{ py: 4 }}>
      {/* Round Info Skeleton */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Skeleton variant="text" width="40%" height={40} />
          <Skeleton variant="text" width="60%" />
          <Skeleton variant="rectangular" height={60} sx={{ mt: 2 }} />
        </CardContent>
      </Card>

      {/* Current Team Skeleton */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Skeleton variant="text" width="30%" height={30} />
          <Grid container spacing={3} sx={{ mt: 1 }}>
            <Grid item size={{ xs: 12, md: 6 }}>
              <Skeleton variant="text" width="20%" />
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} variant="rounded" width={80} height={32} />
                ))}
              </Box>
            </Grid>
            <Grid item size={{ xs: 12, md: 6 }}>
              <Skeleton variant="text" width="20%" />
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} variant="rounded" width={100} height={32} />
                ))}
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Option Sets Skeleton */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Skeleton variant="text" width="30%" height={30} />
          <Skeleton variant="text" width="50%" sx={{ mb: 2 }} />
          <Grid container spacing={2}>
            {[1, 2, 3].map((i) => (
              <Grid item size={{ xs: 12, md: 4 }} key={i}>
                <Box sx={{ p: 2, border: '2px solid', borderColor: 'divider', borderRadius: 2 }}>
                  <Skeleton variant="text" width="40%" />
                  <Skeleton variant="rectangular" height={56} sx={{ mt: 1, mb: 2 }} />
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {[1, 2, 3].map((j) => (
                      <Skeleton key={j} variant="rounded" width={80} height={32} />
                    ))}
                  </Box>
                </Box>
              </Grid>
            ))}
          </Grid>
        </CardContent>
      </Card>
    </Box>
  );
};

export const AnalyticsSkeleton = () => {
  return (
    <Box sx={{ py: 4 }}>
      <Skeleton variant="text" width="40%" height={50} />
      <Skeleton variant="text" width="60%" sx={{ mb: 4 }} />

      {/* Summary Cards Skeleton */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {[1, 2, 3, 4].map((i) => (
          <Grid item size={{ xs: 12, sm: 6, md: 3 }} key={i}>
            <Card>
              <CardContent>
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="40%" height={60} />
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Tables Skeleton */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {[1, 2].map((i) => (
          <Grid item size={{ xs: 12, md: 6 }} key={i}>
            <Card>
              <CardContent>
                <Skeleton variant="text" width="40%" height={30} />
                <Box sx={{ mt: 2 }}>
                  {[1, 2, 3, 4, 5].map((j) => (
                    <Skeleton key={j} variant="rectangular" height={40} sx={{ mb: 1 }} />
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export const SetupFormSkeleton = () => {
  return (
    <Card>
      <CardContent>
        <Skeleton variant="text" width="40%" height={50} />
        <Skeleton variant="text" width="60%" sx={{ mb: 4 }} />
        
        <Grid container spacing={3}>
          <Grid item size={{ xs: 12, md: 6 }}>
            <Skeleton variant="text" width="30%" />
            <Skeleton variant="rectangular" height={56} sx={{ mt: 1, mb: 2 }} />
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} variant="rounded" width={80} height={32} />
              ))}
            </Box>
          </Grid>
          
          <Grid item size={{ xs: 12, md: 6 }}>
            <Skeleton variant="text" width="30%" />
            <Skeleton variant="rectangular" height={56} sx={{ mt: 1, mb: 2 }} />
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} variant="rounded" width={100} height={32} />
              ))}
            </Box>
          </Grid>
        </Grid>
        
        <Skeleton variant="rectangular" height={48} sx={{ mt: 3 }} />
      </CardContent>
    </Card>
  );
};
