import React from 'react';
import { Box, Typography, Container } from '@mui/material';

const Header = () => {
  return (
    <Box
      sx={{
        textAlign: 'center',
        color: 'white',
        py: 4,
      }}
    >
      <Container maxWidth="lg">
        <Typography variant="h6">
          基于战斗数据的策略推荐
        </Typography>
      </Container>
    </Box>
  );
};

export default Header;
