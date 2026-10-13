import { useEffect, useRef, useState } from "react";

export function useInView<T extends HTMLElement>(threshold = 0.35) {
	const ref = useRef<T>(null);
	const [inView, setInView] = useState(false);

	useEffect(() => {
		const node = ref.current;
		if (!node) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					setInView(true);
					observer.disconnect();
				}
			},
			{ threshold },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [threshold]);

	return { ref, inView };
}
