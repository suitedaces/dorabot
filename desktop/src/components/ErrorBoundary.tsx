import { Component, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 p-4 text-muted-foreground">
          <AlertTriangle className="w-5 h-5 text-destructive" />
          <p className="text-xs text-center max-w-[300px]">
            something crashed: {this.state.error.message}
          </p>
          <button
            onClick={this.reset}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-secondary transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// lightweight inline boundary for individual items (tool cards etc)
export class InlineErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[InlineErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center gap-1.5 text-[10px] text-destructive py-0.5 px-2">
          <AlertTriangle className="w-3 h-3" />
          <span>render error</span>
        </div>
      );
    }
    return this.props.children;
  }
}
