import { useId, useState, type ReactNode } from 'react';
import { Box, Button, Collapse, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

interface ResponsiveDisclosureProps {
  children: ReactNode;
  label: string;
  defaultMobileOpen?: boolean;
}

/**
 * Keeps content expanded on larger screens while giving mobile users control
 * over dense supporting detail. Content remains mounted so state is preserved.
 */
const ResponsiveDisclosure = ({
  children,
  label,
  defaultMobileOpen = false,
}: ResponsiveDisclosureProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [mobileOpen, setMobileOpen] = useState(defaultMobileOpen);
  const contentId = useId();
  const expanded = !isMobile || mobileOpen;

  return (
    <Box>
      {isMobile && (
        <Button
          type="button"
          variant="outlined"
          size="small"
          fullWidth
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setMobileOpen((open) => !open)}
          startIcon={expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          sx={{ mb: expanded ? 1.5 : 0 }}
        >
          {expanded ? `收起${label}` : `展开${label}`}
        </Button>
      )}
      <Collapse in={expanded} timeout="auto">
        <Box id={contentId}>{children}</Box>
      </Collapse>
    </Box>
  );
};

export default ResponsiveDisclosure;
