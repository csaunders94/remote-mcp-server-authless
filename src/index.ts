import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

function createServer(env: any) {
	const server = new McpServer({
		name: "VitalPort Health",
		version: "1.0.0",
	});

	// --------------------------------------------------
	// 1. Latest VitalPort export
	// --------------------------------------------------
	server.registerTool(
		"get_latest_health",
		{
			description:
				"Get the latest Apple Health data received from VitalPort, including sleep, HRV, resting heart rate, steps, energy, exercise, VO2 max, weight and workouts where available.",
			inputSchema: z.object({}),
		},
		async () => {
			const raw = await env.HEALTH_KV.get("latest");

			if (!raw) {
				return {
					content: [
						{
							type: "text",
							text: "No latest health data is currently stored.",
						},
					],
				};
			}

			const data = JSON.parse(raw);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(data, null, 2),
					},
				],
			};
		},
	);

	// --------------------------------------------------
	// 2. Health data for a specific date
	// --------------------------------------------------
	server.registerTool(
		"get_health_day",
		{
			description:
				"Get Apple Health metrics for a specific calendar date. Date must be YYYY-MM-DD.",
			inputSchema: z.object({
				date: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/)
					.describe("Calendar date in YYYY-MM-DD format"),
			}),
		},
		async ({ date }) => {
			const raw = await env.HEALTH_KV.get(`day:${date}`);

			if (!raw) {
				return {
					content: [
						{
							type: "text",
							text: `No health data found for ${date}.`,
						},
					],
				};
			}

			const data = JSON.parse(raw);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(data, null, 2),
					},
				],
			};
		},
	);

	// --------------------------------------------------
	// 3. Multi-day health/recovery summary
	// --------------------------------------------------
	server.registerTool(
		"get_health_summary",
		{
			description:
				"Get recent Apple Health data and averages for coaching and recovery analysis. Includes sleep, HRV, resting heart rate, steps, energy expenditure, exercise minutes, VO2 max and weight where available.",
			inputSchema: z.object({
				days: z
					.number()
					.int()
					.min(1)
					.max(30)
					.default(7)
					.describe("Number of recent calendar days to retrieve"),
			}),
		},
		async ({ days }) => {
			const daily: any[] = [];

			for (let i = 0; i < days; i++) {
				const date = londonDateDaysAgo(i);
				const raw = await env.HEALTH_KV.get(`day:${date}`);

				if (raw) {
					const item = JSON.parse(raw);

					daily.push({
						date,
						...item,
					});
				}
			}

			if (daily.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `No daily health records were found within the last ${days} days.`,
						},
					],
				};
			}

			const summary = {
				daysRequested: days,
				daysFound: daily.length,

				averages: {
					sleepHours: average(daily, "sleepHours"),
					hrv: average(daily, "hrv"),
					restingHeartRate: average(
						daily,
						"restingHeartRate",
					),
					respiratoryRate: average(
						daily,
						"respiratoryRate",
					),
					stepCount: average(daily, "stepCount"),
					walkingRunningDistanceMeters: average(
						daily,
						"walkingRunningDistanceMeters",
					),
					activeEnergyKcal: average(
						daily,
						"activeEnergyKcal",
					),
					restingEnergyKcal: average(
						daily,
						"restingEnergyKcal",
					),
					exerciseMinutes: average(
						daily,
						"exerciseMinutes",
					),
					standMinutes: average(
						daily,
						"standMinutes",
					),
					vo2Max: average(daily, "vo2Max"),
					weightKg: average(daily, "weightKg"),
					bodyFatPercent: average(
						daily,
						"bodyFatPercent",
					),
				},

				daily,
			};

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(summary, null, 2),
					},
				],
			};
		},
	);

	// --------------------------------------------------
	// 4. See which dates actually exist in KV
	// --------------------------------------------------
	server.registerTool(
		"list_health_days",
		{
			description:
				"List the dates for which Apple Health daily snapshots are currently stored.",
			inputSchema: z.object({}),
		},
		async () => {
			const result = await env.HEALTH_KV.list({
				prefix: "day:",
			});

			const dates = result.keys
				.map((key: any) => key.name.replace("day:", ""))
				.sort()
				.reverse();

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								count: dates.length,
								dates,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);

	return server;
}


// --------------------------------------------------
// Helpers
// --------------------------------------------------

function average(items: any[], key: string) {
	const values = items
		.map((item) => item[key])
		.filter(
			(value) =>
				typeof value === "number" &&
				Number.isFinite(value),
		);

	if (values.length === 0) {
		return null;
	}

	const result =
		values.reduce((sum, value) => sum + value, 0) /
		values.length;

	return Math.round(result * 100) / 100;
}


function londonDateDaysAgo(daysAgo: number) {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Europe/London",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date());

	const year = Number(
		parts.find((part) => part.type === "year")?.value,
	);

	const month = Number(
		parts.find((part) => part.type === "month")?.value,
	);

	const day = Number(
		parts.find((part) => part.type === "day")?.value,
	);

	const date = new Date(
		Date.UTC(year, month - 1, day),
	);

	date.setUTCDate(date.getUTCDate() - daysAgo);

	return date.toISOString().slice(0, 10);
}


// --------------------------------------------------
// MCP endpoint
// --------------------------------------------------

export default {
	fetch(
		request: Request,
		env: any,
		ctx: ExecutionContext,
	) {
		const handler = createMcpHandler(
			() => createServer(env),
			{
				route: "/mcp",
			},
		);

		return handler(request, env, ctx);
	},
};
