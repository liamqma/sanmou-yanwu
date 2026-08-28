import { useEffect, useState, type MouseEvent } from 'react';
import {
  Box,
  Button,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import MenuOutlinedIcon from '@mui/icons-material/MenuOutlined';
import QueryStatsOutlinedIcon from '@mui/icons-material/QueryStatsOutlined';
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined';
import SportsEsportsOutlinedIcon from '@mui/icons-material/SportsEsportsOutlined';
import UpdateIcon from '@mui/icons-material/Update';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import { Link as RouterLink } from 'react-router-dom';
import { recommendationData } from '../../data';
import JoinGroupButton from './JoinGroupButton';

interface HeaderProps {
  currentPath: string;
  teamBuilderUnlocked: boolean;
  hasProgress: boolean;
  onResetProgress: () => void;
}

const Header = ({
  currentPath,
  teamBuilderUnlocked,
  hasProgress,
  onResetProgress,
}: HeaderProps) => {
  const counts = recommendationData.battle_counts;
  const totalBattles = counts.total_battles ?? 0;
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const menuOpen = Boolean(menuAnchor) && !isDesktop;

  useEffect(() => {
    if (isDesktop) setMenuAnchor(null);
  }, [isDesktop]);

  const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
    setMenuAnchor(event.currentTarget);
  };
  const closeMenu = () => setMenuAnchor(null);
  const resetProgress = () => {
    closeMenu();
    onResetProgress();
  };
  const current = (path: string) =>
    currentPath === path ? ('page' as const) : undefined;

  return (
    <Box
      component="header"
      sx={{
        position: { xs: 'relative', md: 'sticky' },
        top: 0,
        zIndex: 20,
        minHeight: { xs: 62, md: '100vh' },
        height: { md: '100vh' },
        bgcolor: '#17221e',
        color: '#f4ecdc',
        borderRight: { md: '1px solid #53625c' },
        borderBottom: { xs: '1px solid #53625c', md: 0 },
        px: { xs: 2.25, md: 1.5 },
        py: { xs: 1.25, md: 3 },
        display: 'flex',
        flexDirection: { xs: 'row', md: 'column' },
        alignItems: 'center',
        justifyContent: { xs: 'space-between', md: 'flex-start' },
        gap: { xs: 2, md: 2.5 },
      }}
    >
      <Typography
        component="div"
        sx={{
          writingMode: { xs: 'horizontal-tb', md: 'vertical-rl' },
          fontFamily: '"Songti SC", STSong, Georgia, serif',
          fontSize: { xs: 20, md: 22 },
          fontWeight: 800,
          letterSpacing: { xs: '0.18em', md: '0.28em' },
          whiteSpace: 'nowrap',
        }}
      >
        演武策牒
      </Typography>

      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'row', md: 'column' },
          alignItems: 'center',
          gap: { xs: 1.25, md: 2.5 },
          ml: { xs: 'auto', md: 0 },
        }}
      >
        <Box
          sx={{
            writingMode: { xs: 'horizontal-tb', md: 'vertical-rl' },
            display: { xs: 'none', sm: 'flex' },
            alignItems: 'center',
            gap: 0.75,
            color: '#b8c0ba',
            fontSize: 11,
            letterSpacing: '0.1em',
            whiteSpace: 'nowrap',
          }}
        >
          <UpdateIcon sx={{ fontSize: 14 }} />
          {totalBattles > 0 && <span>已收集 {totalBattles} 场战报</span>}
        </Box>

        <Box
          component="nav"
          aria-label="移动导航"
          sx={{ display: { xs: 'block', md: 'none' }, flexShrink: 0 }}
        >
          <Button
            id="mobile-navigation-button"
            aria-controls={menuOpen ? 'mobile-navigation-menu' : undefined}
            aria-haspopup="menu"
            aria-expanded={menuOpen ? 'true' : undefined}
            color="inherit"
            size="small"
            variant="outlined"
            startIcon={<MenuOutlinedIcon />}
            onClick={openMenu}
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
            菜单
          </Button>
          <Menu
            id="mobile-navigation-menu"
            anchorEl={menuAnchor}
            keepMounted
            open={menuOpen}
            onClose={closeMenu}
            MenuListProps={{ 'aria-labelledby': 'mobile-navigation-button' }}
          >
            <MenuItem
              component={RouterLink}
              to="/"
              aria-current={current('/')}
              onClick={closeMenu}
            >
              <ListItemIcon>
                <SportsEsportsOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>对局推荐</ListItemText>
            </MenuItem>
            {teamBuilderUnlocked && (
              <MenuItem
                component={RouterLink}
                to="/team-builder"
                aria-current={current('/team-builder')}
                onClick={closeMenu}
              >
                <ListItemIcon>
                  <AccountTreeOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>队伍推荐</ListItemText>
              </MenuItem>
            )}
            <MenuItem
              component={RouterLink}
              to="/analytics"
              aria-current={current('/analytics')}
              onClick={closeMenu}
            >
              <ListItemIcon>
                <QueryStatsOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>数据洞察</ListItemText>
            </MenuItem>
            <MenuItem
              component={RouterLink}
              to="/guides/yanwu"
              aria-current={current('/guides/yanwu')}
              onClick={closeMenu}
            >
              <ListItemIcon>
                <MenuBookOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>演武攻略</ListItemText>
            </MenuItem>
            <MenuItem
              component={RouterLink}
              to="/contributors"
              aria-current={current('/contributors')}
              onClick={closeMenu}
            >
              <ListItemIcon>
                <EmojiEventsOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>战报贡献榜</ListItemText>
            </MenuItem>
            <MenuItem
              component={RouterLink}
              to="/contribute"
              aria-current={current('/contribute')}
              onClick={closeMenu}
            >
              <ListItemIcon>
                <UploadFileOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>上传战报</ListItemText>
            </MenuItem>
            <JoinGroupButton menuItem onOpen={closeMenu} />
            {hasProgress && (
              <MenuItem onClick={resetProgress} sx={{ color: 'error.main' }}>
                <ListItemIcon sx={{ color: 'inherit' }}>
                  <RestartAltOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>重置进度</ListItemText>
              </MenuItem>
            )}
          </Menu>
        </Box>
      </Box>
    </Box>
  );
};

export default Header;
