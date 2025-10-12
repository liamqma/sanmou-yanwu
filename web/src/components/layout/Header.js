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
        <Typography variant="h1" gutterBottom>
          🤖 Game AI Advisor
        </Typography>
        <Typography variant="h6">
          Strategic recommendations powered by battle data analysis
        </Typography>
      </Container>
    </Box>
  );
};

export default Header;
