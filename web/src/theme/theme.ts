import { alpha, createTheme } from '@mui/material/styles';

const ink = '#1d2421';
const paper = '#f3efe3';
const paperLight = '#fbf8ef';
const paperDeep = '#e7dfcc';
const jade = '#456c5f';
const seal = '#a8392f';
const gold = '#a38147';
const accessibleGold = '#765d31';
const purple = '#8b67b8';
const rule = '#c9c2b1';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: jade, dark: '#304f45', light: '#dfe8e2', contrastText: '#fffdf7' },
    secondary: { main: accessibleGold, dark: '#5f4925', light: '#eee2ca', contrastText: '#fffdf7' },
    error: { main: seal, dark: '#7e2923', light: '#f1dfd9' },
    warning: { main: gold, dark: '#725a2f', light: '#f0e5cf', contrastText: ink },
    success: { main: '#4f755c', dark: '#36523f', light: '#e1eadf', contrastText: '#fffdf7' },
    info: { main: '#526d75', dark: '#374e55', light: '#e1e8e9', contrastText: '#fffdf7' },
    background: { default: paper, paper: paperLight },
    text: { primary: ink, secondary: '#59635d', disabled: '#858b83' },
    divider: rule,
    action: {
      hover: alpha(jade, 0.07),
      selected: alpha(jade, 0.13),
      disabledBackground: alpha(ink, 0.07),
    },
  },
  shape: { borderRadius: 3 },
  spacing: 8,
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    h1: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.035em', color: ink },
    h2: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.03em', color: ink },
    h3: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.025em', color: ink },
    h4: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.025em', color: ink },
    h5: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.025em', color: ink },
    h6: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.02em', color: ink },
    button: { fontWeight: 700, letterSpacing: '0.04em', textTransform: 'none' },
    overline: { fontWeight: 750, letterSpacing: '0.14em', color: seal },
  },
  shadows: [
    'none',
    '0 8px 24px rgba(44,41,30,.07)',
    '0 12px 34px rgba(44,41,30,.09)',
    '0 16px 42px rgba(44,41,30,.1)',
    '0 20px 50px rgba(44,41,30,.11)',
    ...Array(20).fill('0 20px 50px rgba(44,41,30,.12)'),
  ] as any,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { minWidth: 320, backgroundColor: paper, colorScheme: 'light' },
        body: {
          minWidth: 320,
          backgroundColor: paper,
          backgroundImage: `radial-gradient(circle at 82% -10%, ${alpha(gold, 0.09)}, transparent 30rem), repeating-linear-gradient(0deg, ${alpha(ink, 0.018)} 0, ${alpha(ink, 0.018)} 1px, transparent 1px, transparent 4px)`,
          backgroundAttachment: 'fixed',
        },
        '::selection': { backgroundColor: alpha(jade, 0.22) },
        '*': { scrollbarColor: `${alpha(jade, 0.45)} transparent` },
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
          backgroundColor: paperLight,
          backgroundImage: `linear-gradient(145deg, ${alpha(gold, 0.035)}, transparent 38%)`,
          border: `1px solid ${rule}`,
          boxShadow: '0 10px 30px rgba(44,41,30,.055)',
        },
        outlined: { borderColor: rule },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: `1px solid ${rule}`,
          backgroundColor: alpha(paperLight, 0.94),
          backgroundImage: 'none',
          boxShadow: '0 10px 30px rgba(44,41,30,.05)',
        },
      },
    },
    MuiCardContent: { styleOverrides: { root: { padding: 24, '&:last-child': { paddingBottom: 24 } } } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 40,
          borderRadius: 2,
          paddingInline: 18,
          borderWidth: 1,
          '&:focus-visible': { outline: `3px solid ${alpha(jade, 0.3)}`, outlineOffset: 2 },
        },
        containedPrimary: { backgroundColor: jade, color: '#fffdf7', '&:hover': { backgroundColor: '#36594d' } },
        outlinedPrimary: { color: ink, borderColor: '#7a837e', '&:hover': { borderColor: jade, backgroundColor: alpha(jade, 0.07) } },
        containedSecondary: { color: '#fffaf0', backgroundColor: accessibleGold, '&:hover': { backgroundColor: '#5f4925' } },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 2, '&:focus-visible': { outline: `3px solid ${alpha(jade, 0.3)}`, outlineOffset: 2 } } } },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 2, fontWeight: 650, borderColor: rule },
        colorPrimary: { backgroundColor: alpha(jade, 0.13), color: '#2f5045', borderColor: alpha(jade, 0.42) },
        colorSecondary: { backgroundColor: alpha(gold, 0.14), color: '#685126', borderColor: alpha(gold, 0.45) },
        colorWarning: { backgroundColor: alpha(gold, 0.17), color: '#6e5528' },
        colorSuccess: { backgroundColor: alpha('#4f755c', 0.14), color: '#36523f' },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          backgroundColor: alpha('#fffdf7', 0.82),
          '& .MuiOutlinedInput-notchedOutline': { borderColor: '#a9aa9f' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: jade },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: jade, borderWidth: 2 },
        },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { color: '#677069' } } },
    MuiAutocomplete: {
      styleOverrides: {
        paper: { marginTop: 4, border: `1px solid ${rule}`, backgroundColor: paperLight },
        option: { borderBottom: `1px solid ${alpha(rule, 0.65)}` },
      },
    },
    MuiMenu: { styleOverrides: { paper: { backgroundColor: paperLight, border: `1px solid ${rule}` } } },
    MuiTableContainer: {
      styleOverrides: {
        root: { border: `1px solid ${rule}`, backgroundColor: alpha(paperLight, 0.8), '&:focus-visible': { outline: `3px solid ${alpha(jade, 0.35)}`, outlineOffset: 2 } },
      },
    },
    MuiTableHead: { styleOverrides: { root: { backgroundColor: paperDeep } } },
    MuiTableCell: { styleOverrides: { root: { borderColor: rule }, head: { color: ink, fontWeight: 750, letterSpacing: '0.035em', backgroundColor: paperDeep } } },
    MuiTableRow: { styleOverrides: { root: { '&.MuiTableRow-hover:hover': { backgroundColor: alpha(jade, 0.055) } } } },
    MuiDivider: { styleOverrides: { root: { borderColor: rule } } },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 2, border: `1px solid ${rule}`, alignItems: 'center' },
        standardInfo: { backgroundColor: '#e9eeee' },
        standardSuccess: { backgroundColor: '#e5ede3' },
        standardWarning: { backgroundColor: '#f2e9d7' },
        standardError: { backgroundColor: '#f1dfd9' },
      },
    },
    MuiDialog: { styleOverrides: { paper: { border: `1px solid ${rule}`, backgroundColor: paperLight } } },
    MuiDialogTitle: { styleOverrides: { root: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, color: ink, borderBottom: `1px solid ${rule}` } } },
    MuiToggleButton: { styleOverrides: { root: { borderRadius: 2, color: ink, borderColor: rule, '&.Mui-selected': { color: '#29463d', backgroundColor: alpha(jade, 0.15), boxShadow: `inset 0 -2px ${jade}` } } } },
    MuiStepper: { styleOverrides: { root: { backgroundColor: 'transparent' } } },
    MuiStepIcon: { styleOverrides: { root: { color: '#c7c1b3', '&.Mui-active': { color: seal }, '&.Mui-completed': { color: jade } }, text: { fill: '#fffdf7', fontWeight: 700 } } },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: ink, color: '#fffdf7', borderRadius: 2 } } },
  },
});

// Keep the game-specific vocabulary used by the card/layout components while
// mapping it onto the light website palette.
export const gameColors = {
  charcoal: paper,
  ink: paperLight,
  inkRaised: paperDeep,
  gold,
  goldBright: accessibleGold,
  jade,
  ember: seal,
  purple,
  rule,
  text: ink,
  paper,
  paperLight,
  paperDeep,
  seal,
};
