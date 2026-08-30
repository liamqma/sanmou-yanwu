import { alpha, createTheme } from '@mui/material/styles';

const charcoal = '#070c0b';
const ink = '#101716';
const inkRaised = '#18201e';
const gold = '#b69657';
const goldBright = '#e0be72';
const jade = '#6f8f72';
const ember = '#cf5b3b';
const purple = '#8b67b8';
const rule = '#4f4635';
const text = '#e8dfc9';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: jade, dark: '#4e6d54', light: '#9bbb9d', contrastText: '#08110e' },
    secondary: { main: gold, dark: '#826a3e', light: goldBright, contrastText: '#11110c' },
    error: { main: '#d76c57', dark: '#9d4032', light: '#efa08e' },
    warning: { main: '#dc873d', dark: '#a45828', light: '#f0b36d', contrastText: '#171008' },
    success: { main: '#79aa8f', dark: '#517862', light: '#a9d1ba', contrastText: '#09120e' },
    info: { main: '#78a7b2', dark: '#527681', light: '#a8cbd2' },
    background: { default: charcoal, paper: ink },
    text: { primary: text, secondary: '#aaa79d', disabled: '#747972' },
    divider: rule,
    action: {
      hover: alpha(gold, 0.1),
      selected: alpha(jade, 0.18),
      disabledBackground: alpha(text, 0.08),
    },
  },
  shape: { borderRadius: 3 },
  spacing: 8,
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    h1: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.05em', color: goldBright },
    h2: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.045em', color: goldBright },
    h3: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.04em', color: goldBright },
    h4: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.035em', color: goldBright },
    h5: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.03em', color: goldBright },
    h6: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.025em', color: '#d7c28e' },
    button: { fontWeight: 750, letterSpacing: '0.04em', textTransform: 'none' },
    overline: { fontWeight: 800, letterSpacing: '0.16em', color: '#df8b50' },
  },
  shadows: [
    'none',
    '0 8px 24px rgba(0,0,0,.28)',
    '0 12px 34px rgba(0,0,0,.34)',
    '0 16px 42px rgba(0,0,0,.38)',
    '0 20px 50px rgba(0,0,0,.42)',
    ...Array(20).fill('0 20px 50px rgba(0,0,0,.46)'),
  ] as any,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { minWidth: 320, backgroundColor: charcoal, colorScheme: 'dark' },
        body: {
          minWidth: 320,
          backgroundColor: charcoal,
          backgroundImage: `radial-gradient(circle at 52% 112%, ${alpha(ember, 0.2)}, transparent 34rem), radial-gradient(circle at 78% 5%, ${alpha(ember, 0.08)}, transparent 26rem), repeating-linear-gradient(0deg, ${alpha('#d2c7a5', 0.018)} 0, ${alpha('#d2c7a5', 0.018)} 1px, transparent 1px, transparent 5px)`,
          backgroundAttachment: 'fixed',
        },
        '::selection': { backgroundColor: alpha(jade, 0.34) },
        '*': { scrollbarColor: `${alpha(gold, 0.55)} ${charcoal}` },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            scrollBehavior: 'auto !important',
            transitionDuration: '0s !important',
          },
        },
      },
    },
    MuiContainer: { styleOverrides: { root: { minWidth: 0 } } },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          position: 'relative',
          backgroundColor: ink,
          backgroundImage: `linear-gradient(145deg, ${alpha(gold, 0.055)}, transparent 38%), repeating-linear-gradient(0deg, ${alpha('#fff2cc', 0.012)} 0 1px, transparent 1px 5px)`,
          border: `1px solid ${rule}`,
          boxShadow: '0 12px 30px rgba(0,0,0,.26)',
        },
        outlined: { borderColor: rule },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: `1px solid ${rule}`,
          backgroundColor: ink,
          backgroundImage: `linear-gradient(160deg, ${alpha(gold, 0.08)}, transparent 38%), repeating-linear-gradient(0deg, ${alpha('#fff2cc', 0.012)} 0 1px, transparent 1px 5px)`,
          boxShadow: '0 12px 30px rgba(0,0,0,.3)',
        },
      },
    },
    MuiCardContent: { styleOverrides: { root: { padding: 24, '&:last-child': { paddingBottom: 24 } } } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 42,
          borderRadius: 2,
          paddingInline: 18,
          borderWidth: 1,
          '&:focus-visible': { outline: `3px solid ${alpha(goldBright, 0.7)}`, outlineOffset: 2 },
        },
        containedPrimary: {
          backgroundColor: goldBright,
          backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,.16), rgba(92,57,16,.12))',
          color: '#21170a',
          border: `1px solid ${goldBright}`,
          boxShadow: `inset 0 0 0 2px ${alpha('#6d4a18', 0.2)}, 0 6px 18px ${alpha(gold, 0.16)}`,
          '&:hover': { backgroundColor: '#eccd86' },
        },
        outlinedPrimary: { color: '#c8e0d5', borderColor: '#628a77', '&:hover': { borderColor: jade, backgroundColor: alpha(jade, 0.1) } },
        containedSecondary: { color: '#18130b', backgroundColor: goldBright, '&:hover': { backgroundColor: '#eccd86' } },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 2, '&:focus-visible': { outline: `3px solid ${alpha(goldBright, 0.7)}`, outlineOffset: 2 } } } },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 2, fontWeight: 700, borderColor: rule },
        colorPrimary: { backgroundColor: alpha(jade, 0.18), color: '#b9daca', borderColor: alpha(jade, 0.7) },
        colorSecondary: { backgroundColor: alpha(gold, 0.17), color: '#e2c98f', borderColor: alpha(gold, 0.75) },
        colorWarning: { backgroundColor: alpha(ember, 0.26), color: '#ffd19b' },
        colorSuccess: { backgroundColor: alpha(jade, 0.24), color: '#c6ead6' },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          backgroundColor: alpha('#07100e', 0.52),
          '& .MuiOutlinedInput-notchedOutline': { borderColor: '#74684c' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: gold },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: goldBright, borderWidth: 2 },
        },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { color: '#b7b2a3' } } },
    MuiAutocomplete: {
      styleOverrides: {
        paper: { marginTop: 4, border: `1px solid ${rule}`, backgroundColor: inkRaised },
        option: { borderBottom: `1px solid ${alpha(rule, 0.65)}` },
      },
    },
    MuiMenu: { styleOverrides: { paper: { backgroundColor: inkRaised, border: `1px solid ${rule}` } } },
    MuiTableContainer: {
      styleOverrides: {
        root: { border: `1px solid ${rule}`, backgroundColor: alpha(ink, 0.9), '&:focus-visible': { outline: `3px solid ${alpha(gold, 0.65)}`, outlineOffset: 2 } },
      },
    },
    MuiTableHead: { styleOverrides: { root: { backgroundColor: '#26312e' } } },
    MuiTableCell: { styleOverrides: { root: { borderColor: rule }, head: { color: '#ddc98f', fontWeight: 750, letterSpacing: '0.035em', backgroundColor: '#26312e' } } },
    MuiTableRow: { styleOverrides: { root: { '&.MuiTableRow-hover:hover': { backgroundColor: alpha(jade, 0.08) } } } },
    MuiDivider: { styleOverrides: { root: { borderColor: rule } } },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 2, border: `1px solid ${rule}`, alignItems: 'center' },
        standardInfo: { backgroundColor: '#1c3033', color: '#d7e6e5' },
        standardSuccess: { backgroundColor: '#1d3329', color: '#d8ecdf' },
        standardWarning: { backgroundColor: '#39291b', color: '#f3ddbd' },
        standardError: { backgroundColor: '#3b211e', color: '#f2d6d1' },
      },
    },
    MuiDialog: { styleOverrides: { paper: { border: `1px solid ${rule}`, backgroundColor: inkRaised } } },
    MuiDialogTitle: { styleOverrides: { root: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, color: goldBright, borderBottom: `1px solid ${rule}` } } },
    MuiToggleButton: { styleOverrides: { root: { borderRadius: 2, color: text, borderColor: rule, '&.Mui-selected': { color: goldBright, backgroundColor: alpha(gold, 0.2), boxShadow: `inset 0 -2px ${goldBright}` } } } },
    MuiStepper: { styleOverrides: { root: { backgroundColor: 'transparent' } } },
    MuiStepIcon: { styleOverrides: { root: { color: '#504b40', '&.Mui-active': { color: ember }, '&.Mui-completed': { color: jade } }, text: { fill: '#fff8e8', fontWeight: 700 } } },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: '#050908', color: '#fff8e8', border: `1px solid ${rule}`, borderRadius: 2 } } },
  },
});

export const gameColors = { charcoal, ink, inkRaised, gold, goldBright, jade, ember, purple, rule, text };
