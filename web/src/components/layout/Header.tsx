import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
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
import EmojiEventsOutlinedIcon from '@mui/icons-material/EmojiEventsOutlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
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
  hasProgress: boolean;
  onResetProgress: () => void;
}

interface NavItemProps {
  path: string;
  label: string;
  icon: ReactNode;
  currentPath: string;
}

const RailNavItem = ({ path, label, icon, currentPath }: NavItemProps) => {
  const active = currentPath === path;
  return (
    <Button
      component={RouterLink}
      to={path}
      aria-current={active ? 'page' : undefined}
      startIcon={icon}
      sx={{
        position: 'relative',
        width: '100%',
        minWidth: 0,
        minHeight: 88,
        px: 0.5,
        py: 1.25,
        flexDirection: 'column',
        gap: 0.75,
        border: 0,
        borderRadius: 0,
        color: active ? 'error.dark' : 'text.secondary',
        bgcolor: active ? 'error.light' : 'transparent',
        backgroundImage: 'none',
        '&::after': active
          ? {
              content: '""',
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: 4,
              bgcolor: 'error.main',
              boxShadow: 'none',
            }
          : undefined,
        '& .MuiButton-startIcon': { m: 0, '& svg': { fontSize: 28 } },
        '&:hover': { color: 'primary.dark', bgcolor: 'primary.light' },
      }}
    >
      {label}
    </Button>
  );
};

const Header = ({
  currentPath,
  hasProgress,
  onResetProgress,
}: HeaderProps) => {
  const totalBattles = recommendationData.battle_counts.total_battles ?? 0;
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
        minHeight: { xs: 66, md: '100vh' },
        height: { md: '100vh' },
        overflowY: { md: 'auto' },
        bgcolor: 'background.paper',
        color: 'text.primary',
        backgroundImage: 'none',
        borderRight: { md: '1px solid', borderColor: 'divider' },
        borderBottom: { xs: '1px solid', md: 0 },
        display: 'flex',
        flexDirection: { xs: 'row', md: 'column' },
        alignItems: 'center',
        justifyContent: { xs: 'space-between', md: 'flex-start' },
      }}
    >
      <Box
        sx={{
          width: { xs: 'auto', md: '100%' },
          minHeight: { xs: 65, md: 112 },
          px: { xs: 2, md: 1 },
          py: { xs: 1, md: 2 },
          display: 'flex',
          alignItems: 'center',
          justifyContent: { xs: 'flex-start', md: 'center' },
          gap: { xs: 1.5, md: 0 },
          borderBottom: { md: '1px solid' },
          borderColor: 'divider',
        }}
      >
        <Box
          aria-hidden="true"
          sx={{
            display: 'grid',
            placeItems: 'center',
            width: { xs: 43, md: 58 },
            height: { xs: 43, md: 58 },
            flexShrink: 0,
            border: '1px solid',
            borderColor: 'error.main',
            outline: '1px solid rgba(168,57,47,.3)',
            outlineOffset: -5,
            fontFamily: '"Songti SC", STSong, Georgia, serif',
            fontSize: { xs: 27, md: 36 },
            fontWeight: 850,
            lineHeight: 1,
            color: 'error.main',
          }}
        >
          谋
        </Box>
        <Typography
          component="div"
          sx={{
            display: { xs: 'block', md: 'none' },
            fontFamily: '"Songti SC", STSong, Georgia, serif',
            fontSize: 21,
            fontWeight: 800,
            letterSpacing: '0.18em',
            whiteSpace: 'nowrap',
          }}
        >
          演武参谋
        </Typography>
      </Box>

      <Box
        component="nav"
        aria-label="主要导航"
        sx={{ display: { xs: 'none', md: 'flex' }, width: '100%', flexDirection: 'column', flex: 1 }}
      >
        <RailNavItem path="/" label="对局推荐" icon={<SportsEsportsOutlinedIcon />} currentPath={currentPath} />
        {hasProgress && (
          <RailNavItem path="/team-builder" label="阵容关系" icon={<AccountTreeOutlinedIcon />} currentPath={currentPath} />
        )}
        <RailNavItem path="/analytics" label="数据洞察" icon={<QueryStatsOutlinedIcon />} currentPath={currentPath} />
        <RailNavItem path="/guides/yanwu" label="演武攻略" icon={<MenuBookOutlinedIcon />} currentPath={currentPath} />
        <RailNavItem path="/contributors" label="战报贡献榜" icon={<EmojiEventsOutlinedIcon />} currentPath={currentPath} />
        <RailNavItem path="/contribute" label="上传战报" icon={<UploadFileOutlinedIcon />} currentPath={currentPath} />
      </Box>

      <Box
        sx={{
          display: { xs: 'none', md: 'grid' },
          width: '100%',
          gap: 0.5,
          px: 1,
          py: 1.5,
          borderTop: '1px solid',
          borderColor: 'divider',
          '& .MuiButton-root': { minWidth: 0, px: 0.5 },
        }}
      >
        <JoinGroupButton />
        {hasProgress && (
          <Button color="error" size="small" startIcon={<RestartAltOutlinedIcon />} onClick={onResetProgress}>
            重置
          </Button>
        )}
        {totalBattles > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', lineHeight: 1.35 }}>
            <UpdateIcon sx={{ fontSize: 12, verticalAlign: -2, mr: 0.25 }} />
            {totalBattles} 场
          </Typography>
        )}
      </Box>

      <Box component="nav" aria-label="移动导航" sx={{ display: { xs: 'block', md: 'none' }, flexShrink: 0, pr: 2 }}>
        <Button
          id="mobile-navigation-button"
          aria-controls={menuOpen ? 'mobile-navigation-menu' : undefined}
          aria-haspopup="menu"
          aria-expanded={menuOpen ? 'true' : undefined}
          aria-label="菜单"
          color="inherit"
          size="small"
          variant="text"
          onClick={openMenu}
          sx={{ minWidth: 44, width: 44, height: 44, p: 0, color: 'text.primary' }}
        >
          <MenuOutlinedIcon sx={{ fontSize: 34 }} />
        </Button>
        <Menu id="mobile-navigation-menu" anchorEl={menuAnchor} keepMounted open={menuOpen} onClose={closeMenu} MenuListProps={{ 'aria-labelledby': 'mobile-navigation-button' }}>
          <MenuItem component={RouterLink} to="/" aria-current={current('/')} onClick={closeMenu}>
            <ListItemIcon><SportsEsportsOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText>对局推荐</ListItemText>
          </MenuItem>
          {hasProgress && (
            <MenuItem component={RouterLink} to="/team-builder" aria-current={current('/team-builder')} onClick={closeMenu}>
              <ListItemIcon><AccountTreeOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText>阵容关系</ListItemText>
            </MenuItem>
          )}
          <MenuItem component={RouterLink} to="/analytics" aria-current={current('/analytics')} onClick={closeMenu}>
            <ListItemIcon><QueryStatsOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText>数据洞察</ListItemText>
          </MenuItem>
          <MenuItem component={RouterLink} to="/guides/yanwu" aria-current={current('/guides/yanwu')} onClick={closeMenu}>
            <ListItemIcon><MenuBookOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText>演武攻略</ListItemText>
          </MenuItem>
          <MenuItem component={RouterLink} to="/contributors" aria-current={current('/contributors')} onClick={closeMenu}>
            <ListItemIcon><EmojiEventsOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText>战报贡献榜</ListItemText>
          </MenuItem>
          <MenuItem component={RouterLink} to="/contribute" aria-current={current('/contribute')} onClick={closeMenu}>
            <ListItemIcon><UploadFileOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText>上传战报</ListItemText>
          </MenuItem>
          <JoinGroupButton menuItem onOpen={closeMenu} />
          {hasProgress && (
            <MenuItem onClick={resetProgress} sx={{ color: 'error.main' }}>
              <ListItemIcon sx={{ color: 'inherit' }}><RestartAltOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText>重置进度</ListItemText>
            </MenuItem>
          )}
        </Menu>
      </Box>
    </Box>
  );
};

export default Header;
