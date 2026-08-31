import { Box, Button } from '@mui/material';
import ExploreOffOutlinedIcon from '@mui/icons-material/ExploreOffOutlined';
import { Link as RouterLink } from 'react-router-dom';
import EmptyState from '../components/common/EmptyState';

const NotFound = () => (
  <Box sx={{ maxWidth: 760, mx: 'auto' }}>
    <EmptyState
      id="not-found-title"
      icon={<ExploreOffOutlinedIcon />}
      title="页面未找到"
      description="这个地址没有对应的演武参谋页面，可以返回对局推荐继续备战。"
      headingComponent="h1"
      action={(
        <Button component={RouterLink} to="/" variant="contained">
          返回对局推荐
        </Button>
      )}
    />
  </Box>
);

export default NotFound;
