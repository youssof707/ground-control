import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
	ScheduleStatusColorSchema,
	type ScheduleStatusColor,
} from "../../shared/schemas/schedules";

export const REPORT_SERVER_NAME = "ground-control";
export const REPORT_TOOL_NAME = `mcp__${REPORT_SERVER_NAME}__report`;

export const REPORT_INSTRUCTIONS = `You are running as a scheduled background job inside Ground Control. Nobody is watching this session. When the job is finished, call the ${REPORT_TOOL_NAME} tool exactly once with a color (green = fine, yellow = degraded or could not check, red = broken) and a status line. Only when a human must act on this right now, also pass alert: a message written directly to the user saying what happened and what they need to do. Routine results, including routine red ones, omit alert. Never ask the user questions.

Both texts are shown in a narrow sidebar widget, on a single line after the schedule's name, and anything longer is cut off with an ellipsis. Unless the job's prompt says otherwise, keep the status line under about 40 characters and the alert under about 60 characters: a terse headline, not a sentence with details. For example "all 12 checks passed", "2 disks above 90%", or for an alert "Hall B CRAC down, rack temps rising". Details belong in your final message in the session, which the user can open from the widget.`;

export const MAX_REPORT_LINE_LENGTH = 140;
export const MAX_ALERT_MESSAGE_LENGTH = 280;

export interface ScheduleReport {
	scheduleId: string;
	sessionId: string;
	color: ScheduleStatusColor;
	line: string;
	alert?: string;
}

export function createScheduleReportServer(
	ids: { scheduleId: string; sessionId: string },
	onReport: (report: ScheduleReport) => void,
) {
	return createSdkMcpServer({
		name: REPORT_SERVER_NAME,
		version: "1.0.0",
		alwaysLoad: true,
		tools: [
			tool(
				"report",
				"Report this scheduled job's outcome to the Ground Control scheduler widget. Call exactly once when the job is done.",
				{
					color: ScheduleStatusColorSchema.describe(
						"green = fine, yellow = degraded or could not check, red = broken",
					),
					line: z
						.string()
						.min(1)
						.max(MAX_REPORT_LINE_LENGTH)
						.describe("Terse status headline, about 40 characters max, shown on one line in a narrow sidebar"),
					alert: z
						.string()
						.min(1)
						.max(MAX_ALERT_MESSAGE_LENGTH)
						.optional()
						.describe(
							"Only if a human must act on this right now: a terse message to the user, about 60 characters max, shown on one line in a narrow sidebar. Omit otherwise",
						),
				},
				async ({ color, line, alert }) => {
					onReport({
						...ids,
						color,
						line: line.trim(),
						alert: alert?.trim() || undefined,
					});
					return { content: [{ type: "text", text: "Status recorded." }] };
				},
			),
		],
	});
}
