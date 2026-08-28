import { useId, useState, type ReactNode } from 'react';
import { Box, Button, Collapse, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

interface ResponsiveDisclosureProps {
  children: ReactNode;
  label: string;
  collapseOn?: 'mobile' | 'all-viewports';
  defaultOpen?: boolean;
}

/**
 * By default, keeps content expanded on larger screens while giving mobile
 * users control over dense supporting detail. Callers can opt into disclosure
 * on every viewport. Content remains mounted so state is preserved.
 */
const ResponsiveDisclosure = ({
  children,
  label,
  collapseOn = 'mobile',
  defaultOpen = false,
}: ResponsiveDisclosureProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const disclosureEnabled = collapseOn === 'all-viewports' || isMobile;
  const expanded = !disclosureEnabled || open;

  return (
    <Box>
      {disclosureEnabled && (
        <Button
          type="button"
          variant="outlined"
          size="small"
          fullWidth
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setOpen((current) => !current)}
          startIcon={expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          sx={{ mb: expanded ? 1.5 : 0 }}
        >
          {expanded ? `收起${label}` : `展开${label}`}
        </Button>
      )}
      <Collapse in={expanded} timeout="auto" unmountOnExit={false}>
        <Box id={contentId}>{children}</Box>
      </Collapse>
    </Box>
  );
};

export default ResponsiveDisclosure;
