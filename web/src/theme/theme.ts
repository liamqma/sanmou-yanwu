import { createTheme, type Shadows } from '@mui/material/styles';

export const uiColors = {
  neutral: {
    0: '#fffdf8',
    50: '#fbf8ef',
    100: '#f3efe3',
    200: '#e7dfcc',
    300: '#d2c8b4',
    400: '#aaa99f',
    500: '#7a827c',
    600: '#59635d',
    700: '#3f4944',
    800: '#29322e',
    900: '#1d2421',
  },
  jade: {
    50: '#edf3ef',
    100: '#dfe8e2',
    200: '#c4d5cc',
    300: '#9fb9ac',
    400: '#78998a',
    500: '#567b6e',
    600: '#456c5f',
    700: '#36594d',
    800: '#304f45',
    900: '#223b33',
  },
  seal: {
    50: '#f8ece8',
    100: '#f1dfd9',
    200: '#e5c2ba',
    300: '#d4988d',
    400: '#bf6a5e',
    500: '#a8392f',
    600: '#913029',
    700: '#7e2923',
    800: '#65221e',
    900: '#481917',
  },
  gold: {
    50: '#faf5e9',
    100: '#f0e5cf',
    200: '#e2cfaa',
    300: '#cfb37e',
    400: '#b79658',
    500: '#a38147',
    600: '#876b3b',
    700: '#765d31',
    800: '#5f4925',
    900: '#44351d',
  },
  green: {
    50: '#eef4ed',
    100: '#e1eadf',
    300: '#a9c0ad',
    500: '#4f755c',
    700: '#36523f',
    900: '#213428',
  },
  blue: {
    50: '#edf2f3',
    100: '#e1e8e9',
    300: '#a9bcc0',
    500: '#526d75',
    700: '#374e55',
    900: '#22343a',
  },
  purple: {
    50: '#f3eef7',
    100: '#e9e0ef',
    300: '#bda9cf',
    500: '#8b67b8',
    700: '#684d82',
    900: '#453457',
  },
} as const;

const ink = uiColors.neutral[900];
const paper = uiColors.neutral[100];
const paperLight = uiColors.neutral[50];
const paperDeep = uiColors.neutral[200];
const jade = uiColors.jade[600];
const seal = uiColors.seal[500];
const gold = uiColors.gold[500];
const accessibleGold = uiColors.gold[700];
const purple = uiColors.purple[500];
const rule = uiColors.neutral[300];

const subtleShadow = '0 2px 8px rgba(44, 41, 30, 0.06)';
const raisedShadow = '0 8px 24px rgba(44, 41, 30, 0.10)';
const overlayShadow = '0 18px 48px rgba(44, 41, 30, 0.18)';
const themeShadows = [
  'none',
  subtleShadow,
  ...Array(6).fill(raisedShadow),
  ...Array(17).fill(overlayShadow),
] as unknown as Shadows;

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: jade, dark: uiColors.jade[800], light: uiColors.jade[100], contrastText: uiColors.neutral[0] },
    secondary: { main: accessibleGold, dark: uiColors.gold[800], light: uiColors.gold[100], contrastText: uiColors.neutral[0] },
    error: { main: seal, dark: uiColors.seal[700], light: uiColors.seal[100] },
    warning: { main: gold, dark: uiColors.gold[700], light: uiColors.gold[100], contrastText: ink },
    success: { main: uiColors.green[500], dark: uiColors.green[700], light: uiColors.green[100], contrastText: uiColors.neutral[0] },
    info: { main: uiColors.blue[500], dark: uiColors.blue[700], light: uiColors.blue[100], contrastText: uiColors.neutral[0] },
    background: { default: paper, paper: paperLight },
    text: { primary: ink, secondary: uiColors.neutral[600], disabled: uiColors.neutral[500] },
    divider: rule,
    action: {
      hover: uiColors.jade[50],
      selected: uiColors.jade[100],
      disabledBackground: uiColors.neutral[200],
    },
  },
  shape: { borderRadius: 3 },
  spacing: 8,
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    h1: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontSize: '2.5rem', lineHeight: 1.15, fontWeight: 700, letterSpacing: '0.025em', color: ink, '@media (max-width:600px)': { fontSize: '2rem' } },
    h2: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontSize: '2rem', lineHeight: 1.2, fontWeight: 700, letterSpacing: '0.02em', color: ink, '@media (max-width:600px)': { fontSize: '1.75rem' } },
    h3: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontSize: '1.75rem', lineHeight: 1.25, fontWeight: 700, letterSpacing: '0.02em', color: ink, '@media (max-width:600px)': { fontSize: '1.625rem' } },
    h4: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontSize: '1.5rem', lineHeight: 1.3, fontWeight: 700, letterSpacing: '0.018em', color: ink, '@media (max-width:600px)': { fontSize: '1.375rem' } },
    h5: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontSize: '1.25rem', lineHeight: 1.35, fontWeight: 700, letterSpacing: '0.015em', color: ink },
    h6: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontSize: '1rem', lineHeight: 1.45, fontWeight: 700, letterSpacing: '0.012em', color: ink },
    body1: { fontSize: '1rem', lineHeight: 1.65, fontWeight: 400 },
    body2: { fontSize: '0.875rem', lineHeight: 1.6, fontWeight: 400 },
    subtitle1: { fontSize: '1rem', lineHeight: 1.5, fontWeight: 700 },
    subtitle2: { fontSize: '0.875rem', lineHeight: 1.5, fontWeight: 700 },
    caption: { fontSize: '0.75rem', lineHeight: 1.55, fontWeight: 400 },
    button: { fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.025em', textTransform: 'none' },
    overline: { fontSize: '0.75rem', lineHeight: 1.5, fontWeight: 700, letterSpacing: '0.12em', color: seal },
  },
  shadows: themeShadows,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { minWidth: 320, backgroundColor: paper, colorScheme: 'light' },
        body: {
          minWidth: 320,
          backgroundColor: paper,
          backgroundImage: 'none',
        },
        '::selection': { backgroundColor: uiColors.jade[200] },
        '*': { scrollbarColor: `${uiColors.jade[400]} transparent` },
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
          backgroundImage: 'none',
        },
        outlined: { borderColor: rule, boxShadow: 'none' },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: 0,
          backgroundColor: uiColors.neutral[0],
          backgroundImage: 'none',
          boxShadow: subtleShadow,
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
          '&:focus-visible': { outline: `3px solid ${jade}`, outlineOffset: 2 },
        },
        containedPrimary: { backgroundColor: jade, color: uiColors.neutral[0], '&:hover': { backgroundColor: uiColors.jade[700] } },
        outlinedPrimary: { color: ink, borderColor: uiColors.neutral[500], '&:hover': { borderColor: jade, backgroundColor: uiColors.jade[50] } },
        containedSecondary: { color: uiColors.neutral[0], backgroundColor: accessibleGold, '&:hover': { backgroundColor: uiColors.gold[800] } },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 2, '&:focus-visible': { outline: `3px solid ${jade}`, outlineOffset: 2 } } } },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 2, fontWeight: 650, borderColor: rule },
        colorPrimary: { backgroundColor: uiColors.jade[100], color: uiColors.jade[800], borderColor: uiColors.jade[300] },
        colorSecondary: { backgroundColor: uiColors.gold[100], color: uiColors.gold[800], borderColor: uiColors.gold[300] },
        colorWarning: { backgroundColor: uiColors.gold[100], color: uiColors.gold[800] },
        colorSuccess: { backgroundColor: uiColors.green[100], color: uiColors.green[700] },
      },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          backgroundColor: uiColors.neutral[0],
          '& .MuiOutlinedInput-notchedOutline': { borderColor: uiColors.neutral[500] },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: jade },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: jade, borderWidth: 2 },
        },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { color: uiColors.neutral[600] } } },
    MuiAutocomplete: {
      styleOverrides: {
        paper: { marginTop: 4, border: `1px solid ${rule}`, backgroundColor: paperLight },
        option: { borderBottom: `1px solid ${rule}` },
      },
    },
    MuiMenu: { styleOverrides: { paper: { backgroundColor: paperLight, border: `1px solid ${rule}` } } },
    MuiTableContainer: {
      styleOverrides: {
        root: { border: `1px solid ${rule}`, backgroundColor: paperLight, '&:focus-visible': { outline: `3px solid ${jade}`, outlineOffset: 2 } },
      },
    },
    MuiTableHead: { styleOverrides: { root: { backgroundColor: paperDeep } } },
    MuiTableCell: { styleOverrides: { root: { borderColor: rule }, head: { color: ink, fontWeight: 750, letterSpacing: '0.035em', backgroundColor: paperDeep } } },
    MuiTableRow: { styleOverrides: { root: { '&.MuiTableRow-hover:hover': { backgroundColor: uiColors.jade[50] } } } },
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
    MuiDialog: { styleOverrides: { paper: { border: 0, backgroundColor: paperLight, boxShadow: overlayShadow } } },
    MuiDialogTitle: { styleOverrides: { root: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, color: ink, borderBottom: `1px solid ${rule}` } } },
    MuiToggleButton: { styleOverrides: { root: { borderRadius: 2, color: ink, borderColor: rule, '&.Mui-selected': { color: uiColors.jade[900], backgroundColor: uiColors.jade[100], boxShadow: `inset 0 -2px ${jade}` } } } },
    MuiStepper: { styleOverrides: { root: { backgroundColor: 'transparent' } } },
    MuiStepIcon: { styleOverrides: { root: { color: uiColors.neutral[400], '&.Mui-active': { color: seal }, '&.Mui-completed': { color: jade } }, text: { fill: uiColors.neutral[0], fontWeight: 700 } } },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: ink, color: uiColors.neutral[0], borderRadius: 2, boxShadow: raisedShadow } } },
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
