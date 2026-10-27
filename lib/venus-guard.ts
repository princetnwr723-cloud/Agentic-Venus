// An error guard for the studio computer: a scene (or the background, or an overlay) that throws while rendering is replaced by a
// plain fallback instead of crashing the whole render. Written to src/guard.tsx on every "prepare".
// NOTE: lives in a template string: no backticks, no dollar-brace sequences.
export const GUARD_SOURCE = String.raw`import React from "react";

type GuardProps = {name?: string; fallback?: any; children?: any};

export class Guard extends React.Component<GuardProps, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() {
    return {failed: true};
  }
  componentDidCatch(error: any) {
    try {
      console.log("VENUS_GUARD " + (this.props.name || "scene") + ": " + String((error && error.message) || error).slice(0, 300));
    } catch (e) {
      // nothing to do
    }
  }
  render() {
    return this.state.failed ? (this.props.fallback === undefined ? null : this.props.fallback) : this.props.children;
  }
}
`;
