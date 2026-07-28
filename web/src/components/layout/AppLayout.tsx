import { useState, type MouseEvent, type ReactNode } from 'react';
import {
  Box,
  Button,
  Container,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import SportsEsportsOutlinedIcon from '@mui/icons-material/SportsEsportsOutlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import QueryStatsOutlinedIcon from '@mui/icons-material/QueryStatsOutlined';
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import MoreHorizOutlinedIcon from '@mui/icons-material/MoreHorizOutlined';
import {
  Link as RouterLink,
  useNavigate,
  useLocation,
} from 'react-router-dom';
import Header from './Header';
import JoinGroupButton from './JoinGroupButton';
import { useGame } from '../../context/GameContext';

interface AppLayoutProps { children: ReactNode; }

const AppLayout = ({ children }: AppLayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, dispatch } = useGame();
  const roundNumber = state?.gameState?.round_number || 0;
  const isInitialSetup = location.pathname === '/' && !state.gameState;
  const [setupMenuAnchor, setSetupMenuAnchor] = useState<HTMLElement | null>(null);

  const handleOpenSetupMenu = (event: MouseEvent<HTMLButtonElement>) => {
    setSetupMenuAnchor(event.currentTarget);
  };

  const handleCloseSetupMenu = () => {
    setSetupMenuAnchor(null);
  };

  const handleResetProgress = () => {
    if (window.confirm('确定要重置全部进度吗？此操作不可恢复。')) {
      dispatch({ type: 'RESET_GAME' });
      navigate('/');
    }
  };

  const navButtonSx = (path: string) => ({
    minHeight: 42,
    px: 1.75,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    color: location.pathname === path ? 'primary.dark' : 'text.secondary',
    border: 0,
    borderBottom: '2px solid',
    borderColor: location.pathname === path ? 'error.main' : 'transparent',
    bgcolor: location.pathname === path ? 'rgba(69,108,95,0.08)' : 'transparent',
    '&:hover': { bgcolor: 'rgba(69,108,95,0.08)', borderColor: location.pathname === path ? 'error.main' : 'divider' },
  });

  const setupMobileNavigation = isInitialSetup ? (
    <>
      <Box component="nav" aria-label="初始设置导航">
        <Button
          id="setup-more-button"
          aria-controls={setupMenuAnchor ? 'setup-more-menu' : undefined}
          aria-haspopup="menu"
          aria-expanded={setupMenuAnchor ? 'true' : undefined}
          color="inherit"
          size="small"
          variant="outlined"
          startIcon={<MoreHorizOutlinedIcon />}
          onClick={handleOpenSetupMenu}
          sx={{
            minWidth: 0,
            color: 'inherit',
            borderColor: '#69756f',
            '&:hover': {
              borderColor: '#aeb8b1',
              bgcolor: 'rgba(255,255,255,0.08)',
            },
          }}
        >
          更多
        </Button>
      </Box>
      <Menu
        id="setup-more-menu"
        anchorEl={setupMenuAnchor}
        open={Boolean(setupMenuAnchor)}
        onClose={handleCloseSetupMenu}
        MenuListProps={{ 'aria-labelledby': 'setup-more-button' }}
      >
        <MenuItem
          component={RouterLink}
          to="/"
          aria-current={location.pathname === '/' ? 'page' : undefined}
          onClick={handleCloseSetupMenu}
        >
          <ListItemIcon>
            <SportsEsportsOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>对局推荐</ListItemText>
        </MenuItem>
        <MenuItem
          component={RouterLink}
          to="/analytics"
          aria-current={location.pathname === '/analytics' ? 'page' : undefined}
          onClick={handleCloseSetupMenu}
        >
          <ListItemIcon>
            <QueryStatsOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>数据洞察</ListItemText>
        </MenuItem>
        <MenuItem
          component={RouterLink}
          to="/guides/yanwu"
          aria-current={location.pathname === '/guides/yanwu' ? 'page' : undefined}
          onClick={handleCloseSetupMenu}
        >
          <ListItemIcon>
            <MenuBookOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>演武攻略</ListItemText>
        </MenuItem>
        <MenuItem
          component={RouterLink}
          to="/contributors"
          aria-current={location.pathname === '/contributors' ? 'page' : undefined}
          onClick={handleCloseSetupMenu}
        >
          <ListItemIcon>
            <EmojiEventsOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>战报贡献榜</ListItemText>
        </MenuItem>
        <MenuItem
          component={RouterLink}
          to="/contribute"
          aria-current={location.pathname === '/contribute' ? 'page' : undefined}
          onClick={handleCloseSetupMenu}
        >
          <ListItemIcon>
            <UploadFileOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>上传战报</ListItemText>
        </MenuItem>
        <JoinGroupButton menuItem onOpen={handleCloseSetupMenu} />
      </Menu>
    </>
  ) : undefined;

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          md: '80px minmax(0, 1fr)',
        },
        gridTemplateRows: {
          xs: 'auto minmax(0, 1fr)',
          md: 'minmax(0, 1fr)',
        },
      }}
    >
      <Header mobileAction={setupMobileNavigation} />
      <Box sx={{ minWidth: 0 }}>
        <Box
          component="nav"
          aria-label="主要导航"
          sx={{
            display: { xs: isInitialSetup ? 'none' : 'block', md: 'block' },
            position: { xs: 'relative', md: 'sticky' },
            top: { xs: 0, md: 0 },
            zIndex: 15,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'rgba(243,239,227,0.94)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <Container maxWidth="xl" sx={{ py: 1.25 }}>
            <Stack direction="row" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
              <Box sx={{ display: { xs: 'none', sm: 'block' }, mr: { sm: 1, lg: 3 }, minWidth: 0 }}>
                <Typography variant="overline" color="error.main" sx={{ display: { xs: 'none', sm: 'block' }, lineHeight: 1 }}>
                  三国谋定天下
                </Typography>
                <Typography component="div" variant="h6" sx={{ whiteSpace: 'nowrap', fontSize: { xs: 17, sm: 20 } }}>
                  演武参谋
                </Typography>
              </Box>

              <Stack direction="row" gap={0.25} sx={{ overflowX: 'auto', flex: 1, minWidth: 0 }}>
                <Button
                  component={RouterLink}
                  to="/"
                  aria-current={location.pathname === '/' ? 'page' : undefined}
                  startIcon={<SportsEsportsOutlinedIcon />}
                  sx={navButtonSx('/')}
                >
                  对局推荐
                </Button>
                {roundNumber > 3 && (
                  <Button
                    component={RouterLink}
                    to="/team-builder"
                    aria-current={location.pathname === '/team-builder' ? 'page' : undefined}
                    startIcon={<AccountTreeOutlinedIcon />}
                    sx={navButtonSx('/team-builder')}
                  >
                    队伍推荐
                  </Button>
                )}
                <Button
                  component={RouterLink}
                  to="/analytics"
                  aria-current={location.pathname === '/analytics' ? 'page' : undefined}
                  startIcon={<QueryStatsOutlinedIcon />}
                  sx={navButtonSx('/analytics')}
                >
                  数据洞察
                </Button>
                <Button
                  component={RouterLink}
                  to="/guides/yanwu"
                  aria-current={location.pathname === '/guides/yanwu' ? 'page' : undefined}
                  startIcon={<MenuBookOutlinedIcon />}
                  sx={navButtonSx('/guides/yanwu')}
                >
                  演武攻略
                </Button>
                <Button
                  component={RouterLink}
                  to="/contributors"
                  aria-current={location.pathname === '/contributors' ? 'page' : undefined}
                  startIcon={<EmojiEventsOutlinedIcon />}
                  sx={navButtonSx('/contributors')}
                >
                  战报贡献榜
                </Button>
                <Button
                  component={RouterLink}
                  to="/contribute"
                  aria-current={location.pathname === '/contribute' ? 'page' : undefined}
                  startIcon={<UploadFileOutlinedIcon />}
                  sx={navButtonSx('/contribute')}
                >
                  上传战报
                </Button>
              </Stack>

              <Stack direction="row" gap={0.75} sx={{ display: { xs: 'none', lg: 'flex' } }}>
                <JoinGroupButton />
                {state.gameState && (
                  <Button color="error" variant="text" startIcon={<RestartAltOutlinedIcon />} onClick={handleResetProgress} title="重置所有已保存进度">
                    重置
                  </Button>
                )}
              </Stack>
            </Stack>
            <Stack direction="row" gap={1} sx={{ display: { xs: 'flex', lg: 'none' }, mt: 1, justifyContent: 'flex-end' }}>
              <JoinGroupButton />
              {state.gameState && (
                <Button color="error" size="small" startIcon={<RestartAltOutlinedIcon />} onClick={handleResetProgress} title="重置所有已保存进度">
                  重置
                </Button>
              )}
            </Stack>
          </Container>
        </Box>

        <Container component="main" maxWidth="xl" sx={{ py: { xs: 2.5, sm: 4 }, minWidth: 0 }}>
          {children}
        </Container>
      </Box>
    </Box>
  );
};

export default AppLayout;
