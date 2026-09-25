import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  /** Optional custom fallback UI. Defaults to a minimal error card. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Widget-level error boundary that prevents a single feature crash from
 * taking down the entire application. Wrap each top-level widget with this.
 * Per Rule 3: Error Resilience — ErrorBoundary per widget is mandatory.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'react_error_boundary',
        message: error.message,
        componentStack: info.componentStack,
      })
    );
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            padding: '1rem',
            border: '1px solid #ff4d4f',
            borderRadius: '8px',
            color: '#ff4d4f',
            fontSize: '0.875rem',
          }}
          role="alert"
        >
          <strong>Something went wrong.</strong>
          <p style={{ margin: '0.25rem 0 0', opacity: 0.8 }}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
