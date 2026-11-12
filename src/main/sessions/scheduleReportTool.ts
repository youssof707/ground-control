import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
	ScheduleStatusColorSchema,
	type ScheduleStatusColor,
} from "../../shared/schemas/schedules";

export const REPORT_SERVER_NAME = "ground-control";
export const REPORT_TOOL_NAME = `mcp__${REPORT_SERVER_NAME}__report`;

export const REPORT_INSTRUCTIONS = `You are running as a scheduled background job inside Ground Control. Nobody is watching this session. When the job is finished, call the ${REPORT_TOOL_NAME} tool exactly once with a color (green = fine, yellow = degraded or could not check, red = broken) and a status line. This report is the only way to communicate with the user. Never ask the user questions.

The status line is shown in a narrow sidebar widget, on a single line after the schedule's name, and anything longer is cut off with an ellipsis. Unless the job's prompt says otherwise, keep it under about 40 characters: a terse headline, not a sentence with details. For example "all 12 checks passed" or "2 disks above 90%". Details belong in your final message in the session, which the user can open from the widget.`;

export const MAX_REPORT_LINE_LENGTH = 140;

export interface ScheduleReport {
	scheduleId: string;
	sessionId: string;
	color: ScheduleStatusColor;
	line: string;
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
				},
				async ({ color, line }) => {
					onReport({
						...ids,
						color,
						line: line.trim(),
					});
					return { content: [{ type: "text", text: "Status recorded." }] };
				},
			),
		],
	});
}
