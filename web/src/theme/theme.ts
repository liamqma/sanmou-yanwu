import { alpha, createTheme } from '@mui/material/styles';

const ink = '#1d2421';
const paper = '#f3efe3';
const paperLight = '#fbf8ef';
const paperDeep = '#e7dfcc';
const jade = '#456c5f';
const seal = '#a8392f';
const gold = '#a38147';
const rule = '#c9c2b1';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: jade, dark: '#304f45', light: '#dfe8e2', contrastText: '#fffdf7' },
    secondary: { main: gold, dark: '#725a2f', light: '#eee2ca', contrastText: '#fffdf7' },
    error: { main: seal, dark: '#7e2923', light: '#f1dfd9' },
    warning: { main: gold, dark: '#725a2f', light: '#f0e5cf' },
    success: { main: '#4f755c', dark: '#36523f', light: '#e1eadf' },
    info: { main: '#526d75', dark: '#374e55', light: '#e1e8e9' },
    background: { default: paper, paper: paperLight },
    text: { primary: ink, secondary: '#667069', disabled: '#979b93' },
    divider: rule,
    action: {
      hover: alpha(jade, 0.07),
      selected: alpha(jade, 0.13),
      disabledBackground: alpha(ink, 0.07),
    },
  },
  shape: { borderRadius: 2 },
  spacing: 8,
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    h1: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.035em' },
    h2: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.03em' },
    h3: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.025em' },
    h4: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.025em' },
    h5: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.025em' },
    h6: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, letterSpacing: '0.02em' },
    button: { fontWeight: 700, letterSpacing: '0.06em', textTransform: 'none' },
    overline: { fontWeight: 700, letterSpacing: '0.16em' },
  },
  shadows: [
    'none',
    '0 8px 24px rgba(44, 41, 30, 0.07)',
    '0 12px 34px rgba(44, 41, 30, 0.09)',
    '0 16px 42px rgba(44, 41, 30, 0.1)',
    '0 20px 50px rgba(44, 41, 30, 0.11)',
    ...Array(20).fill('0 20px 50px rgba(44, 41, 30, 0.12)'),
  ] as any,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { minWidth: 320, backgroundColor: paper },
        body: {
          minWidth: 320,
          backgroundColor: paper,
          backgroundImage: `repeating-linear-gradient(0deg, ${alpha(ink, 0.018)} 0, ${alpha(ink, 0.018)} 1px, transparent 1px, transparent 4px)`,
          backgroundAttachment: 'fixed',
        },
        '::selection': { backgroundColor: alpha(jade, 0.22) },
        '*': { scrollbarColor: `${alpha(jade, 0.45)} transparent` },
      },
    },
    MuiContainer: {
      styleOverrides: { root: { minWidth: 0 } },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: `1px solid ${rule}`,
          boxShadow: '0 10px 30px rgba(44, 41, 30, 0.055)',
        },
        outlined: { borderColor: rule },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: `1px solid ${rule}`,
          backgroundColor: alpha(paperLight, 0.9),
          backgroundImage: 'none',
          boxShadow: '0 10px 30px rgba(44, 41, 30, 0.05)',
        },
      },
    },
    MuiCardContent: {
      styleOverrides: { root: { padding: 24, '&:last-child': { paddingBottom: 24 } } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 40,
          borderRadius: 1,
          paddingInline: 18,
          borderWidth: 1,
          '&:focus-visible': { outline: `3px solid ${alpha(jade, 0.3)}`, outlineOffset: 2 },
        },
        containedPrimary: {
          backgroundColor: seal,
          color: '#fff8e9',
          '&:hover': { backgroundColor: '#8d3028' },
        },
        outlinedPrimary: {
          color: ink,
          borderColor: '#7a837e',
          '&:hover': { borderColor: jade, backgroundColor: alpha(jade, 0.07) },
        },
        containedSecondary: {
          color: '#fffaf0',
          backgroundColor: gold,
          '&:hover': { backgroundColor: '#826637' },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 1,
          '&:focus-visible': { outline: `3px solid ${alpha(jade, 0.3)}`, outlineOffset: 2 },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 1, fontWeight: 650, borderColor: rule },
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
          borderRadius: 1,
          backgroundColor: alpha('#fffdf7', 0.78),
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
    MuiTableContainer: {
      styleOverrides: { root: { border: `1px solid ${rule}`, backgroundColor: alpha(paperLight, 0.74) } },
    },
    MuiTableHead: { styleOverrides: { root: { backgroundColor: paperDeep } } },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: rule },
        head: { color: ink, fontWeight: 750, letterSpacing: '0.035em', backgroundColor: paperDeep },
      },
    },
    MuiTableRow: {
      styleOverrides: { root: { '&.MuiTableRow-hover:hover': { backgroundColor: alpha(jade, 0.055) } } },
    },
    MuiDivider: { styleOverrides: { root: { borderColor: rule } } },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 1, border: `1px solid ${rule}`, alignItems: 'center' },
        standardInfo: { backgroundColor: '#e9eeee' },
        standardSuccess: { backgroundColor: '#e5ede3' },
        standardWarning: { backgroundColor: '#f2e9d7' },
        standardError: { backgroundColor: '#f1dfd9' },
      },
    },
    MuiDialog: {
      styleOverrides: { paper: { border: `1px solid ${rule}`, backgroundColor: paperLight } },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontFamily: '"Songti SC", STSong, Georgia, serif', fontWeight: 700, borderBottom: `1px solid ${rule}` } },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          borderRadius: 1,
          color: ink,
          borderColor: rule,
          '&.Mui-selected': { color: '#29463d', backgroundColor: alpha(jade, 0.15) },
        },
      },
    },
    MuiStepper: {
      styleOverrides: { root: { backgroundColor: 'transparent' } },
    },
    MuiStepIcon: {
      styleOverrides: {
        root: {
          color: '#c7c1b3',
          '&.Mui-active': { color: seal },
          '&.Mui-completed': { color: jade },
        },
        text: { fill: '#fffdf7', fontWeight: 700 },
      },
    },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: ink, color: '#fffdf7', borderRadius: 1 } } },
  },
});
