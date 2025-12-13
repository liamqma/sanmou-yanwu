import React, { useEffect } from 'react';
import { Box } from '@mui/material';

/**
 * Google AdSense Ad Component
 * 
 * Usage:
 * <GoogleAd 
 *   adSlot="1234567890" 
 *   adFormat="auto" 
 *   style={{ display: 'block' }}
 *   fullWidthResponsive="true"
 * />
 * 
 * @param {string} adSlot - Your AdSense ad slot ID (e.g., "1234567890")
 * @param {string} adFormat - Ad format: "auto", "rectangle", "horizontal", "vertical"
 * @param {string} fullWidthResponsive - Set to "true" for responsive ads
 * @param {object} style - Additional CSS styles
 */
const GoogleAd = ({ 
  adSlot, 
  adFormat = "auto", 
  fullWidthResponsive = "true",
  style = {},
  className = ""
}) => {
  useEffect(() => {
    try {
      // Push ad to Google AdSense
      if (window.adsbygoogle && adSlot) {
        window.adsbygoogle.push({});
      }
    } catch (err) {
      console.error('AdSense error:', err);
    }
  }, [adSlot]);

  if (!adSlot) {
    return null;
  }

  return (
    <Box 
      className={className}
      sx={{
        display: 'block',
        textAlign: 'center',
        minHeight: '100px',
        ...style
      }}
    >
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client="ca-pub-5812703123862023"
        data-ad-slot={adSlot}
        data-ad-format={adFormat}
        data-full-width-responsive={fullWidthResponsive}
      />
    </Box>
  );
};

export default GoogleAd;

