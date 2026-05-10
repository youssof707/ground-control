import {
	useEffect,
	useRef,
	useState,
	type ButtonHTMLAttributes,
	type ReactNode,
} from "react";

type AsyncyButtonState = "idle" | "pending" | "error";

type AsyncyButtonProps = Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"onClick" | "disabled"
> & {
	onClick: () => Promise<unknown>;
	children: ReactNode;
};

export default function AsyncyButton({
	onClick,
	children,
	className,
	...rest
}: AsyncyButtonProps) {
	const [state, setState] = useState<AsyncyButtonState>("idle");
	const mounted = useRef(true);

	useEffect(() => {
		return () => {
			mounted.current = false;
		};
	}, []);

	async function handleClick() {
		if (state === "pending") return;
		setState("pending");
		try {
			await onClick();
			if (mounted.current) setState("idle");
		} catch {
			if (mounted.current) setState("error");
		}
	}

	const classes = ["btn"];
	if (state === "error") classes.push("asyncy-btn-error");
	if (className) classes.push(className);

	return (
		<button
			{...rest}
			className={classes.join(" ")}
			onClick={handleClick}
			disabled={state === "pending"}
			aria-busy={state === "pending"}
		>
			{state === "pending" ? (
				<span className="asyncy-btn-spinner" aria-hidden />
			) : (
				children
			)}
		</button>
	);
}
