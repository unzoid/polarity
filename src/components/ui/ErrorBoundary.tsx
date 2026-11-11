import { Component, type ErrorInfo, type ReactNode } from "react";
import { EmptyState } from "./EmptyState";

export type ErrorBoundaryProps = {
  children: ReactNode;
  /** Where this boundary sits, for the console ("page detail", "player", "app"). */
  where: string;
  /** The way out; reloading the window by default (the app has no browser chrome to do it). */
  action?: { label: string; onClick: () => void };
  /** `tv`: the TV screens' note. */
  variant?: "tv";
  /** For parts that sit beside the pages (a toast, a host with nothing of its own on screen): when one fails, it is left out and the rest stays. */
  quiet?: boolean;
};

const reload = { label: "Reload", onClick: () => window.location.reload() };

/**
 * Catches a render error below it and shows a note with a way out, so one broken page, the
 * player or bad data from a source doesn't blank the whole window (critique C4). Pages, the
 * player layer and the root each have one; a page's boundary resets with its key. The parts around the pages (top
 * bar, toasts, hosts) each have one too, the quiet ones drawing nothing when they fail.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.where}] render failed`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <EmptyState variant={this.props.variant} action={this.props.action ?? reload}>
        Something went wrong here.
      </EmptyState>
    );
  }
}
