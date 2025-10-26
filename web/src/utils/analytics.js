import ReactGA from 'react-ga4';

const MEASUREMENT_ID = process.env.REACT_APP_GA_MEASUREMENT_ID || 'G-TT628MS0J2';

// Initialize Google Analytics
export const initGA = () => {
  if (MEASUREMENT_ID) {
    ReactGA.initialize(MEASUREMENT_ID);
    console.log('Google Analytics initialized with ID:', MEASUREMENT_ID);
  } else {
    console.warn('Google Analytics Measurement ID not found');
  }
};

// Track page views
export const logPageView = () => {
  ReactGA.send({ hitType: 'pageview', page: window.location.pathname + window.location.search });
};

// Track custom events
export const logEvent = (category, action, label = null) => {
  ReactGA.event({
    category,
    action,
    label,
  });
};

// Track exceptions/errors
export const logException = (description, fatal = false) => {
  ReactGA.event({
    category: 'Error',
    action: description,
    label: fatal ? 'Fatal' : 'Non-Fatal',
  });
};
