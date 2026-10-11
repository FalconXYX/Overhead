// src/app/ErrorBoundary.tsx — one boundary per pane, so a crash stays inside its pane.
// No componentDidCatch logging: React 19.3 already logs each caught error once with console.error.
import { Component, type ReactNode } from "react";

export interface PaneErrorProps {
  pane: string;
  message: string;
  onRetry: () => void;
}

/** The fallback a crashed pane shows in place of its content. */
export function PaneError({ pane, message, onRetry }: PaneErrorProps) {
  return (
    <div role="alert">
      <p>{`${pane} stopped working: ${message}`}</p>
      <button type="button" onClick={onRetry}>
        {`Retry ${pane}`}
      </button>
    </div>
  );
}

interface ErrorBoundaryProps {
  pane: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  /** Any thrown value becomes an Error. */
  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  /** Clearing the error re-mounts the children. */
  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return <PaneError pane={this.props.pane} message={error.message} onRetry={this.retry} />;
  }
}
