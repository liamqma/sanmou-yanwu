import ReactGA from 'react-ga4';

const MEASUREMENT_ID = process.env.REACT_APP_GA_MEASUREMENT_ID;

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
