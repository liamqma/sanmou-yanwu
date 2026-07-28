import { Button, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

const NotFound = () => (
  <Stack spacing={2} alignItems="flex-start">
    <Typography component="h1" variant="h3">
      页面未找到
    </Typography>
    <Typography color="text.secondary">
      这个地址没有对应的演武参谋页面。
    </Typography>
    <Button component={RouterLink} to="/" variant="contained">
      返回对局推荐
    </Button>
  </Stack>
);

export default NotFound;
