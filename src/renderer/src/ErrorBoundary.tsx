import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
	error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("[ccw] renderer error:", error, info);
	}

	render() {
		if (this.state.error) {
			return (
				<div style={{ padding: 24, fontFamily: "monospace", color: "#c92a2a" }}>
					<h2>Renderer error</h2>
					<pre style={{ whiteSpace: "pre-wrap" }}>
						{this.state.error.message}
						{"\n\n"}
						{this.state.error.stack}
					</pre>
				</div>
			);
		}
		return this.props.children;
	}
}
