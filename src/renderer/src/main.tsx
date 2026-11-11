import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import MainApp from "./MainApp";
import { ErrorBoundary } from "./ErrorBoundary";
import "./index.css";

window.addEventListener("error", (e) => {
	console.error("[ccw] window error:", e.error ?? e.message);
});
window.addEventListener("unhandledrejection", (e) => {
	console.error("[ccw] unhandled rejection:", e.reason);
});

for (const type of ["dragover", "drop"] as const) {
	window.addEventListener(type, (e) => {
		if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
	});
}

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<ErrorBoundary>
			<HashRouter>
				<MainApp />
			</HashRouter>
		</ErrorBoundary>
	</React.StrictMode>,
);
