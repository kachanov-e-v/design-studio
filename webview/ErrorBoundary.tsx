import React from "react";
import { translate, type Language } from "@design-studio/shared/i18n";

/**
 * P2-20: an uncaught render error previously unmounted the whole panel,
 * leaving the user with a blank webview. The boundary keeps the extension
 * usable: it shows a reload affordance instead of nothing. Language comes
 * from <html lang> set by App, which also survives here as a DOM attribute.
 */
interface ErrorBoundaryState {
  error: Error | null;
}

function currentLanguage(): Language {
  return document.documentElement.lang === "en" ? "en" : "ru";
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Surface the failure in the webview console for diagnostics.
    console.error("Design Studio webview crashed:", error);
  }

  private readonly reload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.error) {
      const language = currentLanguage();
      return (
        <div role="alert" style={{ padding: 16 }}>
          <p>
            {translate(language, "app.errorTitle")}: {this.state.error.message}
          </p>
          <button type="button" onClick={this.reload}>{translate(language, "app.reload")}</button>
        </div>
      );
    }
    return this.props.children;
  }
}
