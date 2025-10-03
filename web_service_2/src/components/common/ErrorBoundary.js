import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      return (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100vh',
            p: 3,
          }}
        >
          <Paper
            sx={{
              p: 4,
              maxWidth: 600,
              textAlign: 'center',
            }}
          >
            <ErrorOutlineIcon
              sx={{
                fontSize: 64,
                color: 'error.main',
                mb: 2,
              }}
            />
            <Typography variant="h5" gutterBottom>
              Oops! Something went wrong
            </Typography>
            <Typography variant="body1" color="text.secondary" paragraph>
              We're sorry for the inconvenience. The application encountered an unexpected error.
            </Typography>
            
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <Box
                sx={{
                  mt: 3,
                  p: 2,
                  bgcolor: 'grey.100',
                  borderRadius: 1,
                  textAlign: 'left',
                  overflow: 'auto',
                }}
              >
                <Typography variant="caption" component="pre" sx={{ whiteSpace: 'pre-wrap' }}>
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </Typography>
              </Box>
            )}
            
            <Box sx={{ mt: 3, display: 'flex', gap: 2, justifyContent: 'center' }}>
              <Button
                variant="contained"
                onClick={this.handleReset}
              >
                Return to Home
              </Button>
              <Button
                variant="outlined"
                onClick={() => window.location.reload()}
              >
                Reload Page
              </Button>
            </Box>
          </Paper>
        </Box>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
